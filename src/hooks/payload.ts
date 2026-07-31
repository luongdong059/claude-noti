/**
 * Shapes of the JSON that Claude Code writes to a hook's stdin.
 * Only the fields this extension actually reads are modelled; Claude Code is
 * free to add more and older payloads are free to omit them, so every field
 * beyond `hook_event_name` is treated as optional at runtime.
 */

export const HANDLED_EVENTS = ['Notification', 'Stop'] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

/** Notification types Claude Code emits that are worth interrupting the user for. */
export const NOTIFICATION_TYPES = [
  'permission_prompt',
  'idle_prompt',
  'agent_needs_input',
  'elicitation_dialog',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface HookEvent {
  hook_event_name: string;
  session_id?: string;
  prompt_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  /** Present on `Notification` events. */
  notification_type?: string;
  /** Present on `Notification` events — the human-readable text. */
  message?: string;
  /** Present on `Stop` events. */
  last_assistant_message?: string;
  /** Present only when the event came from a subagent rather than the main loop. */
  agent_id?: string;
  agent_type?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Parses a hook payload defensively. Anything that is not an object with a
 * string `hook_event_name` is rejected, and every other field is copied only
 * when it has the expected type — the payload arrives over a socket, so it is
 * treated as untrusted input rather than a trusted internal structure.
 */
export function parseHookEvent(raw: string): HookEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const name = optionalString(value.hook_event_name);
  if (!name) {
    return undefined;
  }
  return {
    hook_event_name: name,
    session_id: optionalString(value.session_id),
    prompt_id: optionalString(value.prompt_id),
    transcript_path: optionalString(value.transcript_path),
    cwd: optionalString(value.cwd),
    permission_mode: optionalString(value.permission_mode),
    notification_type: optionalString(value.notification_type),
    message: optionalString(value.message),
    last_assistant_message: optionalString(value.last_assistant_message),
    agent_id: optionalString(value.agent_id),
    agent_type: optionalString(value.agent_type),
  };
}

export function isHandledEvent(event: HookEvent): boolean {
  return (HANDLED_EVENTS as readonly string[]).includes(event.hook_event_name);
}
