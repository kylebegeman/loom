# Using LoomOS

LoomOS adds Loom, Office and Atlas to an Omarchy desktop. Office's Mail and Notes
remain together in Office, with the same app interface used on other platforms.
Each app connects to its existing server. Your available offline features follow
the app's shared implementation and keep their storage between desktop launches.

## Discover native actions

Open **Loom actions** from the launcher or LoomOS menu. Type words such as
mail, notes, save, AI or connections to find an action, its description and a
configured shortcut when available. Press Enter to launch the selected action,
or press Escape twice to close without doing anything. The first Escape leaves
the search field; the second closes the native picker. Ctrl+C also closes it.

Actions needing setup explain what is missing and let you return to the picker.
The list checks local configuration and installed files; the chosen app or AI
flow checks its live connection and permissions when it runs. Failed launches
provide an explicit retry. Nothing retries automatically.

## Shortcuts and readability

Choose **LoomOS → Appearance → Shortcuts**, or find Shortcuts in Loom actions.
The screen shows configured bindings, then offers Standard, Compact, per-action
customization and disabling Loom app shortcuts. Every change gets a live conflict
check and a review before applying. If a chord is occupied, adjust it in that
same review. Standard uses Super+Ctrl+Alt; Compact uses Super+Alt. Both retain
individual overrides. Disabling all Loom app shortcuts is explicit and reversible.

You can restore the previous selection. Personal bindings outside Loom's block
stay in place; edits inside the managed block are preserved and block replacement.
After saving, choose Reload shortcuts now while unlocked, or activate later through
normal Hyprland reload/sign-in. Reloading shortcuts does not restart background Loom.

Readability controls offer system terminal sizing or larger text and padding for
Loom utility dialogs. Larger dialogs use Omarchy's included Alacritty without
editing your terminal configuration. Restore System terminal sizing to use your
normal terminal again. The native Font and Theme choosers remain available for
system appearance and contrast.

```sh
loom-os shortcuts show
loom-os shortcuts preview compact
loom-os shortcuts apply compact
loom-os shortcuts set open-office "Super+F12"
loom-os shortcuts restore --dry-run
loom-os shortcuts restore
```

Presets require an available Hyprland session to check conflicts. An interrupted
change can be restored with Recover interrupted update in the same screen, or
`loom-os shortcuts recover`. Recovery preserves edits made after the interruption.
Shortcut and readability preferences survive pack updates and uninstall. Restoring
an older pack temporarily uses that pack's bindings; returning to the current pack
uses the retained preferences again.

## Compatibility checks

Choose **LoomOS → Maintenance → Compatibility checks**, or run
`loom-os compatibility --human`. This read-only report checks the installed native
menu parser, Theme picker, About action, Loom entries, file ownership and interrupted
updates. It reports personal overrides that could break an integration rather than
rewriting them. It does not contact app servers, read AI credentials or run inference.

## AI workbench

Choose **LoomOS → AI workbench**, or find it in Loom actions. Deliberately select
text, a text file, a saved screenshot, or context exported by an app. Review the
preview before explaining, summarizing or capturing it. The workbench reads only
the chosen input and freezes it for retries, so a later clipboard change does not
change the request.

Explanation and summary run in the configured Loom environment through Switchboard.
You can cancel a running request and review its thread in Loom. Requests use a
separate scratch thread with the provider's normal plan and approval controls. A missing route,
connection or permission produces recovery guidance; the workbench never changes
to a direct provider. Review the result before copying it or sending it to Office
or Atlas. The receiving app keeps its existing review and permission checks.

```sh
loom-os workbench --selected --operation explain
loom-os workbench --file /absolute/path/to/error.txt --operation explain
loom-os workbench --screenshot /absolute/path/to/screenshot.png
loom-os workbench --text "A deliberately selected excerpt" --operation summarize
loom-os workbench --file /absolute/path/to/source.txt --json
```

The last command prints a local preview without inference or capture. Screenshots
must be selected saved images; opening the workbench does not take a screenshot
or read another window. App context is explicit exported context, not permission
to read other app records. Original context and generated results retain their
source information through reviewed capture.

Text and results are limited to 64 KiB. PNG/JPEG screenshots are limited to 4 MiB
and 20 million pixels and require a visual preview. Results can be edited before
capture when an app has a smaller limit; source information is retained.

App-provided files use the `loom-workbench-context` version 1 JSON format with
`app`, `title`, `text` and `url`. Optional `reference` follows the app's exact-item
format. Optional `permissions` contains annotations rather than access grants.
These files are an integration boundary; Office and Atlas do not currently offer
an automatic workbench export control. Selected text remains their everyday path.

## Workstation control desk

Choose **LoomOS → Workstation control desk**, or find it in Loom actions. Review
running, waiting, failed and completed work from the configured Loom environment
and the app services that expose authorized access. Refresh is deliberate and
bounded. Opening the desk starts no agent, job or service restart.

Select a record to open its exact thread or app destination. Approvals remain in
the owning service; a notification, a task row or an OS connection does not grant
approval. Unsupported controls and disconnected sources explain their limits.
Exact Loom threads open the owning environment's existing web client, which may
request normal browser pairing.

Connect the local Loom environment explicitly once. Its scoped credential stays
in the desktop Secret Service, separate from app browser logins and Switchboard
credentials. A revoked or expired connection needs reconnecting. Disconnect
revokes only native access and preserves running work.

```sh
loom-os desk connect
loom-os desk --json
loom-os desk disconnect
```

Office and Atlas enforce their existing CLI permissions. Operator-only queues
remain unavailable when the app does not expose them to that client. Use the
owning app to review those queues.

## Open and capture

Open the applications from your launcher or the LoomOS menu. You can also use
`loom-os open loom`, `loom-os open office` or `loom-os open atlas`.

Press `Super+Ctrl+Alt+N` to send clipboard text to Office's reviewed capture screen.
Choose a Note, Reminder or Desk draft there, then save. You can supply a title and
link from the terminal too:

```sh
loom-os capture office --title "Follow up" --text "Ask about the proposal" \
  --url https://example.com/proposal
```

Office capture supports 200 characters of title, 4,000 of text and 2,048 of link.
It asks you to review the content before saving and preserves the intent through
login. It does not fetch the supplied link.

During a server outage, Capture can open Office or Atlas's review screen using a
supported declaration checked within the last seven days. The app decides whether
this profile has an enabled saved workspace and can queue that destination. Review
before saving; LoomOS does not confirm sign-in or submit the change itself.

## Notifications and focus

Choose **LoomOS → Notifications and focus**, or search for Notifications in Loom actions.
Focus quiets native banners through Omarchy's Do Not Disturb. Resume native banners reverses
that choice. Native notification history remains available, and each app keeps its own history.
App sounds, permissions, privacy and quiet schedules remain in the owning app.

Office's bell and All alerts manage its delivery rules. Atlas's bell has explicit desktop alert
controls for work while its client is open, with private previews by default. Loom's
**Settings → General** controls thread notifications and title previews on this device.
A notification opens its current record or thread for review and grants no approval.
Accepted remote push copies may remain in system history after their originating work changes.

```sh
loom-os notifications --json
loom-os notifications focus on
loom-os notifications focus off
```

## Set up connections

Open **Loom connections** from the app launcher or choose **LoomOS → AI and
connections → Set up connections**. The same flow is available in Loom actions
and Connection status. It checks existing Office/Atlas CLI access, Tailscale and
the private Switchboard gateway before offering the next incomplete step.
Closing and reopening setup keeps completed connections. An expired or cancelled
approval can be retried without signing in to the other apps again.

App-window sign-in stays in each app; setup does not read browser credentials.
**Open access settings** manages grants in the owning app. **Disconnect CLI
access** asks before removing local CLI sign-in and saved search keys. If the
server cannot be reached, review those settings after reconnecting to confirm
revocation. Browser sessions and app data are kept.

For shared AI, unlock the desktop secret store and check again before importing
a missing client key. Setup can restore the machine's commissioned gateway and
accept its personal client key through a masked prompt. Provider accounts stay
on Switchboard's hub. Ordinary setup requires no typed commands or scripts.

## Search and authenticate

If the app's portable CLI is configured, choose **AI and connections → Connect
Office search** or **Connect Atlas search** in the LoomOS menu. You can also run
`loom-os connect office` or `loom-os connect atlas`. Setup checks the installed
server: device sign-in opens its approval page in the shared app browser, while
servers without device sign-in use their existing API-key settings. Paste a key
only into the native masked prompt. Setup checks its search access before saving
it in this desktop's secret store. **Forget saved search key** removes the local
key; revoke it in the app to remove its server access. Browser and CLI access use
their respective app sessions.

Office and Atlas share a browser profile while keeping separate website sessions.
An Atlas sign-in email opened from Office therefore signs in the installed Atlas
window too. Return to Atlas and choose Back to sign in to enter its workspace after
using the link. If a window predates this integration update, save any writing, close
it and open Atlas again.

```sh
loom-os search office "meeting notes"
loom-os search atlas "project research"
loom-os capture atlas --title "Research" --text "A source worth keeping"
```

Choose **LoomOS → AI and connections → App integration** to inspect each app's
supported controls and offline limits. You can also run `loom-os app-integration --human`.
These describe the app release, not whether this device has saved content or pending changes.
Search and capture retain the app's permissions. An invalid or incompatible declaration
shows recovery guidance; use the app directly while its integration is unavailable.

Choose **Find in apps** from the launcher or LoomOS menu, or press
`Super+Ctrl+Alt+F`. You can also run `loom-os find office` or `loom-os find atlas`.
The native picker shows up to 20 results: Office searches ordinary records, while
current Atlas releases search saved Research and Presence work. Older Atlas
servers retain source-title, project and topic search. Select a result to read its
excerpt or metadata, then choose **Open item** to open that exact record in its app.
Compatible app releases reuse the signed-in window and retain the destination through
sign-in. Unsent writing or open editors wait for **Open selected item** in the app.
Save your work first. Deleted, changed or inaccessible records explain recovery.
Older releases keep **Copy title and open app** for search inside the app. Search again refines the query. Escape or Close cancels without
opening an app or copying anything. Search requires a reachable server and a
separate search connection; browser login alone does not authorize the CLI.

You can also open a saved reference from the terminal with
`loom-os open-item office '{"kind":"note","id":"SAVED_NOTE_ID"}'`.
Use the owning app's returned reference, including Atlas revisions and source versions.
Apps on different ports must use distinct hostnames if their app paths are the same;
Chromium omits ports from its native window identity. Ambiguous matches refuse opening
and explain the configuration change.

The terminal `loom-os search` command returns the app's JSON results. Atlas capture
opens its Research source review screen. Supported saved writing can be queued there
during an outage; live search still needs the app server.

## AI routing and health

Enable **Route through Switchboard** in each Loom environment's **Settings →
Providers → Usage providers** after the gateway and credential helper are
configured. The environment that runs the agent owns the connection. Use
`loom-os ai claude` or `loom-os ai codex` to route a normal terminal session through
Switchboard too. Existing app-server AI policies continue to govern Office and Atlas.

Choose **Ask AI** in the launcher or LoomOS menu, or press `Super+Shift+A`.
The native Agent shortcut (`Super+Shift+Ctrl+A`), agent panel and crash diagnoses
use the same private hub. Select Claude Code or Codex in **Setup → Default →
Agent**, or run `loom-os default-agent claude` or `loom-os default-agent codex`.
A terminal prompt can also start with `omarchy agent prompt "YOUR QUESTION"`.

The native AI usage panel shows Switchboard's cached limits for the highest-priority
shared account. Open Switchboard for all accounts, model eligibility and credit
policy. If Tailscale or Dorothy is unavailable, cloud AI reports an error and
waits for connectivity. Local voice dictation still works offline. AI account
login and subscription management stay on Dorothy.

Run `loom-os status` to inspect configuration and installed executables. Run
**LoomOS → Check connections**, or `loom-os doctor --human`, to check app servers,
Tailscale, the Switchboard credential and model catalog, shared cached limits and
the workstation service. Failed checks include a next step. These checks never
send AI prompts or refresh provider usage. `loom-os doctor` prints JSON and returns
a nonzero exit code when a connection has an error. See the
[integration pack](../../deploy/omarchy/README.md) for installation, workstation
hosting and removal.

## Connect another device

On a workstation, choose **LoomOS → Connect another device**, or run `loom-os pair`.
The existing background Loom environment prints a short-lived pairing link and QR
code. Join your Mac, laptop or phone to the same Tailscale network, then add the
link in Loom's **Settings → Connections → Add environment**. Use a fresh link for
each device. Agent work stays on the workstation when a client closes.

Pairing keeps the running service and its loopback listener in place. Its private
HTTPS route persists across restarts. If the HTTPS port is occupied, use
`loom-os pair --tailscale-serve-port 8443`. Tailscale must allow your normal user to
manage Serve; initial setup may require local administrator authentication.

Revoke a paired device in the host's **Settings → Connections**. To remove the
HTTPS route, run `tailscale serve --https=443 off`, replacing `443` with the port
you selected. This leaves local Loom and the background service running.

## What works now

Choose **What works now** from the launcher, Loom actions or **LoomOS → AI and
connections**. The Loom bar icon opens the same keyboard-friendly status and
recovery controls; its tooltip shows separate app, network, AI and workstation
states. Symbols and text distinguish attention and unavailable states as well
as color.

Offline support follows each app's current release and prior use in that browser
profile. **Check in app** asks you to verify this device's saved copies; it does not
promise that an uncached item is available. Choose **Review Office device** or
**Review Atlas device** to inspect saved reading, pending changes, conflicts and
storage inside the installed app. These actions also appear in Loom actions, the
launcher and **LoomOS → AI and connections**. You can run `loom-os device office`
or `loom-os device atlas`.

The device view uses your existing app profile and can open during a server outage
after supported prior use. Browser sign-in and CLI access remain separate. LoomOS
does not inspect private app storage or report pending-change counts, so
**Not confirmed** never means an empty queue. Older app releases open their
ordinary workspace with guidance to review saved work there.

Live search needs the app server and CLI access, with permissions checked when
searching. Shared AI needs Switchboard's private route. A stopped workstation
service is shown separately. During an outage, last-verified offline declarations
are retained for up to seven days, labelled as retained support rather than current
access. Sleep clears readiness until a fresh check finishes.

**Check again**, **Set up connections** and **Open app** recover access without
resubmitting queued changes or restarting agents. App offline storage and retry
policies remain in Office and Atlas.

## Private AI status and recovery

The Loom status icon checks Tailscale, Switchboard and this workstation's Loom
server alongside app capabilities every 30 seconds. Hover for separate states,
or click for **What works now**. Open **Connection status** to check again, open Tailscale
or Switchboard, or inspect the Loom service. Checks do not restart agents or
refresh provider account usage.

Ask AI checks the private route before starting Claude Code or Codex. If the
connection is unavailable, its terminal explains the failure and offers
**Retry Ask AI** and the same recovery actions. Retry preserves the original
prompt and starts only when you choose it. Reconnecting automatically refreshes
the status icon; it never silently resubmits an interrupted turn or falls back
to a direct provider account.

Use `loom-os connections` for JSON or `loom-os connections --human` for readable
status. `loom-os connections --terminal` opens the native recovery console.
If the status icon is absent, use `loom-os connections --enable-status` to place
it through Omarchy's plugin controls. It preserves an existing placement.

Open **LoomOS → AI and connections → Private AI hub**, find **Private AI hub** in
Loom actions or the launcher, or run `loom-os hub`. It shows cached model eligibility,
credit requirements and Office/Atlas client restrictions. A reachable catalog can
still have no eligible route. Ask AI checks its provider and any explicitly selected
model before launching; the selected model stays unchanged.

**Check readiness** reads Switchboard's cache. **Wait for hub readiness** waits up
to 90 seconds and can be cancelled with Escape. Neither action polls provider usage,
starts AI or retries interrupted work. **Open Switchboard** returns to the hub's
existing account and allowance controls.

A **Wake hub on the local network** action appears only for a commissioned wake
method, a fresh origin-bound declaration and a matching current LAN. It asks for
confirmation before sending one reviewed request. Sending does not prove that the
hub is awake or AI is ready; check readiness afterward. Tailscale alone cannot
carry a LAN wake broadcast, and an unreachable computer is not assumed asleep.
Unproven wake methods, additional hubs and local-model routes stay uncommissioned.

Use `loom-os hub --json --provider codex --model MODEL` for an explicit cached
model check, or `--client office` / `--client atlas` to inspect those client rules.

## Updates and recovery

Choose **LoomOS → Maintenance → Updates and recovery**, find it in Loom actions,
or use **Update → LoomOS updates and recovery**. Review the installed pack,
commissioned component versions, current app release identities and the running
Loom service. A pinned release identifies the checked files for future launches;
its running process and a web app's loaded interface can still use an older build.
Unavailable metadata and undeclared release channels stay explicit.

Browse verified local releases to stage a pack or portable recovery kit. Checked
incoming bundles can be placed under `~/.local/share/loom-os/maintenance/inbox/packs/`
or `kits/`; each bundle keeps its own directory. Staging
freezes the exact bytes and presents a review receipt before installation. Review
its component changes and recovery boundaries, then choose **Apply reviewed update**.
An edited candidate, changed configuration or different installed baseline requires
a new review. Integration updates preserve running services. Component-changing
kits check the owning environment's work and leave server activation with its owner.

The screen can verify an installed update, resume the same interrupted operation,
discard an unapplied candidate, or restore its exact retained integration pack.
Pack rollback preserves the selected appearance, credentials and app data. Kit
recovery resumes its verified owner workflow; restoring personal data, system
packages and application servers uses each owner's recovery procedure.

Open Office or Atlas to use their guarded app update action. Open Switchboard to
review the private AI hub, or open the stock Omarchy maintenance menu for system
updates. Their existing update, unsaved-work and backup controls remain authoritative.

```sh
loom-os updates status --human
loom-os updates stage pack /absolute/path/to/checked-pack PACK_SHA256
loom-os updates stage kit /absolute/path/to/checked-kit RECIPE_SHA256
loom-os updates apply REVIEW_SHA256
loom-os updates verify
loom-os updates recover REVIEW_SHA256
loom-os updates rollback REVIEW_SHA256
loom-os updates discard REVIEW_SHA256
```

The review digest is the staging receipt, distinct from the bundle's digest. Keep
the transferred bundle and its reviewed digest for recovery. A pack predating this
utility can be reapplied through the newer bundle's standalone release manager.

## Appearance and integration maintenance

Choose **LoomOS → Appearance → Iris Dark** or **Iris Light** to change the skin
through the normal Omarchy theme flow. These actions appear when the Iris themes
are installed. **About LoomOS** keeps the native system overview and gradient wordmark.

Open **LoomOS → Maintenance → Installed integration**, also available from
**Loom actions → Installed integration**, to see this machine's profile, theme, installed
pack version and retained rollback. It checks the retained bundles and whether
the installed runtime still matches. The CLI equivalents are `loom-os pack status`
for JSON and `loom-os pack status --human` for readable output. This inspection
works without a network connection.

**Restore previous integration** opens a review in the native terminal and defaults
to **No**. Confirm only after checking the version and plan. If the rollback target
changes after review, the action stops and asks for a fresh review. It restores the
integration pack while preserving your chosen theme, app data, credentials and
running background agents. An interrupted update must be finished with its exact
reviewed bundle before choosing another release.
