#!/bin/bash
# claude-noti-hook-version: 1
#
# Claude Code writes a hook payload as JSON on stdin. This script forwards it
# verbatim to every running VS Code window that has the Claude Noti extension
# active, then exits 0 no matter what happens: a notifier must never be able to
# disturb or block a Claude Code session.
#
# It deliberately depends on nothing beyond bash and curl, both of which ship
# with macOS. Working out *which* window should act on a payload needs JSON
# parsing, so that decision lives in the extension rather than here — which is
# also why this broadcasts instead of picking a target.

payload=$(cat)

dir="$HOME/.claude-noti/sock"
[ -d "$dir" ] || exit 0

shopt -s nullglob
for sock in "$dir"/*.sock; do
  [ -S "$sock" ] || continue
  printf '%s' "$payload" | curl -sS -m 2 --unix-socket "$sock" \
    -X POST -H 'Content-Type: application/json' --data-binary @- \
    "http://localhost/notify" >/dev/null 2>&1 &
done

wait
exit 0
