import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { CONFIG_SECTION, readSettings } from './config';
import { runDoctor } from './doctor';
import { focusWindow } from './focus';
import {
  type HookScope,
  hookStatus,
  installHookScript,
  installHooks,
  uninstallHooks,
} from './hooks/installer';
import { IpcServer } from './ipc/server';
import { type InstanceRecord, pruneStale, removeSelf, writeSelf } from './ipc/registry';
import { log, setLogSink } from './log';
import type { Notifier } from './notify';
import { AlerterNotifier } from './notify/alerter';
import { bundleIdentifier, findAlerter, outermostAppBundle } from './notify/detect';
import { OsascriptNotifier } from './notify/osascript';
import { Router } from './router';
import { StatusBar } from './statusbar';

const ONBOARDED_KEY = 'claudeNoti.onboardingDismissed';

let server: IpcServer | undefined;
let statusBar: StatusBar | undefined;
let notifier: Notifier | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('Claude Noti', { log: true });
  setLogSink({
    debug: (m) => channel.debug(m),
    info: (m) => channel.info(m),
    warn: (m) => channel.warn(m),
    error: (m) => channel.error(m),
    show: () => channel.show(true),
  });
  context.subscriptions.push(channel);

  if (process.platform !== 'darwin') {
    log.warn('Claude Noti only supports macOS; staying inactive.');
    return;
  }

  const pid = process.pid;
  const appPath = outermostAppBundle(process.execPath);
  const bundleId = appPath ? await bundleIdentifier(appPath) : undefined;
  log.info('starting for pid', String(pid), 'app', appPath ?? '(unknown)', bundleId ?? '');

  // Windows that crashed or were force-quit leave their socket and registry
  // entry behind; clearing them keeps the claim election accurate.
  const pruned = pruneStale();
  if (pruned > 0) {
    log.info('cleaned up', String(pruned), 'stale entries');
  }

  statusBar = new StatusBar(context.workspaceState);
  context.subscriptions.push(statusBar);

  const rebuildNotifier = () => {
    notifier?.dispose();
    const settings = readSettings();
    const binary = findAlerter(settings.notifierPath);
    // Impersonating the editor's bundle id gives the notification its icon, but
    // recent macOS releases can silently drop notifications from a spoofed
    // sender — so it stays opt-in and the default is alerter's own identity.
    notifier = binary
      ? new AlerterNotifier(
          binary,
          settings.impersonateEditor ? bundleId : undefined,
          resolveIcon(context, settings.notificationIcon),
        )
      : new OsascriptNotifier();
    statusBar?.setDetail(
      notifier.kind === 'alerter'
        ? `Using alerter — notifications are clickable.`
        : `Using osascript — install alerter to make notifications clickable.`,
    );
    log.info('notifier:', notifier.kind);
  };
  rebuildNotifier();

  const router = new Router({
    pid,
    appPath,
    workspaceFolders: currentFolders,
    workspaceFile: currentWorkspaceFile,
    notifier: () => notifier,
    isMuted: () => statusBar?.isMuted ?? false,
  });

  server = new IpcServer(
    pid,
    (event) => router.handle(event),
    () => ({
      version: context.extension.packageJSON.version,
      focused: vscode.window.state.focused,
      muted: statusBar?.isMuted ?? false,
      notifier: notifier?.kind ?? 'none',
      folders: currentFolders(),
      lastDecision: router.lastDecision,
    }),
  );
  try {
    await server.start();
    writeSelf(describeSelf(pid, server.socketPath, appPath, context.extension.packageJSON.version));
  } catch (err) {
    log.error('could not start the IPC server', String(err));
    void vscode.window.showErrorMessage(
      `Claude Noti could not listen for hook events: ${String(err)}`,
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (server) {
        writeSelf(
          describeSelf(pid, server.socketPath, appPath, context.extension.packageJSON.version),
        );
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(CONFIG_SECTION)) {
        return;
      }
      router.refresh();
      if (
        event.affectsConfiguration(`${CONFIG_SECTION}.notifierPath`) ||
        event.affectsConfiguration(`${CONFIG_SECTION}.impersonateEditor`) ||
        event.affectsConfiguration(`${CONFIG_SECTION}.notificationIcon`)
      ) {
        rebuildNotifier();
      }
    }),
    vscode.commands.registerCommand('claudeNoti.installHooks', () =>
      handleInstall(context, readSettings().hookScope),
    ),
    vscode.commands.registerCommand('claudeNoti.uninstallHooks', () =>
      handleUninstall(readSettings().hookScope),
    ),
    vscode.commands.registerCommand('claudeNoti.toggleMute', () => {
      const muted = statusBar?.toggleMute() ?? false;
      void vscode.window.setStatusBarMessage(
        muted ? '$(bell-slash) Claude Noti muted' : '$(bell) Claude Noti unmuted',
        3000,
      );
    }),
    vscode.commands.registerCommand('claudeNoti.showLog', () => log.show()),
    vscode.commands.registerCommand('claudeNoti.doctor', () =>
      runDoctor({
        pid,
        appPath,
        bundleId,
        socketPath: server?.socketPath ?? '(not started)',
        notifierKind: notifier?.kind,
        projectRoot: projectRoot(),
      }),
    ),
    vscode.commands.registerCommand('claudeNoti.test', () => sendTestNotification(appPath)),
  );

  void maybeOnboard(context);
}

export function deactivate(): void {
  notifier?.dispose();
  notifier = undefined;
  server?.dispose();
  server = undefined;
  statusBar?.dispose();
  statusBar = undefined;
  removeSelf(process.pid);
}

function currentFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === 'file')
    .map((folder) => folder.uri.fsPath);
}

function currentWorkspaceFile(): string | undefined {
  const file = vscode.workspace.workspaceFile;
  // An untitled workspace has no file on disk to reopen.
  return file && file.scheme === 'file' ? file.fsPath : undefined;
}

/** Where project-scoped hooks would be written. */
function projectRoot(): string | undefined {
  return currentFolders()[0];
}

/**
 * Picks the image shown on the notification.
 *
 * alerter posts under Terminal's bundle identifier, so without an override the
 * notification wears Terminal's icon and looks like it came from a shell. The
 * extension's own icon makes it recognisable at a glance, which matters when
 * the notification is the only thing you see of it.
 */
function resolveIcon(context: vscode.ExtensionContext, configured: string): string | undefined {
  if (configured === 'none') {
    return undefined;
  }
  const candidate = configured || path.join(context.extensionUri.fsPath, 'images', 'icon.png');
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  log.warn('notification icon not found, falling back to the sender default:', candidate);
  return undefined;
}

function describeSelf(
  pid: number,
  socket: string,
  appPath: string | undefined,
  version: string,
): InstanceRecord {
  return {
    pid,
    socket,
    workspaceFolders: currentFolders(),
    workspaceFile: currentWorkspaceFile(),
    appName: vscode.env.appName,
    appPath,
    version,
    startedAt: new Date().toISOString(),
  };
}

async function handleInstall(context: vscode.ExtensionContext, scope: HookScope): Promise<void> {
  try {
    installHookScript(context.extensionUri.fsPath);
    const { file, changed } = installHooks(scope, projectRoot());
    void vscode.window.showInformationMessage(
      changed
        ? `Claude Noti hooks installed in ${file}. New Claude Code sessions will pick them up.`
        : `Claude Noti hooks were already installed in ${file}.`,
    );
  } catch (err) {
    log.error('install failed', String(err));
    void vscode.window.showErrorMessage(`Claude Noti could not install hooks: ${String(err)}`);
  }
}

async function handleUninstall(scope: HookScope): Promise<void> {
  try {
    const { file, changed } = uninstallHooks(scope, projectRoot());
    void vscode.window.showInformationMessage(
      changed ? `Claude Noti hooks removed from ${file}.` : `No Claude Noti hooks found in ${file}.`,
    );
  } catch (err) {
    log.error('uninstall failed', String(err));
    void vscode.window.showErrorMessage(`Claude Noti could not remove hooks: ${String(err)}`);
  }
}

function sendTestNotification(appPath: string | undefined): void {
  if (!notifier) {
    void vscode.window.showErrorMessage('Claude Noti has no notifier available.');
    return;
  }
  const settings = readSettings();
  notifier.notify(
    {
      title: 'Claude Noti',
      subtitle: 'Test notification',
      message: notifier.supportsClick
        ? 'Click this to bring the window back to the front.'
        : 'Install alerter to make notifications clickable.',
      group: 'claude-noti-test',
    },
    { timeoutSeconds: Math.max(30, settings.timeoutSeconds), sound: settings.sound },
    () => {
      void focusWindow({
        appPath,
        workspacePath: currentWorkspaceFile() ?? currentFolders()[0],
        commands: settings.onFocusCommands,
      });
    },
  );
  void vscode.window.showInformationMessage(
    'Test notification sent. Switch away from VS Code to see it arrive.',
  );
}

/**
 * Offers to install the hooks on first run. Without them Claude Code never
 * tells us anything, so the extension is inert — but writing to another tool's
 * configuration file is not something to do behind the user's back.
 */
async function maybeOnboard(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get(ONBOARDED_KEY, false)) {
    return;
  }
  const scope = readSettings().hookScope;
  if (hookStatus(scope, projectRoot()).installed) {
    return;
  }

  const install = 'Install hooks';
  const later = 'Later';
  const never = "Don't ask again";
  const choice = await vscode.window.showInformationMessage(
    'Claude Noti needs to register a hook with Claude Code before it can notify you.',
    install,
    later,
    never,
  );
  if (choice === install) {
    await handleInstall(context, scope);
  } else if (choice === never) {
    await context.globalState.update(ONBOARDED_KEY, true);
  }
}
