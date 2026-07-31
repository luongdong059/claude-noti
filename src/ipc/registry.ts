import * as fs from 'node:fs';
import * as path from 'node:path';

import { log } from '../log';
import { INSTANCES_DIR, ROOT, SOCK_DIR, instancePath, socketPath } from '../paths';

/**
 * One record per live VS Code window. The hook script broadcasts every payload
 * to every socket, so each window needs to know about the others in order to
 * decide which one owns a given Claude Code session — see `claimant()` in
 * router.ts. The registry is that shared knowledge, and a plain directory of
 * JSON files is enough: writes are rare, reads are a handful of small files.
 */
export interface InstanceRecord {
  pid: number;
  socket: string;
  workspaceFolders: string[];
  workspaceFile?: string;
  appName: string;
  appPath?: string;
  version: string;
  startedAt: string;
}

export function ensureDirs(): void {
  for (const dir of [ROOT, SOCK_DIR, INSTANCES_DIR]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  // `recursive: true` does not reapply the mode to directories that already
  // exist, so tighten it explicitly in case an earlier version was laxer.
  try {
    fs.chmodSync(ROOT, 0o700);
  } catch (err) {
    log.warn('could not tighten permissions on', ROOT, String(err));
  }
}

export function writeSelf(record: InstanceRecord): void {
  ensureDirs();
  const target = instancePath(record.pid);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function removeSelf(pid: number): void {
  safeUnlink(instancePath(pid));
  safeUnlink(socketPath(pid));
}

export function readAll(): InstanceRecord[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(INSTANCES_DIR);
  } catch {
    return [];
  }
  const records: InstanceRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const record = readRecord(path.join(INSTANCES_DIR, entry));
    if (record) {
      records.push(record);
    }
  }
  return records;
}

/**
 * Removes records whose process is gone, plus sockets with no owning record.
 * VS Code does not guarantee `deactivate()` runs on a crash or a force-quit,
 * so stale entries are expected rather than exceptional.
 */
export function pruneStale(): number {
  let removed = 0;

  for (const record of readAll()) {
    if (!isAlive(record.pid)) {
      removeSelf(record.pid);
      removed += 1;
    }
  }

  let sockets: string[];
  try {
    sockets = fs.readdirSync(SOCK_DIR);
  } catch {
    return removed;
  }
  for (const entry of sockets) {
    if (!entry.endsWith('.sock')) {
      continue;
    }
    const pid = Number.parseInt(entry.slice(0, -'.sock'.length), 10);
    if (!Number.isInteger(pid) || !isAlive(pid)) {
      safeUnlink(path.join(SOCK_DIR, entry));
      removed += 1;
    }
  }

  return removed;
}

/**
 * Signal 0 performs the permission and existence checks without delivering a
 * signal. `EPERM` means the process exists but belongs to someone else, which
 * still counts as alive.
 */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readRecord(file: string): InstanceRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const value = parsed as Partial<InstanceRecord>;
  if (typeof value.pid !== 'number' || typeof value.socket !== 'string') {
    return undefined;
  }
  return {
    pid: value.pid,
    socket: value.socket,
    workspaceFolders: Array.isArray(value.workspaceFolders)
      ? value.workspaceFolders.filter((f): f is string => typeof f === 'string')
      : [],
    workspaceFile: typeof value.workspaceFile === 'string' ? value.workspaceFile : undefined,
    appName: typeof value.appName === 'string' ? value.appName : 'unknown',
    appPath: typeof value.appPath === 'string' ? value.appPath : undefined,
    version: typeof value.version === 'string' ? value.version : '0.0.0',
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : '',
  };
}

function safeUnlink(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('could not remove', file, String(err));
    }
  }
}
