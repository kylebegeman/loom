# Computers and connections

Open **Settings > Computers** or the computer shortcut to choose where to work.
A computer runs Loom and keeps its own projects and conversations. Your Mac,
iPhone and browser are clients that connect to those computers. Usually each
working computer runs one Loom environment.

## Find your computers on another device

Sign in to the same Connect account in Loom on your Mac and iPhone. Link each computer from its connection settings, or use the installed CLI's
`t3 connect` setup for a headless host. On iPhone, open a directly paired
computer's details and choose **Link this computer**. That connection must allow
Connect management. Computers linked to your
account appear on your other signed-in clients. Direct pairing remains available
for a local network or VPN without an account.

A direct pairing link grants access on the client that opens it. It does not
link that computer to your Connect account. Account discovery shares the computer
inventory, not its project files or conversation storage.

Open **Manage account > Linked computers** to review your account's computers
and remove a link. Removing an account link revokes its Connect access; removing
a connection from this device only changes this device. Direct pairing routes
remain available after an account link is removed.

Loom's iOS release supports email-code sign-in and enrolled account verification
methods. Account creation and profile changes open the account website. Native
passkeys, social sign-in, Apple sign-in and push delivery require separate
configuration for Loom's Apple identity.

The upstream production account service supports its hosted web app and the
native clients. A browser on a local, IP or VPN address can use direct pairing;
Connections provides the hosted-web sign-in link when that deployment supports
it. A privately configured account service follows its own supported domains.

## Connect computers from your Library

Once this device is connected to your Library, Loom lists the other computers in
your Library that this device has not connected yet, under **Settings > Computers**.
On iPhone they are in its **From your Library** section. Choose **Connect** to sign in to
one with Loom Identity, with no pairing code. In a browser, choose **Sign in**
next, which opens the sign-in window. Loom reaches these computers over
Tailscale, or at a computer's reach address once reach is on for it (see
[Reach a computer from anywhere](#reach-a-computer-from-anywhere)). A computer
without a reach address needs this device on your tailnet. A browser signs in
over Tailscale; when only the reach address answers, Loom offers pairing instead.

If you joined your Library with Loom Identity, sign in to each computer with the
same account. Loom only signs in to a computer that uses the same sign-in
provider as your Library.

When Loom cannot sign in, it says why and offers the pairing form instead, with
the computer's address filled in when Loom has a usable one. That happens when
the computer cannot be reached, does not offer Loom sign-in to this app, or uses
a different sign-in provider than your Library. In a browser, sign-in also needs
the computer to allow this app's address. Get a pairing code from Connections
settings in Loom on that computer.

The desktop app and iPhone also refuse to sign in at a typed address that
claims to be a computer your Library lists at other addresses. Sign in from
your Library's computer list instead, or use a pairing link.

The list is read when you open it. To read it again, choose **Refresh** on
desktop and in a browser, or pull down on iPhone. If your Library cannot be
reached, Loom says so and shows the last list it read. Connected computers keep
their own addresses, and a computer you remove from this device returns to the
list.

If a computer has no published address, choose **Pair instead** and enter a
reachable address and pairing code. Loom checks that it is the computer you
selected. On that computer, **Connection details** shows the addresses it last
reported to your Library. If there are none, enable **Tailscale HTTPS** on desktop
or **Reach from anywhere** below the connection settings. **Tailscale HTTPS**
works with **Network access** off. If another app already serves its port, Loom
names that app and asks for another port instead of replacing it.

## Keep a computer signed in to its Library

A computer renews its Library sign-in automatically before it expires. In
**Settings > Computers > Connection details**, check **Library sign-in and
directory** for its expiry, reporting state and any repair. The same status is
available in the computer's details on iPhone. This sign-in is separate from
your devices' Identity sign-ins.

If automatic renewal is unavailable, update Loom on your Library before the
shown expiry. An expired or refused sign-in needs your Library administrator to
issue a replacement publisher credential for this computer and replace its
private credential file. Loom reloads the replacement automatically. Until
then, Library publishing, directory reporting and remote bot requests cannot
use that sign-in. A Library outage is retried automatically.

The administrator issues credentials on the Library with
`loom auth library-publisher --source-environment-id <computer-id> --library-url <https-origin>`.
If replacing a credential, revoke its old publisher session and retire its old
issuer-side credential file first. Transfer the generated file privately to
that computer's configured publisher credential path and keep its permissions
at `0600`. Do not paste its contents into a conversation.

## Stay signed in with Identity

Each Identity sign-in to a computer lasts up to an hour. When the computer sets
a sign-in limit, the desktop app and iPhone renew it on their own while you
work. They ask you to sign in again once that limit is reached, counted from
when you last signed in, or sooner if the computer stops accepting your account.
A browser does not renew on its own, so it asks you to sign in again after each
hour of use.

Removing a connection signs this device out of that computer. If the computer is
offline, removal still finishes and the device's access ends on its own within
the hour. Revoking a device's session from the computer's Connections settings
also ends its renewals, so that device must sign in again.

**Use these values** in a computer's Reach section turns on renewal for that
computer. Devices stay signed in for 7 days, or the number of days you enter
there, up to 30. A device you don't use for a week signs in again either way.
Update the desktop app and iPhone app on every device that signs in to that
computer first, because older versions cannot sign in once the limit is set.
Setting or changing the limit ends the computer's current Identity sign-ins when
it restarts. Devices that were already renewing reconnect on their own, and
others sign in again. A computer that saved its values before Loom offered this
setting gets the 7-day limit when it updates.

On a server you start yourself, `LOOM_IDENTITY_MAX_SESSION_AGE` in its
environment sets the limit instead and wins over the saved value. Use whole
seconds or a number with `s`, `m`, `h` or `d`, such as `7d`, between one hour
and 365 days. The desktop app does not read it, so use **Use these values**
there.

## Reach a computer from anywhere

Reach gives a computer its own address, such as
`https://studio-loom.example.com`, so your devices can connect to it from any
network without Tailscale. Your Library sets the address up and the connection
runs through Cloudflare. The address only opens the door to Loom: every device
still signs in with Loom Identity or pairs before it can use the computer.

Your Library needs a reach zone and a Cloudflare token before any computer can
use reach. Set `LOOM_REACH_ZONE` and `LOOM_REACH_CLOUDFLARE_TOKEN_FILE` in the
Library's server environment and restart it. Once both are set, a **Reach
addresses** section appears in the Library's Connections settings and shows
whether the token can be read. If you change the zone later, each computer gets
a new address at its next start, and the list shows anything the token could
not remove in the old zone. A Library with Loom sign-in and its Pocket ID key
shows the section without a zone too, to list computers that prepared Loom
sign-in.

To turn reach on, open the computer's details in **Settings > Computers** and
turn on **Reach from anywhere**. You can do this on the computer itself, or from
another device: in the computer's details on desktop or in a browser, or in the
**Reach** section of the computer's details on iPhone. Another device needs a
pairing with full access to change reach. The computer must be signed in to
your Library, and your Library computer itself cannot use reach. Once the
address appears, **Copy address** copies it.

Other devices pick the address up the next time they connect to the computer.
A device that saved the computer earlier and can't reach it now, such as a
phone away from home without Tailscale, gets the address from your Library and
tries it on its own. It checks while it is connected to your Library, when you
open your computers in Settings or when a conversation on that computer can't
connect. You never need to remove the computer to pick up a new address, and
removing it deletes its drafts and unsent messages on that device.

To get Loom sign-in for a computer without turning reach on, choose **Prepare
sign-in** in the Reach section of that computer's own Connections settings.
When your Library has prepared Loom sign-in for the computer, open its own
Connections settings and choose **Use these values**. The session must allow
settings changes. Enter the allowed Loom account IDs if they are not already
configured, how many days devices stay signed in if not 7, and choose whether to
**Require passkey**. Leave it on if you sign in to Loom with a passkey; while it
is on, signing in with an email code is refused. Loom saves these values
privately on that computer and restarts its backend. Active connections
reconnect afterward; server environment variables take precedence over the
saved values. Until sign-in is configured, devices that find the computer through
your Library pair instead. If passkey sign-in is refused, sign out of Loom
Identity in your browser, then sign in with your passkey.

Turning reach off and **Remove address** are different:

- Turning reach off stops the computer from using its address, but keeps the
  address. Turning it on again brings it back.
- **Remove address** deletes the computer's tunnel and address record, so devices
  away from your network lose this route. The address stays reserved for the
  computer, and turning reach on again brings the same address back.
- If this device is connected through the address, Loom asks first, because
  turning it off or removing it disconnects this device.
- If a removal cannot finish because your Library is gone or cannot be reached,
  **Forget reach on this computer** ends it here. The tunnel and address stay
  until you retire them in your Library's **Reach addresses** list.

When your Library retires the computer's address, or another copy of the
computer takes it over, reach turns off on its own and says so. Turn it on again
to get an address.

To clean up after a computer you no longer have, use **Retire** in your
Library's **Reach addresses** list in **Settings > Computers**, on desktop, in a
browser or on iPhone. **Also end Loom sign-in
for this computer** ends its Loom sign-in too, and devices signed in to it lose
access when their current sign-in ends. A retired computer that is still signed
in to your Library sets reach up again on its next start, so revoke its Library
sign-in as well. If your Library cannot read its Loom sign-in key, it refuses
that option and changes nothing; retire without it, or fix the key and try
again. Your Library asks you to retire a computer's reach address before you can
forget the computer.

A computer that has Loom sign-in from your Library and no reach address shows
as **Sign-in only**. To end its sign-in, retire it with **Also end Loom sign-in
for this computer**, or **Retire and end sign-in** on iPhone. It then leaves the
list. If preparing sign-in fails, nothing is listed; choose **Prepare sign-in**
on that computer again.

Agents can check reach from any computer signed in to the Library, including connector counts and sign-in state, and can turn reach off or remove an address. They cannot
turn it on.

## Notifications from your Library

Use **Send test notification** in the command palette to open your Library's
notification settings, then choose the registered iPhone to test.

Your Library can send notifications to Loom on your iPhone without a Connect
account. With agent alerts on, it tells your iPhone when an agent needs your
approval or an answer, asks for Vault access, fails, reaches a usage limit or
finishes. It also reports bot runs waiting for you and failed scheduled tasks. This needs a
Loom build for iPhone that supports Library notifications, a Library with
notifications turned on, and an iPhone signed in to the Library with Loom
Identity.

To turn them on, open **Settings > Notifications** on iPhone and turn on
**Notifications from** your Library. iOS asks for permission the first time.
Choose the kinds you want below that switch, including bot approvals and failed scheduled
tasks. These choices require an updated Library. Choose **Send test notification** to check
that one arrives. If the test fails,
Loom says why, such as too many tests in a short time or Apple refusing the
Library's push key. When the Library no longer had the phone, or Apple no longer
accepted its notification token, Loom registers the phone again; try the test
again in a moment. Your Library turns notifications on with
`LOOM_LIBRARY_PUSH_ENABLED` and an Apple push key in its server environment; its
**Push notifications** section in **Settings > Computers** on desktop or in a
browser shows whether they are on, whether it sends agent alerts, which Loom
builds it sends to, and the iPhones that turned them on. If the iPhone says your
Library doesn't send notifications to this build of Loom, add that build to
`LOOM_LIBRARY_PUSH_TOPICS` on the Library. To have an agent send a test, choose
**Copy ID** on the phone's row there and give the ID to the agent.

Agent alerts have a switch of their own, `LOOM_LIBRARY_PUSH_ACTIVITY` in the
Library's server environment. When more than one account can sign in to your
Library, it sends alerts only to the accounts named in
`LOOM_LIBRARY_PUSH_RECIPIENTS`. Alerts come from the Library's own conversations
and from each computer your Library lists that has a Library connection and runs
a Loom version with agent alerts. A computer connected to your Library after it
started sends alerts once it restarts. An alert names no conversation, project
or computer. Tap it to open the conversation, which needs a connection to that
computer on this iPhone. A Vault access alert opens its requesting conversation, a bot alert
opens the Bots inbox, and a failed scheduled-task alert opens that task's computer in Scheduled
tasks. Older Libraries can still open computer settings for Vault requests. A computer sends
Vault alerts even when it connected to your Library after starting. Each conversation keeps one
notification, the latest.
Subagents and archived or settled conversations never alert. A
snoozed conversation stays quiet when its agent finishes, but still alerts when
it fails or asks you something. A computer sends at most 20 alerts an hour, and
an iPhone gets at most 30.

When you reopen Loom on desktop or in a browser, it summarizes scheduled tasks that failed
since your last visit. Open the notice to review them in Scheduled tasks.

With no iPhone registered, alerts reach no one. The **Push notifications**
section and the iPhone's switch both say so with the steps to fix it, and a
conversation whose alert or Vault request went unheard gets a notice, at most
once a day. An iPhone's registration renews while it connects with a current
sign-in. When your Library's sign-in limit runs out, sign in again with your
passkey to keep notifications coming.

Turning the switch off on iPhone tells your Library to forget the phone. If the
Library cannot be reached, the phone keeps your choice and tells it on the next
connection. Signing in to the Library with a different account turns the switch
off.

Removing the Library connection on iPhone while the Library is connected tells it
to forget the phone first. Signing out, or removing the connection while the
Library cannot be reached, does not stop notifications right away. Your Library
keeps the phone until its registration expires, up to your Library's sign-in
limit or 30 days. To stop a phone now, for example a lost one, choose **Remove**
next to it in **Push notifications** and revoke its sign-in. A phone removed
there that still has the switch on registers again the next time it connects.

## Name and use a computer

Rename a connected Loom computer in its connection settings. Its friendly name
appears on connected clients and in account discovery when the computer is
reachable. Restoring its system name does not change its hostname or connections.
Older servers support a clearly labeled alias saved on the current client only.
A computer that has never been reached while offline may show its last linked
name until it connects.

Start a conversation with no project or an existing project, add a project to the
selected computer, or continue its recent work. Expand connection details to
inspect routes, permissions and devices with access. Permissions belong to each
computer and determine which actions that connection can use.

On web and desktop, **New conversation** opens a searchable project chooser. Choose
an existing project, create one, or browse folders on a connected computer in the
same command palette. When the project is ready, **Start conversation** uses its
current computer, files and agent settings. Search or select a setting to change it;
**Back** keeps your choices. Arrow keys and Enter work throughout the flow.
Creating a project or adding a folder from this flow continues into conversation setup;
using those actions directly opens the project instead.

Use the **+** beside a thread to copy its project, computer, files and agent settings,
including model options, permissions and mode. You can review them before starting.
Existing branch and worktree shortcuts remain available. Choosing another project
clears the original project's file selection.

Moving existing work still uses **Move work**. Signing in or choosing a different
computer does not move its projects or conversations automatically.

## Updates across computers

The desktop sidebar's update control applies to that computer and its local
backends. Open **Settings > Computers > Fleet updates** to compare runtime
versions and provider updates across computers. **Review updates** shows the
planned updates, skipped computers, and restart impact before you run them. The
command palette's **Review updates** opens this section.
Offline computers retain their last known version until they reconnect.

If a computer is older than this Loom supports, Computers names it and offers **Update**.
This includes your Library. The notice clears after the updated computer reports its capabilities.

### Forget an old computer

In Settings > Computers, your Library's list offers **Forget** for computers and unattached machines. Computers that have not reported for 30 days appear under **Old machines**. Forget removes the Library entry and its pinned key; it does not remove your saved connection or files. A running computer returns when it reports again, usually within 15 minutes. Retire an active Reach address before forgetting its computer.

When Library reporting says the signing key changed, use **Forget in your Library** there to accept the computer's next signed report. Agents connected to the Library can use `loom_directory_forget`.
