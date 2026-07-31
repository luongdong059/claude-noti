#!/usr/bin/env bash
#
# Cuts a release: bumps the version, runs the checks, tags, and pushes.
# CI takes it from there — it packages, creates the GitHub release and
# publishes to the Marketplace if VSCE_PAT is configured.
#
#   ./scripts/publish.sh patch          # 0.2.1 -> 0.2.2
#   ./scripts/publish.sh minor          # 0.2.1 -> 0.3.0
#   ./scripts/publish.sh 1.0.0          # an exact version
#   ./scripts/publish.sh patch --local  # also publish from here, without waiting for CI
#
set -euo pipefail

cd "$(dirname "$0")/.."

BUMP="${1:-}"
LOCAL=false
for arg in "$@"; do [ "$arg" = "--local" ] && LOCAL=true; done

die() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
step() { printf '\033[1m→ %s\033[0m\n' "$1"; }
ok() { printf '\033[32m  ✓ %s\033[0m\n' "$1"; }

[ -n "$BUMP" ] || die "Thiếu tham số. Dùng: $0 patch|minor|major|<version> [--local]"

# --- Node 20+ ------------------------------------------------------------
# `node` on this machine can resolve to Laravel Herd's bundled v18, which is
# too old for vsce. Prefer whatever is already on PATH if it is new enough,
# otherwise fall back to Homebrew rather than failing deep inside a build.
step "Kiểm tra Node"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 20 ]; then
  [ -x /opt/homebrew/bin/node ] || die "Cần Node 20 trở lên. Cài bằng: brew install node"
  export PATH="/opt/homebrew/bin:$PATH"
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Không tìm thấy Node 20+ nào trên máy"
fi
ok "node $(node -v)"

# --- Trạng thái repo -----------------------------------------------------
step "Kiểm tra trạng thái git"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || die "Đang ở nhánh '$BRANCH'. Phát hành phải từ main."
[ -z "$(git status --porcelain)" ] || die "Còn thay đổi chưa commit. Commit hoặc stash trước."
git fetch -q origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main lệch với origin/main. Pull hoặc push trước."
ok "main sạch và khớp với origin"

# --- Phiên bản -----------------------------------------------------------
CURRENT="$(node -p "require('./package.json').version")"
NEW="$(npm version "$BUMP" --no-git-tag-version --allow-same-version | tail -1 | tr -d 'v')"
# npm has already written package.json; undo it if anything below fails.
restore() { git checkout -- package.json package-lock.json 2>/dev/null || true; }
trap restore ERR

[ "$NEW" != "$CURRENT" ] || { restore; die "Phiên bản không đổi ($CURRENT). Chọn mức bump khác."; }
git tag -l "v$NEW" | grep -q . && { restore; die "Tag v$NEW đã tồn tại."; }
ok "$CURRENT → $NEW"

# --- CHANGELOG -----------------------------------------------------------
# A release with no changelog entry is a release nobody can tell apart from
# the last one, so this is a hard stop rather than a warning.
step "Kiểm tra CHANGELOG"
grep -q "^## $NEW\$" CHANGELOG.md || {
  restore
  die "CHANGELOG.md chưa có mục '## $NEW'. Viết phần mô tả cho bản này rồi chạy lại."
}
ok "đã có mục cho $NEW"

# --- Kiểm thử ------------------------------------------------------------
step "Chạy typecheck, lint và test"
npm run typecheck
npm run lint
npm run test:unit >/dev/null
ok "tất cả đều đạt"

step "Thử đóng gói"
npx vsce package --out /tmp/claude-noti-precheck.vsix >/dev/null
rm -f /tmp/claude-noti-precheck.vsix
ok "đóng gói được"

# --- Xác nhận ------------------------------------------------------------
trap - ERR
printf '\n\033[1mSắp thực hiện:\033[0m\n'
printf '  • commit "release: v%s"\n' "$NEW"
printf '  • tag v%s và push lên origin\n' "$NEW"
printf '  • CI sẽ đóng gói, tạo GitHub release, và publish lên Marketplace nếu có VSCE_PAT\n'
$LOCAL && printf '  • publish thẳng từ máy này (--local)\n'
printf '\nTiếp tục? [y/N] '
read -r reply </dev/tty
case "$reply" in
  [yY]) ;;
  *) restore; die "Đã huỷ. package.json trả về như cũ." ;;
esac

# --- Phát hành -----------------------------------------------------------
step "Commit và tag"
git add package.json package-lock.json CHANGELOG.md
git commit -q -m "release: v$NEW"
git tag -a "v$NEW" -m "v$NEW"
git push -q origin main --follow-tags
ok "đã push v$NEW"

if $LOCAL; then
  step "Publish lên Marketplace từ máy này"
  npx vsce publish --no-git-tag-version
  ok "đã publish"
fi

PUBLISHER="$(node -p "require('./package.json').publisher")"
NAME="$(node -p "require('./package.json').name")"
printf '\n\033[32mXong.\033[0m\n'
printf '  Release:     https://github.com/luongdong059/%s/releases/tag/v%s\n' "$NAME" "$NEW"
printf '  Actions:     https://github.com/luongdong059/%s/actions\n' "$NAME"
printf '  Marketplace: https://marketplace.visualstudio.com/items?itemName=%s.%s\n' "$PUBLISHER" "$NAME"
