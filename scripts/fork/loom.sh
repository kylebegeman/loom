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
# the fork's checks and builds the app to verify it. Only when all of that
# passes does it fast-forward main, tag the result loom-<tag>, push, publish and
# install. A merge conflict stops on the test branch; resolve it, commit, and
# rerun with --continue. --dry-run merges, checks and builds, then throws the
# result away without touching main or the installed app. --pr is the
# unattended path the loom-upstream workflow uses: merge and check, then push
# the test branch and open a pull request instead of building. land finishes
# that pull request here: merge it with a merge commit, tag, publish and
# install. With none open it brings this Mac up to main, which is how merges
# the workflow made itself and fork changes on main get released.
#
# Only the publisher (scripts/fork/updates.ts) makes installable builds. land and
# integrate run it, so this Mac, the update feed, the iOS build and remote
# computers' runtimes all get one Loom version; build only verifies a checkout.
# check runs the fork's checks on the current checkout. Every install first
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
STATE_DATABASES=(state.sqlite statev2.sqlite)
SIGNING_IDENTITY="${LOOM_SIGNING_IDENTITY:-Loom Local Code Signing}"
LOGIN_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
PUBLISHER_PLIST="$HOME/Library/LaunchAgents/com.kylebegeman.loom-updates.plist"
# Every upstream file the fork touches, with its marker and how many marked
# lines it must keep (docs/fork/seams.tsv). run_checks fails when a merge drops
# a seam, and when a marker appears that the manifest does not list.
SEAMS_MANIFEST=docs/fork/seams.tsv
# Branding tests live next to upstream code; fork_tests also discovers Loom
# feature tests and the benchmark harness checks.
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
# gh picks a remote named "upstream" as its default repository, which would
# send the fork's pull requests to pingdotgg/t3code. Every gh call here is
# about the fork, so pin gh to origin.
GH_REPO=$(git remote get-url origin | sed -E 's#^(git@github\.com:|https://([^@/]+@)?github\.com/)##; s#\.git$##')
export GH_REPO

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'loom: %s\n' "$*" >&2; exit 1; }

latest_stable() { git tag -l 'v[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed -n 1p; }
latest_nightly() { git tag -l 'v*-nightly.*' --sort=-creatordate | sed -n 1p; }
# Loom release versions and upstream tags can differ. Only trust provenance
# naming a real upstream tag contained in the requested source history.
upstream_at() {
  local ref=$1 integration annotation upstream
  integration=$(git tag -l 'loom-v*' --merged "$ref" --sort=-v:refname --sort=-creatordate | sed -n 1p)
  if [ -n "$integration" ] && [ "$(git cat-file -t "refs/tags/$integration")" = tag ]; then
    annotation=$(git for-each-ref --format='%(contents)' "refs/tags/$integration")
    upstream=$(printf '%s\n' "$annotation" | sed -n 's/^upstream=\(v[^[:space:]]*\)$/\1/p' | sed -n 1p)
    if [ -z "$upstream" ]; then
      upstream=$(printf '%s\n' "$annotation" | sed -nE 's/^.*[Bb]uilt from upstream (v[^[:space:]]+).*$/\1/p' | sed -n 1p)
    fi
    if printf '%s\n' "$upstream" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' \
      && git show-ref --verify --quiet "refs/tags/$upstream" \
      && git merge-base --is-ancestor "refs/tags/$upstream" "$ref"; then
      printf '%s\n' "$upstream"
      return 0
    fi
  fi
  git tag -l 'v[0-9]*' --merged "$ref" --sort=-v:refname --sort=-creatordate \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' | sed -n 1p || true
}
current_upstream() { upstream_at main; }
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
  # Browser-mode tests need apps/web's headless Chromium project, which the root
  # config used here lacks; CI's web test job runs them.
  git ls-files -- '*/fork/*.test.ts' '*/fork/*.test.tsx' 'benchmarks/loom/*.test.ts' \
    ':(exclude)*.browser.test.ts' ':(exclude)*.browser.test.tsx'
}

# Lint only fork-owned source. Skip unmatched globs so future fork directories
# are included automatically without linting upstream source.
fork_lint_paths() {
  local path
  for path in apps/*/src/fork packages/*/src/fork apps/web/src/routes/settings.loom*.tsx \
    scripts/fork deploy/omarchy benchmarks/loom apps/server/scripts/benchmark-library.ts; do
    if [ -e "$path" ]; then printf '%s\n' "$path"; fi
  done
}

check_fork_lint() {
  say "Linting fork code"
  local path paths=()
  while IFS= read -r path; do paths+=("$path"); done < <(fork_lint_paths)
  # An empty path list would make vp lint the whole repository.
  [ "${#paths[@]}" -gt 0 ] || return 0
  pnpm exec vp lint --report-unused-disable-directives --deny-warnings "${paths[@]}" ||
    die "fork lint failed; fix the findings above (rules in oxlint-plugin-t3code/rules/)"
}

# The Omarchy pack's own Node tests and its generated packet views.
check_omarchy_pack() {
  say "Running the Omarchy pack's checks"
  node deploy/omarchy/check.mjs
}

run_checks() {
  check_seams
  say "Installing dependencies"
  pnpm install --frozen-lockfile
  check_fork_lint
  say "Running the fork's tests"
  local tests=()
  while IFS= read -r t; do tests+=("$t"); done < <(fork_tests)
  # Test paths are substring filters, so exclude agent worktrees nested in the
  # checkout. Shells inside Loom inherit ELECTRON_RUN_AS_NODE, which the
  # desktop artifact tests assert is absent.
  env -u ELECTRON_RUN_AS_NODE pnpm exec vp test run --exclude '**/.claude/**' "${tests[@]}"
  check_omarchy_pack
  say "Regenerating web routes and building the web client"
  (cd apps/web && pnpm exec vp build)
  local d
  for d in "${TYPECHECK_DIRS[@]}"; do
    say "Typechecking $d"
    (cd "$d" && pnpm run -s typecheck)
  done
  say "Typechecking Loom benchmarks"
  pnpm exec tsc-rs --noEmit -p benchmarks/loom/tsconfig.json
  restore_lockfile
}

# Build the macOS app from the current checkout to prove it builds. Installable
# builds come only from the publisher (scripts/fork/updates.ts), so every Loom on
# this Mac, in the update feed, on iOS and on remote computers shares one Loom
# release version. This build carries the upstream version and stays in release/.
verify_build() {
  local version=$1
  # Dependencies must match the checkout being built: switching branches (or a
  # dry run of a newer tag) leaves node_modules from another lockfile.
  say "Installing dependencies for this checkout"
  pnpm install --frozen-lockfile
  say "Building Loom $version to verify it"
  rm -rf release
  # Like upstream's release workflow, stamp every releasable package with the
  # release version first, so the app and its bundled server agree. The stamp
  # is for the build only; the package files are restored afterwards.
  local stamped=(apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json)
  node scripts/update-release-package-versions.ts "$version"
  if ! T3CODE_DESKTOP_UPDATE_REPOSITORY="$GH_REPO" node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --build-version "$version"; then
    git checkout -q -- "${stamped[@]}"
    die "the desktop build failed"
  fi
  git checkout -q -- "${stamped[@]}"
  restore_lockfile
  local zip
  zip=$(ls release/*-arm64.zip 2>/dev/null | sed -n 1p)
  [ -n "$zip" ] || die "the build produced no zip in release/"
  local unpacked app name
  unpacked=$(mktemp -d)
  ditto -x -k "$zip" "$unpacked"
  app=$(ls -d "$unpacked"/*.app | sed -n 1p)
  name=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$app/Contents/Info.plist")
  case "$name" in Loom | "Loom ("*) ;; *) rm -rf "$unpacked"; die "the built app is named '$name', not Loom; check the brand seams" ;; esac
  # Both apps share an id, so only the fork's feed may be embedded in Loom.
  if ! node --input-type=module -e '
    import { readFile } from "node:fs/promises";
    import { validateFeedConfig } from "./scripts/fork/updates.ts";
    validateFeedConfig(await readFile(process.argv[1], "utf8"));
  ' "$app/Contents/Resources/app-update.yml"; then
    rm -rf "$unpacked"
    die "the built app does not use the Loom update feed"
  fi
  rm -rf "$unpacked"
  echo "Built $name $version in release/ to verify it. Only published builds install."
}

signing_identity_exists() {
  security find-identity -p codesigning "$LOGIN_KEYCHAIN" 2>/dev/null | grep -F "\"$SIGNING_IDENTITY\"" >/dev/null
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

# Published build records, newest first. Install and rollback only see the
# publisher's builds, so the installed app always carries a Loom release version.
# Ordered by the recorded build time, not folder dates, which change whenever a
# data snapshot is saved into a record.
records() {
  local env
  for env in "$BUILDS_DIR"/*/build.env; do
    [ -f "$env" ] && [ -f "$(dirname "$env")/updates/ready" ] || continue
    printf '%s\t%s\n' "$(grep '^built=' "$env" | cut -d= -f2-)" "$(dirname "$env")"
  done | sort -r | cut -f2-
}

# In-app updates carry their build record; older scripted installs use the marker.
installed_record() {
  local name version commit
  local embedded="$APP_PATH/Contents/Resources/loom-build.env"
  if [ -f "$embedded" ]; then
    version=$(sed -n 's/^version=//p' "$embedded" | sed -n 1p)
    # Before independent Loom versions, upstream held the app version.
    [ -n "$version" ] || version=$(sed -n 's/^upstream=//p' "$embedded" | sed -n 1p)
    commit=$(sed -n 's/^commit=//p' "$embedded" | sed -n 1p)
    name="$version-${commit:0:10}"
    [ -d "$BUILDS_DIR/$name" ] && echo "$BUILDS_DIR/$name"
    return 0
  fi
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

# True when the app is an ancestor of this script (its terminal or an agent it
# runs). Quitting the app would then kill the script before it installs.
inside_app() {
  local pid=$$ cmd
  while [ "$pid" -gt 1 ]; do
    cmd=$(ps -o command= -p "$pid")
    case "$cmd" in "$APP_PATH/Contents/"* | "$VANILLA_APP_PATH/Contents/"*) return 0 ;; esac
    pid=$(ps -o ppid= -p "$pid" | tr -d ' ')
  done
  return 1
}

quit_app() {
  app_running || return 0
  inside_app && die "this runs inside the app it has to quit. Run it again from Terminal: scripts/fork/loom.sh $1"
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
  mkdir -p "$into/state"
  local database
  for database in "${STATE_DATABASES[@]}"; do
    rm -f "$into/state/$database"
    if [ -f "$T3_USERDATA/$database" ]; then
      sqlite3 -readonly "$T3_USERDATA/$database" "VACUUM INTO '$into/state/$database'"
    fi
  done
  local f
  for f in settings.json client-settings.json; do
    [ -f "$T3_USERDATA/$f" ] && cp "$T3_USERDATA/$f" "$into/state/"
  done
  echo "Saved the current T3 data to $into/state"
}

install_record() {
  local record=$1
  quit_app install
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
  # A repair worktree may contain newer upstream code than the main checkout.
  local tag
  tag=$(git tag -l 'v[0-9]*' --merged HEAD --sort=-v:refname | sed -n 1p)
  [ -n "$tag" ] || die "this checkout has no upstream version tag"
  verify_build "${tag#v}"
}

cmd_install() {
  local record
  record=$(records | sed -n 1p)
  [ -n "$record" ] || die "no published build to install; run land first"
  install_record "$record"
}

# The publisher's build of HEAD, when this Mac has one.
published_record() {
  local head record
  head=$(git rev-parse HEAD)
  records | while read -r record; do
    if grep -q -x "commit=$head" "$record/build.env"; then
      echo "$record"
      break
    fi
  done
}

# Fork changes on main that no integration tag covers get a tag of their own, named
# for the next Loom version, so the publisher releases them like any integration.
tag_main() {
  [ -z "$(git tag -l 'loom-v*' --points-at HEAD)" ] || return 0
  local upstream version
  upstream=$(upstream_at HEAD)
  version=$(node scripts/fork/updates.ts next-version "$upstream")
  say "Tagging main as Loom $version"
  git tag -a "loom-v$version" -m "Loom fork changes on main
loom-release=$version${upstream:+
upstream=$upstream}"
  git push -q origin "loom-v$version"
}

# Release main through the publisher the scheduled run uses, so the update feed, the
# iOS build and remote computers' runtimes all get the same Loom version as this Mac.
publish_main() {
  # The scheduled run uses its own copy of the publisher; keep it the same as main's.
  [ -f "$PUBLISHER_PLIST" ] && node scripts/fork/updates.ts enable
  say "Publishing main"
  if ! node scripts/fork/updates.ts publish --wait; then
    [ -n "$(published_record)" ] || die "publishing failed; see the output above"
    echo "The local build is ready, but publication failed. The scheduled publisher retries it."
    return 1
  fi
}

cmd_rollback() {
  local current previous commit
  current=$(installed_record)
  [ -n "$current" ] || die "the installed app has no build record, so there is nothing to roll back to"
  previous=$(records | grep -v -x -F "$current" | sed -n 1p)
  [ -n "$previous" ] || die "no earlier build is kept"
  [ -f "$previous/state/state.sqlite" ] || [ -f "$previous/state/statev2.sqlite" ] \
    || die "$(basename "$previous") has no saved data to restore"
  quit_app rollback
  snapshot_state "$current"
  say "Restoring the data $(basename "$previous") last ran with"
  local database
  for database in "${STATE_DATABASES[@]}"; do
    rm -f "$T3_USERDATA/$database" "$T3_USERDATA/$database-wal" "$T3_USERDATA/$database-shm"
    if [ -f "$previous/state/$database" ]; then
      cp "$previous/state/$database" "$T3_USERDATA/$database"
    fi
  done
  local f
  for f in settings.json client-settings.json; do
    [ -f "$previous/state/$f" ] && cp "$previous/state/$f" "$T3_USERDATA/$f"
  done
  install_record "$previous"
  echo "Rolled back to $(basename "$previous"). main still points at the newer code;"
  commit=$(sed -n 's/^commit=//p' "$previous/build.env" | sed -n 1p)
  if printf '%s\n' "$commit" | grep -qE '^[0-9a-f]{40}$|^[0-9a-f]{64}$'; then
    echo "to move it back too: git reset --hard $commit && git push --force-with-lease origin main"
  else
    echo "The previous build has no recorded source commit. Choose its source revision before changing main."
  fi
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
  verify_build "${tag#v}"
  if [ "$dry" -eq 1 ]; then
    say "Dry run passed; discarding it"
    git switch -q main
    git branch -q -D "$branch"
    pnpm install --frozen-lockfile >/dev/null
    echo "$tag merges, checks and builds cleanly. main and the installed app are unchanged."
    return 0
  fi
  say "Everything passed; updating main"
  git switch -q main
  git merge -q --ff-only "$branch"
  git tag -a "loom-$tag" -m "Loom built from upstream $tag"
  git push -q origin main "loom-$tag"
  git branch -q -d "$branch"
  publish_main
  finish_release "$install"
}

# Prune old builds, then install the published build of main unless told not to.
finish_release() {
  prune_builds
  if [ "$1" -eq 1 ]; then
    local record
    record=$(published_record)
    [ -n "$record" ] || die "this Mac has no published build of main; update from Loom's update button"
    install_record "$record"
  else
    echo "Published. Update from Loom's update button, or install it with: scripts/fork/loom.sh install"
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

Land it from Terminal on your Mac (not inside Loom, which the install quits) with \`scripts/fork/loom.sh land\`: it merges with a merge commit, tags \`loom-$tag\`, publishes the next Loom release and installs it. Never squash or rebase this pull request; the fork needs upstream's history for the next merge.${added:+

Upstream added these workflows. The loom-upstream workflow disables every non-fork workflow on its next run:
$added}"
  close_superseded "$branch"
}

# Close open integration pull requests whose upstream tag this merge already contains,
# including "needs Kyle" drafts. Their fixes are redone against newer upstream code, so
# they only pile up; any commit the new branch lacks is listed on the closed one.
close_superseded() {
  local branch=$1 new number other left
  new=$(gh pr view "$branch" --json number --jq .number)
  gh pr list --state open --json number,headRefName \
    --jq '.[] | select(.headRefName | startswith("integrate/")) | "\(.number) \(.headRefName)"' |
    while read -r number other; do
      [ "$other" = "$branch" ] && continue
      git merge-base --is-ancestor "refs/tags/${other#integrate/}" HEAD 2>/dev/null || continue
      git fetch -q origin "$other" || continue
      left=$(git log --no-merges --format='- %h %s' HEAD..FETCH_HEAD)
      gh pr close "$number" --delete-branch --comment "Superseded by #$new, which already contains upstream ${other#integrate/}.${left:+ These commits are not in #$new; reapply any that still matter:

$left}"
    done
}

# Finish an integration pull request on this Mac. With an open one, merge it
# (always a merge commit); with none, land what main already contains, which
# covers a pull request merged on GitHub and fork changes. Tags loom-<tag> for an
# integration, or the next Loom version for untagged fork changes, then publishes
# main and installs the published build unless it is already installed.
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
  git fetch -q --tags origin
  git merge -q --ff-only origin/main
  if [ -n "$number" ]; then
    local head tag
    head=$(gh pr view "$number" --json headRefName --jq .headRefName)
    tag=${head#integrate/}
    git merge-base --is-ancestor "$tag" main \
      || die "main does not contain $tag, so #$number was squashed or rebased. Revert that commit and merge the pull request with a merge commit."
    if ! git rev-parse -q --verify "refs/tags/loom-$tag" >/dev/null; then
      git tag -a "loom-$tag" -m "Loom built from upstream $tag"
      git push -q origin "loom-$tag"
    fi
  fi
  local installed
  installed=$(installed_record)
  if [ -n "$installed" ] && grep -q -x "commit=$(git rev-parse HEAD)" "$installed/build.env"; then
    echo "The installed Loom is already main. Nothing to land."
    return 0
  fi
  tag_main
  publish_main
  finish_release "$install"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    status) cmd_status ;;
    check) run_checks ;;
    integrate) shift; cmd_integrate "$@" ;;
    land) shift; cmd_land "$@" ;;
    build) cmd_build ;;
    install) cmd_install ;;
    rollback) cmd_rollback ;;
    signing-setup) cmd_signing_setup ;;
    *) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
  esac
fi
