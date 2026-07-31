import assert from 'node:assert/strict';
import { describe as suite, test } from 'node:test';

import type { HookEvent } from '../hooks/payload';
import type { InstanceRecord } from '../ipc/registry';
import {
  type EventPolicy,
  Throttle,
  claimant,
  contextLabel,
  describe,
  fallbackClaimant,
  matchLength,
  passesEventPolicy,
} from '../routing';

function instance(pid: number, folders: string[]): InstanceRecord {
  return {
    pid,
    socket: `/tmp/${pid}.sock`,
    workspaceFolders: folders,
    appName: 'Visual Studio Code',
    version: '0.1.0',
    startedAt: '2026-01-01T00:00:00.000Z',
  };
}

const allOn: EventPolicy = {
  permissionPrompt: true,
  idlePrompt: true,
  agentNeedsInput: true,
  stop: true,
};

suite('matchLength', () => {
  test('matches a directory against itself', () => {
    assert.equal(matchLength('/a/b', '/a/b'), 4);
  });

  test('matches a nested directory', () => {
    assert.equal(matchLength('/a/b', '/a/b/c/d'), 4);
  });

  test('ignores trailing separators on either side', () => {
    assert.equal(matchLength('/a/b/', '/a/b'), 4);
  });

  test('does not match a sibling with a shared prefix', () => {
    assert.equal(matchLength('/a/b', '/a/bc'), 0);
  });

  test('is case-insensitive, matching how macOS behaves by default', () => {
    assert.ok(matchLength('/Users/Me/Work', '/users/me/work/app') > 0);
  });
});

suite('claimant', () => {
  test('gives the session to the window with the deepest matching folder', () => {
    const instances = [instance(10, ['/a']), instance(20, ['/a/b'])];
    assert.equal(claimant('/a/b/c', instances), 20);
  });

  test('breaks ties on the lowest pid so every window agrees', () => {
    const instances = [instance(30, ['/a']), instance(20, ['/a']), instance(40, ['/a'])];
    assert.equal(claimant('/a/x', instances), 20);
    // The same registry in a different order must elect the same window,
    // otherwise two windows would both notify.
    assert.equal(claimant('/a/x', [...instances].reverse()), 20);
  });

  test('returns undefined when no window contains the directory', () => {
    assert.equal(claimant('/somewhere/else', [instance(10, ['/a'])]), undefined);
  });

  test('returns undefined without a working directory', () => {
    assert.equal(claimant(undefined, [instance(10, ['/a'])]), undefined);
  });

  test('considers every folder of a multi-root window', () => {
    const instances = [instance(10, ['/x', '/a/b'])];
    assert.equal(claimant('/a/b/c', instances), 10);
  });
});

suite('fallbackClaimant', () => {
  test('elects the lowest pid', () => {
    assert.equal(fallbackClaimant([instance(30, []), instance(11, []), instance(20, [])]), 11);
  });

  test('returns undefined when there are no windows', () => {
    assert.equal(fallbackClaimant([]), undefined);
  });
});

suite('passesEventPolicy', () => {
  const notification = (type: string): HookEvent => ({
    hook_event_name: 'Notification',
    notification_type: type,
  });

  test('allows a permission prompt', () => {
    assert.equal(passesEventPolicy(notification('permission_prompt'), allOn), undefined);
  });

  test('honours a disabled event type', () => {
    assert.equal(
      passesEventPolicy(notification('permission_prompt'), { ...allOn, permissionPrompt: false }),
      'event-type-off',
    );
  });

  test('treats MCP elicitation as an agent-input event', () => {
    assert.equal(
      passesEventPolicy(notification('elicitation_dialog'), { ...allOn, agentNeedsInput: false }),
      'event-type-off',
    );
  });

  test('ignores notification types that do not need the user', () => {
    assert.equal(passesEventPolicy(notification('auth_success'), allOn), 'event-type-off');
    assert.equal(passesEventPolicy(notification('agent_completed'), allOn), 'event-type-off');
  });

  test('allows the end of a turn', () => {
    assert.equal(passesEventPolicy({ hook_event_name: 'Stop' }, allOn), undefined);
  });

  test('always ignores a subagent finishing, however the toggles are set', () => {
    const event: HookEvent = { hook_event_name: 'Stop', agent_id: 'sub-1' };
    assert.equal(passesEventPolicy(event, allOn), 'subagent-stop');
  });

  test('rejects events we never registered for', () => {
    assert.equal(passesEventPolicy({ hook_event_name: 'PreToolUse' }, allOn), 'unhandled-event');
  });
});

suite('describe', () => {
  test('uses the notification message and groups by session', () => {
    const content = describe(
      {
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission to use Bash',
        session_id: 'abc',
      },
      'my-project',
    );
    assert.equal(content.title, 'Claude Code — my-project');
    assert.equal(content.subtitle, 'Waiting for permission');
    assert.equal(content.message, 'Claude needs your permission to use Bash');
    assert.equal(content.group, 'claude-noti-abc');
  });

  test('summarises the assistant message on Stop', () => {
    const content = describe(
      {
        hook_event_name: 'Stop',
        last_assistant_message: `${'x'.repeat(400)}`,
        session_id: 'abc',
      },
      'proj',
    );
    assert.equal(content.subtitle, 'Finished');
    assert.ok(content.message.length <= 160);
    assert.ok(content.message.endsWith('…'));
  });

  test('collapses newlines so the banner stays on one line', () => {
    const content = describe(
      { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'a\n\n  b' },
      'proj',
    );
    assert.equal(content.message, 'a b');
  });
});

suite('contextLabel', () => {
  test('prefers the workspace file name', () => {
    assert.equal(contextLabel('/a/b', ['/a/b'], '/x/team.code-workspace'), 'team');
  });

  test('uses the matching folder name', () => {
    assert.equal(contextLabel('/a/b/c', ['/other', '/a/b'], undefined), 'b');
  });

  test('falls back to the working directory name', () => {
    assert.equal(contextLabel('/somewhere/deep', ['/a'], undefined), 'deep');
  });
});

suite('Throttle', () => {
  test('drops a repeat inside the window', () => {
    const throttle = new Throttle(1000);
    assert.equal(throttle.allow('s1', 0), true);
    assert.equal(throttle.allow('s1', 500), false);
    assert.equal(throttle.allow('s1', 1500), true);
  });

  test('tracks sessions independently', () => {
    const throttle = new Throttle(1000);
    assert.equal(throttle.allow('s1', 0), true);
    assert.equal(throttle.allow('s2', 0), true);
  });

  test('lets everything through when disabled', () => {
    const throttle = new Throttle(0);
    assert.equal(throttle.allow('s1', 0), true);
    assert.equal(throttle.allow('s1', 0), true);
  });
});
