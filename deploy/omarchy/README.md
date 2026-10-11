# LoomOS integration pack

LoomOS is a user-owned layer on an ordinary Omarchy installation. Loom uses the
custom upstream-based T3 build. Office and Atlas keep their shared app interfaces,
server authorities, authentication and offline implementations. Office contains
Mail and Notes. The pack installs no database, container runtime or local model.

## Install

Use Linux and Node 24 or newer. Supply your custom Loom AppImage or executable;
the pack does not substitute a public upstream release. The portable Office and
Atlas clients are optional and use each app's existing device login.

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
capture. These app chords preserve Omarchy 4’s standard utility shortcuts. The existing
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
settings. It lives beside T3's unit in `$HOME/.config/systemd/user`, including when
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
It records a private backup and rollback path. Theme changes and protected
boot/login publication remain separate from routine pack updates, so an update
cannot unexpectedly replace your chosen appearance or require sudo. Reuse the
skin's printed `loom-branding.sh` only when publishing changed protected assets.
Loom desktop/server and Switchboard artifacts retain their existing release
workflows; the pack does not silently upgrade their runtimes.

## Native connection status

The pack owns the `loom.status` plugin under the user's Omarchy plugin directory.
Its native bar presentation reads bounded connection checks every 30 seconds;
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
