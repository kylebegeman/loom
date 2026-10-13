# Computers and connections

Open **Settings > Connections** or the computer shortcut to choose where to work.
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

Moving existing work still uses **Move work**. Signing in or choosing a different
computer does not move its projects or conversations automatically.
