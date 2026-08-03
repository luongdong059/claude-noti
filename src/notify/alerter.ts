import { type ChildProcess, execFile, spawn } from 'node:child_process';

import { log } from '../log';
import type { NotificationContent } from '../routing';
import type { NotifyOptions, NotifyResult, Notifier } from './index';

/**
 * Each live notification holds one blocked `alerter` process, so a runaway
 * count would mean a runaway process count. In practice one per session is
 * plenty; this is a backstop, not a working limit.
 */
const MAX_LIVE = 5;

/** What alerter prints when the notification body itself is clicked. */
const CONTENT_CLICKED = '@CONTENTCLICKED';
/**
 * What it prints when an action button is pressed. Some builds echo the
 * action's own label instead of this marker, so both are treated as an action.
 */
const ACTION_CLICKED = '@ACTIONCLICKED';

/**
 * Sends notifications through `alerter`, which is built on the modern
 * `UNUserNotificationCenter` API. It blocks until the user interacts and then
 * prints the outcome on stdout — that blocking behaviour is exactly what lets
 * the extension react to a click, which is why it is preferred over
 * `osascript`, whose notifications cannot call back at all.
 */
export class AlerterNotifier implements Notifier {
  readonly kind = 'alerter' as const;
  readonly supportsClick = true;

  private readonly live = new Map<string, ChildProcess>();

  constructor(
    private readonly binary: string,
    private readonly sender: string | undefined,
    /**
     * Image shown in place of the posting application's icon. Without it the
     * notification carries Terminal's icon, because that is the bundle
     * identifier alerter posts under.
     */
    private readonly appIcon: string | undefined,
  ) {}

  notify(
    content: NotificationContent,
    options: NotifyOptions,
    onResult: (result: NotifyResult) => void,
  ): void {
    this.retire(content.group);
    this.enforceLimit();

    const args = [
      '--title',
      content.title,
      '--subtitle',
      content.subtitle,
      '--message',
      content.message,
      '--group',
      content.group,
      '--timeout',
      String(options.timeoutSeconds),
    ];
    if (content.action) {
      args.push('--actions', content.action);
    }
    if (this.sender) {
      args.push('--sender', this.sender);
    }
    if (this.appIcon) {
      args.push('--app-icon', this.appIcon);
    }
    if (options.sound) {
      args.push('--sound', options.sound);
    }

    let child: ChildProcess;
    try {
      child = spawn(this.binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      log.error('could not start alerter', String(err));
      return;
    }

    this.live.set(content.group, child);

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      log.warn('alerter stderr:', chunk.toString('utf8').trim());
    });

    child.on('error', (err) => {
      log.error('alerter failed', String(err));
      this.live.delete(content.group);
    });

    child.on('close', () => {
      this.live.delete(content.group);
      const result = stdout.trim();
      log.debug('alerter result for', content.group, '→', result || '(none)');

      if (result.includes(ACTION_CLICKED) || (content.action && result === content.action)) {
        onResult({ kind: 'action' });
      } else if (result.includes(CONTENT_CLICKED)) {
        onResult({ kind: 'clicked' });
      }
    });
  }

  /**
   * Ends the previous notification for a session so a newer one can take its
   * place.
   *
   * Only the blocked process is killed. alerter already replaces a
   * notification that shares its `--group`, so an explicit `--remove` here
   * would be redundant — and worse, it runs concurrently with the post that
   * immediately follows, so it can withdraw the notification we just
   * delivered instead of the old one.
   */
  private retire(group: string): void {
    const existing = this.live.get(group);
    if (!existing) {
      return;
    }
    existing.kill();
    this.live.delete(group);
  }

  /**
   * Takes a notification down with nothing replacing it, so the banner has to
   * be withdrawn explicitly. Safe to `--remove` here precisely because no post
   * for this group follows.
   */
  private withdraw(group: string): void {
    this.retire(group);
    execFile(this.binary, ['--remove', group], { timeout: 5000 }, (err) => {
      if (err) {
        log.debug('alerter --remove', group, 'failed:', String(err));
      }
    });
  }

  private enforceLimit(): void {
    while (this.live.size >= MAX_LIVE) {
      const oldest = this.live.keys().next();
      if (oldest.done) {
        return;
      }
      log.debug('too many live notifications, withdrawing', oldest.value);
      this.withdraw(oldest.value);
    }
  }

  dispose(): void {
    for (const group of [...this.live.keys()]) {
      this.withdraw(group);
    }
  }
}
