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
import { platform } from './platform';
import { Router } from './router';
import { chooseIcon, chooseSound, chooseTimeout, disposeSettingsUi } from './settingsui';
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

  const host = platform();
  if (!host.supported) {
    // Silence here would look like a broken install, so say it once rather
    // than only writing to a log channel nobody opens.
    log.warn(host.unsupportedReason ?? 'unsupported platform');
    void vscode.window.showWarningMessage(host.unsupportedReason ?? 'Unsupported platform.');
    return;
  }
  await host.init(context.extensionUri.fsPath);

  const pid = process.pid;
  log.info('starting for pid', String(pid), 'on', host.id);

  // Windows that crashed or were force-quit leave their socket and registry
  // entry behind; clearing them keeps the claim election accurate.
  const pruned = pruneStale();
  if (pruned > 0) {
    log.info('cleaned up', String(pruned), 'stale entries');
  }

  statusBar = new StatusBar(context.workspaceState);
  context.subscriptions.push(statusBar);

  const rebuildNotifier = () => {
    notifier = host.createNotifier(readSettings());
    statusBar?.setDetail(
      notifier.supportsClick
        ? `Using ${notifier.kind} — notifications are clickable.`
        : `Using ${notifier.kind} — notifications cannot be clicked.`,
    );
    log.info('notifier:', notifier.kind);
  };
  rebuildNotifier();

  const router = new Router({
    pid,
    workspaceFolders: currentFolders,
    workspaceFile: currentWorkspaceFile,
    notifier: () => notifier,
    isMuted: () => statusBar?.isMuted ?? false,
  });

  const endpoint = host.ipcEndpoint(pid);
  server = new IpcServer(
    pid,
    endpoint,
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
    writeSelf(describeSelf(pid, endpoint, context.extension.packageJSON.version));
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
          describeSelf(pid, endpoint, context.extension.packageJSON.version),
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
    vscode.commands.registerCommand('claudeNoti.chooseSound', () => chooseSound()),
    vscode.commands.registerCommand('claudeNoti.chooseIcon', () => chooseIcon()),
    vscode.commands.registerCommand('claudeNoti.chooseTimeout', () => chooseTimeout()),
    vscode.commands.registerCommand('claudeNoti.doctor', () =>
      runDoctor({
        pid,
        endpoint: server?.socketPath ?? '(not started)',
        notifierKind: notifier?.kind,
        projectRoot: projectRoot(),
      }),
    ),
    vscode.commands.registerCommand('claudeNoti.test', () => sendTestNotification()),
  );

  void maybeOnboard(context);
}

export function deactivate(): void {
  disposeSettingsUi();
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

function describeSelf(pid: number, socket: string, version: string): InstanceRecord {
  return {
    pid,
    socket,
    workspaceFolders: currentFolders(),
    workspaceFile: currentWorkspaceFile(),
    appName: vscode.env.appName,
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

function sendTestNotification(): void {
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
