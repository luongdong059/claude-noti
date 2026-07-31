import * as path from 'node:path';

import type { HookEvent } from './hooks/payload';
import type { InstanceRecord } from './ipc/registry';

/**
 * Pure routing logic, deliberately free of any `vscode` import so it can be
 * unit-tested with plain Node. Everything that needs the editor API lives in
 * router.ts, which is a thin wrapper over these functions.
 */

export interface EventPolicy {
  permissionPrompt: boolean;
  idlePrompt: boolean;
  agentNeedsInput: boolean;
  stop: boolean;
}

export type SkipReason =
  | 'disabled'
  | 'unhandled-event'
  | 'subagent-stop'
  | 'event-type-off'
  | 'not-claimant'
  | 'muted'
  | 'throttled'
  | 'window-focused';

/**
 * macOS filesystems are case-insensitive by default, and Claude Code reports a
 * `cwd` that may differ in case from the path VS Code opened. Comparing
 * case-insensitively matches how the filesystem actually behaves.
 */
function normalize(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  return (trimmed === '' ? '/' : trimmed).toLowerCase();
}

/**
 * Length of the match between a workspace folder and a working directory, or 0
 * when the directory is not inside the folder. Longer means more specific, so
 * a nested workspace beats its parent.
 */
export function matchLength(folder: string, cwd: string): number {
  const f = normalize(folder);
  const c = normalize(cwd);
  if (c === f) {
    return f.length;
  }
  return c.startsWith(`${f}/`) ? f.length : 0;
}

export function bestMatch(record: InstanceRecord, cwd: string): number {
  let best = 0;
  for (const folder of record.workspaceFolders) {
    best = Math.max(best, matchLength(folder, cwd));
  }
  return best;
}

/**
 * Decides which window owns a Claude Code session, given the working directory
 * the hook reported.
 *
 * The hook script broadcasts to every window, so without this every open
 * window would fire its own notification. Each window runs this same function
 * over the same registry and therefore reaches the same answer without any
 * coordination: deepest matching workspace folder wins, lowest pid breaks ties.
 *
 * Returns `undefined` when no open window contains the directory.
 */
export function claimant(cwd: string | undefined, instances: InstanceRecord[]): number | undefined {
  if (!cwd) {
    return undefined;
  }
  let winner: { pid: number; score: number } | undefined;
  for (const record of instances) {
    const score = bestMatch(record, cwd);
    if (score === 0) {
      continue;
    }
    if (!winner || score > winner.score || (score === winner.score && record.pid < winner.pid)) {
      winner = { pid: record.pid, score };
    }
  }
  return winner?.pid;
}

/** Elects a single window to handle sessions that belong to no open workspace. */
export function fallbackClaimant(instances: InstanceRecord[]): number | undefined {
  let lowest: number | undefined;
  for (const record of instances) {
    if (lowest === undefined || record.pid < lowest) {
      lowest = record.pid;
    }
  }
  return lowest;
}

/**
 * Notification types that report something already dealt with. These are the
 * only ones worth staying quiet about, so they are listed explicitly rather
 * than being whatever falls through a switch.
 */
const ALREADY_HANDLED_TYPES = new Set([
  'auth_success',
  'elicitation_complete',
  'elicitation_response',
  'agent_completed',
]);

/**
 * Whether the user asked to be told about this kind of event.
 *
 * `Stop` events carrying an `agent_id` come from a subagent finishing rather
 * than the turn ending. A single turn can spawn many subagents, so surfacing
 * those would turn a useful signal into a stream of noise.
 *
 * A notification whose type is unrecognised — or missing, which older Claude
 * Code builds do — is passed through rather than dropped. Claude Code only
 * raises a Notification when it wants the user, and a missed permission prompt
 * is precisely the failure this extension exists to prevent; an extra
 * notification costs far less than a session sitting blocked for an hour.
 */
export function passesEventPolicy(event: HookEvent, policy: EventPolicy): SkipReason | undefined {
  if (event.hook_event_name === 'Stop') {
    if (event.agent_id) {
      return 'subagent-stop';
    }
    return policy.stop ? undefined : 'event-type-off';
  }

  if (event.hook_event_name !== 'Notification') {
    return 'unhandled-event';
  }

  switch (event.notification_type) {
    case 'permission_prompt':
      return policy.permissionPrompt ? undefined : 'event-type-off';
    case 'idle_prompt':
      return policy.idlePrompt ? undefined : 'event-type-off';
    case 'agent_needs_input':
    case 'elicitation_dialog':
      return policy.agentNeedsInput ? undefined : 'event-type-off';
  }

  if (event.notification_type && ALREADY_HANDLED_TYPES.has(event.notification_type)) {
    return 'event-type-off';
  }

  const wantsAnyNotification =
    policy.permissionPrompt || policy.idlePrompt || policy.agentNeedsInput;
  return wantsAnyNotification ? undefined : 'event-type-off';
}

export interface NotificationContent {
  title: string;
  subtitle: string;
  message: string;
  group: string;
}

const MAX_MESSAGE_LENGTH = 160;

export function describe(event: HookEvent, contextLabel: string): NotificationContent {
  const subtitle = subtitleFor(event);
  const body =
    event.hook_event_name === 'Stop'
      ? truncate(event.last_assistant_message ?? 'Claude finished this turn.', MAX_MESSAGE_LENGTH)
      : truncate(event.message ?? 'Claude needs your attention.', MAX_MESSAGE_LENGTH);

  return {
    title: contextLabel ? `Claude Code — ${contextLabel}` : 'Claude Code',
    subtitle,
    message: body,
    // Grouping by session means a newer notification replaces the older one
    // instead of stacking up while you are away.
    group: `claude-noti-${event.session_id ?? 'unknown'}`,
  };
}

function subtitleFor(event: HookEvent): string {
  if (event.hook_event_name === 'Stop') {
    return 'Finished';
  }
  switch (event.notification_type) {
    case 'permission_prompt':
      return 'Waiting for permission';
    case 'idle_prompt':
      return 'Waiting for your input';
    case 'agent_needs_input':
      return 'A subagent needs an answer';
    case 'elicitation_dialog':
      return 'An MCP server needs an answer';
    default:
      return 'Needs attention';
  }
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** Human-readable label for the notification title: the workspace folder name. */
export function contextLabel(
  cwd: string | undefined,
  workspaceFolders: string[],
  workspaceFile: string | undefined,
): string {
  if (workspaceFile) {
    return path.basename(workspaceFile, path.extname(workspaceFile));
  }
  if (cwd) {
    let best: { folder: string; score: number } | undefined;
    for (const folder of workspaceFolders) {
      const score = matchLength(folder, cwd);
      if (score > 0 && (!best || score > best.score)) {
        best = { folder, score };
      }
    }
    if (best) {
      return path.basename(best.folder);
    }
    return path.basename(cwd);
  }
  return workspaceFolders[0] ? path.basename(workspaceFolders[0]) : '';
}

/** Drops repeats for the same session that arrive inside the configured window. */
export class Throttle {
  private readonly last = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  allow(key: string, now: number): boolean {
    if (this.windowMs <= 0) {
      return true;
    }
    const previous = this.last.get(key);
    if (previous !== undefined && now - previous < this.windowMs) {
      return false;
    }
    this.last.set(key, now);
    return true;
  }

  clear(): void {
    this.last.clear();
  }
}
