# Claude Noti

You give Claude Code a task and switch to something else. Claude hits a command it needs permission for, and stops. You find out twenty minutes later.

Claude Noti puts that moment on your screen, wherever you are, and gets you back to the right window in one click.

## What it does

- **Tells you the moment Claude needs you** — a permission request, a question, or the end of a turn.
- **Says what is being asked.** The command Claude wants to run, or the question and the options on offer. Enough to decide whether it is worth switching windows for, without switching windows to find out.
- **One click puts you back.** Not "brings VS Code forward" — it raises the specific window that session belongs to, even with a dozen open.
- **Stays quiet when you are already there.** If you are looking at that window, you get a line in the status bar instead of a banner across your screen.
- **One notification, not one per window.** However many windows are open, exactly one of them speaks up.

## Before you start

You need macOS 13 or later, [Claude Code](https://claude.com/claude-code), and one small command-line tool:

```sh
brew install vjeantet/tap/alerter
```

Without `alerter` the extension falls back to `osascript`. That still shows a notification, but macOS gives it no way to report a click — so the "click to get back" part stops working, which is most of the point.

### One setting in macOS

Open **System Settings → Notifications**, find **Terminal**, and set its style to **Alerts**.

Two things about that are worth saying plainly, because both surprise people:

- **Look under Terminal, not "alerter".** There is no "alerter" entry and there never will be — it posts under Terminal's identity, so Terminal's settings govern it. The trade-off is real: this also changes how Terminal.app's own notifications behave.
- **Alerts, not Banners.** Banners vanish after a few seconds. If you are away from the machine — the entire situation this extension exists for — a banner is gone before you look back.

## Getting started

1. Install the extension.
2. Say yes when it offers to install the Claude Code hooks, or run **Claude Noti: Install Claude Code Hooks** from the command palette.
3. **Start a new Claude Code session.** Hooks are read when a session starts, so an already-running one will not pick them up.
4. Run **Claude Noti: Send Test Notification**, switch to another app, and check it arrives.

If it does not, **Claude Noti: Run Diagnostics** checks every link in the chain and prints which one is broken.

## Settings

Everything is under `claudeNoti` in VS Code settings. Three of them also have pickers in the command palette, because their values are impossible to guess.

### What you get told about

Turn off whatever you find noisy. Each is independent.

| Setting | Default | Fires when |
| --- | --- | --- |
| `events.permissionPrompt` | `true` | Claude asks to run a tool, or puts a set of options in front of you |
| `events.idlePrompt` | `true` | Claude has been waiting on you for a while |
| `events.agentNeedsInput` | `true` | A subagent or an MCP server needs an answer |
| `events.stop` | `true` | A turn finished |
| `enabled` | `true` | Master switch for all of it |

`events.stop` is the one people turn off first — it fires at the end of every turn, which is useful when you step away and noise when you do not. Completions from subagents are always ignored, since a single turn can spawn many.

### How it looks and sounds

| Setting | Default | Notes |
| --- | --- | --- |
| `sound` | `""` (silent) | A macOS sound name such as `Glass` or `Sosumi` |
| `notificationIcon` | `""` | Empty uses the bell icon; give a path for your own image; `none` keeps Terminal's |
| `timeoutSeconds` | `0` | `0` means the notification waits until you deal with it |

Use **Claude Noti: Choose Notification Sound** rather than typing a name — it plays each sound as you move down the list, which is the only sensible way to pick one. It includes anything you have put in `~/Library/Sounds`.

`timeoutSeconds: 0` is deliberate. A notification that expires while you are in another application is one you never see, and that is precisely when you needed it. Set a number only if you find them piling up.

### When it should stay quiet

| Setting | Default | Notes |
| --- | --- | --- |
| `suppressWhenFocused` | `true` | No banner when you are already looking at that window |
| `minIntervalMs` | `1500` | Ignores repeats from the same session inside this window |

There is also a bell in the status bar. Click it to mute this window when you want to work undisturbed for a while; it does not persist across restarts, so you cannot accidentally leave it off forever.

### The rest

Most people never touch these.

| Setting | Default | Notes |
| --- | --- | --- |
| `hookScope` | `"user"` | Register hooks for every project, or only this one |
| `notifyUnmatchedSessions` | `false` | Also notify for Claude sessions running outside any open workspace |
| `onFocusCommands` | `[]` | Commands to run after the window comes forward, e.g. `workbench.action.terminal.focus` to land in the terminal |
| `notifierPath` | `""` | Point at `alerter` yourself if it is somewhere unusual |
| `impersonateEditor` | `false` | Borrow the editor's icon. **Likely to stop notifications appearing at all** — macOS only displays notifications from a sender it recognises. Test before relying on it |

## Commands

| Command | What it does |
| --- | --- |
| Send Test Notification | Checks the whole chain, including the click |
| Run Diagnostics | Reports which link is broken, and why |
| Choose Notification Sound | Pick a sound, hearing each as you go |
| Choose Notification Icon | The bell, Terminal's icon, or your own image |
| Choose How Long Notifications Stay | Wait for you, or close after a set time |
| Toggle Mute | Silence this window for a while |
| Install / Remove Claude Code Hooks | Register with Claude Code, or undo it |
| Show Log | Open the output channel |

## What it changes on your machine

Worth knowing, since this extension asks Claude Code to run a script:

- It writes one shell script to `~/.claude-noti/` and registers it in `~/.claude/settings.json` so Claude Code will run it. **Remove Claude Code Hooks** takes out only its own entries and leaves anything else you have in there alone. It keeps a `.bak` copy before writing, and refuses to touch the file at all if it is not valid JSON.
- Windows talk to each other over a socket in a directory only your account can read. No network port is opened, and nothing leaves your machine.

## When it does not work

**Nothing happens at all.** Hooks are read when a Claude Code session starts. Restart the session, then run diagnostics.

**Notifications appear, but clicking does nothing.** `alerter` is missing and the fallback is in use. Install it with the brew command above.

**No notification appears anywhere.** Click the clock in the menu bar to open Notification Center. If the messages are sitting there, delivery works and only the alert style is wrong — set **Terminal** to **Alerts**. If Notification Center is empty too, a Focus mode is filtering them.

**They reach Notification Center, the settings are right, and still nothing appears on screen.** macOS's own notification agent can wedge into a state where it files notifications away without ever drawing them. Nothing in System Settings reveals this and no amount of changing the style fixes it. Restart the agent:

```sh
killall NotificationCenter
```

It relaunches by itself and banners come back. Worth trying before assuming a notification tool is at fault — this affects every app on the machine, not just this one.

**Two notifications for one prompt.** That should not happen. Please [open an issue](https://github.com/luongdong059/claude-noti/issues) with the output of **Run Diagnostics** from both windows.

## Windows and Linux

Not yet — macOS only. On another OS the extension tells you so and stays out of the way.

## Contributing

Bug reports and pull requests are welcome at [github.com/luongdong059/claude-noti](https://github.com/luongdong059/claude-noti). See [CONTRIBUTING.md](CONTRIBUTING.md) for how it is put together and how to run it locally.

MIT licensed.
