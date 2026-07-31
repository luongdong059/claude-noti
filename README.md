# Claude Noti

[![CI](https://github.com/luongdong059/claude-noti/actions/workflows/ci.yml/badge.svg)](https://github.com/luongdong059/claude-noti/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/luongdong059/claude-noti)](https://github.com/luongdong059/claude-noti/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Get a real macOS notification when Claude Code needs you — and click it to land back in the right VS Code window.

## Why

Claude Code sends desktop notifications from Ghostty, Kitty and iTerm2. The VS Code integrated terminal is not on that list, so when you kick off a task and switch to another app, a permission prompt can sit there unanswered for a long time.

Claude Noti closes that gap:

- **A system notification** every time Claude asks for permission, waits for your input, or finishes a turn.
- **Click to return.** The click raises the specific window whose workspace the session belongs to, not just whichever window was last in front.
- **Quiet when you are already looking.** If the relevant window has focus, you get a small status-bar message instead of a banner.
- **One notification, not five.** With several windows open, exactly one of them claims each session.

## Requirements

- macOS 13 or later
- [Claude Code](https://claude.com/claude-code)
- [`alerter`](https://github.com/vjeantet/alerter) for clickable notifications:

  ```sh
  brew install vjeantet/tap/alerter
  ```

  Without it the extension falls back to `osascript`, which can still show a notification but cannot report a click — so the "jump back to the window" behaviour is unavailable.

Then open System Settings → Notifications and set **Terminal** to **Alerts**.

Two things about that are surprising enough to be worth stating plainly. There is no "alerter" entry to find: alerter posts under `com.apple.Terminal`, so macOS files its notifications under **Terminal**. And the style has to be **Alerts**, not **Banners** — banners disappear after a few seconds, so the one notification you needed is gone before you look back at the screen.

## Install

Until the Marketplace listing is live, grab the `.vsix` from the [latest release](https://github.com/luongdong059/claude-noti/releases/latest):

```sh
code --install-extension claude-noti.vsix
```

## Setup

1. Install the extension.
2. Accept the prompt to install hooks, or run **Claude Noti: Install Claude Code Hooks** from the command palette.
3. Start a new Claude Code session — hooks are read at session start.
4. Run **Claude Noti: Send Test Notification** to confirm everything works.

If nothing appears, run **Claude Noti: Run Diagnostics**. It checks the binary, the hook registration, the IPC socket and the window registry, and prints what is wrong.

## How it works

Installing hooks writes a small script to `~/.claude-noti/hook.sh` and registers it for Claude Code's `Notification` and `Stop` events. When Claude Code fires one, the script forwards the payload to every open VS Code window over a Unix domain socket in a `0700` directory under your home directory. No TCP port is opened and nothing leaves your machine.

Each window then decides independently whether the session belongs to it, by comparing the reported working directory against its own workspace folders — deepest match wins, lowest process id breaks ties. Because every window runs the same comparison over the same registry, exactly one of them acts, with no coordination needed.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `claudeNoti.enabled` | `true` | Master switch |
| `claudeNoti.events.permissionPrompt` | `true` | Claude is asking for permission |
| `claudeNoti.events.idlePrompt` | `true` | Claude has been waiting for input |
| `claudeNoti.events.agentNeedsInput` | `true` | A subagent or MCP server needs an answer |
| `claudeNoti.events.stop` | `true` | A turn finished (subagent completions are always ignored) |
| `claudeNoti.suppressWhenFocused` | `true` | Stay quiet when the window already has focus |
| `claudeNoti.notifierPath` | `""` | Override the path to `alerter` |
| `claudeNoti.impersonateEditor` | `false` | Show the editor's icon on the notification. Recent macOS releases may suppress notifications from an impersonated sender, so try it with the test command before relying on it |
| `claudeNoti.sound` | `""` | Sound name, e.g. `default` or `Glass` |
| `claudeNoti.timeoutSeconds` | `0` | Auto-close after N seconds; `0` waits until you act on it |
| `claudeNoti.minIntervalMs` | `1500` | Drop repeats for the same session |
| `claudeNoti.notifyUnmatchedSessions` | `false` | Also notify for sessions outside any open workspace |
| `claudeNoti.onFocusCommands` | `[]` | Commands to run after the window comes forward, e.g. `workbench.action.terminal.focus` |
| `claudeNoti.hookScope` | `"user"` | Install hooks globally or per project |

## Commands

| Command | Purpose |
| --- | --- |
| Claude Noti: Install Claude Code Hooks | Register the hooks with Claude Code |
| Claude Noti: Remove Claude Code Hooks | Undo that, leaving other hooks alone |
| Claude Noti: Send Test Notification | Check the notifier and the click path |
| Claude Noti: Toggle Mute | Silence this window for a while |
| Claude Noti: Run Diagnostics | Report what is and is not working |
| Claude Noti: Show Log | Open the output channel |

## Notes on your Claude Code settings

The installer edits `~/.claude/settings.json` (or `.claude/settings.json` for project scope). It refuses to write if the file is not valid JSON, keeps a `.claude-noti.bak` copy of the previous contents, adds nothing that is already there, and on removal takes out only its own entries.

## Troubleshooting

**Nothing happens at all.** Hooks are read when a Claude Code session starts, so restart the session after installing them. Then run diagnostics.

**Notifications appear but clicking does nothing.** `alerter` is missing and the `osascript` fallback is in use. Install `alerter`.

**No notification ever appears.** First check whether they are arriving at all: click the clock in the menu bar to open Notification Center. If the messages are sitting there, delivery is working and only the alert style is wrong — open System Settings → Notifications → **Terminal** and switch it to **Alerts**. If Notification Center is empty too, a Focus mode is filtering them or notifications are not allowed for Terminal.

**Notifications reach Notification Center, the settings are right, and still nothing appears on screen.** macOS's own `NotificationCenter` agent can wedge into a state where it files notifications away without ever drawing them. Nothing in System Settings shows this, and no amount of changing the alert style fixes it. Restart the agent:

```sh
killall NotificationCenter
```

It relaunches immediately under launchd, and banners come back. Worth trying before assuming anything is wrong with a notification tool — it applies to every app on the machine, not just this one.

**There is no "alerter" entry in System Settings.** There never will be. alerter posts under the `com.apple.Terminal` bundle identifier, so its notifications are governed by the **Terminal** entry. Changing that entry does also change how real Terminal.app notifications behave, which is the price of using a command-line notifier.

**Two notifications for one prompt.** Two windows both claim the session, which should not happen — please open an issue with the output of **Run Diagnostics** from both windows.

## Contributing

`npm ci` then `npm run watch`, and press F5 in VS Code to launch an Extension Development Host. `npm test` runs the linter and the unit suite; `npm run typecheck` is separate.

Release steps and Marketplace setup are in [PUBLISHING.md](PUBLISHING.md).

## Licence

MIT
