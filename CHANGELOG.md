# Changelog

## 0.1.3

- Documented a macOS failure that looks exactly like a broken notifier: the system's own `NotificationCenter` agent can wedge into a state where it files notifications away without ever drawing them on screen. Every setting reads as correct and no tool can detect it. `killall NotificationCenter` restores it. The README and the diagnostics command now say so, because it costs a long time to work out otherwise.

## 0.1.2

- New icon.
- Documented where the notification settings actually live. alerter posts under the `com.apple.Terminal` bundle identifier, so there is no "alerter" entry in System Settings — the style has to be changed on **Terminal**. Testing on macOS 26 confirmed that any other sender, including alerter's own bundle id, is dropped without a notification ever appearing.
- `claudeNoti.impersonateEditor` now says outright that turning it on will most likely stop notifications appearing, for the same reason.
- Removed the icon generator script and the CI step that checked its output.

## 0.1.1

- Fixed a race that could withdraw a notification immediately after posting it. Replacing an earlier notification for the same session ran `alerter --remove` concurrently with the new post, and alerter already replaces by `--group`, so the removal was both redundant and able to cancel the wrong notification.
- `claudeNoti.timeoutSeconds` now defaults to `0`, meaning a notification waits until you act on it. The previous 90 second default expired while you were in another application, which is exactly when you needed it.
- README and diagnostics now explain the most common cause of "nothing appears": notifications arrive but the alert style for **alerter** is set to **None** or **Banners** in System Settings.
- `PUBLISHING.md` is no longer shipped inside the extension package.

## 0.1.0

First release.

- macOS notifications for Claude Code `Notification` and `Stop` hook events.
- Clicking a notification raises the VS Code window that owns the session, via `alerter`.
- `osascript` fallback when `alerter` is not installed (notification only, no click).
- Per-window claim election so exactly one window notifies for a given session.
- Stays quiet when the relevant window already has focus.
- Install and remove hooks from the command palette, with a backup and a refusal to touch unparseable settings.
- Status bar mute toggle and a diagnostics command.
