# Portable setup and recovery

A LoomOS recovery kit commissions an existing Omarchy installation. Its recipe pins
the integration pack, custom Loom desktop/server and selected Office, Atlas and
Switchboard clients. The same kit supports laptop and workstation profiles. Paths
expand from the destination user's HOME and XDG directories; no username, machine
ID, credential, browser profile or application database belongs in the recipe.

## Prepare a kit

Copy [personal.example.json](personal.example.json) outside the checkout, replace
the release versions, pack digest and shared service origins, and prepare these
directories from each product's checked distribution:

| Input directory           | Contents                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `integration/`            | Complete pack built by `release.mjs`, including `release.json`                         |
| `components/loom/`        | Custom `Loom.AppImage` and extracted `squashfs-root/`                                  |
| `components/office/`      | Checked Linux `office-cli` executable                                                  |
| `components/atlas/`       | Checked Linux `atlas` executable                                                       |
| `components/switchboard/` | Portable client with `bin/`, `controller/` and package metadata                        |
| `components/server/`      | Complete checked T3 distribution: `t3`, `node_modules`, `client` and supporting assets |

The server's optional `runtimeDirectory` creates a standardized, checksum-pinned
T3 archive from the complete selected release, with normalized archive metadata. Initial
hosting can use this kit through a temporary loopback-only mirror. The normal T3
installer verifies the archive and exact runtime version; its persisted update
origin remains the configured custom fork. Python is needed when building this
self-contained workstation distribution.

Remove unused optional components and their corresponding app/server declarations.
Loom can instead be a regular executable distribution: declare its relative command
and omit `appImage` and `appDir`. The pack version and digest must match the chosen
integration. Match the CPU architecture; the kit never substitutes an upstream
runtime or downloads a different release.

```sh
node deploy/omarchy/commission.mjs build /absolute/spec.json /absolute/inputs /absolute/recovery-kit
```

The builder writes `recipe.json`, `setup.sh` and verified payloads into a new directory,
and prints the recipe SHA256. Every payload file and executable mode is pinned.
Internal relative release symlinks are retained; escaping links, extra files, unknown
recipe fields and common credential/state files are rejected. Review distributions
before copying them: the tool cannot identify a secret hidden inside arbitrary source
code or a differently named file.

Keep the kit and its printed SHA256 in an independent backup location. Do not add
the large private recovery kit to Git. Build a new kit after intentionally choosing
newer components. Routine pack updates do not rewrite an older recovery recipe.

## Commission a machine

Install Omarchy through its normal workflow. It owns disk setup, drivers, network,
keyring, desktop and OS recovery. Use the normal user, Node 24 or newer and Chromium.
For this full example, Tailscale, Secret Service, Bash, Python, librsvg and ImageMagick
must also be available. Missing prerequisites stop before setup writes files;
install the missing tool through Omarchy's package controls and retry.

Copy the kit to the destination, then review the expanded plan:

```sh
/usr/bin/bash /absolute/recovery-kit/setup.sh plan /absolute/recovery-kit --profile laptop --review-sha256 RECIPE_SHA256
/usr/bin/bash /absolute/recovery-kit/setup.sh apply /absolute/recovery-kit --profile laptop --review-sha256 RECIPE_SHA256
```

The laptop omits the standalone hosting runtime. Use `--profile workstation` on a hosting machine. Both profiles use the same app
servers and applicable offline features. Laptop setup starts no background hosting.
Workstation setup retains running jobs and requires an explicit hosting action if
its service is absent. Changing an installed workstation to laptop first requires
removing its hosting through the owning T3 service controls.

Setup verifies platform, Omarchy version, native menu parsing, existing ownership,
the recipe and every payload. It installs component releases to named directories,
delegates integration/rollback to the existing pack installer, and creates a private
commissioning journal plus a recipe snapshot.

Existing keyboard controls are preserved even when Omarchy represents them as opaque
Lua callbacks and no preset file exists. A clean installation initializes its keyboard
preset; utility text preferences initialize only when absent. Appearance and shell geometry stay intact until the local
appearance action is selected. Sources of user-owned edits are reported and preserved.
Rerunning never resets credentials, app storage, T3 data or another environment's service.

## Finish local steps

Open **LoomOS → Maintenance → Machine setup and recovery**, find that action in
Loom actions, or run `loom-os commission`.

Status lists verified releases and unfinished steps. Continue the existing app and
AI connection flow; completed Office/Atlas CLI and Switchboard authorizations are
reused. Browser sign-in stays inside each app. Tailscale membership, missing client
credentials and local administrator approval remain ordinary local flows.

Loom keeps provider configuration inside each owning environment. On a new
environment, use its existing **Settings → Providers → Usage providers → Route
through Switchboard** control. Native Ask AI uses the installed routed adapters;
provider CLI installation and account/settings checks remain with their existing
owners. The kit never copies provider account homes or substitutes a direct route.

Choose **Apply Iris appearance** on an unlocked desktop to install the pinned skin.
It retains wallpaper and shell settings and prints its appearance backup path.
**Publish boot/login branding** runs that skin's existing publisher in the terminal,
so a necessary sudo password never enters the journal. Already published matching
boot/login logos and gradient adapters are recognized.

Enable the existing status widget if requested. On a new workstation, **Install
workstation hosting** delegates to the custom T3 installer only when no service unit
exists. Native continuation refuses to replace an existing unit or operate past the
secure lock. It never restarts a running service or shell. If Omarchy does not watch
changed menu/plugin files, use its normal Restart shell action when safe.

```sh
loom-os commission status --human
loom-os pack status --human
loom-os compatibility --human
```

A commissioned recipe can still have unfinished local steps. `commissioned` means
base installation completed; `ready` also requires the reported connections,
appearance, branding, widget and selected hosting. Checks never run provider inference.

## Interruption and replacement

If setup stops, rerun the same kit, SHA256 and profile. A different recipe/profile
cannot take over an incomplete journal. The native screen also offers **Resume
reviewed setup**. Actual bytes and ownership are checked again rather than trusting
completion marks. An interrupted pack activation requires its exact release;
an independently interrupted shortcut change uses `loom-os shortcuts recover`.

If the recipe itself needs amendment after a stopped setup, archive its unfinished
journal with `loom-os commission abandon --review-sha256 OLD_RECIPE_SHA256`, then review
the new kit. This retires only the progress record and retains installed components,
personal settings, app data and services. The archived journal remains available;
abandoning never claims the old recipe completed.

On a replacement machine, use the saved kit and repeat normal app/CLI authorization.
Office and Atlas retain server authority, shared data and their own offline behavior.
The kit restores software and setup, not browser state or an old T3 environment's
contents; recover those through their owning backup/restore workflows. Full disk/OS
recovery remains Omarchy's responsibility.

Pack rollback preserves the journal and recipe snapshot. A pre-recipe rollback can
remove the installed commission command; the saved kit's `setup.sh` works independently.
Reapplying it restores the pinned integration. Status distinguishes a subsequently
updated pack from the originally commissioned recipe.
