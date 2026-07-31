import { execFile } from 'node:child_process';

import * as vscode from 'vscode';

import { readSettings } from './config';
import { HOOK_SCRIPT_VERSION, hookStatus, installedScriptVersion } from './hooks/installer';
import { readAll } from './ipc/registry';
import { log } from './log';
import { findAlerter } from './notify/detect';
import { HOOK_SCRIPT } from './paths';

export interface DoctorEnvironment {
  pid: number;
  appPath: string | undefined;
  bundleId: string | undefined;
  socketPath: string;
  notifierKind: string | undefined;
  projectRoot: string | undefined;
}

/**
 * Prints a full picture of the setup to the output channel.
 *
 * Almost every failure of this extension is environmental — a missing binary,
 * an unregistered hook, a stale socket, a notification permission that was
 * never granted — and none of it is visible from inside VS Code. This is the
 * first thing to ask a user to run when they report that nothing happens.
 */
export async function runDoctor(env: DoctorEnvironment): Promise<void> {
  const lines: string[] = ['', '===== Claude Noti diagnostics ====='];
  const settings = readSettings();

  lines.push(`platform:            ${process.platform} (${process.arch})`);
  if (process.platform !== 'darwin') {
    lines.push('  ✗ This extension only supports macOS.');
  }

  const alerter = findAlerter(settings.notifierPath);
  if (alerter) {
    const version = await alerterVersion(alerter);
    lines.push(`alerter:             ✓ ${alerter}${version ? ` (${version})` : ''}`);
  } else {
    lines.push('alerter:             ✗ not found');
    lines.push('  → brew install vjeantet/tap/alerter');
    lines.push('  → without it, notifications cannot be clicked to focus this window');
  }
  lines.push(`active notifier:     ${env.notifierKind ?? 'none'}`);

  lines.push(`application bundle:  ${env.appPath ?? '✗ not detected'}`);
  lines.push(`bundle identifier:   ${env.bundleId ?? '✗ not detected'}`);
  lines.push(`impersonate editor:  ${settings.impersonateEditor}`);

  const scriptVersion = installedScriptVersion();
  if (scriptVersion === undefined) {
    lines.push(`hook script:         ✗ missing at ${HOOK_SCRIPT}`);
  } else if (scriptVersion !== HOOK_SCRIPT_VERSION) {
    lines.push(
      `hook script:         ! outdated (v${scriptVersion}, expected v${HOOK_SCRIPT_VERSION})`,
    );
    lines.push('  → run "Claude Noti: Install Claude Code Hooks" to refresh it');
  } else {
    lines.push(`hook script:         ✓ ${HOOK_SCRIPT} (v${scriptVersion})`);
  }

  for (const scope of ['user', 'project'] as const) {
    const status = hookStatus(scope, env.projectRoot);
    if (!status.settingsFile) {
      lines.push(`hooks (${scope}):       — no settings file for this scope`);
      continue;
    }
    const mark = status.installed ? '✓' : status.registeredEvents.length > 0 ? '!' : '✗';
    lines.push(`hooks (${scope}):       ${mark} ${status.settingsFile}`);
    lines.push(
      `  registered events: ${status.registeredEvents.length > 0 ? status.registeredEvents.join(', ') : 'none'}`,
    );
    if (!status.settingsReadable) {
      lines.push('  ✗ settings file could not be parsed');
    }
  }

  lines.push(`ipc socket:          ${env.socketPath}`);
  const instances = readAll();
  lines.push(`known windows:       ${instances.length}`);
  for (const record of instances) {
    const self = record.pid === env.pid ? ' (this window)' : '';
    lines.push(`  pid ${record.pid}${self}: ${record.workspaceFolders.join(', ') || '(no folder)'}`);
  }

  lines.push('settings:');
  lines.push(`  enabled=${settings.enabled} muteWhenFocused=${settings.suppressWhenFocused}`);
  lines.push(
    `  events: permission=${settings.events.permissionPrompt} idle=${settings.events.idlePrompt} ` +
      `agent=${settings.events.agentNeedsInput} stop=${settings.events.stop}`,
  );
  lines.push(`  timeout=${settings.timeoutSeconds}s minInterval=${settings.minIntervalMs}ms`);

  lines.push('');
  lines.push('If notifications land in Notification Center but nothing appears on');
  lines.push('screen, the alert style is the cause, not this extension. Open');
  lines.push('System Settings → Notifications → Terminal and set the style to');
  lines.push('"Alerts". Look under Terminal, not alerter: alerter posts under the');
  lines.push('com.apple.Terminal bundle id, so no "alerter" entry exists. And use');
  lines.push('"Alerts", not "Banners" — banners vanish after a few seconds, which');
  lines.push('defeats the purpose when you are away from the machine.');
  lines.push('==================================');

  for (const line of lines) {
    log.info(line);
  }
  log.show();

  const summary = alerter
    ? 'Diagnostics written to the Claude Noti output channel.'
    : 'alerter is not installed — notifications cannot be clicked. See the output channel.';
  void vscode.window.showInformationMessage(summary);
}

function alerterVersion(binary: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(binary, ['--version'], { timeout: 5000 }, (err, stdout) => {
      resolve(err ? undefined : stdout.trim() || undefined);
    });
  });
}
