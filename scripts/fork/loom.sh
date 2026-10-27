#!/bin/bash
# Loom fork maintenance: integrate upstream T3 Code releases, build the app,
# install it, and roll back. Fork-owned; upstream never edits this file.
#
#   scripts/fork/loom.sh status
#   scripts/fork/loom.sh upstream-status [--check]
#   scripts/fork/loom.sh upstream-overlap <path or topic>...
#   scripts/fork/loom.sh check
#   scripts/fork/loom.sh integrate [stable|nightly|<tag>] [--no-install] [--dry-run] [--continue] [--pr] [--resolve]
#   scripts/fork/loom.sh review-integration
#   scripts/fork/loom.sh close-superseded
#   scripts/fork/loom.sh merge-integration <integrate/tag branch>
#   scripts/fork/loom.sh notify <status> [<summary file>]
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
# --resolve gives each conflicted file its own Claude session instead of
# stopping, so a merge that piled up over several days never exhausts one
# session, then gives each failing check its own repair session and commit.
# --pr continues an open needs-Kyle draft instead of starting over, so its
# repairs carry into the next day's merge; close-superseded closes the older
# attempts a pushed branch contains. review-integration has a separate session
# check that resolution and repair before merge-integration merges it
# unattended. upstream-status says how far main trails upstream (--check fails
# once a nightly has waited past the grace period); upstream-overlap lists
# upstream work, merged or in open pull requests, that touches what a fork
# change is about to. notify alerts Kyle in Loom through LOOM_ALERT_WEBHOOK_URL.
#
# Only the publisher (scripts/fork/updates.ts) makes installable builds. land and
# integrate run it, so this Mac, the update feed, the iOS build and remote
# computers' runtimes all get one Loom version; build only verifies a checkout.
# check runs the fork's checks on the current checkout. Every install, including
# the app's own updates, first snapshots the T3 database into the outgoing
# build's record, so rollback restores that build and the data it last ran
# with. The app's copy lives in apps/desktop/src/fork/rollback-snapshot and
# follows the same rules. signing-setup creates a local code-signing certificate once, so
# every build is the same app to macOS and keeps its permissions and Keychain
# access across updates.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO_ROOT"

APP_PATH="/Applications/Loom.app"
BUILDS_DIR="$HOME/Library/Application Support/Loom Builds"
T3_USERDATA="$HOME/.t3/userdata"
KEEP_BUILDS=3
KEEP_STATE_SNAPSHOTS=2
# Head-room left beside a snapshot that has fully diverged from the live data.
SNAPSHOT_FREE_MARGIN_BYTES=$((2 * 1024 * 1024 * 1024))
STATE_DATABASES=(state.sqlite statev2.sqlite)
SIGNING_IDENTITY="${LOOM_SIGNING_IDENTITY:-Loom Local Code Signing}"
LOGIN_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
PUBLISHER_PLIST="$HOME/Library/LaunchAgents/com.kylebegeman.loom-updates.plist"
# Every upstream file the fork touches, with its marker and how many marked
# lines it must keep (docs/fork/seams.tsv). run_checks fails when a merge drops
# a seam, and when a marker appears that the manifest does not list.
SEAMS_MANIFEST=docs/fork/seams.tsv
# Visible "T3 Code" text that stays on purpose (identifiers, legacy detection,
# attribution): path<TAB>trimmed source line. check_brand_copy fails on any other.
BRAND_COPY_ALLOWLIST=docs/fork/brand-copy-allowlist.tsv
# Branding tests check upstream files the fork may not have touched since the last merge;
# fork_tests also runs the tests of every file the fork adds or changes.
BRAND_TESTS=(
  packages/shared/src/brand.test.ts
  apps/web/src/branding.test.ts
  apps/desktop/src/app/DesktopAppIdentity.test.ts
  scripts/build-desktop-artifact.test.ts
)
UPSTREAM_REPO=pingdotgg/t3code
UPSTREAM_RELEASES=https://github.com/$UPSTREAM_REPO/releases/tag
# A nightly may wait this long for main: one daily integration plus its run time.
# Longer means a day was missed, and upstream-status --check fails.
UPSTREAM_GRACE_HOURS=30
# Resolver sessions run this many at a time; each owns one conflicted file.
LOOM_RESOLVE_JOBS=${LOOM_RESOLVE_JOBS:-4}
# After a resolved merge, each failing check gets at most this many repair sessions.
LOOM_REPAIR_ATTEMPTS=${LOOM_REPAIR_ATTEMPTS:-3}
LOOM_CLAUDE_MODEL=${LOOM_CLAUDE_MODEL:-claude-opus-5-5}
# Read-only git for the sessions; they edit with Claude's own tools.
CLAUDE_GIT_TOOLS=('Bash(git show:*)' 'Bash(git log:*)' 'Bash(git diff:*)' 'Bash(git blame:*)')

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

# What one seams.tsv row's file lacks, or nothing when the seam survived.
seam_row_shortfall() {
  local path=$1 marker=$2 want=$3 have
  if [ "$marker" = - ]; then
    # Files that cannot carry a comment (JSON): the seam's own text is the check.
    grep -qF -- "$want" "$path" 2>/dev/null || echo "no longer contains $want"
  else
    have=$(grep -cE "$(marker_re "$marker")" "$path" 2>/dev/null) || have=0
    [ "$have" -ge "$want" ] || echo "has $have of $want 'fork: $marker' lines"
  fi
}

# The seams one file lost, one per line.
seam_shortfall() {
  local file=$1 path marker want
  [ -f "$SEAMS_MANIFEST" ] || return 0
  while IFS=$'\t' read -r path marker want; do
    [ "$path" = "$file" ] && seam_row_shortfall "$path" "$marker" "$want"
  done < "$SEAMS_MANIFEST"
  return 0
}

check_seams() {
  local missing=0 path marker want short
  while IFS=$'\t' read -r path marker want; do
    case "$path" in '' | '#'*) continue ;; esac
    short=$(seam_row_shortfall "$path" "$marker" "$want")
    [ -z "$short" ] || { echo "  $path $short"; missing=1; }
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

# Source lines naming T3 Code outside comments, tests and Connect copy (Connect
# leaves with the Loom-owned connections work), as path<TAB>trimmed line.
brand_copy_lines() {
  # apps/marketing is T3's own site; transcripts and fixtures record provider output.
  git grep -nF "T3 Code" -- ':(glob)apps/*/src/**' ':(glob)packages/*/src/**' \
    ':(exclude)apps/marketing' ':(exclude)*.test.ts' ':(exclude)*.test.tsx' \
    ':(exclude)*.ndjson' ':(exclude)*.fixture.ts' \
    | grep -vF "T3 Connect" \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|/?\*)' \
    | sed -E 's/^([^:]+):[0-9]+:[[:space:]]*/\1	/' | sort -u
}

# Upstream merges keep adding "T3 Code" copy; reword it (see FORK.md, Brand source).
check_brand_copy() {
  local unexpected
  unexpected=$(comm -23 <(brand_copy_lines) <(grep -v '^#' "$BRAND_COPY_ALLOWLIST" | sort -u))
  [ -z "$unexpected" ] || die "new T3 Code text; say Loom or drop the name, marking each line 'fork: brand' (or allowlist an identifier in $BRAND_COPY_ALLOWLIST):
$unexpected"
}

# The newest upstream release in HEAD's history, which the fork's changes are measured against.
upstream_base() {
  local base
  base=$(git tag -l 'v[0-9]*' --merged HEAD --sort=-creatordate | sed -n 1p)
  [ -n "$base" ] || die "no upstream release tag in HEAD's history; run git fetch upstream --tags"
  printf '%s\n' "$base"
}

# The branding tests, every test file the fork adds or changes, and upstream's tests beside
# the files the fork changes, which nothing else runs while the fork's CI workflow is off.
# Browser-mode tests need apps/web's headless Chromium project, which the root config used
# here lacks.
fork_tests() {
  local base source test
  base=$(upstream_base) || return 1
  {
    printf '%s\n' "${BRAND_TESTS[@]}"
    git diff --name-only --diff-filter=d "$base" -- '*.test.ts' '*.test.tsx' \
      ':(exclude)*.browser.test.ts' ':(exclude)*.browser.test.tsx'
    git diff --name-only --diff-filter=d "$base" -- '*.ts' '*.tsx' \
      ':(exclude)*.test.ts' ':(exclude)*.test.tsx' |
      while IFS= read -r source; do
        for test in "${source%.*}.test.ts" "${source%.*}.test.tsx"; do
          [ ! -f "$test" ] || printf '%s\n' "$test"
        done
      done
  } | sort -u
}

# The package a path belongs to: apps/<name> or packages/<name>, otherwise its top directory.
test_package() {
  awk -F/ '$1 == "apps" || $1 == "packages" { print $1 "/" $2; next } { print $1 }'
}

# Every workspace package with a typecheck task, as a package script or a Vite+ task in its
# vite.config.ts, so packages upstream adds are typechecked too.
typecheck_dirs() {
  local root d found=0
  root=$(pwd -P)
  while IFS= read -r d; do
    d=${d#"$root"/}
    [ "$d" != "$root" ] || continue
    if grep -qs '"typecheck":' "$d/package.json" || grep -qsE '^[[:space:]]+typecheck: \{' "$d/vite.config.ts"; then
      printf '%s\n' "$d"
      found=1
    fi
  done < <(pnpm -r ls --depth -1 --parseable)
  [ "$found" -eq 1 ]
}

# Lint only fork-owned source. Skip unmatched globs so future fork directories
# are included automatically without linting upstream source.
fork_lint_paths() {
  local path
  for path in apps/*/src/fork packages/*/src/fork apps/web/src/routes/_chat.settings.loom*.tsx \
    scripts/fork deploy/omarchy benchmarks/loom apps/server/scripts/benchmark-library.ts; do
    if [ -e "$path" ]; then printf '%s\n' "$path"; fi
  done
}

check_fork_lint() {
  local path paths=()
  while IFS= read -r path; do paths+=("$path"); done < <(fork_lint_paths)
  # An empty path list would make vp lint the whole repository.
  [ "${#paths[@]}" -gt 0 ] || return 0
  pnpm exec vp lint --report-unused-disable-directives --deny-warnings "${paths[@]}" ||
    die "fork lint failed; fix the findings above (rules in oxlint-plugin-t3code/rules/)"
}

# The Omarchy pack's own Node tests and its generated packet views.
check_omarchy_pack() {
  node deploy/omarchy/check.mjs
}

run_fork_tests() {
  local package=$1 tests=() t
  while IFS= read -r t; do tests+=("$t"); done < <(fork_tests | awk -v p="$package/" 'index($0, p) == 1')
  # With no test paths vitest would run every test in the repository.
  [ "${#tests[@]}" -gt 0 ] || die "found no fork tests in $package"
  # Test paths are substring filters, so exclude agent worktrees nested in the
  # checkout. Shells inside Loom inherit ELECTRON_RUN_AS_NODE, which the
  # desktop artifact tests assert is absent.
  env -u ELECTRON_RUN_AS_NODE pnpm exec vp test run --exclude '**/.claude/**' "${tests[@]}"
}

in_dir() {
  cd "$1" && shift && "$@"
}

# Runs one check under its "==> <name>" header and records a failure instead of stopping,
# so one pass reaches every check. Call it as a plain command: inside if, || or && bash
# ignores errexit, and a check would run on past its own failures.
run_check() {
  local name=$1 code
  shift
  say "$name"
  set +e
  (set -e; "$@")
  code=$?
  set -e
  [ "$code" -eq 0 ] || FAILED_CHECKS+="$name"$'\n'
}

# Ends a pass: one "loom: check failed: <name>" line per failure, and fails if there was any.
report_failed_checks() {
  [ -n "$FAILED_CHECKS" ] || return 0
  printf '%s' "$FAILED_CHECKS" | sed 's/^/loom: check failed: /' >&2
  return 1
}

# Every check runs even after another fails, so one repair round sees them all; only a failed
# install stops the rest, which would fail for that reason alone. Cheapest first, tests last.
run_checks() {
  FAILED_CHECKS=""
  run_check "Checking that every fork seam survived" check_seams
  run_check "Checking for new T3 Code product text" check_brand_copy
  local before=$FAILED_CHECKS dirs d packages package
  run_check "Installing dependencies" pnpm install --frozen-lockfile
  if [ "$FAILED_CHECKS" = "$before" ]; then
    run_check "Linting fork code" check_fork_lint
    run_check "Running the Omarchy pack's checks" check_omarchy_pack
    run_check "Regenerating web routes and building the web client" in_dir apps/web pnpm exec vp build
    # One check per package, since vp stops typechecking every package after the first failure.
    # An empty list would skip the checks unseen, so failing to list them is a failure too.
    if dirs=$(typecheck_dirs); then
      for d in $dirs; do
        run_check "Typechecking $d" in_dir "$d" pnpm exec vp run typecheck
      done
    else
      FAILED_CHECKS+="Listing the packages to typecheck"$'\n'
    fi
    run_check "Typechecking Loom benchmarks" pnpm exec tsc --noEmit -p benchmarks/loom/tsconfig.json
    if packages=$(fork_tests | test_package | sort -u) && [ -n "$packages" ]; then
      for package in $packages; do
        run_check "Running the fork's tests in $package" run_fork_tests "$package"
      done
    else
      FAILED_CHECKS+="Listing the fork's tests"$'\n'
    fi
  fi
  restore_lockfile
  report_failed_checks
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

# Keep the newest builds, the installed one, and any holding saved data, which
# prune_snapshots bounds, so a run of unopened updates cannot drop the rollback.
prune_builds() {
  local installed old
  installed=$(installed_record)
  records | tail -n +$((KEEP_BUILDS + 1)) | while read -r old; do
    [ "$old" = "$installed" ] || [ -d "$old/state" ] || rm -rf "$old"
  done
}

# Loom and upstream's T3 Code share an app id and a data folder, so both are
# found and quit by their exact paths: a bundle id is ambiguous between them,
# and two running at once would put two servers on one database.
VANILLA_APP_PATH="/Applications/T3 Code (Alpha).app"
# Node-mode helpers reuse Electron's executable after the desktop app exits.
# LaunchServices tracks the actual apps, so helpers cannot block installation.
app_running() {
  local state
  state=$(osascript -l JavaScript "$REPO_ROOT/scripts/fork/running-apps.js" "$APP_PATH" "$VANILLA_APP_PATH") \
    || die "could not determine whether the desktop app is running"
  case "$state" in
    running) return 0 ;;
    stopped) return 1 ;;
    *) die "unexpected desktop app state: $state" ;;
  esac
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

free_bytes() { echo $(($(df -Pk "$1" | awk 'NR == 2 { print $4 }') * 1024)); }

# BSD tools on macOS, GNU coreutils on Linux CI and in Homebrew's gnubin.
if stat --version >/dev/null 2>&1; then
  file_size() { stat -c %s "$1"; }
  file_mtime() { stat -c %.9Y "$1"; }
else
  file_size() { stat -f %z "$1"; }
  file_mtime() { stat -f %Fm "$1"; }
fi
if cp --version >/dev/null 2>&1; then
  clone_file() { cp --reflink=auto "$1" "$2"; }
else
  clone_file() { cp -c "$1" "$2"; }
fi

# Each database with its WAL, which holds committed data a closed app may not
# have checkpointed. SQLite rebuilds the -shm index on open.
state_database_files() {
  local database
  for database in "${STATE_DATABASES[@]}"; do
    printf '%s\n' "$database" "$database-wal"
  done
}

state_fingerprint() {
  local f
  for f in $(state_database_files); do
    [ ! -f "$T3_USERDATA/$f" ] || printf '%s %s %s\n' "$f" "$(file_size "$T3_USERDATA/$f")" "$(file_mtime "$T3_USERDATA/$f")"
  done
}

# Snapshot the T3 database and settings into the record of the build that is
# installed now, so rolling back to it restores the data it last ran with.
# The copies are clones where the filesystem supports them, free until the live
# data diverges, so the disk must have room for a full copy before one is taken.
snapshot_state() {
  local into=$1 f size=0 before stage
  for f in $(state_database_files); do
    [ ! -f "$T3_USERDATA/$f" ] || size=$((size + $(file_size "$T3_USERDATA/$f")))
  done
  if [ "$(free_bytes "$T3_USERDATA")" -lt $((size + SNAPSHOT_FREE_MARGIN_BYTES)) ]; then
    echo "Not enough free disk space to keep a copy of the T3 data in $into/state" >&2
    return 1
  fi
  mkdir -p "$into"
  stage=$(mktemp -d "$into/.state.XXXXXX") || return 1
  before=$(state_fingerprint)
  for f in $(state_database_files) settings.json client-settings.json; do
    [ ! -f "$T3_USERDATA/$f" ] || clone_file "$T3_USERDATA/$f" "$stage/$f" || { rm -rf "$stage"; return 1; }
  done
  if [ "$(state_fingerprint)" != "$before" ]; then
    rm -rf "$stage"
    echo "The T3 database changed while it was being saved; something besides Loom has it open" >&2
    return 1
  fi
  rm -rf "$into/state.old"
  if [ -d "$into/state" ]; then
    mv "$into/state" "$into/state.old" || { rm -rf "$stage"; return 1; }
  fi
  if ! mv "$stage" "$into/state"; then
    rm -rf "$stage"
    [ ! -d "$into/state.old" ] || mv "$into/state.old" "$into/state"
    return 1
  fi
  rm -rf "$into/state.old"
  echo "Saved the current T3 data to $into/state"
}

# Keep the newest snapshots: the data the previous build last ran with, and the
# outgoing data a rollback replaced. Run once userdata no longer needs the others.
prune_snapshots() {
  local record
  records | while read -r record; do
    [ ! -d "$record/state" ] || printf '%s\t%s\n' "$(file_mtime "$record/state")" "$record"
  done | sort -rn | tail -n +$((KEEP_STATE_SNAPSHOTS + 1)) | cut -f2- | while read -r record; do
    rm -rf "$record/state"
  done
}

# The build this Mac ran before the installed one: every install saves the data
# of the build it replaces, so it is the earlier build whose data was saved last.
# A newer build the publisher made but this Mac never ran is not a rollback.
rollback_target() {
  local current=$1 built record
  built=$(sed -n 's/^built=//p' "$current/build.env" | sed -n 1p)
  records | while read -r record; do
    [ -d "$record/state" ] && [ "$record" != "$current" ] || continue
    [[ "$(sed -n 's/^built=//p' "$record/build.env" | sed -n 1p)" < "$built" ]] || continue
    printf '%s\t%s\n' "$(file_mtime "$record/state")" "$record"
  done | sort -rn | sed -n 1p | cut -f2-
}

verify_install_signing() {
  local app="$1/Loom.app" details authority installed requirement
  codesign --verify --deep --strict "$app" \
    || die "the selected app has an invalid signature; the installed app was not changed"
  details=$(codesign -dvv "$app" 2>&1) \
    || die "could not inspect the selected app's signature"
  authority=$(printf '%s\n' "$details" | sed -n 's/^Authority=//p' | sed -n 1p)
  [ "$authority" = "$SIGNING_IDENTITY" ] \
    || die "the selected app is not signed by $SIGNING_IDENTITY; refusing to break updates"
  if [ -d "$APP_PATH" ]; then
    installed=$(codesign -dvv -r- "$APP_PATH" 2>&1) \
      || die "could not inspect the installed app's signature"
    if ! printf '%s\n' "$installed" | grep -q -x 'Signature=adhoc'; then
      requirement=$(printf '%s\n' "$installed" | sed -n 's/^\(# \)\{0,1\}designated => //p')
      [ -n "$requirement" ] || die "the installed app has no readable signing requirement"
      codesign --verify --deep --strict -R "=$requirement" "$app" \
        || die "the selected app changes the installed signing identity; refusing to break updates"
    fi
  fi
}

prepare_install() (
  local record=$1
  verify_install_signing "$record"
  loom_install_stage=$(mktemp -d "$(dirname "$APP_PATH")/.loom-install.XXXXXX") \
    || die "could not stage the update beside the installed app"
  trap 'rm -rf "$loom_install_stage"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  ditto "$record/Loom.app" "$loom_install_stage/Loom.app" \
    || die "could not copy the update; the installed app was not changed"
  verify_install_signing "$loom_install_stage"
  trap - EXIT
  printf '%s\n' "$loom_install_stage"
)

install_record() (
  local record=$1 current
  loom_install_mode=${3:-install}
  loom_install_stage=${2:-}
  [ -n "$loom_install_stage" ] || loom_install_stage=$(prepare_install "$record")
  cleanup_install() {
    if [ -d "$loom_install_stage/previous.app" ] && [ ! -e "$APP_PATH" ]; then
      mv "$loom_install_stage/previous.app" "$APP_PATH" \
        || { echo "The previous app is retained at $loom_install_stage/previous.app" >&2; return; }
    fi
    # Rollback's outer cleanup also restores userdata when replacement did not finish.
    # Keep the candidate's presence available as the rename's completion evidence.
    [ "$loom_install_mode" != rollback ] || return 0
    [ -d "$loom_install_stage/previous.app" ] || rm -rf "$loom_install_stage"
  }
  trap cleanup_install EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [ "$loom_install_mode" != rollback ]; then
    quit_app install
    current=$(installed_record)
    snapshot_state "${current:-$BUILDS_DIR/before-loom}" \
      || echo "Warning: the T3 data was not saved, so rollback cannot return to the data the outgoing build ran with." >&2
  fi
  if [ -d "$VANILLA_APP_PATH" ]; then
    echo "Warning: $VANILLA_APP_PATH is still installed. It shares Loom's app id and data;"
    echo "never run both. Remove it with: brew uninstall --cask t3-code"
  fi
  say "Installing $(basename "$record")"
  if [ -e "$APP_PATH" ]; then
    mv "$APP_PATH" "$loom_install_stage/previous.app" || die "could not retain the installed app"
  fi
  mv "$loom_install_stage/Loom.app" "$APP_PATH" || die "could not replace the app; restoring the previous app"
  basename "$record" > "$BUILDS_DIR/installed"
  prune_snapshots
  [ "$loom_install_mode" = rollback ] || rm -rf "$loom_install_stage/previous.app"
  xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
  open "$APP_PATH"
  echo "Installed Loom $(installed_version)"
)

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
  # next-version reads published tags and the publisher's reservations; a build still running
  # has only a reservation, so a checkout without it would repeat that version. --no-prune keeps
  # local upstream tags that origin does not mirror when fetch.prune is set.
  git fetch -q --no-prune origin 'refs/tags/*:refs/tags/*' \
    'refs/loom/publications/*:refs/loom/publications/*'
  version=$(node scripts/fork/updates.ts next-version "$upstream")
  if upstream_status HEAD | grep -qx 'state=stale'; then
    echo "Warning: main has waited over ${UPSTREAM_GRACE_HOURS}h for an upstream nightly. Fix the daily integration (FORK.md, Updating from upstream) before building more fork work on it." >&2
  fi
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

cmd_rollback() (
  local current previous commit database f
  loom_rollback_state_stage=
  loom_rollback_changed=0
  loom_rollback_state_files=(settings.json client-settings.json)
  for database in "${STATE_DATABASES[@]}"; do
    loom_rollback_state_files+=("$database" "$database-wal" "$database-shm")
  done
  current=$(installed_record)
  [ -n "$current" ] || die "the installed app has no build record, so there is nothing to roll back to"
  previous=$(rollback_target "$current")
  [ -n "$previous" ] \
    || die "no earlier build has saved data to restore. Each update or install saves the data of the build it replaces"
  [ -f "$previous/state/state.sqlite" ] || [ -f "$previous/state/statev2.sqlite" ] \
    || die "$(basename "$previous") has no saved data to restore"
  loom_rollback_stage=$(prepare_install "$previous")
  cleanup_rollback() {
    local result=$? installed=0 failed=0 f
    trap - EXIT
    if [ -d "$loom_rollback_stage/previous.app" ] && [ ! -e "$APP_PATH" ]; then
      mv "$loom_rollback_stage/previous.app" "$APP_PATH" \
        || echo "The outgoing app is retained at $loom_rollback_stage/previous.app" >&2
    fi
    # The staged app only disappears after its same-filesystem rename succeeds. Keep the
    # restored data once that happens, even if recording the install or opening it fails.
    if [ ! -d "$loom_rollback_stage/Loom.app" ] && [ -d "$APP_PATH" ]; then installed=1; fi
    if [ "$loom_rollback_changed" -eq 1 ] && [ "$installed" -eq 0 ]; then
      for f in "${loom_rollback_state_files[@]}"; do
        if [ -e "$loom_rollback_state_stage/outgoing/$f" ] || [ -L "$loom_rollback_state_stage/outgoing/$f" ]; then
          mv -f "$loom_rollback_state_stage/outgoing/$f" "$T3_USERDATA/$f" || failed=1
        elif [ -f "$loom_rollback_state_stage/absent/$f" ]; then
          rm -f "$T3_USERDATA/$f" || failed=1
        fi
      done
    fi
    if [ "$failed" -eq 1 ]; then
      echo "Could not restore all outgoing data. Keep the app closed; recovery files remain at $loom_rollback_state_stage/outgoing" >&2
      result=1
    elif [ -n "$loom_rollback_state_stage" ]; then
      rm -rf "$loom_rollback_state_stage"
    fi
    if [ "$installed" -eq 1 ] || [ ! -d "$loom_rollback_stage/previous.app" ]; then
      rm -rf "$loom_rollback_stage"
    fi
    exit "$result"
  }
  trap cleanup_rollback EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  quit_app rollback
  snapshot_state "$current" || die "the outgoing data could not be saved, so nothing was rolled back"
  loom_rollback_state_stage=$(mktemp -d "$T3_USERDATA/.loom-rollback.XXXXXX")
  mkdir "$loom_rollback_state_stage/outgoing" "$loom_rollback_state_stage/restored" "$loom_rollback_state_stage/absent"
  # Prepare every incoming file before changing userdata. Original files, including WALs
  # and absent settings, remain recoverable independently of the durable build snapshot.
  for f in $(state_database_files) settings.json client-settings.json; do
    [ ! -f "$previous/state/$f" ] || clone_file "$previous/state/$f" "$loom_rollback_state_stage/restored/$f"
  done
  for f in "${loom_rollback_state_files[@]}"; do
    if [ ! -e "$T3_USERDATA/$f" ] && [ ! -L "$T3_USERDATA/$f" ]; then
      touch "$loom_rollback_state_stage/absent/$f"
    fi
  done
  say "Restoring the data $(basename "$previous") last ran with"
  loom_rollback_changed=1
  for f in "${loom_rollback_state_files[@]}"; do
    if [ -e "$T3_USERDATA/$f" ] || [ -L "$T3_USERDATA/$f" ]; then
      mv "$T3_USERDATA/$f" "$loom_rollback_state_stage/outgoing/$f"
    fi
    if [ -f "$loom_rollback_state_stage/restored/$f" ]; then
      mv "$loom_rollback_state_stage/restored/$f" "$T3_USERDATA/$f"
    fi
  done
  # The outgoing data was saved before restoration. Saving it again would overwrite
  # that recovery snapshot with the previous build's restored data.
  install_record "$previous" "$loom_rollback_stage" rollback
  echo "Rolled back to $(basename "$previous"). main still points at the newer code;"
  commit=$(sed -n 's/^commit=//p' "$previous/build.env" | sed -n 1p)
  if printf '%s\n' "$commit" | grep -qE '^[0-9a-f]{40}$|^[0-9a-f]{64}$'; then
    echo "to move it back too: git reset --hard $commit && git push --force-with-lease origin main"
  else
    echo "The previous build has no recorded source commit. Choose its source revision before changing main."
  fi
)

cmd_integrate() {
  local target=stable install=1 cont=0 dry=0 pr=0 resolve=0 arg
  for arg in "$@"; do
    case "$arg" in
      --no-install) install=0 ;;
      --continue) cont=1 ;;
      --dry-run) dry=1 ;;
      --pr) pr=1 ;;
      --resolve) resolve=1 ;;
      *) target=$arg ;;
    esac
  done
  local tag branch start resume=""
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
    require_clean
    # A pull request only needs origin/main checked out, so any worktree can open one;
    # integrating here fast-forwards main itself.
    if [ "$pr" -eq 1 ]; then
      [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
        || die "check out origin/main first: git switch --detach origin/main"
    else
      [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "run integrate from main"
      [ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] || die "main differs from origin/main; sync them first"
    fi
    if git merge-base --is-ancestor "$tag" HEAD; then
      echo "main already includes $tag. Nothing to integrate."
      return 0
    fi
    start=$(git symbolic-ref -q --short HEAD || git rev-parse HEAD)
    branch="integrate/$tag"
    if [ "$pr" -eq 1 ] && [ "$dry" -eq 0 ]; then
      resume=$(open_integration "$tag") || die "could not list the open integration pull requests"
      # A rerun at the same tag continues its own draft; only another attempt is replaced.
      if [ "$resume" != "$branch" ] && git ls-remote --exit-code -q --heads origin "$branch" >/dev/null; then
        replace_failed_integration "$branch" || return 0
      fi
    fi
    if [ -n "$resume" ]; then
      say "Continuing the open integration $resume"
      git switch -q -c "$branch" "origin/$resume"
      if ! git merge --no-edit -m "chore(fork): merge main into $branch" origin/main; then
        git merge --abort 2>/dev/null || true
        say "main conflicts with $resume; starting over from main"
        git checkout -q "$start"
        git branch -q -D "$branch"
        if [ "$resume" = "$branch" ]; then
          replace_failed_integration "$branch" || return 0
        fi
        resume=""
      fi
    fi
    if [ -z "$resume" ]; then
      git switch -q -c "$branch"
    fi
    if ! git merge-base --is-ancestor "$tag" HEAD; then
      say "Merging upstream $tag"
      if ! git merge --no-ff --no-edit -m "chore(fork): integrate upstream $tag" "$tag"; then
        if [ "$resolve" -eq 1 ] && resolve_conflicts "$tag"; then
          git commit -q --no-edit
        else
          echo
          echo "The merge stopped on conflicts in:"
          git diff --name-only --diff-filter=U | sed 's/^/  /'
          echo
          echo "They are almost always fork seams (docs/fork/seams.tsv; see FORK.md)."
          echo "Resolve them, then: git add -A && git commit --no-edit && scripts/fork/loom.sh integrate --continue"
          echo "To give up: git merge --abort && git switch $start && git branch -D $branch"
          exit 2
        fi
      fi
    fi
  fi
  if [ "$resolve" -eq 1 ]; then
    checks_with_repair "$tag"
  else
    run_checks
  fi
  if [ "$pr" -eq 1 ]; then
    if [ "$dry" -eq 1 ]; then
      say "Dry run passed; discarding it"
      git checkout -q "${start:-origin/main}"
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

# An integrate/<tag> branch already on origin. A pull request that passed is waiting to
# merge, so leave it (returns 1). A draft or an abandoned branch is a failed attempt: close
# it so this run retries the tag, instead of the tag staying unintegrated for good.
replace_failed_integration() {
  local branch=$1 open
  open=$(gh pr list --head "$branch" --state open --json number,isDraft \
    --jq '.[] | "\(.number) \(.isDraft)"' | sed -n 1p)
  case "$open" in
    *" false")
      echo "$branch has an open pull request (#${open% *}) that passed its checks; it waits to merge."
      return 1
      ;;
    *" true")
      gh pr close "${open% *}" --delete-branch --comment "Retrying this upstream tag from a fresh merge."
      ;;
    *) git push -q origin --delete "$branch" ;;
  esac
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

# Push a checked integrate/<tag> branch and open its pull request into main, or finish the
# needs-Kyle draft this run continued at the same tag.
open_pr() {
  local tag=$1 branch=$2 added body draft
  added=$(git diff --name-only --diff-filter=A origin/main...HEAD -- .github/workflows | sed 's/^/- `/; s/$/`/')
  say "Pushing $branch and opening its pull request"
  git push -q -u origin "$branch"
  body="Merges upstream T3 Code [$tag]($UPSTREAM_RELEASES/$tag) into Loom. The seams in \`docs/fork/seams.tsv\` survived, every test file the fork adds or changes passes, and every package typechecks.

Land it from Terminal on your Mac (not inside Loom, which the install quits) with \`scripts/fork/loom.sh land\`: it merges with a merge commit, tags \`loom-$tag\`, publishes the next Loom release and installs it. Never squash or rebase this pull request; the fork needs upstream's history for the next merge.${added:+

Upstream added these workflows. The loom-upstream workflow disables every non-fork workflow on its next run:
$added}"
  draft=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty')
  if [ -n "$draft" ]; then
    gh pr edit "$draft" --title "chore(fork): integrate upstream $tag" --body "$body"
    gh pr ready "$draft"
  else
    gh pr create --base main --head "$branch" --title "chore(fork): integrate upstream $tag" --body "$body"
  fi
  close_superseded "$branch"
}

# Close open integration pull requests whose upstream tag this merge already contains,
# including "needs Kyle" drafts: a branch that continued one carries its commits, and any
# commit the new branch lacks is listed on the closed one.
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

# The pushed integrate/<tag> branch on HEAD closes the older attempts it contains, as
# open_pr does, so a needs-Kyle draft supersedes them too.
cmd_close_superseded() {
  local branch
  branch=$(git rev-parse --abbrev-ref HEAD)
  [[ "$branch" == integrate/* ]] || die "close-superseded runs on an integrate/<tag> branch"
  close_superseded "$branch"
}

# The needs-Kyle draft an integration continues instead of starting over, as its branch: the
# open draft holding the newest upstream tag that origin/main lacks and the target contains.
# Its resolution and repairs survive; the run merges main and the newer tag into it.
open_integration() {
  local tag=$1 branch held
  gh pr list --state open --json headRefName,isDraft \
    --jq '.[] | select(.isDraft and (.headRefName | startswith("integrate/"))) | .headRefName' |
    while IFS= read -r branch; do
      git rev-parse -q --verify "refs/remotes/origin/$branch" >/dev/null || continue
      held=$(git tag -l 'v[0-9]*' --merged "origin/$branch" --sort=-creatordate | sed -n 1p)
      [ -n "$held" ] || continue
      git merge-base --is-ancestor "$held" origin/main && continue
      git merge-base --is-ancestor "$held" "$tag" || continue
      printf '%s %s\n' "$(git log -1 --format=%ct "$held")" "$branch"
    done | sort -rn | sed -n 1p | cut -d' ' -f2
}

# --- Upstream sync -------------------------------------------------------------
# The daily workflow merges unattended; these keep that merge small, reviewed and
# visible, and keep fork work from starting on a main that trails upstream.

now_epoch() { echo "${LOOM_NOW:-$(date +%s)}"; }

# How far a ref trails upstream's nightlies, as key=value lines. state is in-sync when it
# has the newest nightly, behind while every missing nightly is younger than
# UPSTREAM_GRACE_HOURS, and stale once one has waited longer.
upstream_status() {
  local ref=${1:-origin/main} newest tag oldest="" waited=0 state=in-sync
  newest=$(latest_nightly)
  [ -n "$newest" ] || die "no upstream nightly tags; run git fetch upstream --tags"
  while IFS= read -r tag; do
    git merge-base --is-ancestor "$tag" "$ref" && break
    oldest=$tag
  done < <(git tag -l 'v*-nightly.*' --sort=-creatordate)
  if [ -n "$oldest" ]; then
    waited=$((($(now_epoch) - $(git log -1 --format=%ct "$oldest")) / 3600))
    state=behind
    [ "$waited" -lt "$UPSTREAM_GRACE_HOURS" ] || state=stale
  fi
  printf 'state=%s\nnewest=%s\nmain=%s\noldest_missing=%s\nwaited_hours=%s\nbehind_commits=%s\n' \
    "$state" "$newest" "$(upstream_at "$ref")" "$oldest" "$waited" "$(git rev-list --count "$ref..$newest")"
}

cmd_upstream_status() {
  git fetch -q upstream --tags
  git fetch -q origin
  local status
  status=$(upstream_status origin/main)
  printf '%s\n' "$status"
  if [ "${1:-}" = --check ] && printf '%s\n' "$status" | grep -qx 'state=stale'; then
    die "main has waited over ${UPSTREAM_GRACE_HOURS}h for an upstream nightly; the daily integration is failing or not running"
  fi
}

# Open upstream pull requests, with the files each one changes, as number<TAB>title<TAB>file lines.
upstream_open_prs() {
  gh pr list -R "$UPSTREAM_REPO" --state open --limit 300 --json number,title,files \
    --jq '.[] | . as $pr | (.files // [])[] | "\($pr.number)\t\($pr.title)\t\(.path)"'
}

# Upstream work a fork change would conflict with or duplicate. A path lists upstream's
# commits that main lacks and its open pull requests that touch it; any other argument
# is a topic, matched against those commit messages and pull request titles.
cmd_upstream_overlap() {
  [ "$#" -gt 0 ] || die "name the paths or topics the change will touch"
  git fetch -q upstream --tags
  git fetch -q origin
  local prs arg found=0 lines
  prs=$(upstream_open_prs) || prs=""
  for arg in "$@"; do
    if [ -e "$arg" ] || git cat-file -e "upstream/main:$arg" 2>/dev/null; then
      lines=$(git log --no-merges --date=short --format='  commit %h %ad %s' origin/main..upstream/main -- "$arg")
      lines+=$(printf '%s\n' "$prs" | awk -F'\t' -v p="$arg" 'index($3, p) == 1 && !seen[$1]++ { printf "\n  open #%s %s", $1, $2 }')
    else
      lines=$(git log --no-merges --date=short -i -F --grep="$arg" --format='  commit %h %ad %s' origin/main..upstream/main)
      lines+=$(printf '%s\n' "$prs" | awk -F'\t' -v t="$arg" 'index(tolower($2), tolower(t)) && !seen[$1]++ { printf "\n  open #%s %s", $1, $2 }')
    fi
    lines=$(printf '%s\n' "$lines" | sed '/^$/d')
    [ -n "$lines" ] || continue
    found=1
    printf '%s\n%s\n' "$arg" "$lines"
  done
  [ "$found" -eq 1 ] || echo "No upstream work main lacks touches these. Open pull requests: https://github.com/$UPSTREAM_REPO/pulls"
}

# Runs Claude headless on the prompt from stdin: run_agent <max turns> <permission mode> <tools...>.
# LOOM_AGENT replaces it with any executable that reads the prompt from stdin.
run_agent() {
  local turns=$1 mode=$2
  shift 2
  if [ -n "${LOOM_AGENT:-}" ]; then
    "$LOOM_AGENT"
    return
  fi
  claude -p --model "$LOOM_CLAUDE_MODEL" --effort high --max-turns "$turns" --no-session-persistence \
    --permission-mode "$mode" --allowedTools "$@"
}

# The last non-empty line of a session's reply, without Markdown emphasis.
final_line() { sed '/^[[:space:]]*$/d' "$1" | tail -n 1 | tr -d '*`' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }

has_conflict_markers() { grep -qE '^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( |$)|^=======$' -- "$1" 2>/dev/null; }

resolve_logs() { echo "${LOOM_RESOLVE_LOGS:-$(git rev-parse --absolute-git-dir)/loom-resolve}"; }
resolve_log() { echo "$(resolve_logs)/$(printf '%s' "$1" | tr '/' '_').log"; }
# Files that differ from the index, new files included.
changed_files() { { git diff --name-only; git ls-files --others --exclude-standard; } | sort -u; }

resolve_prompt() {
  local file=$1 tag=$2
  sed -e "s|{{file}}|$file|g" -e "s|{{tag}}|$tag|g" "$REPO_ROOT/scripts/fork/upstream-resolve.md"
  printf '\n## This file\n\nIts rows in docs/fork/seams.tsv (path, marker, marked lines kept):\n\n'
  awk -F'\t' -v f="$file" '$1 == f { print "    " $0; n++ } END { if (!n) print "    none" }' "$SEAMS_MANIFEST" 2>/dev/null ||
    echo "    none"
  printf '\nUpstream commits in this merge that change it:\n\n'
  git log --no-merges --format='    %h %s' HEAD..MERGE_HEAD -- "$file" | head -n 40
  printf '\nLoom commits since the last integration that change it:\n\n'
  git log --no-merges --format='    %h %s' MERGE_HEAD..HEAD -- "$file" | head -n 40
}

# One session for one conflicted file. Its reply ends RESOLVED or UNRESOLVED: <why>. A
# resolution that dropped a seam gets one more session, told which marked lines it lost.
resolve_file() {
  local file=$1 tag=$2 log lost
  log=$(resolve_log "$file")
  export LOOM_RESOLVE_FILE=$file
  resolve_prompt "$file" "$tag" | run_agent 80 acceptEdits Read Edit Write Glob Grep "${CLAUDE_GIT_TOOLS[@]}" \
    >"$log" 2>&1 || echo "The session exited with status $?." >>"$log"
  if [ "$(final_line "$log")" = RESOLVED ] && [ -e "$file" ] && ! has_conflict_markers "$file"; then
    lost=$(seam_shortfall "$file" | awk 'NR > 1 { printf "; " } { printf "%s", $0 }')
    if [ -n "$lost" ]; then
      {
        resolve_prompt "$file" "$tag"
        cat <<EOF

## Seams lost

A first session resolved this file, but it now $lost (docs/fork/seams.tsv). Loom's marked
lines are in \`git show :2:$file\`. Carry each lost one onto the resolved file in the working
tree and keep its marker. If upstream now does what a lost seam did, leave it out and say so.
Reply as above.
EOF
      } | run_agent 80 acceptEdits Read Edit Write Glob Grep "${CLAUDE_GIT_TOOLS[@]}" \
        >>"$log" 2>&1 || echo "The session exited with status $?." >>"$log"
    fi
  fi
  echo "  $(final_line "$log" | cut -c1-200): $file"
}

# Resolve a stopped merge one conflicted file per session, LOOM_RESOLVE_JOBS at a time, so
# a large merge never exhausts one session and each sees both sides of its own file.
# Stages what resolved; returns 1, leaving the rest conflicted, if any file did not.
resolve_conflicts() {
  local tag=$1 conflicted before logs file unresolved="" edited summary
  conflicted=$(git diff --name-only --diff-filter=U)
  logs=$(resolve_logs)
  mkdir -p "$logs" && rm -f "$logs"/*.log "$logs/summary.md"
  before=$(changed_files)
  say "Resolving $(printf '%s\n' "$conflicted" | grep -c .) conflicted files, $LOOM_RESOLVE_JOBS at a time (logs in $logs)"
  if printf '%s\n' "$conflicted" | grep -qvx pnpm-lock.yaml; then
    # Each worker sources this script (with its own $0, so the command dispatch stays off);
    # xargs appends its file after the fixed arguments.
    printf '%s\n' "$conflicted" | grep -vx pnpm-lock.yaml | tr '\n' '\0' |
      xargs -0 -n 1 -P "$LOOM_RESOLVE_JOBS" bash -c 'source "$1" >/dev/null && cd "$2" && resolve_file "$4" "$3"' \
        loom-resolve "$REPO_ROOT/scripts/fork/loom.sh" "$PWD" "$tag"
  fi
  while IFS= read -r file; do
    [ -n "$file" ] && [ "$file" != pnpm-lock.yaml ] || continue
    if has_conflict_markers "$file" || [ "$(final_line "$(resolve_log "$file")")" != RESOLVED ]; then
      unresolved+="$file"$'\n'
    elif [ -e "$file" ]; then
      git add -- "$file"
    else
      git rm -q --cached --ignore-unmatch -- "$file"
    fi
  done <<<"$conflicted"
  edited=$(comm -13 <(printf '%s\n' "$before") <(changed_files))
  [ -z "$edited" ] || printf '%s\n' "$edited" | while IFS= read -r file; do git add -A -- "$file"; done
  if printf '%s\n' "$conflicted" | grep -qx pnpm-lock.yaml; then
    say "Regenerating pnpm-lock.yaml from upstream's, with the fork's dependencies"
    if git checkout -q --theirs -- pnpm-lock.yaml && pnpm install --lockfile-only --ignore-scripts >"$logs/pnpm-lock.yaml.log" 2>&1; then
      git add pnpm-lock.yaml
    else
      unresolved+=$'pnpm-lock.yaml\n'
    fi
  fi
  summary="$logs/summary.md"
  {
    echo "Merging upstream $tag conflicted in $(printf '%s\n' "$conflicted" | grep -c .) files; one Claude session took each."
    if [ -n "$edited" ]; then
      printf '\nSessions also edited these files to carry a seam to its new home:\n\n'
      printf '%s\n' "$edited" | sed 's/^/- `/; s/$/`/'
    fi
    if [ -n "$unresolved" ]; then
      printf '\nUnresolved:\n\n'
      printf '%s' "$unresolved" | while IFS= read -r file; do
        echo "- \`$file\`: $(final_line "$(resolve_log "$file")" 2>/dev/null | cut -c1-300)"
      done
    fi
  } >"$summary"
  [ -z "$unresolved" ] || { cat "$summary"; return 1; }
}

# Whether a newline-terminated list holds a line.
listed() {
  case $'\n'"$1" in *$'\n'"$2"$'\n'*) return 0 ;; esac
  return 1
}

# LOOM_REPAIR_DEADLINE (epoch seconds) keeps the last session and pass inside the runner's limit.
repair_time_left() { [ -z "${LOOM_REPAIR_DEADLINE:-}" ] || [ "$(now_epoch)" -lt "$LOOM_REPAIR_DEADLINE" ]; }

# After a merge, every check that fails gets its own fresh repair session (prompt in
# scripts/fork/upstream-repair.md) whose changes become one commit, then the checks run again.
# A round repairs every failure of one pass, so a merge that breaks several checks neither
# waits a round per check nor exhausts one session. A check gets LOOM_REPAIR_ATTEMPTS
# sessions, none after one gives up, and none starts past LOOM_REPAIR_DEADLINE. Dies, keeping
# every commit for the needs-Kyle draft, when a round changes nothing or no failing check may
# have another session; repair.md beside the resolve logs records every session. Call it
# outside if and ||: run_checks relies on errexit, which bash ignores there even when set again.
checks_with_repair() {
  local tag=$1 logs report round=0 code log failed check checks session reply attempts
  local tried="" gave_up="" skipped ran changed
  logs=$(resolve_logs)
  report="$logs/repair.md"
  mkdir -p "$logs" && rm -f "$logs"/checks-*.log "$logs"/repair-*.log "$report"
  while :; do
    log="$logs/checks-$round.log"
    set +e
    (set -e; run_checks) 2>&1 | tee "$log"
    code=${PIPESTATUS[0]}
    set -e
    [ "$code" -ne 0 ] || return 0
    # A pass that broke outside every check names none; repair the last one it started.
    failed=$(sed -n 's/^loom: check failed: //p' "$log")
    [ -n "$failed" ] || failed=$(awk '/^==> / { last = substr($0, 5) } END { print last }' "$log")
    checks=()
    while IFS= read -r check; do checks+=("$check"); done <<<"$failed"
    round=$((round + 1)) ran=0 changed=0 skipped=""
    for check in "${checks[@]}"; do
      attempts=$(printf '%s' "$tried" | grep -cxF -- "$check") || true
      if listed "$gave_up" "$check"; then
        skipped+="- Still failing: $check. Its session gave up."$'\n'
        continue
      elif [ "$attempts" -ge "$LOOM_REPAIR_ATTEMPTS" ]; then
        skipped+="- Still failing: $check, after $attempts repair sessions."$'\n'
        continue
      elif ! repair_time_left; then
        skipped+="- Still failing: $check. No time was left for another session."$'\n'
        continue
      fi
      ran=$((ran + 1))
      session="$logs/repair-$round-$ran"
      awk -v name="$check" '/^==> / { on = (substr($0, 5) == name) } on' "$log" >"$session-check.log"
      say "Repair round $round: $check"
      sed -e "s|{{tag}}|$tag|g" -e "s|{{check}}|$check|g" -e "s|{{log}}|$session-check.log|g" -e "s|{{all}}|$log|g" \
        "$REPO_ROOT/scripts/fork/upstream-repair.md" |
        run_agent 150 acceptEdits Bash Read Edit Write Glob Grep >"$session.log" 2>&1 ||
        echo "The session exited with status $?." >>"$session.log"
      tried+="$check"$'\n'
      reply=$(final_line "$session.log")
      echo "- Round $round, $check: $(printf '%s' "$reply" | cut -c1-300)" >>"$report"
      case "$reply" in UNREPAIRABLE*) gave_up+="$check"$'\n' ;; esac
      restore_lockfile
      git add -A
      if git diff --cached --quiet; then
        echo "  The session changed nothing." >>"$report"
        continue
      fi
      changed=1
      # A session that stops partway still commits, so the needs-Kyle draft keeps its work.
      {
        if [ "$reply" = REPAIRED ]; then
          echo "fix(fork): repair round $round after upstream $tag ($check)"
        else
          echo "fix(fork): partial repair round $round after upstream $tag ($check)"
        fi
        echo
        echo "Failing check: $check"
        [ "$reply" = REPAIRED ] || printf '\nStopped before the check passed: %s\n' "$(printf '%s' "$reply" | cut -c1-300)"
        echo
        # The session's reply without its final line, at most 80 lines.
        awk 'NF { last = NR } { line[NR] = $0 } END { for (i = 1; i < last && i <= 80; i++) print line[i] }' \
          "$session.log"
      } | git commit -q -F -
    done
    printf '%s' "$skipped" >>"$report"
    [ "$ran" -gt 0 ] || die "the fork's checks still fail after repair; see $report"$'\n'"${skipped%$'\n'}"
    [ "$changed" -eq 1 ] || die "repair round $round changed nothing; see $report"
  done
}

# The integration on HEAD as a reviewer reads it: everything it adds to origin/main, oldest
# first, with each merge's conflict resolution (git show --remerge-diff) and each commit's
# patch. A branch that continued an earlier draft holds several merges, none reviewed yet.
resolution_diff() {
  local commit
  git rev-list --reverse --first-parent origin/main..HEAD | while IFS= read -r commit; do
    if git rev-parse -q --verify "$commit^2" >/dev/null; then
      git show --remerge-diff --format='Merge %h %s' "$commit"
    else
      git show --format='Commit %h %s' "$commit"
    fi
  done
}

# An independent session checks an unattended resolution before it merges without a
# person: no upstream change dropped outside a seam, no seam lost, nothing unrelated.
# Writes review.md beside the resolve logs and fails unless the verdict is pass.
cmd_review_integration() {
  local branch tag logs
  branch=$(git rev-parse --abbrev-ref HEAD)
  [[ "$branch" == integrate/* ]] || die "review-integration runs on an integrate/<tag> branch"
  tag=${branch#integrate/}
  logs=$(resolve_logs)
  mkdir -p "$logs"
  resolution_diff >"$logs/resolution.diff"
  sed -e "s|{{tag}}|$tag|g" -e "s|{{diff}}|$logs/resolution.diff|g" "$REPO_ROOT/scripts/fork/upstream-review.md" |
    run_agent 80 default Read Glob Grep "${CLAUDE_GIT_TOOLS[@]}" >"$logs/review.md" 2>&1 || true
  cat "$logs/review.md"
  [ "$(final_line "$logs/review.md")" = "VERDICT: pass" ] || die "the review did not pass the resolution of $tag"
}

# Merge an integration pull request with a merge commit and tag it loom-<tag>, as land
# does, without publishing or installing: the publisher builds the tag on its schedule.
cmd_merge_integration() {
  local branch=${1:-} tag number merged
  [[ "$branch" == integrate/* ]] || die "name the integrate/<tag> branch to merge"
  tag=${branch#integrate/}
  number=$(gh pr view "$branch" --json number --jq .number)
  # gh deletes the merged branch locally too; it must not be checked out.
  git checkout -q --detach
  gh pr merge "$number" --merge --delete-branch
  merged=$(gh pr view "$number" --json mergeCommit --jq .mergeCommit.oid)
  git fetch -q origin main
  git tag -a "loom-$tag" -m "Loom built from upstream $tag" "$merged"
  git push -q origin "loom-$tag"
}

# Rings the Loom upstream alert: a scheduled task on Kyle's Mac that opens a thread and
# looks into it. The request is a doorbell: status only, because the agent reads the
# facts from GitHub itself, so a forged request can do no more than ask it to look.
# loom-upstream.yml's Alert Kyle step sends the same request inline, so it works without
# a checkout; change both together.
cmd_notify() {
  local status=${1:-}
  case "$status" in
    failed | needs-review | stale | heartbeat) ;;
    *) die "notify takes failed, needs-review, stale or heartbeat" ;;
  esac
  if [ -z "${LOOM_ALERT_WEBHOOK_URL:-}" ]; then
    echo "LOOM_ALERT_WEBHOOK_URL is not set, so Loom was not alerted" >&2
    return 1
  fi
  printf '{"source":"loom-upstream","status":"%s","run":"%s"}' "$status" "${GITHUB_RUN_ID:-}" |
    curl -fsS --retry 3 -X POST -H 'content-type: application/json' --data-binary @- \
      "$LOOM_ALERT_WEBHOOK_URL" >/dev/null || die "the Loom alert webhook did not accept the request"
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
    upstream-status) shift; cmd_upstream_status "$@" ;;
    upstream-overlap) shift; cmd_upstream_overlap "$@" ;;
    review-integration) cmd_review_integration ;;
    close-superseded) cmd_close_superseded ;;
    merge-integration) shift; cmd_merge_integration "$@" ;;
    notify) shift; cmd_notify "$@" ;;
    check) run_checks ;;
    integrate) shift; cmd_integrate "$@" ;;
    land) shift; cmd_land "$@" ;;
    build) cmd_build ;;
    install) cmd_install ;;
    rollback) cmd_rollback ;;
    signing-setup) cmd_signing_setup ;;
    *) awk 'NR > 1 && /^set -euo/ { exit } NR > 1' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
  esac
fi
