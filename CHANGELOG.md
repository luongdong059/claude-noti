# Changelog

## 0.4.2

- Rewrote the Marketplace page around using the extension rather than building it: what each setting is for and when you would change it, the two macOS settings that catch everyone out, and what the extension writes on your machine. How it is put together moved to CONTRIBUTING.md, where it is of use to the people it is written for.

## 0.4.1

- Fixed the details dialog trapping you. A modal in VS Code does not scroll, so a long detail grew past the bottom of the screen and took its buttons with it — leaving no way to close it. The dialog now holds only what is certain to fit, and offers **Open full text** to read the rest in an editor tab, which scrolls, can be copied from, and closes like any other tab.

## 0.4.0

- **A details button on the notification.** A banner holds a line or two, which is not enough for a long command or a question carrying four options. Where something had to be cut, the notification now offers a button that raises the window and shows the whole text.
- **Questions now say what they are asking.** A choice from Claude used to arrive as "Claude is waiting for you to choose an option" — enough to know something wanted you, not enough to know whether it was worth switching windows for. The banner now carries the question and the option labels, and the details button lists every option with its description.

  Note what this does not do: the options cannot be answered from the notification. Claude Code takes that answer through its own interface, and the `PermissionRequest` hook can only allow or deny the whole tool call, not pick an option within it. Showing the labels as buttons would look like it worked and quietly do nothing, so they are shown as text.

## 0.3.1

- Groundwork for Windows support: everything OS-specific now sits behind a `Platform` interface in `src/platform/`, leaving the routing, event-filter and settings-patching logic free of any OS branches. No change in behaviour on macOS.
- On an unsupported OS the extension now says so once instead of activating silently and appearing broken.
- CI runs the test suite on Linux, macOS and Windows, so a stray platform assumption in the shared logic fails in CI rather than on someone's machine.

## 0.3.0

- Three commands for the settings people actually change: **Choose Notification Sound**, **Choose Notification Icon**, and **Choose How Long Notifications Stay**. The settings themselves already existed but none of their values were guessable — a sound is a bare macOS name like `Sosumi`, an icon is an absolute path. The sound picker plays each one as you move through the list, and lists anything you have put in `~/Library/Sounds` alongside the system sounds.

## 0.2.1

- New icon, and the extension is published under the `nldong` publisher.

## 0.2.0

- **Permission prompts now actually notify.** The extension listened for `Notification`/`permission_prompt`, and that event never arrived: Claude Code raises `Notification` only when it has a desktop notification channel, and it has none in the VS Code integrated terminal — the exact setup this extension exists for. Instrumenting the hook recorded five `PermissionRequest` events and zero `Notification` events in a single session. The `PermissionRequest` hook is now registered, and it covers both tool approval and `AskUserQuestion` option pickers.
- Notifications say what is being asked: `Bash: Fetch example.com` using Claude's own description of the command, the file name for an edit, or a plain statement that a choice is waiting.
- `Notification` stays registered, since it does fire in terminals that have a channel and carries idle prompts that `PermissionRequest` does not.

## 0.1.6

- Notifications carry the extension's own icon instead of Terminal's, via `--app-icon`. New `claudeNoti.notificationIcon` setting.

## 0.1.5

- `/ping` and **Run Diagnostics** report each window's live focus state, mute state and the router's last decision, so "nothing was notified" can be answered from evidence rather than guesswork.

## 0.1.4

- Notifications with an unrecognised or missing `notification_type` are now shown rather than silently dropped.

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
