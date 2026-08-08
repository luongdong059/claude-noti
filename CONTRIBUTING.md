# Contributing

## Running it locally

```sh
npm ci
npm run watch
```

Press F5 in VS Code to launch an Extension Development Host with the extension loaded.

```sh
npm test          # lint + unit suite
npm run typecheck # separate, so a type error does not hide a test failure
npm run package   # build a .vsix
```

CI runs the suite on Linux, macOS and Windows. That matters more than it looks: the routing and event logic is deliberately free of OS-specific code, and running it on three systems is what keeps it that way. The Windows runner caught a `path.sep` bug on its first outing.

Release steps and Marketplace setup are in [PUBLISHING.md](PUBLISHING.md).

## How it fits together

Installing hooks writes a script to `~/.claude-noti/hook.sh` and registers it in Claude Code's settings. When Claude Code fires a hook, that script forwards the payload to **every** open VS Code window over a Unix domain socket in a `0700` directory under `$HOME`. No TCP port is opened.

Broadcasting is deliberate. Deciding which window should act needs JSON parsing, and doing that in the shell script would mean depending on `jq`, `node` or `python3` — none of which is guaranteed to be there. So the script stays at bash plus curl, and the decision lives in TypeScript where the workspace data already is.

Each window then works out independently whether the session is its own, by matching the reported `cwd` against its own workspace folders: deepest match wins, lowest process id breaks ties. Every window runs the same comparison over the same registry of instances, so they all reach the same answer and exactly one acts — no coordination, no leader election.

### Which hook event, and why it matters

The extension listens for `PermissionRequest`, not `Notification`.

`Notification` looks like the obvious choice and is what the documentation points you at. It never fires in the VS Code integrated terminal: Claude Code raises it only when it has a desktop notification channel to send on, and there is none there — the exact situation this extension exists for. Instrumenting the hook script across one session recorded five `PermissionRequest` events and zero `Notification` events.

`Notification` is still registered, because it does fire in terminals that have a channel and carries idle prompts that `PermissionRequest` does not.

### Layout

| Path | Holds |
| --- | --- |
| `src/routing.ts` | Window election, event filtering, throttling, notification text. No `vscode` import, so it is unit-testable |
| `src/router.ts` | Wires the above to the editor |
| `src/platform/` | Everything OS-specific: notifier, window raising, IPC endpoint, hook script, sounds. No `vscode` import either |
| `src/ipc/` | The socket server and the registry of live windows |
| `src/hooks/installer.ts` | Patching Claude Code's `settings.json` |
| `src/notify/` | `alerter` and the `osascript` fallback |
| `resources/hook.sh` | The script Claude Code runs |

The `Platform` interface is where Windows support will slot in. `scripts/windows-probe.ps1` is the measurement script that has to run on a real Windows machine first.

## A note on how this was built

Several days of this project were spent on assumptions taken from documentation that turned out to be false on a real machine — the hook that never fired, a sender override that silently swallowed every notification, a preferences file that stopped reflecting reality. Each one cost hours.

If you are changing anything that touches the operating system, measure it before you write it. Log what actually arrives, fire the real command, and check the result with your own eyes. The `--check`-style probes and the diagnostics command exist because of that, and are worth extending rather than working around.
