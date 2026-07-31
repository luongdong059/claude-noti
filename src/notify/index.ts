import type { NotificationContent } from '../routing';

export interface NotifyOptions {
  /** Auto-close after N seconds; 0 means never. */
  timeoutSeconds: number;
  /** Sound name, or empty for a silent notification. */
  sound: string;
}

export interface Notifier {
  readonly kind: 'alerter' | 'osascript';
  /** Whether clicking the notification can call back into the extension. */
  readonly supportsClick: boolean;
  notify(content: NotificationContent, options: NotifyOptions, onClick: () => void): void;
  dispose(): void;
}
