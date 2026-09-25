#!/bin/bash
# Loom fork maintenance: integrate upstream T3 Code releases, build the app,
# install it, and roll back. Fork-owned; upstream never edits this file.
#
#   scripts/fork/loom.sh status
#   scripts/fork/loom.sh check
#   scripts/fork/loom.sh integrate [stable|nightly|<tag>] [--no-install] [--dry-run] [--continue] [--pr]
#   scripts/fork/loom.sh land [<pr number>] [--no-install]
#   scripts/fork/loom.sh build
#   scripts/fork/loom.sh install
#   scripts/fork/loom.sh rollback
#   scripts/fork/loom.sh signing-setup
#
# integrate merges an upstream tag into a test branch (integrate/<tag>), runs
# the fork's checks and builds the app. Only when all of that passes does it
# fast-forward main, tag the result loom-<tag>, push, and install. A merge
# conflict stops on the test branch; resolve it, commit, and rerun with
# --continue. --dry-run merges, checks and builds, then throws the result
# away without touching main or the installed app. --pr is the unattended
# path the loom-upstream workflow uses: merge and check, then push the test
# branch and open a pull request instead of building. land finishes that pull
# request here: merge it with a merge commit, tag, build and install. check
# runs the fork's checks on the current checkout. Every install first
# snapshots the T3 database so rollback can restore the build and the data it
# ran with. signing-setup creates a local code-signing certificate once, so
# every build is the same app to macOS and keeps its permissions and Keychain
# access across updates.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO_ROOT"

APP_PATH="/Applications/Loom.app"
BUILDS_DIR="$HOME/Library/Application Support/Loom Builds"
T3_USERDATA="$HOME/.t3/userdata"
KEEP_BUILDS=3
SIGNING_IDENTITY="${LOOM_SIGNING_IDENTITY:-Loom Local Code Signing}"
LOGIN_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
# Every upstream file the fork touches, with its marker and how many marked
# lines it must keep (docs/fork/seams.tsv). run_checks fails when a merge drops
# a seam, and when a marker appears that the manifest does not list.
SEAMS_MANIFEST=docs/fork/seams.tsv
# The branding tests live next to upstream code; every other fork test lives
# in a fork/ directory and is found by fork_tests.
BRAND_TESTS=(
  packages/shared/src/brand.test.ts
  apps/web/src/branding.test.ts
  apps/desktop/src/app/DesktopAppIdentity.test.ts
  scripts/build-desktop-artifact.test.ts
)
TYPECHECK_DIRS=(packages/shared packages/contracts packages/client-runtime apps/server apps/desktop apps/web scripts)
UPSTREAM_RELEASES=https://github.com/pingdotgg/t3code/releases/tag

# The repo's own tools (vp) and Rust, which the desktop build needs for a
# native helper. pnpm adds node_modules/.bin itself; plain node does not.
export PATH="$REPO_ROOT/node_modules/.bin:/opt/homebrew/opt/rustup/bin:$PATH"
# Shells inside Loom (its terminal, its agents) inherit ELECTRON_RUN_AS_NODE=1
# from the desktop app. It turns every Electron the build starts into plain
# Node, and upstream tests that copy the environment into mock commands fail.
unset ELECTRON_RUN_AS_NODE

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'loom: %s\n' "$*" >&2; exit 1; }

latest_stable() { git tag -l 'v[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed -n 1p; }
latest_nightly() { git tag -l 'v*-nightly.*' --sort=-creatordate | sed -n 1p; }
# The upstream tag main was last built from: the newest loom-<tag> on main,
# or the newest upstream stable tag main contains.
current_upstream() {
  local t
  t=$(git tag -l 'loom-v*' --merged main --sort=-creatordate | sed -n 1p)
  if [ -n "$t" ]; then echo "${t#loom-}"; return; fi
  git tag -l 'v[0-9]*' --merged main --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed -n 1p
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
  printf 'main is built from: %s\n' "$(current_upstream)"
  printf 'installed Loom:       %s\n' "$(installed_version)"
  printf 'newest stable:        %s\n' "$(latest_stable)"
  printf 'newest nightly:       %s\n' "$(latest_nightly)"
  printf 'kept builds:          %s\n' "$(ls "$BUILDS_DIR" 2>/dev/null | tr '\n' ' ')"
}

# pnpm's automatic install on some machines rewrites one peer-dependency hash
# in pnpm-lock.yaml. It is local noise, never part of the fork, so undo it.
restore_lockfile() {
  git diff --quiet -- pnpm-lock.yaml || git checkout -q -- pnpm-lock.yaml
}

# A marker is `fork: <name>` right after a comment opener, so upstream code that
# merely contains "fork: " (an object key, say) never counts.
marker_re() { printf '(//|/\\*|<!--|#) fork: %s([^a-z0-9-]|$)' "$1"; }

check_seams() {
  say "Checking that every fork seam survived"
  local missing=0 path marker want have
  while IFS=$'\t' read -r path marker want; do
    case "$path" in '' | '#'*) continue ;; esac
    if [ "$marker" = - ]; then
      # Files that cannot carry a comment (JSON): the seam's own text is the check.
      grep -qF -- "$want" "$path" 2>/dev/null || { echo "  $path no longer contains $want"; missing=1; }
    else
      have=$(grep -cE "$(marker_re "$marker")" "$path" 2>/dev/null) || have=0
      [ "$have" -ge "$want" ] || { echo "  $path has $have of $want 'fork: $marker' lines"; missing=1; }
    fi
  done < "$SEAMS_MANIFEST"
  [ "$missing" -eq 0 ] || die "a fork seam is gone; reapply it (see FORK.md), commit, and rerun with --continue"
  local unlisted
  unlisted=$(comm -23 \
    <(git grep -nE "$(marker_re '[a-z0-9-]+')" -- . ':(exclude)docs/' \
      | sed -E 's/^([^:]+):[0-9]+:.*(\/\/|\/\*|<!--|#) fork: ([a-z0-9-]+).*/\1	\3/' | sort -u) \
    <(grep -v '^#' "$SEAMS_MANIFEST" | cut -f1,2 | sort -u))
  [ -z "$unlisted" ] || die "fork markers missing from $SEAMS_MANIFEST (add a row per file and marker):
$unlisted"
}

fork_tests() {
  printf '%s\n' "${BRAND_TESTS[@]}"
  git ls-files -- '*/fork/*.test.ts' '*/fork/*.test.tsx'
}

run_checks() {
  check_seams
  say "Installing dependencies"
  pnpm install --frozen-lockfile
  say "Running the fork's tests"
  local tests=()
  while IFS= read -r t; do tests+=("$t"); done < <(fork_tests)
  pnpm exec vp test run "${tests[@]}"
  local d
  for d in "${TYPECHECK_DIRS[@]}"; do
    say "Typechecking $d"
    (cd "$d" && pnpm run -s typecheck)
  done
  restore_lockfile
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
  # Like upstream's release workflow, stamp every releasable package with the
  # release version first, so the app and its bundled server agree. The stamp
  # is for the build only; the package files are restored afterwards.
  local stamped=(apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json)
  node scripts/update-release-package-versions.ts "$version"
  if ! node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --build-version "$version"; then
    git checkout -q -- "${stamped[@]}"
    die "the desktop build failed"
  fi
  git checkout -q -- "${stamped[@]}"
  restore_lockfile
  local zip
  zip=$(ls release/*-arm64.zip 2>/dev/null | sed -n 1p)
  [ -n "$zip" ] || die "the build produced no zip in release/"
  local record
  record="$BUILDS_DIR/$version-$(git rev-parse --short HEAD)"
  rm -rf "$record" && mkdir -p "$record"
  ditto -x -k "$zip" "$record"
  local name
  name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$record"/*.app/Contents/Info.plist)
  case "$name" in Loom | "Loom ("*) ;; *) die "the built app is named '$name', not Loom; check the brand seams" ;; esac
  [ "$(ls -d "$record"/*.app | sed -n 1p)" = "$record/Loom.app" ] || mv "$record"/*.app "$record/Loom.app"
  sign_app "$record/Loom.app"
  printf 'upstream=%s\ncommit=%s\nbuilt=%s\n' "$version" "$(git rev-parse HEAD)" "$(date -u +%FT%TZ)" > "$record/build.env"
  echo "Built $name $version into $record"
}

signing_identity_exists() {
  security find-identity -p codesigning "$LOGIN_KEYCHAIN" 2>/dev/null | grep -F "\"$SIGNING_IDENTITY\"" >/dev/null
}

# Local builds leave Electron's own ad hoc signature, identified as "Electron"
# and pinned to one build's hash. Re-sign with the local identity so the
# signature names the app's bundle id and the same certificate every build.
# Without the identity, still re-sign ad hoc so the identifier is right.
sign_app() {
  local app=$1 identity=-
  if signing_identity_exists; then
    identity=$SIGNING_IDENTITY
  else
    echo "No '$SIGNING_IDENTITY' certificate: signing ad hoc. Each build will look like a new app"
    echo "to macOS; run 'scripts/fork/loom.sh signing-setup' once to fix that."
  fi
  say "Signing the app"
  codesign --force --deep --sign "$identity" "$app"
  codesign --verify --deep --strict "$app"
  codesign -d -r- "$app" 2>&1 | grep '^designated' | sed 's/^/  /'
}

# Create a self-signed code-signing certificate in the login keychain. It is
# only for this Mac: it gives local builds a stable identity, it is not trusted
# by anyone else, and it cannot notarize. The private key never leaves the
# keychain; the temporary files are removed.
cmd_signing_setup() {
  if signing_identity_exists; then
    echo "'$SIGNING_IDENTITY' already exists in the login keychain."
    return 0
  fi
  local tmp pw
  tmp=$(mktemp -d)
  chmod 700 "$tmp"
  pw=$(/usr/bin/openssl rand -hex 16)
  printf '%s\n' \
    '[req]' 'distinguished_name = dn' 'x509_extensions = ext' 'prompt = no' \
    '[dn]' "CN = $SIGNING_IDENTITY" \
    '[ext]' 'basicConstraints = critical, CA:false' 'keyUsage = critical, digitalSignature' \
    'extendedKeyUsage = critical, codeSigning' > "$tmp/cert.cnf"
  /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$tmp/cert.cnf" \
    -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null
  /usr/bin/openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
    -out "$tmp/identity.p12" -passout pass:"$pw" 2>/dev/null
  security import "$tmp/identity.p12" -k "$LOGIN_KEYCHAIN" -P "$pw" -T /usr/bin/codesign >/dev/null
  rm -rf "$tmp"
  signing_identity_exists || die "the certificate was not imported"
  echo "Created '$SIGNING_IDENTITY' in the login keychain. The first signing may ask to let"
  echo "codesign use it; choose Always Allow."
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

# Loom and upstream's T3 Code share an app id and a data folder, so both are
# found and quit by their exact paths: a bundle id is ambiguous between them,
# and two running at once would put two servers on one database.
VANILLA_APP_PATH="/Applications/T3 Code (Alpha).app"
# pgrep never matches itself (a grep over ps output would match its own
# arguments); the paths are escaped so "(Alpha)" is literal, not a regex group.
app_running() {
  local app pattern
  for app in "$APP_PATH" "$VANILLA_APP_PATH"; do
    pattern=$(printf '%s' "$app/Contents/MacOS/" | sed 's/[][\\.*^$()+?{}|]/\\&/g')
    pgrep -f -- "$pattern" >/dev/null && return 0
  done
  return 1
}

quit_app() {
  app_running || return 0
  say "Quitting the running app"
  local app
  for app in "$APP_PATH" "$VANILLA_APP_PATH"; do
    [ -d "$app" ] && osascript -e "tell application \"$app\" to quit" >/dev/null 2>&1
  done
  local _
  for _ in $(seq 1 30); do
    app_running || return 0
    sleep 1
  done
  die "the app did not quit; quit it yourself and rerun"
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
  if [ -d "$VANILLA_APP_PATH" ]; then
    echo "Warning: $VANILLA_APP_PATH is still installed. It shares Loom's app id and data;"
    echo "never run both. Remove it with: brew uninstall --cask t3-code"
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
  record=$(records | sed -n 1p)
  [ -n "$record" ] || die "no build to install; run build or integrate first"
  install_record "$record"
}

cmd_rollback() {
  local current previous
  current=$(installed_record)
  [ -n "$current" ] || die "the installed app has no build record, so there is nothing to roll back to"
  previous=$(records | grep -v -x -F "$current" | sed -n 1p)
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
  local target=stable install=1 cont=0 dry=0 pr=0 arg
  for arg in "$@"; do
    case "$arg" in
      --no-install) install=0 ;;
      --continue) cont=1 ;;
      --dry-run) dry=1 ;;
      --pr) pr=1 ;;
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
    if [ "$pr" -eq 1 ] && [ "$dry" -eq 0 ] && git ls-remote --exit-code -q --heads origin "$branch" >/dev/null; then
      echo "$branch is already on origin, so its pull request is open or was abandoned. Nothing to do."
      return 0
    fi
    git switch -q -c "$branch"
    say "Merging upstream $tag"
    if ! git merge --no-ff --no-edit -m "chore(fork): integrate upstream $tag" "$tag"; then
      echo
      echo "The merge stopped on conflicts in:"
      git diff --name-only --diff-filter=U | sed 's/^/  /'
      echo
      echo "They are almost always fork seams (docs/fork/seams.tsv; see FORK.md)."
      echo "Resolve them, then: git add -A && git commit --no-edit && scripts/fork/loom.sh integrate --continue"
      echo "To give up: git merge --abort && git switch main && git branch -D $branch"
      exit 2
    fi
  fi
  run_checks
  if [ "$pr" -eq 1 ]; then
    if [ "$dry" -eq 1 ]; then
      say "Dry run passed; discarding it"
      git switch -q main
      git branch -q -D "$branch"
      echo "$tag merges and passes the fork's checks. Nothing was pushed."
    else
      open_pr "$tag" "$branch"
    fi
    return 0
  fi
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

# Push a checked integrate/<tag> branch and open its pull request into main.
open_pr() {
  local tag=$1 branch=$2 added
  added=$(git diff --name-only --diff-filter=A main...HEAD -- .github/workflows | sed 's/^/- `/; s/$/`/')
  say "Pushing $branch and opening its pull request"
  git push -q -u origin "$branch"
  gh pr create --base main --head "$branch" \
    --title "chore(fork): integrate upstream $tag" \
    --body "Merges upstream T3 Code [$tag]($UPSTREAM_RELEASES/$tag) into Loom. The seams in \`docs/fork/seams.tsv\` survived, the fork's tests pass, and $(printf '%s, ' "${TYPECHECK_DIRS[@]}" | sed 's/, $//') typecheck.

Land it from your Mac with \`scripts/fork/loom.sh land\`: it merges with a merge commit, tags \`loom-$tag\`, builds and installs. Never squash or rebase this pull request; the fork needs upstream's history for the next merge.${added:+

Upstream added these workflows. The loom-upstream workflow disables every non-fork workflow on its next run:
$added}"
}

# The newest upstream tag main contains, stable or nightly.
merged_upstream() { git tag -l 'v[0-9]*' --merged main --sort=-creatordate | sed -n 1p; }

# Finish an integration pull request on this Mac. With an open one, merge it
# (always a merge commit); with none, land whatever upstream tag main already
# contains but has no loom-<tag> for, which covers a PR merged on GitHub.
cmd_land() {
  local number="" install=1 arg
  for arg in "$@"; do
    case "$arg" in
      --no-install) install=0 ;;
      *) number=$arg ;;
    esac
  done
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "run land from main"
  require_clean
  if [ -z "$number" ]; then
    local open
    open=$(gh pr list --base main --state open --json number,headRefName \
      --jq '.[] | select(.headRefName | startswith("integrate/")) | .number')
    [ "$(printf '%s' "$open" | grep -c .)" -le 1 ] || die "several integration pull requests are open ($(echo $open)); pass the one to land"
    number=$open
  fi
  if [ -n "$number" ] && [ "$(gh pr view "$number" --json state --jq .state)" = OPEN ]; then
    say "Merging pull request #$number"
    gh pr merge "$number" --merge --delete-branch
  fi
  git fetch -q upstream --tags
  git fetch -q origin
  git merge -q --ff-only origin/main
  local tag
  tag=$(merged_upstream)
  if [ -n "$number" ]; then
    local head
    head=$(gh pr view "$number" --json headRefName --jq .headRefName)
    tag=${head#integrate/}
    git merge-base --is-ancestor "$tag" main \
      || die "main does not contain $tag, so #$number was squashed or rebased. Revert that commit and merge the pull request with a merge commit."
  fi
  [ -n "$tag" ] || die "main contains no upstream tag"
  if git rev-parse -q --verify "refs/tags/loom-$tag" >/dev/null; then
    echo "loom-$tag already exists. Nothing to land; rebuild with: scripts/fork/loom.sh build"
    return 0
  fi
  git tag -a "loom-$tag" -m "Loom built from upstream $tag"
  git push -q origin "loom-$tag"
  build_app "${tag#v}"
  prune_builds
  if [ "$install" -eq 1 ]; then
    cmd_install
  else
    echo "Built. Install it with: scripts/fork/loom.sh install"
  fi
}

case "${1:-}" in
  status) cmd_status ;;
  check) run_checks ;;
  integrate) shift; cmd_integrate "$@" ;;
  land) shift; cmd_land "$@" ;;
  build) cmd_build ;;
  install) cmd_install ;;
  rollback) cmd_rollback ;;
  signing-setup) cmd_signing_setup ;;
  *) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
