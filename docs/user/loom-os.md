# Using LoomOS

LoomOS adds Loom, Office and Atlas to an Omarchy desktop. Office's Mail and Notes
remain together in Office, with the same app interface used on other platforms.
Each app connects to its existing server. Your available offline features follow
the app's shared implementation and keep their storage between desktop launches.

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

## Search and authenticate

If the app's portable CLI is configured, sign in with `loom-os login office` or
`loom-os login atlas`. Each opens the app's existing device authorization flow;
browser and CLI access use their respective app sessions.

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

Search returns the app's JSON results. Atlas capture saves a private source tagged
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
