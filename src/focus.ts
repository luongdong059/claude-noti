import { execFile } from 'node:child_process';

import * as vscode from 'vscode';

import { log } from './log';

export interface FocusTarget {
  /** Outermost application bundle, e.g. /Applications/Visual Studio Code.app */
  appPath: string | undefined;
  /** Workspace file or folder that identifies this specific window. */
  workspacePath: string | undefined;
  /** Extra command IDs to run once the window is up front. */
  commands: string[];
}

/**
 * Brings this window to the front after the user clicks a notification.
 *
 * The `vscode` API can move focus around inside a window but cannot raise the
 * application itself from the background, so this shells out to `open`.
 * Passing the workspace path matters: VS Code reuses the window that already
 * has that folder open, which is how the click lands on the session the
 * notification was about rather than whichever window happened to be last.
 */
export async function focusWindow(target: FocusTarget): Promise<void> {
  if (target.appPath) {
    const args = ['-a', target.appPath];
    if (target.workspacePath) {
      args.push(target.workspacePath);
    }
    await new Promise<void>((resolve) => {
      execFile('open', args, { timeout: 10_000 }, (err) => {
        if (err) {
          log.error('could not raise the window', String(err));
        }
        resolve();
      });
    });
  } else {
    log.warn('no application bundle detected; cannot raise the window from the background');
  }

  for (const command of target.commands) {
    try {
      await vscode.commands.executeCommand(command);
    } catch (err) {
      log.warn('onFocus command failed:', command, String(err));
    }
  }
}
