import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Everything this extension owns on disk lives under one directory in $HOME,
 * created with mode 0700. That permission is the security boundary: the IPC
 * sockets are reachable only by the user who owns them, and no TCP port is
 * ever opened.
 */
export const ROOT = path.join(os.homedir(), '.claude-noti');
export const SOCK_DIR = path.join(ROOT, 'sock');
export const INSTANCES_DIR = path.join(ROOT, 'instances');
export const HOOK_SCRIPT = path.join(ROOT, 'hook.sh');

/** Claude Code's own user-level settings file, which we patch to register hooks. */
export const CLAUDE_USER_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

/** Project-level Claude Code settings, relative to a workspace folder. */
export const CLAUDE_PROJECT_SETTINGS_RELATIVE = path.join('.claude', 'settings.json');

export function socketPath(pid: number): string {
  return path.join(SOCK_DIR, `${pid}.sock`);
}

export function instancePath(pid: number): string {
  return path.join(INSTANCES_DIR, `${pid}.json`);
}

/**
 * macOS caps `sockaddr_un.sun_path` at 104 bytes including the terminator.
 * Our paths are ~45 bytes, but a pathological home directory could overflow,
 * and the failure mode would otherwise be an opaque bind error.
 */
export const MAX_SOCKET_PATH_BYTES = 103;

export function socketPathTooLong(p: string): boolean {
  return Buffer.byteLength(p, 'utf8') > MAX_SOCKET_PATH_BYTES;
}
