import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe as suite, test } from 'node:test';

import { hookStatus, installHooks, uninstallHooks } from '../hooks/installer';
import { HANDLED_EVENTS } from '../hooks/payload';
import { platform } from '../platform';

const EVERY_EVENT = [...HANDLED_EVENTS].sort();
const HOOK_SCRIPT = platform().hookScript().command;

/**
 * These exercise the riskiest code in the extension: it rewrites a
 * configuration file that belongs to Claude Code and that the user may have
 * customised heavily. Every test uses `project` scope pointed at a temporary
 * directory, so the real ~/.claude/settings.json is never touched.
 */

let root: string;
let settingsFile: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-noti-test-'));
  settingsFile = path.join(root, '.claude', 'settings.json');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(contents: unknown): void {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(contents, null, 2));
}

function read(): Record<string, any> {
  return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
}

suite('installHooks', () => {
  test('creates the settings file when none exists', () => {
    const result = installHooks('project', root);
    assert.equal(result.changed, true);
    assert.equal(result.file, settingsFile);

    const settings = read();
    assert.deepEqual(Object.keys(settings.hooks).sort(), EVERY_EVENT);
    assert.equal(settings.hooks.Notification[0].hooks[0].command, HOOK_SCRIPT);
    assert.equal(settings.hooks.Notification[0].hooks[0].type, 'command');
  });

  test('is idempotent, so running it twice changes nothing', () => {
    installHooks('project', root);
    const before = fs.readFileSync(settingsFile, 'utf8');

    const second = installHooks('project', root);
    assert.equal(second.changed, false);
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), before);
  });

  test('leaves unrelated settings and unrelated hooks untouched', () => {
    write({
      model: 'opus',
      permissions: { allow: ['Bash(ls)'] },
      hooks: {
        Notification: [{ hooks: [{ type: 'command', command: '/usr/bin/afplay beep.aiff' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/check.sh' }] }],
      },
    });

    installHooks('project', root);
    const settings = read();

    assert.equal(settings.model, 'opus');
    assert.deepEqual(settings.permissions.allow, ['Bash(ls)']);
    assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, '/check.sh');
    assert.equal(settings.hooks.Notification.length, 2);
    assert.equal(settings.hooks.Notification[0].hooks[0].command, '/usr/bin/afplay beep.aiff');
    assert.equal(settings.hooks.Notification[1].hooks[0].command, HOOK_SCRIPT);
  });

  test('refuses to rewrite a file it cannot parse', () => {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, '{ this is not json');

    assert.throws(() => installHooks('project', root), /not valid JSON/);
    // The user's file must survive our refusal untouched.
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{ this is not json');
  });

  test('refuses a settings file that is not a JSON object', () => {
    write([1, 2, 3]);
    assert.throws(() => installHooks('project', root), /does not contain a JSON object/);
  });

  test('backs the file up before the first change', () => {
    write({ model: 'opus' });
    installHooks('project', root);
    assert.equal(JSON.parse(fs.readFileSync(`${settingsFile}.claude-noti.bak`, 'utf8')).model, 'opus');
  });

  test('reports an unusable scope instead of writing somewhere unexpected', () => {
    assert.throws(() => installHooks('project', undefined), /needs an open workspace folder/);
  });
});

suite('uninstallHooks', () => {
  test('removes our entries and the keys they emptied', () => {
    installHooks('project', root);
    const result = uninstallHooks('project', root);

    assert.equal(result.changed, true);
    assert.equal(read().hooks, undefined);
  });

  test('restores the file to what it was before installing', () => {
    write({ model: 'opus', permissions: { allow: ['Bash(ls)'] } });
    const original = read();

    installHooks('project', root);
    uninstallHooks('project', root);

    assert.deepEqual(read(), original);
  });

  test('keeps other people’s hooks for the same event', () => {
    write({
      hooks: {
        Notification: [{ hooks: [{ type: 'command', command: '/usr/bin/afplay beep.aiff' }] }],
      },
    });
    installHooks('project', root);
    uninstallHooks('project', root);

    const settings = read();
    assert.equal(settings.hooks.Notification.length, 1);
    assert.equal(settings.hooks.Notification[0].hooks[0].command, '/usr/bin/afplay beep.aiff');
  });

  test('keeps sibling handlers inside a group we partly own', () => {
    write({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: HOOK_SCRIPT },
              { type: 'command', command: '/other.sh' },
            ],
          },
        ],
      },
    });
    uninstallHooks('project', root);

    const settings = read();
    assert.equal(settings.hooks.Stop[0].hooks.length, 1);
    assert.equal(settings.hooks.Stop[0].hooks[0].command, '/other.sh');
  });

  test('is a no-op when nothing of ours is installed', () => {
    write({ model: 'opus' });
    assert.equal(uninstallHooks('project', root).changed, false);
  });
});

suite('hookStatus', () => {
  test('reports a complete install', () => {
    installHooks('project', root);
    const status = hookStatus('project', root);

    assert.equal(status.installed, true);
    assert.deepEqual(status.registeredEvents.sort(), EVERY_EVENT);
    assert.equal(status.settingsReadable, true);
  });

  test('reports a hand-edited partial install', () => {
    write({ hooks: { Stop: [{ hooks: [{ type: 'command', command: HOOK_SCRIPT }] }] } });
    const status = hookStatus('project', root);

    assert.equal(status.installed, false);
    assert.deepEqual(status.registeredEvents, ['Stop']);
  });

  test('reports nothing installed for a missing file', () => {
    const status = hookStatus('project', root);
    assert.equal(status.installed, false);
    assert.deepEqual(status.registeredEvents, []);
  });
});
