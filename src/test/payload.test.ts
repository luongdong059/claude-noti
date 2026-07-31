import assert from 'node:assert/strict';
import { describe as suite, test } from 'node:test';

import { isHandledEvent, parseHookEvent } from '../hooks/payload';

suite('parseHookEvent', () => {
  test('reads the fields we act on', () => {
    const event = parseHookEvent(
      JSON.stringify({
        hook_event_name: 'Notification',
        session_id: 's1',
        cwd: '/a/b',
        notification_type: 'permission_prompt',
        message: 'needs permission',
        agent_id: 'sub-1',
      }),
    );
    assert.equal(event?.hook_event_name, 'Notification');
    assert.equal(event?.session_id, 's1');
    assert.equal(event?.cwd, '/a/b');
    assert.equal(event?.notification_type, 'permission_prompt');
    assert.equal(event?.message, 'needs permission');
    assert.equal(event?.agent_id, 'sub-1');
  });

  test('rejects malformed JSON rather than throwing', () => {
    assert.equal(parseHookEvent('{not json'), undefined);
  });

  test('rejects payloads that are not objects', () => {
    assert.equal(parseHookEvent('"a string"'), undefined);
    assert.equal(parseHookEvent('[1,2,3]'), undefined);
    assert.equal(parseHookEvent('null'), undefined);
  });

  test('rejects a payload with no event name', () => {
    assert.equal(parseHookEvent(JSON.stringify({ session_id: 's1' })), undefined);
  });

  test('drops fields of the wrong type instead of trusting them', () => {
    const event = parseHookEvent(
      JSON.stringify({ hook_event_name: 'Stop', session_id: 42, message: { a: 1 } }),
    );
    assert.equal(event?.session_id, undefined);
    assert.equal(event?.message, undefined);
  });

  test('treats empty strings as absent', () => {
    const event = parseHookEvent(JSON.stringify({ hook_event_name: 'Stop', cwd: '' }));
    assert.equal(event?.cwd, undefined);
  });
});

suite('isHandledEvent', () => {
  test('accepts the events we register hooks for', () => {
    assert.equal(isHandledEvent({ hook_event_name: 'Notification' }), true);
    assert.equal(isHandledEvent({ hook_event_name: 'Stop' }), true);
  });

  test('rejects everything else', () => {
    assert.equal(isHandledEvent({ hook_event_name: 'PreToolUse' }), false);
  });
});
