# Changelog

## 0.1.0

First release.

- macOS notifications for Claude Code `Notification` and `Stop` hook events.
- Clicking a notification raises the VS Code window that owns the session, via `alerter`.
- `osascript` fallback when `alerter` is not installed (notification only, no click).
- Per-window claim election so exactly one window notifies for a given session.
- Stays quiet when the relevant window already has focus.
- Install and remove hooks from the command palette, with a backup and a refusal to touch unparseable settings.
- Status bar mute toggle and a diagnostics command.
