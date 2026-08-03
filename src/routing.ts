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
  // Claude Code only fires this when it is genuinely about to ask the user —
  // tools allowed by a permission rule never reach it — so it needs no
  // filtering of its own beyond the user's own toggle.
  if (event.hook_event_name === 'PermissionRequest') {
    return policy.permissionPrompt ? undefined : 'event-type-off';
  }

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
  /**
   * The whole of what was cut down to fit the banner, shown when the user asks
   * to see everything. Absent when the banner already says all there is.
   */
  detail?: string;
  /** Label for the button that reveals `detail`. */
  action?: string;
}

const MAX_MESSAGE_LENGTH = 160;
export const EXPAND_ACTION = 'Show details';

export function describe(event: HookEvent, contextLabel: string): NotificationContent {
  const subtitle = subtitleFor(event);
  const full = bodyFor(event);
  const body = truncate(full, MAX_MESSAGE_LENGTH);
  // Only offer the button when pressing it would actually reveal something —
  // a button that expands to the same sentence is noise.
  const detail = detailFor(event);
  const hasMore = detail !== undefined && detail.trim() !== body.trim();

  return {
    title: contextLabel ? `Claude Code — ${contextLabel}` : 'Claude Code',
    subtitle,
    message: body,
    // Grouping by session means a newer notification replaces the older one
    // instead of stacking up while you are away.
    group: `claude-noti-${event.session_id ?? 'unknown'}`,
    ...(hasMore ? { detail, action: EXPAND_ACTION } : {}),
  };
}

function bodyFor(event: HookEvent): string {
  if (event.hook_event_name === 'Stop') {
    return event.last_assistant_message ?? 'Claude finished this turn.';
  }
  if (event.hook_event_name === 'PermissionRequest') {
    return describeToolRequest(event);
  }
  return event.message ?? 'Claude needs your attention.';
}

/** The whole text, for when the banner had to cut it short. */
function detailFor(event: HookEvent): string | undefined {
  if (event.hook_event_name === 'PermissionRequest' && event.tool_name === 'AskUserQuestion') {
    return describeQuestionsInFull(event);
  }
  const full = bodyFor(event);
  return full.length > MAX_MESSAGE_LENGTH ? full : undefined;
}

function toolField(event: HookEvent, key: string): string | undefined {
  const value = (event.tool_input ?? {})[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Says what Claude is asking to do, so the notification is worth reading
 * rather than just being an alert that something happened. `description` is
 * Claude's own summary and reads better than the raw command, so it wins when
 * present.
 */
function describeToolRequest(event: HookEvent): string {
  const tool = event.tool_name ?? 'A tool';
  if (tool === 'AskUserQuestion') {
    return describeQuestionsBriefly(event);
  }

  const filePath =
    toolField(event, 'file_path') ?? toolField(event, 'path') ?? toolField(event, 'notebook_path');
  const detail =
    toolField(event, 'description') ??
    toolField(event, 'command') ??
    (filePath && path.basename(filePath));

  return detail ? `${tool}: ${detail}` : `${tool} needs your approval.`;
}

interface ParsedQuestion {
  question: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
}

/**
 * Pulls the questions out of an AskUserQuestion payload. Shaped defensively:
 * this is Claude Code's tool input, not a structure under our control.
 */
function parseQuestions(event: HookEvent): ParsedQuestion[] {
  const raw = (event.tool_input ?? {}).questions;
  if (!Array.isArray(raw)) {
    return [];
  }
  const parsed: ParsedQuestion[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const question = typeof record.question === 'string' ? record.question : '';
    const options: ParsedQuestion['options'] = [];
    if (Array.isArray(record.options)) {
      for (const option of record.options) {
        if (typeof option !== 'object' || option === null) {
          continue;
        }
        const opt = option as Record<string, unknown>;
        if (typeof opt.label === 'string' && opt.label.length > 0) {
          options.push({
            label: opt.label,
            description: typeof opt.description === 'string' ? opt.description : undefined,
          });
        }
      }
    }
    if (question || options.length > 0) {
      parsed.push({ question, options, multiSelect: record.multiSelect === true });
    }
  }
  return parsed;
}

/**
 * What goes on the banner: the question itself and the choices on offer.
 *
 * The options cannot be answered from the notification — Claude Code takes
 * that answer through its own interface, and the PermissionRequest hook can
 * only allow or deny the whole tool call. Naming them is still worth it: it
 * tells you whether the question is worth switching windows for.
 */
function describeQuestionsBriefly(event: HookEvent): string {
  const questions = parseQuestions(event);
  if (questions.length === 0) {
    return 'Claude is waiting for you to choose an option.';
  }
  const first = questions[0];
  if (!first) {
    return 'Claude is waiting for you to choose an option.';
  }
  const labels = first.options.map((option) => option.label).join(' · ');
  const extra = questions.length > 1 ? ` (+${questions.length - 1} more)` : '';
  const head = first.question || 'Claude is waiting for you to choose an option.';
  return labels ? `${head}${extra}\n${labels}` : `${head}${extra}`;
}

/** Every question with every option and its description, for the details view. */
function describeQuestionsInFull(event: HookEvent): string {
  const questions = parseQuestions(event);
  if (questions.length === 0) {
    return 'Claude is waiting for you to choose an option.';
  }
  const blocks = questions.map((entry, index) => {
    const heading = questions.length > 1 ? `${index + 1}. ${entry.question}` : entry.question;
    const mode = entry.multiSelect ? '  (choose any number)' : '';
    const options = entry.options
      .map((option, i) =>
        option.description
          ? `  ${i + 1}. ${option.label}\n     ${option.description}`
          : `  ${i + 1}. ${option.label}`,
      )
      .join('\n');
    return [heading + mode, options].filter(Boolean).join('\n');
  });
  return blocks.join('\n\n');
}

function subtitleFor(event: HookEvent): string {
  if (event.hook_event_name === 'Stop') {
    return 'Finished';
  }
  if (event.hook_event_name === 'PermissionRequest') {
    return event.tool_name === 'AskUserQuestion' ? 'Waiting for your choice' : 'Waiting for permission';
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

/**
 * Line breaks are kept — macOS renders a multi-line banner, and putting the
 * choices on their own line below the question is the whole point of showing
 * them. Runs of spaces and blank lines are still collapsed, since text pulled
 * out of an assistant message carries plenty of both.
 */
function truncate(text: string, limit: number): string {
  const tidy = text
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return tidy.length <= limit ? tidy : `${tidy.slice(0, limit - 1)}…`;
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

/**
 * A modal dialog does not scroll. Given enough text it grows past the bottom
 * of the screen and takes its buttons with it, leaving no way to dismiss it —
 * so what goes into one has to be bounded up front. Deliberately conservative:
 * it must fit the smallest screen this might run on, alongside a title and
 * buttons.
 */
const MAX_MODAL_LINES = 16;
const MAX_MODAL_CHARS = 800;

export interface FittedDetail {
  text: string;
  /** True when text was left out and needs somewhere else to be read. */
  truncated: boolean;
}

export function fitForModal(detail: string): FittedDetail {
  const lines = detail.split('\n');
  let text = detail;
  let truncated = false;

  if (lines.length > MAX_MODAL_LINES) {
    text = lines.slice(0, MAX_MODAL_LINES).join('\n');
    truncated = true;
  }
  if (text.length > MAX_MODAL_CHARS) {
    text = text.slice(0, MAX_MODAL_CHARS);
    truncated = true;
  }
  return truncated ? { text: `${text.trimEnd()}\n…`, truncated } : { text, truncated };
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
