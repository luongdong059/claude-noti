import type { Settings } from '../config';
import type { Notifier } from '../notify';
import { DarwinPlatform } from './darwin';

/**
 * Everything that differs between operating systems, behind one interface.
 *
 * The alternative — `if (process.platform === ...)` scattered through the
 * codebase — would put OS branches inside the routing and event logic, which
 * is the part that has nothing to do with the OS and is covered by the unit
 * tests. Keeping the split here means `routing.ts`, `payload.ts` and the rest
 * stay platform-agnostic and testable under plain Node.
 *
 * Nothing in this directory may import `vscode`. Raising a window and posting
 * a notification are OS operations; running editor commands afterwards is not,
 * and lives in `focus.ts`.
 */

export interface SoundOption {
  /** What gets written to the setting. */
  name: string;
  /** Absolute path, when the sound can be previewed. */
  file?: string;
  /** Short label describing where it came from. */
  source: string;
}

export interface HookScript {
  /** Absolute path the script is installed to. */
  path: string;
  /** Name of the file shipped in `resources/`. */
  resource: string;
  /** The `command` string written into Claude Code's settings. */
  command: string;
}

export interface Platform {
  readonly id: NodeJS.Platform;
  readonly supported: boolean;
  /** Shown to the user when this OS is not supported. */
  readonly unsupportedReason?: string;

  /** Resolves anything that needs probing the system. Called once, at activation. */
  init(extensionPath: string): Promise<void>;

  /** Unix domain socket path, or a named pipe on Windows. */
  ipcEndpoint(pid: number): string;
  /** Removes a leftover endpoint belonging to a process that is gone. */
  cleanupEndpoint(pid: number): void;

  createNotifier(settings: Settings): Notifier;

  /** Brings the window that has this workspace open to the front. */
  raiseWindow(workspacePath: string | undefined): Promise<void>;

  hookScript(): HookScript;
  listSounds(): SoundOption[];

  /** Lines appended to the diagnostics report, describing OS-specific state. */
  doctorLines(settings: Settings): Promise<string[]>;

  dispose(): void;
}

let current: Platform | undefined;

export function platform(): Platform {
  if (!current) {
    current = select();
  }
  return current;
}

/**
 * Replaces the detected platform. Exists so that logic depending on
 * platform-shaped values — the hook installer above all — can be tested on any
 * operating system rather than only the one it happens to run on. Pass
 * `undefined` to go back to detection.
 */
export function setPlatform(next: Platform | undefined): void {
  current = next;
}

function select(): Platform {
  // Implementations are imported statically — esbuild bundles the whole
  // extension into one file regardless, and nothing in them runs until an
  // instance is constructed.
  switch (process.platform) {
    case 'darwin':
      return new DarwinPlatform();
    default:
      return new UnsupportedPlatform();
  }
}

/** Stands in on operating systems with no implementation yet. */
class UnsupportedPlatform implements Platform {
  readonly id = process.platform;
  readonly supported = false;
  readonly unsupportedReason = `Claude Noti has no support for ${process.platform} yet — it currently works on macOS only.`;

  async init(): Promise<void> {}
  ipcEndpoint(): string {
    throw new Error(this.unsupportedReason);
  }
  cleanupEndpoint(): void {}
  createNotifier(): Notifier {
    throw new Error(this.unsupportedReason);
  }
  async raiseWindow(): Promise<void> {}
  hookScript(): HookScript {
    throw new Error(this.unsupportedReason);
  }
  listSounds(): SoundOption[] {
    return [];
  }
  async doctorLines(): Promise<string[]> {
    return [`  ✗ ${this.unsupportedReason}`];
  }
  dispose(): void {}
}
