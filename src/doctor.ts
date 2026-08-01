import * as http from 'node:http';

import * as vscode from 'vscode';

import { readSettings } from './config';
import { HOOK_SCRIPT_VERSION, hookStatus, installedScriptVersion } from './hooks/installer';
import { readAll } from './ipc/registry';
import { log } from './log';
import { platform } from './platform';

export interface DoctorEnvironment {
  pid: number;
  endpoint: string;
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
  const host = platform();

  lines.push(`platform:            ${process.platform} (${process.arch})`);
  if (!host.supported) {
    lines.push(`  ✗ ${host.unsupportedReason}`);
  }
  lines.push(`active notifier:     ${env.notifierKind ?? 'none'}`);

  // Whatever is specific to this operating system — which binary is used, how
  // notifications are configured, what commonly swallows them.
  lines.push(...(await host.doctorLines(settings)));

  const scriptPath = host.supported ? host.hookScript().path : '(n/a)';
  const scriptVersion = installedScriptVersion();
  if (scriptVersion === undefined) {
    lines.push(`hook script:         ✗ missing at ${scriptPath}`);
  } else if (scriptVersion !== HOOK_SCRIPT_VERSION) {
    lines.push(
      `hook script:         ! outdated (v${scriptVersion}, expected v${HOOK_SCRIPT_VERSION})`,
    );
    lines.push('  → run "Claude Noti: Install Claude Code Hooks" to refresh it');
  } else {
    lines.push(`hook script:         ✓ ${scriptPath} (v${scriptVersion})`);
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

  lines.push(`ipc endpoint:        ${env.endpoint}`);
  const instances = readAll();
  lines.push(`known windows:       ${instances.length}`);
  for (const record of instances) {
    const self = record.pid === env.pid ? ' (this window)' : '';
    const state = await ping(record.socket);
    // A window that is focused deliberately stays quiet, which is the single
    // most common reason a notification "did not work" when everything else
    // is configured correctly. Showing it here saves guessing.
    const live = state
      ? `focused=${state.focused} muted=${state.muted} v${state.version} notifier=${state.notifier}`
      : 'not responding';
    lines.push(`  pid ${record.pid}${self}: ${live}`);
    lines.push(`      ${record.workspaceFolders.join(', ') || '(no folder)'}`);
  }

  lines.push('settings:');
  lines.push(`  enabled=${settings.enabled} muteWhenFocused=${settings.suppressWhenFocused}`);
  lines.push(
    `  events: permission=${settings.events.permissionPrompt} idle=${settings.events.idlePrompt} ` +
      `agent=${settings.events.agentNeedsInput} stop=${settings.events.stop}`,
  );
  lines.push(`  timeout=${settings.timeoutSeconds}s minInterval=${settings.minIntervalMs}ms`);
  lines.push('==================================');

  for (const line of lines) {
    log.info(line);
  }
  log.show();

  void vscode.window.showInformationMessage(
    'Diagnostics written to the Claude Noti output channel.',
  );
}

/** Asks another window for its live state over its socket or named pipe. */
function ping(socketPath: string): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    const req = http.get({ socketPath, path: '/ping', timeout: 2000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          resolve(undefined);
        }
      });
    });
    req.on('error', () => resolve(undefined));
    req.on('timeout', () => {
      req.destroy();
      resolve(undefined);
    });
  });
}
