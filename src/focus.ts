import * as vscode from 'vscode';

import { log } from './log';
import { platform } from './platform';

export interface FocusTarget {
  /** Workspace file or folder that identifies this specific window. */
  workspacePath: string | undefined;
  /** Extra command IDs to run once the window is up front. */
  commands: string[];
}

/**
 * Brings this window to the front after the user clicks a notification.
 *
 * The `vscode` API can move focus around inside a window but cannot raise the
 * application itself from the background, so the OS half of this is delegated
 * to the platform. Running editor commands afterwards is not an OS concern and
 * stays here.
 */
export async function focusWindow(target: FocusTarget): Promise<void> {
  await platform().raiseWindow(target.workspacePath);

  for (const command of target.commands) {
    try {
      await vscode.commands.executeCommand(command);
    } catch (err) {
      log.warn('onFocus command failed:', command, String(err));
    }
  }
}
