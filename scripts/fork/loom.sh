#!/bin/bash
# Loom fork maintenance: integrate upstream T3 Code releases, build the app,
# install it, and roll back. Fork-owned; upstream never edits this file.
#
#   scripts/fork/loom.sh status
#   scripts/fork/loom.sh integrate [stable|nightly|<tag>] [--no-install] [--dry-run] [--continue]
#   scripts/fork/loom.sh build
#   scripts/fork/loom.sh install
#   scripts/fork/loom.sh rollback
#
# integrate merges an upstream tag into a test branch (integrate/<tag>), runs
# the fork's checks and builds the app. Only when all of that passes does it
# fast-forward main, tag the result loom-<tag>, push, and install. A merge
# conflict stops on the test branch; resolve it, commit, and rerun with
# --continue. --dry-run merges, checks and builds, then throws the result away
# without touching main or the installed app. Every install first snapshots the T3 database so rollback can
# restore the build and the data it ran with.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO_ROOT"

APP_ID="com.t3tools.t3code"
APP_PATH="/Applications/Loom.app"
BUILDS_DIR="$HOME/Library/Application Support/Loom Builds"
T3_USERDATA="$HOME/.t3/userdata"
KEEP_BUILDS=3
# Upstream files that must still carry a `fork: brand` marker after a merge.
SEAM_FILES=(
  apps/desktop/src/app/DesktopEnvironment.ts
  apps/web/src/branding.ts
  apps/web/src/branding.logic.ts
  apps/web/src/components/sidebar/SidebarChrome.tsx
  apps/web/index.html
  scripts/build-desktop-artifact.ts
  apps/desktop/resources/dmg/dmg-background-latest.svg
  apps/desktop/resources/dmg/dmg-background-nightly.svg
)
FORK_TESTS=(
  packages/shared/src/brand.test.ts
  apps/web/src/branding.test.ts
  apps/desktop/src/app/DesktopAppIdentity.test.ts
  scripts/build-desktop-artifact.test.ts
)
TYPECHECK_DIRS=(packages/shared apps/desktop apps/web scripts)

# The repo's own tools (vp) and Rust, which the desktop build needs for a
# native helper. pnpm adds node_modules/.bin itself; plain node does not.
export PATH="$REPO_ROOT/node_modules/.bin:/opt/homebrew/opt/rustup/bin:$PATH"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'loom: %s\n' "$*" >&2; exit 1; }

latest_stable() { git tag -l 'v[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1; }
latest_nightly() { git tag -l 'v*-nightly.*' --sort=-creatordate | head -1; }
# The upstream tag main was last built from: the newest loom-<tag> on main,
# or the newest upstream stable tag main contains.
current_upstream() {
  local t
  t=$(git tag -l 'loom-v*' --merged main --sort=-creatordate | head -1)
  if [ -n "$t" ]; then echo "${t#loom-}"; return; fi
  git tag -l 'v[0-9]*' --merged main --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1
}
installed_version() {
  [ -d "$APP_PATH" ] && /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "not installed"
}

require_clean() {
  [ -z "$(git status --porcelain)" ] || die "the working tree has changes; commit or stash them first"
}

cmd_status() {
  git fetch -q upstream --tags
  git fetch -q origin
  printf 'main is built from:   %s\n' "$(current_upstream)"
  printf 'installed Loom:       %s\n' "$(installed_version)"
  printf 'newest stable:        %s\n' "$(latest_stable)"
  printf 'newest nightly:       %s\n' "$(latest_nightly)"
  printf 'kept builds:          %s\n' "$(ls "$BUILDS_DIR" 2>/dev/null | tr '\n' ' ')"
}

run_checks() {
  say "Checking that every fork seam survived"
  local missing=0 f
  for f in "${SEAM_FILES[@]}"; do
    if ! grep -q 'fork: brand' "$f" 2>/dev/null; then echo "  missing seam: $f"; missing=1; fi
  done
  [ "$missing" -eq 0 ] || die "a fork seam is gone; reapply it (see FORK.md), commit, and rerun with --continue"
  say "Installing dependencies"
  pnpm install --frozen-lockfile
  say "Running the fork's tests"
  pnpm exec vp test run "${FORK_TESTS[@]}"
  local d
  for d in "${TYPECHECK_DIRS[@]}"; do
    say "Typechecking $d"
    (cd "$d" && pnpm run -s typecheck)
  done
}

# Build the macOS app for this Mac from the current checkout, stamped with
# the upstream version it was built from.
build_app() {
  local version=$1
  # Dependencies must match the checkout being built: switching branches (or a
  # dry run of a newer tag) leaves node_modules from another lockfile.
  say "Installing dependencies for this checkout"
  pnpm install --frozen-lockfile
  say "Building Loom $version"
  rm -rf release
  node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --build-version "$version"
  local zip
  zip=$(ls release/*-arm64.zip 2>/dev/null | head -1)
  [ -n "$zip" ] || die "the build produced no zip in release/"
  local record
  record="$BUILDS_DIR/$version-$(git rev-parse --short HEAD)"
  rm -rf "$record" && mkdir -p "$record"
  ditto -x -k "$zip" "$record"
  local name
  name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$record"/*.app/Contents/Info.plist)
  case "$name" in Loom | "Loom ("*) ;; *) die "the built app is named '$name', not Loom; check the brand seams" ;; esac
  [ "$(ls -d "$record"/*.app | head -1)" = "$record/Loom.app" ] || mv "$record"/*.app "$record/Loom.app"
  printf 'upstream=%s\ncommit=%s\nbuilt=%s\n' "$version" "$(git rev-parse HEAD)" "$(date -u +%FT%TZ)" > "$record/build.env"
  echo "Built $name $version into $record"
}

# Build records, newest build first. Ordered by the recorded build time, not
# folder dates, which change whenever a data snapshot is saved into a record.
records() {
  local env
  for env in "$BUILDS_DIR"/*/build.env; do
    [ -f "$env" ] || continue
    printf '%s\t%s\n' "$(grep '^built=' "$env" | cut -d= -f2-)" "$(dirname "$env")"
  done | sort -r | cut -f2-
}

# The record of the installed build, from the marker install_record writes.
installed_record() {
  local name
  [ -f "$BUILDS_DIR/installed" ] || return 0
  name=$(cat "$BUILDS_DIR/installed")
  [ -d "$BUILDS_DIR/$name" ] && echo "$BUILDS_DIR/$name"
  return 0
}

# Keep the newest builds, and always the installed one.
prune_builds() {
  local installed old
  installed=$(installed_record)
  records | tail -n +$((KEEP_BUILDS + 1)) | while read -r old; do
    [ "$old" = "$installed" ] || rm -rf "$old"
  done
}

quit_app() {
  if pgrep -f "/Applications/Loom.app/Contents/MacOS/" >/dev/null || pgrep -f "T3 Code (Alpha).app/Contents/MacOS/" >/dev/null; then
    say "Quitting the running app"
    osascript -e "quit app id \"$APP_ID\"" || true
    local _
    for _ in $(seq 1 30); do
      pgrep -f "/Applications/Loom.app/Contents/MacOS/" >/dev/null || pgrep -f "T3 Code (Alpha).app/Contents/MacOS/" >/dev/null || return 0
      sleep 1
    done
    die "the app did not quit; quit it yourself and rerun"
  fi
}

# Snapshot the T3 database and settings into the record of the build that is
# installed now, so rolling back to it restores the data it last ran with.
snapshot_state() {
  local into=$1
  [ -f "$T3_USERDATA/state.sqlite" ] || return 0
  mkdir -p "$into/state"
  rm -f "$into/state/state.sqlite"
  sqlite3 "$T3_USERDATA/state.sqlite" "VACUUM INTO '$into/state/state.sqlite'"
  local f
  for f in settings.json client-settings.json; do
    [ -f "$T3_USERDATA/$f" ] && cp "$T3_USERDATA/$f" "$into/state/"
  done
  echo "Saved the current T3 data to $into/state"
}

install_record() {
  local record=$1
  quit_app
  local current
  current=$(installed_record)
  if [ -n "$current" ]; then
    snapshot_state "$current"
  else
    snapshot_state "$BUILDS_DIR/before-loom"
  fi
  say "Installing $(basename "$record")"
  rm -rf "$APP_PATH"
  ditto "$record/Loom.app" "$APP_PATH"
  basename "$record" > "$BUILDS_DIR/installed"
  xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
  open "$APP_PATH"
  echo "Installed Loom $(installed_version)"
}

cmd_build() {
  require_clean
  build_app "$(current_upstream | sed 's/^v//')"
}

cmd_install() {
  local record
  record=$(records | head -1)
  [ -n "$record" ] || die "no build to install; run build or integrate first"
  install_record "$record"
}

cmd_rollback() {
  local current previous
  current=$(installed_record)
  [ -n "$current" ] || die "the installed app has no build record, so there is nothing to roll back to"
  previous=$(records | grep -v -x -F "$current" | head -1)
  [ -n "$previous" ] || die "no earlier build is kept"
  [ -f "$previous/state/state.sqlite" ] || die "$(basename "$previous") has no saved data to restore"
  quit_app
  snapshot_state "$current"
  say "Restoring the data $(basename "$previous") last ran with"
  rm -f "$T3_USERDATA/state.sqlite" "$T3_USERDATA/state.sqlite-wal" "$T3_USERDATA/state.sqlite-shm"
  cp "$previous/state/state.sqlite" "$T3_USERDATA/state.sqlite"
  local f
  for f in settings.json client-settings.json; do
    [ -f "$previous/state/$f" ] && cp "$previous/state/$f" "$T3_USERDATA/$f"
  done
  install_record "$previous"
  echo "Rolled back to $(basename "$previous"). main still points at the newer code;"
  echo "to move it back too: git reset --hard loom-$(grep '^upstream=' "$previous/build.env" | cut -d= -f2) && git push --force-with-lease origin main"
}

cmd_integrate() {
  local target=stable install=1 cont=0 dry=0 arg
  for arg in "$@"; do
    case "$arg" in
      --no-install) install=0 ;;
      --continue) cont=1 ;;
      --dry-run) dry=1 ;;
      *) target=$arg ;;
    esac
  done
  local tag branch
  if [ "$cont" -eq 1 ]; then
    branch=$(git rev-parse --abbrev-ref HEAD)
    [[ "$branch" == integrate/* ]] || die "--continue runs on an integrate/<tag> branch"
    tag=${branch#integrate/}
    require_clean
  else
    git fetch -q upstream --tags
    git fetch -q origin
    case "$target" in
      stable) tag=$(latest_stable) ;;
      nightly) tag=$(latest_nightly) ;;
      *) tag=$target ;;
    esac
    git rev-parse -q --verify "refs/tags/$tag" >/dev/null || die "no upstream tag $tag"
    [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "run integrate from main"
    require_clean
    [ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] || die "main differs from origin/main; sync them first"
    if git merge-base --is-ancestor "$tag" main; then
      echo "main already includes $tag. Nothing to integrate."
      return 0
    fi
    branch="integrate/$tag"
    git switch -q -c "$branch"
    say "Merging upstream $tag"
    if ! git merge --no-ff --no-edit -m "chore(fork): integrate upstream $tag" "$tag"; then
      echo
      echo "The merge stopped on conflicts in:"
      git diff --name-only --diff-filter=U | sed 's/^/  /'
      echo
      echo "They are almost always fork seams (git grep -n 'fork: brand'; see FORK.md)."
      echo "Resolve them, then: git add -A && git commit --no-edit && scripts/fork/loom.sh integrate --continue"
      echo "To give up: git merge --abort && git switch main && git branch -D $branch"
      exit 2
    fi
  fi
  run_checks
  build_app "${tag#v}"
  if [ "$dry" -eq 1 ]; then
    say "Dry run passed; discarding it"
    git switch -q main
    git branch -q -D "$branch"
    pnpm install --frozen-lockfile >/dev/null
    rm -rf "$BUILDS_DIR/${tag#v}-"*
    echo "$tag merges, checks and builds cleanly. main and the installed app are unchanged."
    return 0
  fi
  say "Everything passed; updating main"
  git switch -q main
  git merge -q --ff-only "$branch"
  git tag -a "loom-$tag" -m "Loom built from upstream $tag"
  git push -q origin main "loom-$tag"
  git branch -q -d "$branch"
  prune_builds
  if [ "$install" -eq 1 ]; then
    cmd_install
  else
    echo "Built and pushed. Install it with: scripts/fork/loom.sh install"
  fi
}

case "${1:-}" in
  status) cmd_status ;;
  integrate) shift; cmd_integrate "$@" ;;
  build) cmd_build ;;
  install) cmd_install ;;
  rollback) cmd_rollback ;;
  *) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
