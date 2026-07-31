import { execFile } from 'node:child_process';

import { log } from '../log';
import type { NotificationContent } from '../routing';
import type { NotifyOptions, Notifier } from './index';

/**
 * Fallback for machines without `alerter`. `osascript` is always present, but
 * a notification it posts cannot report back when it is clicked — so the
 * "click to jump back to the right window" behaviour is unavailable here. This
 * exists so the extension still does something useful before the user installs
 * alerter, not as an equivalent option.
 */
export class OsascriptNotifier implements Notifier {
  readonly kind = 'osascript' as const;
  readonly supportsClick = false;

  notify(content: NotificationContent, options: NotifyOptions, _onClick: () => void): void {
    const parts = [
      `display notification ${quote(content.message)}`,
      `with title ${quote(content.title)}`,
      `subtitle ${quote(content.subtitle)}`,
    ];
    if (options.sound) {
      parts.push(`sound name ${quote(options.sound)}`);
    }
    execFile('osascript', ['-e', parts.join(' ')], { timeout: 10_000 }, (err) => {
      if (err) {
        log.error('osascript notification failed', String(err));
      }
    });
  }

  dispose(): void {
    // Nothing to clean up: osascript exits as soon as the notification is posted.
  }
}

/** Escapes a value for embedding in an AppleScript string literal. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
