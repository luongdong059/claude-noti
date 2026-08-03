import assert from 'node:assert/strict';
import { describe as suite, test } from 'node:test';

import type { HookEvent } from '../hooks/payload';
import type { InstanceRecord } from '../ipc/registry';
import {
  type EventPolicy,
  EXPAND_ACTION,
  Throttle,
  claimant,
  contextLabel,
  describe,
  fallbackClaimant,
  fitForModal,
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

  test('ignores notification types that report something already handled', () => {
    for (const type of [
      'auth_success',
      'agent_completed',
      'elicitation_complete',
      'elicitation_response',
    ]) {
      assert.equal(passesEventPolicy(notification(type), allOn), 'event-type-off', type);
    }
  });

  test('passes a notification whose type is missing', () => {
    // Older Claude Code builds omit notification_type. Dropping those would
    // silently swallow the permission prompts this exists to surface.
    assert.equal(passesEventPolicy({ hook_event_name: 'Notification' }, allOn), undefined);
  });

  test('passes a notification type it has never seen before', () => {
    assert.equal(passesEventPolicy(notification('some_future_type'), allOn), undefined);
  });

  test('stays quiet about unknown types when every event is switched off', () => {
    const allOff: EventPolicy = {
      permissionPrompt: false,
      idlePrompt: false,
      agentNeedsInput: false,
      stop: false,
    };
    assert.equal(passesEventPolicy(notification('some_future_type'), allOff), 'event-type-off');
    assert.equal(passesEventPolicy({ hook_event_name: 'Notification' }, allOff), 'event-type-off');
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

  test('allows a permission request', () => {
    const event: HookEvent = { hook_event_name: 'PermissionRequest', tool_name: 'Bash' };
    assert.equal(passesEventPolicy(event, allOn), undefined);
    assert.equal(
      passesEventPolicy(event, { ...allOn, permissionPrompt: false }),
      'event-type-off',
    );
  });
});

suite('describe for a permission request', () => {
  const label = 'proj';

  test('prefers Claude’s own description of the command', () => {
    const content = describe(
      {
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'curl -sS https://example.com', description: 'Fetch example.com' },
      },
      label,
    );
    assert.equal(content.subtitle, 'Waiting for permission');
    assert.equal(content.message, 'Bash: Fetch example.com');
  });

  test('falls back to the raw command', () => {
    const content = describe(
      { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf x' } },
      label,
    );
    assert.equal(content.message, 'Bash: rm -rf x');
  });

  test('names the file for an edit, without the full path', () => {
    const content = describe(
      {
        hook_event_name: 'PermissionRequest',
        tool_name: 'Edit',
        tool_input: { file_path: '/a/b/c/router.ts' },
      },
      label,
    );
    assert.equal(content.message, 'Edit: router.ts');
  });

  test('says a choice is waiting for AskUserQuestion', () => {
    const content = describe(
      { hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' },
      label,
    );
    assert.equal(content.subtitle, 'Waiting for your choice');
    assert.equal(content.message, 'Claude is waiting for you to choose an option.');
  });

  test('copes with a tool it knows nothing about', () => {
    const content = describe(
      { hook_event_name: 'PermissionRequest', tool_name: 'mcp__x__y' },
      label,
    );
    assert.equal(content.message, 'mcp__x__y needs your approval.');
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

  test('collapses runs of space and blank lines but keeps single breaks', () => {
    const content = describe(
      { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'a  b\n\n  c' },
      'proj',
    );
    assert.equal(content.message, 'a b\nc');
  });

  test('offers a details button only when there is more to read', () => {
    const short = describe(
      { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'short' },
      'proj',
    );
    assert.equal(short.action, undefined);
    assert.equal(short.detail, undefined);

    const long = describe(
      { hook_event_name: 'Stop', last_assistant_message: 'x'.repeat(400) },
      'proj',
    );
    assert.equal(long.action, EXPAND_ACTION);
    assert.equal(long.detail?.length, 400);
  });
});

suite('describe for a question with options', () => {
  const event: HookEvent = {
    hook_event_name: 'PermissionRequest',
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [
        {
          question: 'What next?',
          options: [
            { label: 'Reservations', description: 'Build the day and week timeline.' },
            { label: 'Push notifications', description: 'Reconnect the dispatch cron.' },
          ],
          multiSelect: false,
        },
      ],
    },
  };

  test('puts the question and the choices on the banner', () => {
    const content = describe(event, 'proj');
    assert.equal(content.subtitle, 'Waiting for your choice');
    assert.equal(content.message, 'What next?\nReservations · Push notifications');
  });

  test('keeps every option and its description for the details view', () => {
    const content = describe(event, 'proj');
    assert.equal(content.action, EXPAND_ACTION);
    assert.match(content.detail ?? '', /What next\?/);
    assert.match(content.detail ?? '', /1\. Reservations/);
    assert.match(content.detail ?? '', /Build the day and week timeline\./);
    assert.match(content.detail ?? '', /2\. Push notifications/);
  });

  test('says how many more questions are waiting', () => {
    const many: HookEvent = {
      ...event,
      tool_input: {
        questions: [
          { question: 'First?', options: [{ label: 'A' }] },
          { question: 'Second?', options: [{ label: 'B' }] },
        ],
      },
    };
    assert.match(describe(many, 'proj').message, /First\? \(\+1 more\)/);
  });

  test('marks a question that takes more than one answer', () => {
    const multi: HookEvent = {
      ...event,
      tool_input: {
        questions: [{ question: 'Which ones?', options: [{ label: 'A' }], multiSelect: true }],
      },
    };
    assert.match(describe(multi, 'proj').detail ?? '', /choose any number/);
  });

  test('falls back gracefully when the payload carries no questions', () => {
    const bare: HookEvent = { hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' };
    assert.equal(describe(bare, 'proj').message, 'Claude is waiting for you to choose an option.');
  });

  test('ignores malformed entries instead of throwing', () => {
    const junk: HookEvent = {
      ...event,
      tool_input: { questions: [null, 'nope', { question: 'Real?', options: [{ label: 'Yes' }] }] },
    };
    assert.equal(describe(junk, 'proj').message, 'Real?\nYes');
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

suite('fitForModal', () => {
  test('leaves short text alone', () => {
    const fitted = fitForModal('one\ntwo');
    assert.equal(fitted.text, 'one\ntwo');
    assert.equal(fitted.truncated, false);
  });

  test('caps the number of lines', () => {
    // A modal cannot scroll: too many lines pushes its buttons off the bottom
    // of the screen and the dialog can no longer be dismissed at all.
    const fitted = fitForModal(Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n'));
    assert.equal(fitted.truncated, true);
    assert.ok(fitted.text.split('\n').length <= 17, 'kept at most the line budget plus the ellipsis');
    assert.ok(fitted.text.endsWith('…'));
  });

  test('caps the number of characters even on a single line', () => {
    const fitted = fitForModal('x'.repeat(5000));
    assert.equal(fitted.truncated, true);
    assert.ok(fitted.text.length < 1000);
  });

  test('reports truncation so the caller can offer the full text elsewhere', () => {
    assert.equal(fitForModal('short').truncated, false);
    assert.equal(fitForModal('y'.repeat(2000)).truncated, true);
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
