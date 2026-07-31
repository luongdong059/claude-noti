import * as vscode from 'vscode';

const MUTE_KEY = 'claudeNoti.muted';

/**
 * A one-click mute in the status bar. Mute is stored per window in workspace
 * state rather than in settings: it is a "not right now" toggle, not a
 * preference worth syncing or writing to disk-backed configuration.
 */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private muted: boolean;
  private detail = '';

  constructor(private readonly state: vscode.Memento) {
    this.muted = state.get(MUTE_KEY, false);
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'claudeNoti.toggleMute';
    this.render();
    this.item.show();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    void this.state.update(MUTE_KEY, this.muted);
    this.render();
    return this.muted;
  }

  /** Short status text appended to the tooltip, e.g. the active notifier. */
  setDetail(detail: string): void {
    this.detail = detail;
    this.render();
  }

  private render(): void {
    this.item.text = this.muted ? '$(bell-slash)' : '$(bell)';
    const heading = this.muted ? 'Claude Noti: muted' : 'Claude Noti: active';
    this.item.tooltip = new vscode.MarkdownString(
      `**${heading}**\n\n${this.detail}\n\nClick to ${this.muted ? 'unmute' : 'mute'}.`,
    );
    this.item.backgroundColor = this.muted
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
