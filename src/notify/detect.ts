import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Homebrew's bin directories, checked explicitly because a VS Code launched
 * from Finder or the Dock inherits a bare `PATH` (`/usr/bin:/bin:/usr/sbin:
 * /sbin`) rather than the one from the user's shell profile. Relying on `PATH`
 * alone would make detection fail for most users.
 */
const EXTRA_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];

export function findAlerter(configuredPath: string): string | undefined {
  if (configuredPath) {
    return isExecutable(configuredPath) ? configuredPath : undefined;
  }
  const dirs = [...(process.env.PATH?.split(path.delimiter) ?? []), ...EXTRA_BIN_DIRS];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) {
      continue;
    }
    seen.add(dir);
    const candidate = path.join(dir, 'alerter');
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Finds the application bundle that owns a running executable.
 *
 * The extension host runs from a helper bundle nested inside the editor:
 *
 *   /Applications/Visual Studio Code.app/Contents/Frameworks/
 *     Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)
 *
 * so the *outermost* `.app` is the one to activate — walking up to the first
 * one found would return the helper, which `open` cannot bring to the front.
 * Working from `process.execPath` rather than a hardcoded path is also what
 * makes this work unchanged on Cursor, Windsurf and VSCodium.
 */
export function outermostAppBundle(execPath: string): string | undefined {
  const segments = execPath.split(path.sep);
  const index = segments.findIndex((segment) => segment.endsWith('.app'));
  if (index === -1) {
    return undefined;
  }
  return segments.slice(0, index + 1).join(path.sep);
}

export function bundleIdentifier(appPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'defaults',
      ['read', path.join(appPath, 'Contents', 'Info'), 'CFBundleIdentifier'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve(undefined);
          return;
        }
        const id = stdout.trim();
        resolve(id.length > 0 ? id : undefined);
      },
    );
  });
}
