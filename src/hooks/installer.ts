import * as fs from 'node:fs';
import * as path from 'node:path';

import { log } from '../log';
import {
  CLAUDE_PROJECT_SETTINGS_RELATIVE,
  CLAUDE_USER_SETTINGS,
  HOOK_SCRIPT,
  ROOT,
} from '../paths';
import { HANDLED_EVENTS } from './payload';

export type HookScope = 'user' | 'project';

/** Bumped whenever resources/hook.sh changes, so `doctor` can spot a stale copy. */
export const HOOK_SCRIPT_VERSION = 1;
const VERSION_MARKER = /^#\s*claude-noti-hook-version:\s*(\d+)/m;

export interface HookStatus {
  settingsFile: string | undefined;
  settingsReadable: boolean;
  /** Every handled event has an entry pointing at our script. */
  installed: boolean;
  /** Events that are registered — a partial install is possible if edited by hand. */
  registeredEvents: string[];
  scriptInstalled: boolean;
  scriptVersion: number | undefined;
}

/**
 * `projectRoot` is passed in rather than read from the editor so that this
 * module — the one that rewrites another tool's configuration file — has no
 * `vscode` dependency and can be exercised directly in tests.
 */
export function settingsFileFor(scope: HookScope, projectRoot: string | undefined): string | undefined {
  if (scope === 'user') {
    return CLAUDE_USER_SETTINGS;
  }
  return projectRoot ? path.join(projectRoot, CLAUDE_PROJECT_SETTINGS_RELATIVE) : undefined;
}

/**
 * Copies resources/hook.sh into ~/.claude-noti/ and marks it executable.
 * The script is kept outside the extension directory on purpose: extension
 * folders are replaced wholesale on every update, which would break the
 * absolute path recorded in Claude Code's settings.
 */
export function installHookScript(extensionPath: string): void {
  const source = path.join(extensionPath, 'resources', 'hook.sh');
  const contents = fs.readFileSync(source, 'utf8');
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  fs.writeFileSync(HOOK_SCRIPT, contents, { mode: 0o755 });
  fs.chmodSync(HOOK_SCRIPT, 0o755);
  log.info('installed hook script at', HOOK_SCRIPT);
}

export function installedScriptVersion(): number | undefined {
  let contents: string;
  try {
    contents = fs.readFileSync(HOOK_SCRIPT, 'utf8');
  } catch {
    return undefined;
  }
  const match = VERSION_MARKER.exec(contents);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

/**
 * Adds our hook to Claude Code's settings for every event we handle.
 *
 * The file belongs to another tool and may contain anything the user has set
 * up, so the write is conservative: parse first and bail out on malformed
 * JSON rather than overwriting it, keep a backup, and add an entry only when
 * an identical one is not already present so repeated runs are a no-op.
 */
export function installHooks(
  scope: HookScope,
  projectRoot: string | undefined,
): { file: string; changed: boolean } {
  const file = requireSettingsFile(scope, projectRoot);
  const settings = readSettings(file);

  const hooks = asRecord(settings.hooks) ?? {};
  settings.hooks = hooks;

  let changed = false;
  for (const event of HANDLED_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    if (!groups.some(groupTargetsOurScript)) {
      groups.push({
        hooks: [{ type: 'command', command: HOOK_SCRIPT, timeout: 5 }],
      });
      changed = true;
    }
    hooks[event] = groups;
  }

  if (changed) {
    backup(file);
    writeSettings(file, settings);
    log.info('registered hooks in', file);
  }
  return { file, changed };
}

/** Removes only the entries pointing at our script, then tidies up what that empties. */
export function uninstallHooks(
  scope: HookScope,
  projectRoot: string | undefined,
): { file: string; changed: boolean } {
  const file = requireSettingsFile(scope, projectRoot);
  const settings = readSettings(file);
  const hooks = asRecord(settings.hooks);
  if (!hooks) {
    return { file, changed: false };
  }

  let changed = false;
  for (const event of HANDLED_EVENTS) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) {
      continue;
    }
    const kept = groups
      .map((group) => stripOurHandlers(group))
      .filter((group) => group !== undefined);
    if (kept.length !== groups.length || kept.some((g, i) => g !== groups[i])) {
      changed = true;
    }
    if (kept.length === 0) {
      delete hooks[event];
    } else {
      hooks[event] = kept;
    }
  }

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }

  if (changed) {
    backup(file);
    writeSettings(file, settings);
    log.info('removed hooks from', file);
  }
  return { file, changed };
}

export function hookStatus(scope: HookScope, projectRoot: string | undefined): HookStatus {
  const file = settingsFileFor(scope, projectRoot);
  const scriptVersion = installedScriptVersion();
  const base: HookStatus = {
    settingsFile: file,
    settingsReadable: false,
    installed: false,
    registeredEvents: [],
    scriptInstalled: scriptVersion !== undefined,
    scriptVersion,
  };
  if (!file) {
    return base;
  }

  let settings: Record<string, unknown>;
  try {
    settings = readSettings(file);
  } catch {
    return base;
  }
  base.settingsReadable = true;

  const hooks = asRecord(settings.hooks);
  if (!hooks) {
    return base;
  }
  for (const event of HANDLED_EVENTS) {
    const groups = hooks[event];
    if (Array.isArray(groups) && groups.some(groupTargetsOurScript)) {
      base.registeredEvents.push(event);
    }
  }
  base.installed = base.registeredEvents.length === HANDLED_EVENTS.length;
  return base;
}

function requireSettingsFile(scope: HookScope, projectRoot: string | undefined): string {
  const file = settingsFileFor(scope, projectRoot);
  if (!file) {
    throw new Error(
      'Project scope needs an open workspace folder on the local filesystem. ' +
        'Open a folder, or set claudeNoti.hookScope to "user".',
    );
  }
  return file;
}

function readSettings(file: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
  if (raw.trim() === '') {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Refusing to write is the whole point here — silently replacing a file we
    // could not understand would destroy the user's Claude Code configuration.
    throw new Error(
      `${file} is not valid JSON, so Claude Noti will not modify it (${String(err)}). ` +
        'Fix the file and try again.',
    );
  }
  const record = asRecord(parsed);
  if (!record) {
    throw new Error(`${file} does not contain a JSON object, so Claude Noti will not modify it.`);
  }
  return record;
}

function writeSettings(file: string, settings: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.claude-noti.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function backup(file: string): void {
  try {
    fs.copyFileSync(file, `${file}.claude-noti.bak`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('could not back up', file, String(err));
    }
  }
}

function groupTargetsOurScript(group: unknown): boolean {
  const handlers = asRecord(group)?.hooks;
  return Array.isArray(handlers) && handlers.some(isOurHandler);
}

function isOurHandler(handler: unknown): boolean {
  const record = asRecord(handler);
  return typeof record?.command === 'string' && record.command === HOOK_SCRIPT;
}

/**
 * Returns the group with our handlers removed, or `undefined` when nothing
 * would be left of it. Groups that never mentioned us are returned untouched
 * (same object identity), which is how the caller detects a real change.
 */
function stripOurHandlers(group: unknown): unknown | undefined {
  const record = asRecord(group);
  const handlers = record?.hooks;
  if (!record || !Array.isArray(handlers) || !handlers.some(isOurHandler)) {
    return group;
  }
  const kept = handlers.filter((handler) => !isOurHandler(handler));
  if (kept.length === 0) {
    return undefined;
  }
  return { ...record, hooks: kept };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
