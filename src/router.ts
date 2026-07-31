import * as vscode from 'vscode';

import { readSettings } from './config';
import { focusWindow } from './focus';
import type { HookEvent } from './hooks/payload';
import { log } from './log';
import { readAll } from './ipc/registry';
import type { Notifier } from './notify';
import {
  type SkipReason,
  Throttle,
  claimant,
  contextLabel,
  describe,
  fallbackClaimant,
  passesEventPolicy,
} from './routing';

export interface RouterContext {
  pid: number;
  appPath: string | undefined;
  workspaceFolders: () => string[];
  workspaceFile: () => string | undefined;
  notifier: () => Notifier | undefined;
  isMuted: () => boolean;
  /** Injectable so tests do not depend on the clock. */
  now?: () => number;
}

/**
 * Decides what to do with a hook payload that arrived on the IPC socket.
 *
 * The hook script broadcasts to every window, so the first job is working out
 * whether this window owns the session at all — see `claimant()`. Everything
 * after that is user preference: which events they care about, whether they
 * are already looking at this window, and how often to repeat.
 */
export class Router {
  private throttle: Throttle;
  private throttleWindowMs: number;

  constructor(private readonly context: RouterContext) {
    const settings = readSettings();
    this.throttleWindowMs = settings.minIntervalMs;
    this.throttle = new Throttle(this.throttleWindowMs);
  }

  /** Rebuilds the throttle when the user changes the interval. */
  refresh(): void {
    const { minIntervalMs } = readSettings();
    if (minIntervalMs !== this.throttleWindowMs) {
      this.throttleWindowMs = minIntervalMs;
      this.throttle = new Throttle(minIntervalMs);
    }
  }

  handle(event: HookEvent): void {
    const skip = this.evaluate(event);
    if (skip) {
      log.debug('skipped', event.hook_event_name, event.notification_type ?? '', `(${skip})`);
      return;
    }

    const settings = readSettings();
    const label = contextLabel(
      event.cwd,
      this.context.workspaceFolders(),
      this.context.workspaceFile(),
    );
    const content = describe(event, label);

    const notifier = this.context.notifier();
    if (!notifier) {
      log.warn('no notifier available; run "Claude Noti: Run Diagnostics"');
      return;
    }

    log.info('notifying:', content.subtitle, '—', content.message);
    notifier.notify(
      content,
      { timeoutSeconds: settings.timeoutSeconds, sound: settings.sound },
      () => {
        void focusWindow({
          appPath: this.context.appPath,
          workspacePath: this.context.workspaceFile() ?? this.context.workspaceFolders()[0],
          commands: readSettings().onFocusCommands,
        });
      },
    );
  }

  /** Returns the reason to skip, or `undefined` when the event should notify. */
  private evaluate(event: HookEvent): SkipReason | undefined {
    const settings = readSettings();

    if (!settings.enabled) {
      return 'disabled';
    }

    const policyFailure = passesEventPolicy(event, settings.events);
    if (policyFailure) {
      return policyFailure;
    }

    const instances = readAll();
    let owner = claimant(event.cwd, instances);
    if (owner === undefined) {
      if (!settings.notifyUnmatchedSessions) {
        return 'not-claimant';
      }
      owner = fallbackClaimant(instances);
    }
    if (owner !== this.context.pid) {
      return 'not-claimant';
    }

    if (this.context.isMuted()) {
      return 'muted';
    }

    const now = this.context.now?.() ?? Date.now();
    if (!this.throttle.allow(event.session_id ?? 'unknown', now)) {
      return 'throttled';
    }

    // You are already looking at this window, so a system notification would
    // only be noise. A quiet in-window message keeps the signal without it.
    if (settings.suppressWhenFocused && vscode.window.state.focused) {
      this.showInWindow(event);
      return 'window-focused';
    }

    return undefined;
  }

  private showInWindow(event: HookEvent): void {
    const text =
      event.hook_event_name === 'Stop'
        ? 'Claude Code finished this turn.'
        : (event.message ?? 'Claude Code needs your attention.');
    void vscode.window.setStatusBarMessage(`$(bell) ${text}`, 6000);
  }
}
