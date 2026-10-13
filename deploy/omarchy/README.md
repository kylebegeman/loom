# LoomOS integration pack

LoomOS is a user-owned layer on an ordinary Omarchy installation. Loom uses the
custom upstream-based T3 build. Office and Atlas keep their shared app interfaces,
server authorities, authentication and offline implementations. Office contains
Mail and Notes. The pack installs no database, container runtime or local model.

## Install

Use Linux and Node 24 or newer. Supply your custom Loom AppImage or executable;
the pack does not substitute a public upstream release. The portable Office and
Atlas clients are optional and use each server's existing authorization. Native
search setup discovers device sign-in support; servers without it use their
existing API-key interface and the desktop's Secret Service through `secret-tool`.

```sh
./deploy/omarchy/install.sh \
  --profile laptop \
  --loom-executable "$HOME/.local/lib/loom/Loom.AppImage" \
  --office-url https://office.begam.in \
  --office-cli "$HOME/.local/bin/office-cli" \
  --atlas-url https://YOUR-PRIVATE-ATLAS-ORIGIN \
  --atlas-cli "$HOME/.local/bin/atlas" \
  --switchboard-url https://YOUR-PRIVATE-GATEWAY-ORIGIN \
  --switchboard-status-url https://YOUR-PRIVATE-DASHBOARD-ORIGIN/status \
  --switchboard-dashboard-url https://YOUR-PRIVATE-DASHBOARD-ORIGIN \
  --switchboard-key-helper /absolute/switchboard/bin/switchboard-credential \
  --switchboard-cli /absolute/switchboard/bin/switchboard \
  --dry-run
```

Replace the example private origins with commissioned endpoints and rerun without
`--dry-run`. Atlas's `127.0.0.1:8397` on a Mac is not reachable at Linux localhost.
Omit optional applications until their endpoints are available. Use Chromium for
Office and Atlas; `--browser-executable` selects an absolute executable explicitly.
The tool installs to XDG directories and `$HOME/.local/bin`. Make that bin directory
available on your shell's PATH, or invoke it by its absolute path.

`loom-os configure` accepts the same options and preserves other configuration.
Config is `~/.config/loom-os/config.json` unless `XDG_CONFIG_HOME` overrides it.
It contains paths and origins, never tokens. Optional integrations can be removed
by deleting their configuration fields and running `loom-os configure`.

Omarchy 4's existing `hypr/bindings.lua` selects Lua bindings and the supported
JSONC menu extension. Older existing `hypr/bindings.conf` selects legacy bindings.
Unknown desktop layouts get application entries only. Install does not edit
`/usr/share/omarchy` or reload the active desktop. With Switchboard configured, it
replaces only the AI shortcut defaults and adds user-owned AI command adapters.
Reload Hyprland and restart the shell while the desktop is unlocked, or log out
and back in, to apply the AI environment to the running shell. Backups
are retained in `~/.local/state/loom-os/backups`.

The keys are `Super+Ctrl+Alt+L` for Loom, `Super+Ctrl+Alt+O` for Office,
`Super+Ctrl+Alt+A` for Atlas when configured, and `Super+Ctrl+Alt+N` for Office clipboard
capture, and `Super+Ctrl+Alt+F` for Find in apps when a portable app CLI is
configured. These app chords preserve Omarchy 4’s standard utility shortcuts. The existing
Agent shortcut remains available through Switchboard.
Review them against any additional personal bindings before reloading. The menu adds
LoomOS with the same applications and capture action. User content outside the
marked integration blocks is preserved. Edited generated files or blocks are
preserved and reported instead of overwritten.

## App and AI behavior

See [Using LoomOS](../../docs/user/loom-os.md) for daily commands. Office and Atlas
share the retained Office Chromium profile, so email links opened from Office sign in
the same Atlas origin used by its installed window. Cookies and offline storage remain
isolated by each app’s web origin; Switchboard keeps its own profile. Pack updates
preserve browser storage. Older per-app profile directories are retained rather than
merged or deleted. A running older Atlas window keeps its existing profile until closed
and reopened; save any writing before doing that. Their scopes and routes belong to
the applications. The integration does
not promise offline features that have not shipped: Office's replica/outbox and
Atlas's offline support are shared product work.

Configure the portable Switchboard client on Linux using `switchboard client
configure <private-gateway-origin>`, then import the personal client credential
with its stdin-based import command. The credential lives in Secret Service;
headless users can provide the Switchboard helper's validated systemd credential
file. For unattended hosting, keep a separate user systemd drop-in with
`LoadCredential=client-api-key:/absolute/private/credential-file`; the helper reads
the resulting `CREDENTIALS_DIRECTORY/client-api-key`. The source file must be
private and belong to that user. Keep this directive in `credentials.conf` rather
than the generated `loom-os.conf`. Never place keys in this pack, process arguments or the JSON configuration.
The hub must expose its secured gateway through private networking. The existing
hub remains authoritative; this pack does not bypass Switchboard's signed release,
adoption, verification, draining or rollback workflows to relocate it.

On each Loom environment that should use the hub, enable **Settings → Providers →
Usage providers → Route through Switchboard**. The pack passes `LOOM_SWITCHBOARD_URL`,
`LOOM_SWITCHBOARD_STATUS_URL` and `LOOM_SWITCHBOARD_KEY_HELPER` to the owning Loom
process. Native provider binaries and account homes remain supported. Remote Loom
servers need those settings on their own host, rather than on the browser client.
Only Claude Code may use Claude subscription models. Office and Atlas keep their
isolated GPT client policies and server-side AI configuration.

## Shared app capabilities

Office and Atlas expose anonymous, build-only metadata at `GET /.well-known/loom-app`.
Protocol `loom-app-integration` 1.1 describes launch, search, capture, links, notifications,
availability and bounded offline support. Authenticated `office.integration.describe` and
`atlas.integration.describe` expose the same metadata through each app's existing registry.
Actual operations keep their existing scope, account, source, revision and approval checks.

LoomOS accepts additive minor versions, refuses incompatible major versions and disables
unsupported capability versions with recovery guidance. Search and capture negotiate the
actual registry CLI words, formats and length units. Commands remain literal arguments.
Only a missing declaration (404 or 410) selects the existing limited adapter. Network,
authorization, redirect, malformed and incompatible responses never select that fallback.
Ordinary app opening remains available without discovery, including offline reading in
an already-used Office browser profile. The app declaration reports its current bounded offline support; successful browser caching alone does not establish durable offline capability.

Exact-item handoff uses each app's declared read-only item resolver and validated
same-origin route. A temporary native launch asks the existing same-profile window to
navigate; writing and open editors defer that navigation for explicit review. Uncertain
delivery never cold-launches a second workspace. Linux closes only its own nonce-labelled
stateless handoff window if the browser refuses to close it. Chromium identifies native
app windows by hostname and path, omitting ports. Configured apps with colliding identities
refuse native focus and request distinct hostnames instead of selecting another app.
Older app releases retain
in-app search guidance. Unified notifications remain unavailable. Device availability is reviewed inside each app's profile through its declared owner route, not a remote CLI session.

Check real producer interoperability from a Mac with Go and the app checkouts:

```sh
node deploy/omarchy/verify-app-integration.mjs /absolute/office /absolute/atlas
```

The command runs isolated metadata/permission tests in both products and checks their
actual JSON outputs against the adapter and installed search/capture/exact-item dispatch
on loopback.
It uses synthetic executables and no personal records, browser session, inference or database.

## Native OS AI

Configuring both `switchboard-url` and `switchboard-cli` enables native AI routing.
The Switchboard client's saved endpoint must match the commissioned Loom endpoint;
missing or mismatched settings refuse launch. Runtime credentials remain in the
existing OS secret store or systemd credential. No direct-provider fallback exists.

The integration adds **Ask AI** to the launcher and LoomOS menu. It routes
`Super+Shift+A`, `Super+Shift+Alt+A`, and the native Agent shortcut
`Super+Shift+Ctrl+A` to the default routed agent. Native agent-panel launches,
`omarchy agent`, `omarchy agent prompt`, and crash-notification diagnoses use the
same path. `loom-os default-agent claude|codex` selects the supported client.
Other agent choices and direct-provider AI installers are hidden until they have
an explicit Switchboard adapter. The bundled ChatGPT desktop entry is shadowed
with a user-owned hidden entry; its package is retained.

Adapters live in `~/.local/share/loom-os/ai/bin`. A user UWSM environment file,
the managed Bash block, and the existing Hyprland bindings block place this
narrow adapter directory ahead of native commands. The `omarchy` adapter passes
ordinary commands to `/usr/bin/omarchy`; it intercepts AI routes because the
native dispatcher otherwise resolves package scripts by absolute path. Future
OS AI entry points should call `loom-os agent` or `loom-os ai`, rather than a
provider binary or provider website.

The native usage panel reads only Switchboard's cached HTTPS status. It shows
fresh limits for the highest-priority shared account, omits reset or stale
windows, and writes an unavailable state after a failed read. It never polls
provider account usage independently. Local Whisper dictation keeps its existing
offline behavior. Any future cloud dictation cleanup must use Switchboard.

The normal CLI homes and history are preserved. Routed sessions keep their normal
approval behavior. Failed launches keep the terminal open with the diagnostic so
an unreachable hub is visible. Install and uninstall ownership checks preserve
edited adapters and personal settings.

## Context and background-work utilities

The native **AI workbench** previews deliberately selected text, files, saved
screenshots and app-exported context. Explanation and summary use the owning Loom
environment with verified Switchboard routing. Copying and app capture require
review; Office and Atlas retain capture authorization and provenance.

The **Workstation control desk** reads the existing Loom environment and supported
app service records. It exposes exact destinations, supported controls and
explicit disconnected or unavailable states. Its refresh is bounded and opening
it neither executes work nor restarts a service. `loom-os desk connect` explicitly
commissions the local scoped connection in Secret Service; credentials never go
in pack configuration or portable recipes. See [Using LoomOS](../../docs/user/loom-os.md)
for input selection, review and connection commands.

## Profiles and background work

Both profiles install the same applications and utilities. Laptop is the default
and starts no background process at login or boot. Workstation can run unattended
agents with the fork's existing T3 service:

```sh
loom-os configure --profile workstation \
  --server-executable /absolute/custom-fork/t3 \
  --server-base-dir "$HOME/.local/share/loom-os/t3" \
  --server-release-base-url https://github.com/kylebegeman/loom/releases/download \
  --server-host 127.0.0.1 --server-port 3774
loom-os service status
loom-os service install
```

Installation is explicit even for workstation. The pack delegates service
lifecycle to that chosen T3 CLI, including its lingering and restart behavior.
The service requires an explicit data directory and release base URL. Missing
runtime archives come from that configured origin, with `/v<version>/SHA256SUMS`
and the platform archive appended. Choose a published custom fork release, or
commission a verified local archive with `loom-os service install
--release-base-url http://127.0.0.1:PORT/releases`. This override applies only to
that installation; startup retains the configured fork origin. Archive checksums
and the executable's exact version are validated by T3's supported installer.
Ambient shell settings cannot substitute another release origin or data directory.
Avoid unqualified `t3 update`: its release discovery still targets upstream.

A user systemd drop-in persists the non-secret `LOOM_SWITCHBOARD_*`,
`T3CODE_RELEASE_BASE_URL`, `T3CODE_HOME`, and configured `T3CODE_HOST`/`T3CODE_PORT`
settings plus the commissioned Node and user CLI search paths. It lives beside T3's unit in `$HOME/.config/systemd/user`, including when
the pack's own configuration uses another XDG directory. These service settings do
not change the native desktop app's environment. T3 uses one `t3code.service` per
user; the pack preserves a unit that belongs to another data directory. Choose a
free port and separate state while commissioning beside legacy Loom.

`loom-os service restart` refreshes the owned drop-in before T3 reloads the user
manager and restarts. If `service install` reports an already-current runtime after
settings changed, restart explicitly to apply them. Restart interrupts active
agent work; schedule it when those sessions can stop. If desktop and service
should share an environment, use the fork's existing connection
selection instead of starting duplicate servers against one live database.
Changing profile alone does not stop an existing service. Use `loom-os service
uninstall` to stop background hosting before switching an installed workstation
to laptop behavior. Pack uninstall preserves background services and their drop-in.

## Private workstation access

`loom-os pair` delegates to the configured fork's supported `t3 pair --tailscale`
command and selects `server-base-dir` explicitly. The native **Connect another
device** menu action opens the same flow in a dedicated terminal. It appears only
for a configured workstation. No server or service restart is needed, and no
pairing credential is stored in pack configuration or files.

The upstream command checks the running environment, refuses an HTTPS route owned
by another environment and prints its one-time link with the normal five-minute
expiry and standard client scopes. `--tailscale-serve-port PORT` selects another
HTTPS port. Private Serve mappings persist across reboot and stay separate from
Dorothy's AI hub. Join both devices to the tailnet and grant the workstation's
normal user Tailscale operator access during local commissioning if needed.
Device revocation and route removal follow [Using LoomOS](../../docs/user/loom-os.md#connect-another-device).

## Existing LoomOS migration

Inventory the running machine before installing over it: Omarchy version,
hardware, available memory/disk, packages, user/system services, old Loom server,
its state location, network ingress, keyring and desktop configuration. The old
`loom-server.service`, `~/.loom/server` and installation directories are not
removed by this pack. Keep their data and a recovery copy until the new client
and replacement server have been verified.

Keep Omarchy's desktop, network management, audio, portals, keyring, drivers,
power management, updates and recovery. Trim optional bundled applications only
after measuring the actual installation. Retire the old custom Core/Runner,
duplicate app implementations, account shadow homes and custom ISO pipeline
through an explicit migration, rather than importing them into this layer.

## Verify and remove

```sh
node --test deploy/omarchy/loom-os.test.mjs deploy/omarchy/ai.test.mjs deploy/omarchy/health.test.mjs
sh -n deploy/omarchy/install.sh
loom-os status
loom-os doctor
loom-os uninstall --dry-run
loom-os uninstall
```

`status` reads configuration and executable presence. `doctor` also performs
bounded app/status GETs, authenticated Switchboard model-catalog checks and, on
workstations, a read-only service check. It does not invoke inference or poll
subscription accounts. Use `doctor --human` for recovery guidance, or
**LoomOS → Check connections** for the dedicated terminal. Default JSON retains
configuration fields and adds `diagnostics` and `summary`; errors return exit code 1.
Uninstall removes unchanged owned launchers/runtime/config and integration blocks.
It preserves modified files, browser profiles, credentials, app/T3 data and backups.
It never removes packages or kills processes.

## Versioned pack releases

The pack and the approved Iris skin are now bundled from `deploy/omarchy` rather
than copied from a session artifact directory. Build into a fresh directory:

```sh
node deploy/omarchy/release.mjs build /absolute/loom-pack-20261011 20261011.1
```

Keep the printed manifest SHA256 with the transferred bundle. On a commissioned
machine, verify and review the update before applying it:

```sh
node deploy/omarchy/release.mjs verify /absolute/loom-pack-20261011 SHA256
node deploy/omarchy/release.mjs install /absolute/loom-pack-20261011 SHA256 --dry-run
node deploy/omarchy/release.mjs install /absolute/loom-pack-20261011 SHA256
loom-os pack status --human
loom-os pack rollback --dry-run
loom-os pack rollback
```

The native LoomOS maintenance menu exposes release inspection and reviewed rollback;
see [Using LoomOS](../../docs/user/loom-os.md#appearance-and-integration-maintenance).

First commission the chosen profile with `install.sh` above; pack releases reuse
that machine's current configuration. Releases retain immutable copies and the
previous version. They verify every member, reject edited integration files,
and preserve the current profile, app origins, browser storage, credentials,
Iris appearance and protected branding. Neither profile starts or restarts a
service as a side effect of a pack update. If an activation is interrupted, its
`pack-pending.json` records the intended version; repeat that exact install to
finish it before selecting another version.

The first managed update retains an adopted baseline. Rolling back to a baseline
may restore a CLI without the `pack` command. Keep the transferred release bundle
and use its `pack/release.mjs install BUNDLE SHA256` command to apply an update
again. This works independently of the currently installed CLI.

The bundle's `iris/` directory contains the approved skin installer, palette,
gradient wordmark and terminal adapters. For a new Omarchy machine, install that
skin explicitly with `python3 BUNDLE/iris/install.py --mode dark` (or `light`).
It records a private backup and rollback path. The desktop must be unlocked for
appearance installation. Restore an appearance with
`python3 ~/.local/lib/loom-os/iris/install.py --rollback BACKUP_PATH`; pack rollback
preserves the selected appearance and is a separate operation.

The skin pins canonical Iris `tokens.json` with its version and SHA256 in
`iris/manifest.json`. Regenerate from a checked Iris source with
`python3 deploy/omarchy/iris/generate.py --tokens /path/to/iris/tokens.json` and
verify with `python3 deploy/omarchy/iris/generate.py --check`. The pack gate also
checks generation, source provenance and the approved artwork hashes. Terminal
text shades derive from Iris with recorded black/white mixes when needed to reach
4.5:1 on the nominal palette surfaces. Neutral keyboard focus uses an opaque
outline without changing geometry. These palette checks do not certify arbitrary
wallpaper blends, ANSI black-on-black, or app-owned content. Approved pixel
wordmarks are preserved separately from palette generation.

Theme changes and protected
boot/login publication remain separate from routine pack updates, so an update
cannot unexpectedly replace your chosen appearance or require sudo. Reuse the
skin's printed `loom-branding.sh` only when publishing changed protected assets.
Loom desktop/server and Switchboard artifacts retain their existing release
workflows; the pack does not silently upgrade their runtimes.

## Coordinated maintenance

The native **Updates and recovery** screen combines installed release identities,
current owner metadata and reviewed local pack/recovery-kit maintenance. It stages
immutable verified bytes and binds a private review receipt to the candidate,
installed baseline and plan. Apply, exact retry, verification, discard and pack
rollback delegate to existing release owners; report and staging start no updater.

Local packs and portable kits can be supplied to `loom-os updates stage` with their
independently reviewed SHA256. The native picker also discovers verified retained
releases and local incoming bundles. User settings, private route origins, component
inventory and supported feature boundaries are checked before activation. Existing
running services are preserved. Component-changing recipes require the owning
local environment's complete work metadata; the bounded control desk remains
informational. Pinned server bytes stay separate from explicit owner activation.

Office and Atlas expose their current hosted interface identities and retain their
own guarded update controls. Switchboard owns private hub releases and routing;
Omarchy owns system/package updates and recovery. This utility does not create a
cross-product server deployment authority or use upstream T3 release discovery.
See [Using LoomOS](../../docs/user/loom-os.md#updates-and-recovery) for native and
CLI review/recovery flows.

## Reproducible setup

Use a [portable recipe and recovery kit](recipes/README.md) to commission an existing
Omarchy machine with pinned component releases and resumable local setup. The kit
supports both profiles, expands paths for the destination user, preserves personal
data/settings and reuses normal connection, appearance and T3 service workflows.
The native **Machine setup and recovery** action lists verified releases and remaining
steps. `loom-os commission status --human` gives the same read-only status.

## Guided connections

**Loom connections** in the launcher and **AI and connections → Set up connections**
open one native flow for existing app CLI authorizations, Tailscale and Switchboard.
`loom-os setup --human` or `--json` performs the same bounded checks without opening
setup. Reopening discovers current owner sessions, so no progress file contains
credentials and completed approvals are not repeated. App-window sessions remain
inside Office and Atlas. Confirmed CLI disconnect delegates revocation to the app's
client and removes only that app/origin's saved search key; offline revocation must
be confirmed in the owning app after reconnecting.

The shared AI step can restore the configured gateway and import a personal client
key through masked input and stdin to Switchboard. Unlock/retry is offered first for
an unavailable secret store. No provider sign-in, inference or service restart is
part of this flow.

## Native connection status

The pack owns the `loom.status` plugin under the user's Omarchy plugin directory.
Its native bar presentation reads bounded capability/connection checks every 30 seconds;
there is no additional daemon. Ask AI uses the same private route check before
launch and keeps prompts intact through an explicit retry. Provider inference,
account-usage refresh and service restarts are never diagnostic side effects.

On a new machine, let Omarchy discover the plugin and run
`loom-os connections --enable-status` in its graphical session to place the
widget without moving an existing one. The plugin files participate in release
integrity checks and edited widgets are preserved. A commissioned machine with
the retired custom Loom widget needs its exact old files reviewed and backed up
before replacement; the installer deliberately refuses unowned existing files.
Routine updates retain that widget's placement and personal shell settings.

On Omarchy builds that disable shell file watching, the verified widget update
may still use cached components after a plugin rescan. Activate it with Omarchy's
supported **Restart shell** action (`omarchy restart shell`) in an unlocked
session. The pack installer does not restart the desktop or background Loom server.
Verify the live widget's `loom.status status` response after activation.

## Capability availability

`loom-os availability --json` collects the same app, private AI and workstation
status used by the bar. The native **What works now** action exposes explicit
read-only retry and owner-app opening. Offline support comes from validated app
integration declarations; retained declarations are origin-bound, expire after
seven days and contain no grants, account data or browser credentials. Refused
CLI access disables live search availability independently of offline support.
The versioned `device-status-in-app-v1` availability capability opens `/app/device`
through `loom-device-handoff-v1`, independently of server item resolution or CLI
sign-in. **Review Office device** and **Review Atlas device** are available from the
native status screen, launcher, Loom actions and connections menu. Run
`loom-os device office` or `loom-os device atlas` for the same owner handoff.
A verified, origin-bound retained declaration can enable that route during an
outage for up to seven days. Older or unsupported app releases explain the missing
route and open their ordinary app instead.

Device counts, conflict details and storage management stay in the installed
browser profile's owning app. LoomOS reads no browser cookies or private IndexedDB
records and does not resubmit pending writes or clear storage. Pending counts
remain unknown outside the app; unknown never means zero.

The widget clears status on logind sleep signals, rejects in-flight pre-sleep
results by generation, and also handles wall-clock gaps/backwards changes. Its
one-second clock check performs no network request; connection checks run at most
once per widget at a time on the 30-second cadence or explicit recovery. Sleep
never cancels an owning CLI credential refresh or replays queued work.

## Private hub readiness

`loom-os hub` opens the native cached model/readiness and recovery view. Its launcher,
Loom action and AI/connections menu share `hub-readiness-v1` from Switchboard's
existing private controller. Ask AI consumes provider/explicit-model eligibility;
network/catalog reachability alone is insufficient. `--json` and `--human` support
provider, model and existing app-client inspection. Waiting and reviewed wake
stay in the portable Switchboard owner, with bounded cancellation and no task replay.
Wake needs a commissioned target, an unexpired origin-bound declaration and the
matching current LAN; unsupported wake, secondary hubs and local routes remain
explicit. See [Using LoomOS](../../docs/user/loom-os.md#private-ai-status-and-recovery).

## Implementation packets

Kyle selected 17 further improvements, excluding saved project workspaces (#14).
The [packet review](packets/README.md) records their scope, dependencies and
acceptance. Approved packets are not completion claims.

The searchable **Loom actions** launcher/menu uses the same existing operations.
`loom-os actions --query "mail"` opens it with an initial filter;
`loom-os actions --json --query "mail"` lists matching action metadata without
network checks, credential lookup or inference. Shortcut hints come from the
configured Hyprland bindings. Local prerequisites can be unavailable even while
other actions work; selected operations retain their normal authorization and
connection checks.

## Shortcut preferences and compatibility

Shortcut presets and readability use user data in `~/.config/loom-os/shortcuts.json`
and `readability.json`, following XDG_CONFIG_HOME. They do not add fields to the
release's connection configuration, so retained installers continue accepting it.
Shortcut changes update only the owned binding block and its manifest hash. A private
pending record supports recovery after interruption. Preset application checks live
Hyprland bindings and refuses ambiguous ownership or conflicts. Personal text outside
the block is preserved. Reload is an explicit native choice and requires an unlocked
session. Larger utility dialogs use per-window Alacritty options; global terminal
settings are untouched. See [daily controls](../../docs/user/loom-os.md#shortcuts-and-readability).

Before preparing a pack release, run the focused gate:

```sh
node deploy/omarchy/check.mjs
```

On an installed Linux target, `--native` also runs that installation's read-only
compatibility report. Native visual/keyboard checks and physical display/suspend
acceptance remain separate. Record the actual Omarchy version and reviewed release
hash in rollout evidence; fixtures are not a claim that every upstream version works.
The unmodified upstream menu/parser fixtures carry their source commit, hashes and
license in `fixtures/omarchy/provenance.json`. Update those snapshots from recorded
upstream bytes, rather than editing or formatting the fixture text.

## Device continuity

`loom-os continuity` provides verified private workstation shortcuts and reviewed
exact thread/app-item handoff from the control desk. It pins the public T3 environment
identity, never saves pairing credentials, and verifies the same host before opening
or sharing a thread. `~/.config/loom-os/continuity.json` is separate from release
configuration and contains only the private origin, environment ID and label.
Current browser login and revoked-device recovery stay in T3's existing connection
controls; host reachability is not an authorization claim.

The utility delegates pairing, offline-device review and OS power changes to their
existing owners. It starts no daemon, retries no work after sleep/reconnect and
creates no competing local server. Optional `powerprofilesctl`/`qrencode` support
is discovered without installing dependencies. Physical laptop acceptance remains
separate from fixtures and desktop checks.
