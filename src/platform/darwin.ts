import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Settings } from '../config';
import { log } from '../log';
import type { Notifier } from '../notify';
import { AlerterNotifier } from '../notify/alerter';
import { bundleIdentifier, findAlerter, outermostAppBundle } from '../notify/detect';
import { OsascriptNotifier } from '../notify/osascript';
import { ROOT, SOCK_DIR, socketPathTooLong } from '../paths';
import type { HookScript, Platform, SoundOption } from './index';

/** Where macOS looks up a sound by name, in the order it searches. */
const SOUND_DIRECTORIES = [
  path.join(os.homedir(), 'Library', 'Sounds'),
  '/Library/Sounds',
  '/System/Library/Sounds',
];

export class DarwinPlatform implements Platform {
  readonly id = 'darwin' as const;
  readonly supported = true;

  private extensionPath = '';
  private appPath: string | undefined;
  private bundleId: string | undefined;
  private notifier: Notifier | undefined;

  async init(extensionPath: string): Promise<void> {
    this.extensionPath = extensionPath;
    this.appPath = outermostAppBundle(process.execPath);
    this.bundleId = this.appPath ? await bundleIdentifier(this.appPath) : undefined;
    log.info('platform darwin:', this.appPath ?? '(app bundle not detected)', this.bundleId ?? '');
  }

  ipcEndpoint(pid: number): string {
    const endpoint = path.join(SOCK_DIR, `${pid}.sock`);
    if (socketPathTooLong(endpoint)) {
      throw new Error(
        `socket path exceeds the macOS limit of 103 bytes: ${endpoint}. ` +
          'Claude Noti cannot listen for hook events.',
      );
    }
    return endpoint;
  }

  cleanupEndpoint(pid: number): void {
    try {
      fs.unlinkSync(path.join(SOCK_DIR, `${pid}.sock`));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('could not remove socket for pid', String(pid), String(err));
      }
    }
  }

  createNotifier(settings: Settings): Notifier {
    this.notifier?.dispose();
    const binary = findAlerter(settings.notifierPath);
    // Impersonating the editor's bundle id gives the notification its icon, but
    // recent macOS releases can silently drop notifications from a spoofed
    // sender — so it stays opt-in and the default is alerter's own identity.
    this.notifier = binary
      ? new AlerterNotifier(
          binary,
          settings.impersonateEditor ? this.bundleId : undefined,
          this.resolveIcon(settings.notificationIcon),
        )
      : new OsascriptNotifier();
    return this.notifier;
  }

  async raiseWindow(workspacePath: string | undefined): Promise<void> {
    if (!this.appPath) {
      log.warn('no application bundle detected; cannot raise the window from the background');
      return;
    }
    // Passing the workspace path matters: VS Code reuses the window that
    // already has that folder open, which is how the click lands on the
    // session the notification was about.
    const args = ['-a', this.appPath];
    if (workspacePath) {
      args.push(workspacePath);
    }
    await new Promise<void>((resolve) => {
      execFile('open', args, { timeout: 10_000 }, (err) => {
        if (err) {
          log.error('could not raise the window', String(err));
        }
        resolve();
      });
    });
  }

  hookScript(): HookScript {
    const target = path.join(ROOT, 'hook.sh');
    return { path: target, resource: 'hook.sh', command: target };
  }

  listSounds(): SoundOption[] {
    const byName = new Map<string, SoundOption>();
    // Earlier directories win, matching how macOS itself resolves a sound name.
    for (const dir of SOUND_DIRECTORIES) {
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const name = path.basename(entry, path.extname(entry));
        if (!name || byName.has(name)) {
          continue;
        }
        byName.set(name, {
          name,
          file: path.join(dir, entry),
          source: dir.startsWith(os.homedir()) ? 'your sounds' : 'system',
        });
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async doctorLines(settings: Settings): Promise<string[]> {
    const lines: string[] = [];
    const alerter = findAlerter(settings.notifierPath);
    if (alerter) {
      const version = await run(alerter, ['--version']);
      lines.push(`alerter:             ✓ ${alerter}${version ? ` (${version})` : ''}`);
    } else {
      lines.push('alerter:             ✗ not found');
      lines.push('  → brew install vjeantet/tap/alerter');
      lines.push('  → without it, notifications cannot be clicked to focus this window');
    }
    lines.push(`application bundle:  ${this.appPath ?? '✗ not detected'}`);
    lines.push(`bundle identifier:   ${this.bundleId ?? '✗ not detected'}`);
    lines.push(`impersonate editor:  ${settings.impersonateEditor}`);
    lines.push('');
    lines.push('If notifications land in Notification Center but nothing appears on');
    lines.push('screen, the alert style is the cause, not this extension. Open');
    lines.push('System Settings → Notifications → Terminal and set the style to');
    lines.push('"Alerts". Look under Terminal, not alerter: alerter posts under the');
    lines.push('com.apple.Terminal bundle id, so no "alerter" entry exists. And use');
    lines.push('"Alerts", not "Banners" — banners vanish after a few seconds, which');
    lines.push('defeats the purpose when you are away from the machine.');
    lines.push('');
    lines.push("If that setting is already correct and notifications still only reach");
    lines.push('Notification Center, macOS\'s own agent has wedged. Run:');
    lines.push('  killall NotificationCenter');
    lines.push('It relaunches on its own and banners start appearing again.');
    return lines;
  }

  dispose(): void {
    this.notifier?.dispose();
    this.notifier = undefined;
  }

  /**
   * Picks the image shown on the notification. alerter posts under Terminal's
   * bundle identifier, so without an override the notification wears
   * Terminal's icon and looks like it came from a shell.
   */
  private resolveIcon(configured: string): string | undefined {
    if (configured === 'none') {
      return undefined;
    }
    const candidate = configured || path.join(this.extensionPath, 'images', 'icon.png');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    log.warn('notification icon not found, falling back to the sender default:', candidate);
    return undefined;
  }
}

function run(binary: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: 5000 }, (err, stdout) => {
      resolve(err ? undefined : stdout.trim() || undefined);
    });
  });
}
