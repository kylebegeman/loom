# Loom fork notes

Loom is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code). The fork is
additive: it tracks upstream and keeps upstream's internal names so merges stay easy.
The `fork/branding` work is purely cosmetic. The app shows the name "Loom" and its own
icon; behavior, data locations and identifiers are upstream's.

## Implementation packets

Loom features beyond the branding are built as implementation packets, one folder per
feature, each additive and limited to marked seams. Start at
[docs/fork/packets/README.md](docs/fork/packets/README.md) for the packet index, the
conventions and the shared extension points. The
[implement-now queue](docs/fork/packets/IMPLEMENT-NOW.md) records current selections and
takes precedence over older packet readiness labels; [docs/fork/selections.md](docs/fork/selections.md)
records which old Loom features were chosen.

L23's 3D editing workspace ships in Loom `0.0.46-nightly.20261007.2787` on `main`.
Its [packet](docs/fork/packets/L23-model-preview-3d/) records the completed scope and
verification limits; [user help](docs/fork/user/model-preview-3d.md) explains how to start.

L24's expanded PCB workspace ships in Loom `0.0.46-nightly.20261008.2801` on `main`.
Its [packet](docs/fork/packets/L24-pcb-preview/) records scope and verification;
[user help](docs/fork/user/pcb-preview.md) covers the editor, library, simulation and tools.

## Brand source

Fork-owned files, never edited upstream:

- `packages/shared/src/brand.ts`: `BRAND_NAME` ("Loom") and `formatBrandDisplayName`.
  Stable builds show "Loom", nightly builds "Loom (Nightly)", development builds
  "Loom (Dev)". The internal stage union (`Alpha | Dev | Nightly`) is unchanged; "Alpha"
  is upstream's stable stage and displays as the bare name. Covered by `brand.test.ts`.
- `apps/web/src/components/LoomWordmark.tsx`: the sidebar header wordmark. It inherits
  the header's size, weight, tracking and color, so it follows light, dark and the
  stage backdrop.
- `FORK.md`: this file.

## Seams in upstream files

Find them with `git grep -n "fork: brand"`; `docs/fork/seams.tsv` is the checked list.
JSON and binary files cannot carry the marker and are listed separately.

| File                                                          | Why                                                                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/app/DesktopEnvironment.ts`                  | Base and display name from the brand file. Feeds `app.setName`, the About panel, window titles, the app menu, the Linux desktop entry and the web via IPC. |
| `apps/web/src/branding.ts`                                    | Web fallback base name when no desktop branding is injected.                                                                                               |
| `apps/web/src/branding.logic.ts`                              | Display-name policy delegates to the brand file (document title, auth, pairing and error screens).                                                         |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`           | Header wordmark: `LoomWordmark` in place of the "T3" mark plus "Code".                                                                                     |
| `apps/web/index.html`                                         | Document title and splash labels shown before React mounts.                                                                                                |
| `scripts/build-desktop-artifact.ts`                           | Bundle product name (`Loom.app`, `CFBundleName`), DMG title, artifact file names, URL protocol display name, screen-capture usage text.                    |
| `apps/desktop/resources/dmg/dmg-background-*.svg`             | Installer artwork: "Drag Loom into Applications." and a Loom wordmark in place of the T3 mark.                                                             |
| `apps/web/src/branding.test.ts`                               | Expected fallback names.                                                                                                                                   |
| `apps/desktop/src/app/DesktopAppIdentity.test.ts`             | Expected app name.                                                                                                                                         |
| `scripts/build-desktop-artifact.test.ts`                      | Expected product name, DMG title and protocol name.                                                                                                        |
| `packages/shared/package.json` (no marker)                    | Adds the `./brand` subpath export, placed first so upstream's appended exports do not conflict.                                                            |
| `assets/{prod,nightly,dev}/**` (no marker)                    | Loom icons under the upstream file names and dimensions. See Icons.                                                                                        |
| `apps/web/public/{favicon*,apple-touch-icon.png}` (no marker) | Development web icon copies generated by `icons:export`.                                                                                                   |

### Extension point seams

The shared plumbing packets register into, specified in
[docs/fork/packets/EXTENSION-POINTS.md](docs/fork/packets/EXTENSION-POINTS.md). Find them with
`git grep -n "fork: ext-"`.

| File                                                                                         | Marker            | Why                                                                                                         |
| -------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/server/src/ws.ts`                                                                      | `ext-core`        | Serves `LoomWsRpcGroup` and merges the fork RPC handler layer.                                              |
| `apps/server/src/server.ts`                                                                  | `ext-core`        | `ForkLayer` at the head of the core runtime; `ForkRoutesLayer` with the routes.                             |
| `apps/server/src/environment/ServerEnvironment.ts`                                           | `ext-core`        | Advertises `capabilities.loomFeatures`.                                                                     |
| `packages/contracts/src/environment.ts`                                                      | `ext-core`        | Optional `loomFeatures` capability key.                                                                     |
| `packages/client-runtime/src/rpc/protocol.ts`                                                | `ext-core`        | Clients speak `LoomWsRpcGroup`.                                                                             |
| `packages/client-runtime/src/rpc/client.ts`                                                  | `ext-core`        | Fork streaming tags join the client's stream unions.                                                        |
| `packages/contracts/package.json` (no marker)                                                | `ext-core`        | `./fork` subpath export, first after `.`.                                                                   |
| `apps/web/src/routes/__root.tsx`                                                             | `ext-web-root`    | Mounts `ForkRoot` in the authenticated app shell.                                                           |
| `apps/web/src/rightPanelStore.ts`                                                            | `ext-panels`      | The generic `"fork"` surface kind and the `openSurface` action.                                             |
| `apps/web/src/components/RightPanelTabs.tsx`                                                 | `ext-panels`      | Fork panels in the launcher and "+" menu; their tab titles and icons.                                       |
| `apps/web/src/components/ChatView.tsx`                                                       | `ext-panels`      | Renders fork panels, passes panel actions to both tab bars, and lets focusable canvases own keyboard input. |
| `apps/web/src/components/CommandPalette.tsx`                                                 | `ext-palette`     | Adds fork palette items to the root action list.                                                            |
| `packages/contracts/src/keybindings.ts`                                                      | `ext-keybindings` | Fork `loom.*` commands join the static keybinding command list.                                             |
| `apps/web/src/components/settings/KeybindingsSettings.logic.ts`                              | `ext-keybindings` | Fork feature names in keybinding labels, such as "Device QA".                                               |
| `packages/client-runtime/package.json` (no marker)                                           | `ext-core`        | `./fork` subpath export, after `./errors`.                                                                  |
| `apps/web/src/components/settings/settingsSearch.ts`                                         | `ext-settings`    | Adds the Loom settings route, label and scope.                                                              |
| `apps/web/src/components/settings/SettingsSidebarNav.tsx`                                    | `ext-settings`    | Gives the Loom page its icon.                                                                               |
| `apps/web/src/routes/settings.loom.tsx` (fork-owned)                                         | `ext-settings`    | Hosts packet settings in the route directory.                                                               |
| `apps/web/src/routeTree.gen.ts` (generated)                                                  | `ext-settings`    | Regenerated by the web build to include the Loom route.                                                     |
| `apps/server/src/binCli.ts`                                                                  | `ext-cli`         | Registers service-backed fork CLI commands through authenticated MCP.                                       |
| `apps/server/src/mcp/McpHttpServer.ts`                                                       | `ext-mcp`         | Registers the fork's toolkits on the shared agent server.                                                   |
| `packages/contracts/src/clientRpcPermissions.ts`, `apps/server/src/auth/RpcAuthorization.ts` | `ext-core`        | Add fork client grants while preserving the exhaustive upstream server scope map.                           |
| `packages/client-runtime/src/state/runtime.ts`, `usage.test.ts`                              | `ext-core`        | Expose cancellable document results through the shared command boundary.                                    |
| `apps/server/src/observability/RpcInstrumentation.ts`                                        | `ext-core`        | Label fork RPC spans within the shared middleware.                                                          |
| `apps/web/src/closedViewStore.ts`, `reopenClosedView.ts`                                     | `ext-panels`      | Persist and reopen fork documents; retire archived inspector history.                                       |
| `apps/web/src/components/DiffPanel.tsx`                                                      | `ext-diff-header` | Fork buttons in the diff panel header, such as the code graph's Impact button.                              |

### Dependencies added by packets

L23 adds `three` and `@types/three` 0.186.0 to `apps/web`, approved by Kyle on
2026-09-24. The renderer and loaders live in a lazy chunk loaded by the 3D panel.
The lockfile changes are limited to those packages and their required dependencies.

`apps/server` keeps `diff` 8.0.3 for the Apple build tooling's project patches. Upstream
dropped it in `v0.0.46-nightly.20261010.2935`; a seam row keeps the next merge from
removing it again.

### Packet seams

Upstream edits a single packet needs that no extension point covers. Each packet's `SEAMS.md`
explains why. Find them with `git grep -n "fork: <slug>"`.

L24 adds an optional `extendEnv` flag to `apps/server/src/processRunner.ts`
(`fork: pcb-preview`) so circuit code receives only its filtered environment.
Existing callers retain inherited variables. See the
[L24 packet](docs/fork/packets/L24-pcb-preview/SEAMS.md).

L09 wraps DeviceWorkspace in `apps/web/src/components/device/DevicePanel.tsx`
(`fork: device-qa`, 2 marker lines) to put the Device QA toolbar row above the device
being viewed. The row renders nothing against a server without Device QA. See the
[L09 packet](docs/fork/packets/L09-device-qa/SEAMS.md).

L12 renders the right panel's empty-state launcher and the tab bar's "+" menu through
the Loom panel picker in `apps/web/src/components/RightPanelTabs.tsx` (`fork: panel-picker`,
6 marker lines). Both seams read upstream's own action arrays, and the "+" popover reuses
upstream's open state and trigger, so `rightPanel.new` still opens it. With the picker
turned off in Settings the upstream list and menu render unchanged. See the
[L12 packet](docs/fork/packets/L12-panel-picker/SEAMS.md) and
[user help](docs/fork/user/panel-picker.md).

The thread inspector is archived in `apps/web/src/fork/thread-inspector/`. Its header
seam and UI registrations are removed.

The `codex-shadow-images` seam in `CodexHomeLayout.ts` and its regression tests
preserves Codex-created `generated_images` directories in account shadow homes.
Keep it during upstream merges until upstream accepts these directories without
preventing provider startup. The Pro Max account schema fix comes from upstream.

The `codex-login-email` seam in `CodexProvider.ts` names a Codex account from its
home's `auth.json` when a custom `model_provider` makes Codex report no account, so
usage views do not count a hub-routed subscription twice.

The `switchboard` seams add Switchboard mode (`apps/server/src/fork/switchboard`,
`apps/web/src/fork/switchboard`): one `switchboardEnabled` server setting, shown with
the usage hubs in Settings. While it is on, every Claude and Codex launch is pointed at
the local CLIProxyAPI hub (`provider/codexLaunchArgs.ts`, `ClaudeAdapterV2.ts`,
`ClaudeTextGeneration.ts`) and the model picker shows one Claude and one Codex
(`ProviderModelPicker.tsx`). The picker also disables, with the reason, models the hub
cannot serve right now: the `loom.switchboard.limits` RPC reads the Switchboard
controller's status on `127.0.0.1:8318`, so while every Codex account is on credits only
the credit models stay selectable. Off, launches and the picker are upstream's.

`apps/server/scripts/migrate-dev-db.ts` (`fork: dev-db`, 2 marker lines) skips the Loom
tables listed in `apps/server/src/fork/devDb.ts` when it copies the real database. Their
rows name the live install's lanes, run folders and graphs, and a dev server reconciling
them would release leases, clear scratch or delete files that belong to the live install.
Add a table there when a feature stores host resources it later cleans up.

L05 adds the outline toggle and column to the file viewer in
`apps/web/src/components/files/FilePreviewPanel.tsx` (`fork: file-outline`, 3 marker
lines). See the [L05 packet](docs/fork/packets/L05-file-outline/SEAMS.md) and
[user help](docs/fork/user/file-outline.md).

## Identifiers kept on purpose

These locate the owner's existing T3 Code data or are invisible, so they keep T3 names:

- App id `com.t3tools.t3code` (and the Windows AppUserModelId).
- userData folder `~/Library/Application Support/t3code` (`t3code-dev` in development),
  including upstream's legacy `T3 Code (Alpha)` folder detection.
- State directory `~/.t3`, env vars `T3CODE_*`, localStorage keys `t3code:*`, and
  package names `@t3tools/*`.
- URL schemes `t3code` and `t3code-dev`; only their display name changed.
- The packaged `package.json` name `t3code`. Electron names the macOS Keychain item
  after it (see below).
- Linux executable name and WM class `t3code`; `apps/desktop/package.json` `productName`,
  which only names the unpackaged development Electron process.
- The default branch `main`, as upstream's. Upstream's scripts, docs and workflow
  triggers assume it.
- The CLI update source in `packages/shared/src/cliRelease.ts`.
- Upstream's `T3Wordmark` component, still used by the work-log "T3 Code" icon and the
  first-run welcome wizard, and the scattered help and error messages that say
  "T3 Code". The wizard is skipped for existing workspaces.

## safeStorage and the Keychain

Electron encrypts its cookie store and `safeStorage` data with a key kept in the macOS
Keychain item `<app name> Safe Storage`. The name is bound during startup from the
packaged `package.json` (`name: "t3code"`, no `productName`), before the app's own
`app.setName` call runs. That is why the installed T3 Code (Alpha) created
`t3code Safe Storage`, not `T3 Code (Alpha) Safe Storage`.

The fork changes only `productName` in the electron-builder config and the runtime
display name, and leaves the packaged `package.json` name alone, so Loom uses the same
`t3code Safe Storage` item and existing cookies stay readable. Adding a `productName` to
the staged `package.json` would move the key to `Loom Safe Storage`, an item that a
different app named Loom already created on this Mac. Don't add one.

The app encrypts two files with `safeStorage`: `~/.t3/userdata/saved-environments.json`
(saved remote environment bearer tokens) and `~/.t3/userdata/connection-catalog.json`
(the desktop connection catalog). Neither existed when this fork was made.

A locally built, unsigned app has a different code signature from the T3 release that
created the Keychain item, so macOS may ask once whether Loom can use
`t3code Safe Storage`. Allow it to keep existing cookies. That prompt comes from the
signature, not from the rename.

## Icons

The desktop build turns `assets/<flavor>/*-macos-1024.png` into `icon.icns` with `sips`
and `iconutil`. It doesn't use the Icon Composer projects or build an `Assets.car`.
The `app-icon.icon` projects are the source for `vp run icons:export` (iOS, Linux,
Windows `.ico` and web exports) and for the mobile iOS build.

- Each `app-icon.icon` has one flat, glass-free layer, `Assets/loom.png`: the Loom icon
  body cropped from its macOS rendition and scaled to 1024px. The old layer SVGs stay in
  place because `scripts/export-android-icons.ts` still reads them, so the Android
  launcher artwork is still T3.
- The iOS, universal, web favicon, apple-touch and `.ico` files are generated by
  `vp run icons:export`; `vp run icons:check` passes.
- The macOS 1024px PNGs are the Loom icon's own macOS rendition from its `.icns`
  (848px body, 88px inset, no shadow), copied in place of the manual Icon Composer
  "macOS pre-Tahoe" export described in `assets/README.md`.
- `assets/prod/logo.svg` is unchanged. No build uses it.

## Updating from upstream

Loom follows upstream's nightlies, so `main` takes small upstream steps every day instead
of a large one per stable release. The `Loom upstream` workflow
(`.github/workflows/loom-upstream.yml`) runs every morning. When upstream has a nightly
that `main` lacks, it merges it on `integrate/<tag>`, runs the fork's checks and opens a
pull request. A pull request that passes on the first try merges by itself and `main` is
tagged `loom-<tag>` (the repository variable `LOOM_AUTO_MERGE`). If the merge conflicts or
a check fails, Claude (Opus 5.5, high effort) repairs it on the same branch within the
seam rules and says what it changed on the pull request, or opens a draft marked "needs
Kyle" when it cannot. Those pull requests wait for review.

Nothing installs by itself. Feed-enabled builds use the existing update button: download
the update, then restart and install when ready. The local publisher described below builds
and publishes each checked daily integration automatically.

For a manual build, run this from Terminal, not from inside Loom: installing quits Loom,
and `land` refuses to run where that would kill it midway.

```sh
scripts/fork/loom.sh land
```

`land` merges an open integration pull request with a merge commit, tags `loom-<tag>` if
the workflow has not, then builds, signs and installs `main`. With nothing open it installs
`main` as it is, which covers the workflow's own merges and fork changes; it stops early
when the installed build is already `main`. Never squash or rebase an integration pull
request: the next merge needs upstream's history, and `land` stops if it finds the tag
missing from `main`. To take a stable release or a specific tag, run the workflow by hand
(Actions, Loom upstream, Run workflow, target `stable` or a tag) or
`gh workflow run loom-upstream.yml -f target=stable`; `dry_run` merges and checks without
pushing. Mention `@claude` in any pull request comment to have Claude work on that branch
(`.github/workflows/loom-claude.yml`, owner only).

The same steps run locally with `scripts/fork/loom.sh`:

| Command                                          | What it does                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/fork/loom.sh status`                    | The upstream release main is built from, the installed version, and the newest stable and nightly tags.                              |
| `scripts/fork/loom.sh check`                     | The fork's checks on the current checkout: seams, fork tests, typechecks.                                                            |
| `scripts/fork/loom.sh integrate`                 | Merge the newest stable tag on a test branch, run the fork's checks, build, then fast-forward main, tag `loom-<tag>`, push, install. |
| `scripts/fork/loom.sh integrate nightly`         | The same for the newest nightly tag, or pass any upstream tag.                                                                       |
| `scripts/fork/loom.sh integrate <tag> --dry-run` | Merge, check and build, then discard it. main and the installed app are unchanged.                                                   |
| `scripts/fork/loom.sh integrate <tag> --pr`      | Merge and check, then push the test branch and open its pull request (what the workflow runs).                                       |
| `scripts/fork/loom.sh land [<pr>]`               | Merge an integration pull request, tag, build and install. With none open, install what main already contains.                       |
| `scripts/fork/loom.sh build` / `install`         | Rebuild main (stamped with its upstream version) / install the newest build.                                                         |
| `scripts/fork/loom.sh rollback`                  | Reinstall the previous build and restore the T3 data it last ran with.                                                               |

A merge conflict stops on the `integrate/<tag>` branch and lists the files. Resolve them,
`git add -A && git commit --no-edit`, then `scripts/fork/loom.sh integrate --continue`
(add `--pr` to finish as a pull request).

Fork features that reach `main` join the next daily integration build. To install them
before then, use `scripts/fork/loom.sh land` from Terminal.

### Automatic builds and the update button

On Kyle's Apple Silicon Mac, the local publisher checks GitHub every 30 minutes while
logged in. It builds the newest `loom-v*` integration tag contained in `origin/main`, in
an isolated checkout under `~/Library/Application Support/Loom Updates`. It does not
pull, stash or reset the working checkout. A failed or unmerged integration is not a
release candidate.

```sh
node scripts/fork/updates.ts publish
node scripts/fork/updates.ts enable
```

The first command builds, signs and publishes the current integration. `enable` installs
the publisher and its launch agent outside the checkout, so switching branches does not
break the schedule. Run `enable` again after changing the publisher. `check` reports the
candidate without building or publishing; `prepare` builds without publishing; `status`
shows the service and log locations; `disable` removes the schedule.

The signing key stays in the Mac's login keychain. The publisher verifies that the built
app uses `kylebegeman/loom` as its feed and satisfies the installed app's signing
requirement. It signs before creating the final ZIP and checksum, uploads to a draft
GitHub Release, then publishes only after the ZIP, block map and manifest have uploaded.
Re-running a published integration does nothing. Sleeping or offline Macs catch up on
the next successful check. Logs are in `~/Library/Logs/Loom Updates.log`.

Older Loom builds have no feed. After the first `publish`, run
`scripts/fork/loom.sh install` once from Terminal to install the prepared build. Subsequent
releases appear in the app's normal update controls; downloading and restarting remain
manual. GitHub releases are for this Mac, not notarized public macOS distribution.

The publisher retains three completed builds plus the installed build. Scripted installs
make the database snapshots used by `loom.sh rollback`; the standard in-app updater does
not make those legacy snapshots. Do not assume every in-app update has a rollback snapshot.

### Versions and updates

Loom keeps upstream's version numbers. Every build is stamped with the upstream tag it
was built from (the newest `loom-<tag>` on `main`), and the build record's commit tells
two Loom builds of one tag apart. Don't give Loom a version of its own:

- A remote SSH environment installs upstream's `t3` release of exactly the desktop's
  version (`packages/shared/src/cliRelease.ts`). Only upstream versions exist there.
- Clients compare their version with the server's (`apps/web/src/versionSkew.ts`), so the
  mobile app and app.t3.codes would report a mismatch against every Loom server.
- The `-nightly.<date>.<run>` suffix is what makes a build "Loom (Nightly)" with the
  nightly icon; a stable tag builds plain "Loom". Following nightlies, Loom is nearly
  always a nightly build: upstream cuts each stable from its latest nightly, which `main`
  usually has already.

Loom's feed is `kylebegeman/loom`, never `pingdotgg/t3code`: both apps share an app id,
so an upstream feed would replace Loom. Both the local build script and publisher reject
an app with the wrong feed. The app and server keep the exact upstream version. Published
release tags use the plain upstream version without a leading `v`: unlike `loom-v*`,
these are valid semantic versions that the GitHub updater can discover, and they stay
out of the sync scripts' upstream tag selection. Do not add `+` build metadata to those
tags: GitHub encodes it in the Atom feed, and the updater rejects the encoded version.
Upstream's tags are never moved.

### GitHub Actions on the fork

Actions were off when the fork was created, GitHub's default for forks, and upstream's
workflows must stay off here: they try to publish a release every half hour, deploy the
relay and build mobile apps with upstream's accounts, and they run on paid Blacksmith
runners the fork does not have. Only `loom-*.yml` workflows run. The
first step of every `Loom upstream` run disables any other active workflow, including ones
a merge adds, and the default workflow token is read-only.

The workflows need two repository secrets:

- `CLAUDE_CODE_OAUTH_TOKEN`: from `claude setup-token`, so Claude runs on Kyle's Claude
  subscription.
- `LOOM_BOT_TOKEN`: a fine-grained personal access token for `kylebegeman/loom` only, with
  read and write access to Contents, Pull requests and Workflows. The built-in token cannot
  push the upstream workflow changes most merges carry. It expires; renew it when runs fail
  to push.

The repository variable `LOOM_AUTO_MERGE` is `true`, which lets the workflow merge an
integration pull request that passed without repairs. Set it to anything else and every
pull request waits for `land`.

Builds live in `~/Library/Application Support/Loom Builds` (the newest three, plus the
installed one). Each scripted install first saves the V1 `state.sqlite`, the V2 `statev2.sqlite`
(when present), and the settings files from `~/.t3/userdata` into the record of the build
being replaced. Rollback restores the saved databases and removes a V2 database when
returning to a V1-only snapshot. Nightly builds share stable's data
folder and may upgrade the database in ways an older build cannot read, which is why a
rollback restores the data along with the app. Threads created on the newer build are
lost by a rollback.

Builds are signed with a local certificate, "Loom Local Code Signing", that
`scripts/fork/loom.sh signing-setup` creates once in the login keychain. It gives every
build the same identity (`identifier "com.t3tools.t3code" and certificate leaf = ...`),
so macOS keeps Loom's permissions and Keychain access across updates; without it each
build is a new ad hoc app. The certificate is self-signed and only for this Mac: it is
not trusted elsewhere and cannot notarize. The first build after setup may ask to let
`codesign` use the key, and Loom may ask once for the `t3code Safe Storage` item;
choose Always Allow for both.

## Merging upstream

Conflicts should only appear on seam lines. `docs/fork/seams.tsv` lists every seam file,
its marker and how many marked lines it keeps; `scripts/fork/loom.sh check` fails when a
merge drops one, or when a marker appears that the manifest does not list. A change that
adds or moves a seam updates the manifest in the same commit.
