import type { NotificationContent } from '../routing';

export interface NotifyOptions {
  /** Auto-close after N seconds; 0 means never. */
  timeoutSeconds: number;
  /** Sound name, or empty for a silent notification. */
  sound: string;
}

/** What the user did with the notification. */
export type NotifyResult =
  /** Clicked the body — take me back to that window. */
  | { kind: 'clicked' }
  /** Pressed the action button — take me back and show me everything. */
  | { kind: 'action' };

export interface Notifier {
  readonly kind: 'alerter' | 'osascript';
  /** Whether clicking the notification can call back into the extension. */
  readonly supportsClick: boolean;
  notify(
    content: NotificationContent,
    options: NotifyOptions,
    onResult: (result: NotifyResult) => void,
  ): void;
  dispose(): void;
}
