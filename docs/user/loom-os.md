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

The terminal `loom-os search` command returns the app's JSON results. Atlas capture saves a private source tagged
`omarchy`. Its server must be reachable from this machine.

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

## Private AI status and recovery

The Loom status icon checks Tailscale, Switchboard and this workstation's Loom
server every 30 seconds. Hover for their separate states, or click for
**AI and connections**. Open **Connection status** to check again, open Tailscale
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

## Appearance and integration maintenance

Choose **LoomOS → Appearance → Iris Dark** or **Iris Light** to change the skin
through the normal Omarchy theme flow. These actions appear when the Iris themes
are installed. **About LoomOS** keeps the native system overview and gradient wordmark.

Open **LoomOS → Maintenance → Installed integration**, also available from
**Update → LoomOS integration**, to see this machine's profile, theme, installed
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
