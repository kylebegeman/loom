# Settings and project overrides

On web and desktop, the "Applying settings for …" sentence at the top of Settings pages picks
the project and environment a change applies to. Pages that only hold device preferences, such as
Appearance, don't show it. They start at **All projects** and **All environments**
and stay selected as you move between categories or search for a setting.

Preferences saved on this device, such as appearance, confirmations and browser profiles, always
show and ignore the selection. Everything else is stored on a server. Choose one environment to
edit its settings, or leave **All environments** to edit every connected environment at once.
Offline environments keep their current values; this is a bulk edit, not a synced global default.

Choose a project to override settings for it on the selected environments. A layers icon beside
each server row's title shows where the value comes from: the built-in default, the environment,
or a project override. Click it to see that chain on every selected environment. An override can
be reset to inherit again. Settings that cannot be overridden by a project are shown read-only
while a project is selected.

When the selected environments disagree, the control shows **Mixed** in place of a value and the
layers icon turns amber. Picking a value applies it to every selected environment.

Changing an environment value never touches a project's own override. When projects override the
setting you are editing, the layers icon counts them and the chain lists each one with its value:
click a project to jump to it, or **Reset all** to make those projects follow the environment
again.

Providers and diagnostics are per machine: they show one environment at a time, the primary
one until you pick another. Every other setting fans out to the selection.

With a project selected, a provider's switch in **Settings → Providers** turns it on or off for
that project only, in either direction: a provider off on the machine can be used in one project,
and one on everywhere can be kept out of another. That project's model pickers follow the switch,
and no new turn there can start on a provider it turned off, including queued messages and
follow-ups from delegated tasks. A turn already running when the switch flips finishes. A delegated
task's result still lands in its parent thread, which sees it on its next turn. Reset returns the project to the
machine's setting. Every other provider setting stays per machine.

On mobile, open **Settings** and use the filter in its header to choose connected environments
and a project. The filter stays available in server-setting pages. With **All projects** selected,
the **Server settings** categories and auto-settle controls in **Thread behavior** edit the
selected environments' defaults. Choosing a project edits its overrides on the selected
environments. Use **Use defaults** in a page to remove that page's project overrides.
Open **Settings → Projects & threads → Overview** to rename the project across its selected
connected checkouts, see where they live, and review each checkout's storage preference.
Settings that are environment-wide stay read-only while a project is selected. When selected
targets disagree, a control shows **Mixed** until you choose one value. Appearance, keyboard,
and other phone-only settings ignore the filter.

## Library projects and working copies

Loom opens **Projects** when you enter the app. **New project** starts with a name and
brief; repositories and references are optional. Connect your shared Library once before
saving your first project. You can also manage that connection in **Settings → Connections**. If that server supports Loom account sign-in, **Sign in to Loom** opens its
sign-in page. On desktop, you can check a Library address and sign in before saving its
computer connection. Desktop sign-in opens your browser and returns to Loom after verification.
Existing computer pairing and T3 Connect remain available. Changing your
Library selection does not move records from the previous Library.

**New project** saves a name, shared brief and resources without choosing a computer or
cloning files. Add repositories or reference links as needed. **Add existing folder** lets
you inspect a folder, then add it to an existing project or create a new project. Imported
folders are borrowed: removing their registration preserves your files.

Open a project to see its resources, conversations and known working copies. Starting a
conversation requires an explicit computer and either the whole project or one repository.
Use a suitable existing copy on that computer, or prepare files first. **Clone project**
prepares the project repositories together under one parent folder. Editing the shared brief
applies to new conversations; existing conversations keep the context they started with.

A conversation stays on its original computer. **Continue elsewhere** creates a linked
conversation with a fresh agent session and the context you choose to carry forward.
Removing a managed working copy preserves the Library project and saved conversations;
active work or local changes can prevent removal. A project can have zero working copies.

Saved projects and conversation history remain readable when a computer is offline.
Conversation history shows when it was last saved to the Library; work that has not uploaded
may be missing. Open saved attachments from the Library, and use **Save pending history**
when newer work is waiting to upload. A disconnected Library keeps its selected identity and cached records, but
must reconnect before you can save changes. It never silently switches to another server.

## Computer folders and earlier work

**Computer conversations** keeps earlier work on connected computers accessible from the
same navigation. On mobile, its **Folders** view groups that history by computer folder.
These folders remain separate from the shared projects you manage in **Projects**.

Open computer folder details to browse its threads. Expand a project for a short
thread preview, or open its home for **Open**, **Snoozed**, **History**, and **All** views.
Title search includes every thread, even when another view is selected. Clear search
to return to that view. **Open in Threads** switches to the thread navigator scoped
to the project.

Choose the connected computer and checkout before starting a new task. That choice
does not move existing work, and an offline or read-only computer requires reconnection
or another explicit choice.

Expand **Working files** in Project home to review its locations on each computer.
To add a working copy elsewhere, choose **Prepare on another computer** there.
Review the source computer's actual Git origin, choose the destination computer, and
review its destination folder before cloning. A fork is prepared from its own origin,
not from the upstream repository it may be grouped with. The destination uses its
existing Git credentials; private repositories may need GitHub setup on that computer.
If a matching copy already exists, open it instead of creating another.

The destination project is saved before cloning finishes, and clone progress remains
visible. If cloning fails, review the error before using Retry. If the computer restarts
and progress is unavailable, inspect the saved folder before trying again. Loom does
not automatically remove partial or existing files. Preparing a copy leaves the source
conversation unchanged; use [Move work](portable-handoffs.md#continue-on-another-machine)
for a reviewed linked continuation.

## Worktree branch names

In **Settings → Source Control → Worktree branch naming**, choose a static prefix,
a model-selected semantic prefix such as `feat/` or `fix/`, or custom instructions
for the complete name. The static prefix defaults to `t3/`; a trailing slash is
optional, and an empty prefix adds nothing. Invalid characters in a static prefix
are replaced with hyphens. Custom instructions are appended to
the naming prompt and can specify issue IDs, namespaces, and casing.

These settings apply to automatically named new worktree branches. Select a project
to override its environment defaults. Worktree directories keep their original names.
If generation fails, or a custom name is invalid or already taken, the temporary
branch name remains.

## Scheduled tasks on mobile

Open **Settings → Scheduled tasks** to create recurring tasks or manage existing
ones across your connected environments. Use the settings filter to narrow the
list by environment or project. Each task runs on the environment you choose,
using its project, model, and workspace settings. Fixed-time schedules use that
environment's time zone, which may differ from your phone's.

You can edit, pause, resume, run immediately, or delete a task from the list.
Webhook tasks only run when their URL is called, so they can't be run
immediately.
Leaving an edited form asks before discarding unsaved changes.

## Webhook automations

In **Settings → Scheduled tasks**, choose **On webhook**
as a task's schedule to run it whenever another service calls its URL, such as
GitHub on a new pull request or a CI job that failed. A public URL needs a
[T3 Connect](remote-access.md) managed tunnel; after you save the task, copy
its URL from the editor. Without one, the editor shows only the URL's path.
**Rotate** replaces the URL and the old one stops working.

The prompt decides what the agent sees. Placeholders pull values out of the
request: `{{body.path}}` for a JSON or form field, `{{headers.name}}`,
`{{query.name}}`, `{{body}}` for the raw body, and `{{request}}` for everything.
For example, `Review this PR: {{body.pull_request.html_url}}` sends only the
pull request link. A placeholder with no value is left empty.

For GitHub, turn on **Require signature**, keep the header
`x-hub-signature-256`, hex encoding and the `sha256=` prefix, and enter the
same secret in the repository's webhook settings with content type
`application/json`. Requests without a valid signature are rejected. Set this
up on desktop or web; mobile keeps an existing signature check but can't turn
one on.

On desktop and web, pick **Deliveries** from a task's menu to see recent
requests and the prompt each one produced.

If the environment is offline, the sender gets an error and nothing runs;
redeliver from the sender, such as GitHub's **Recent Deliveries**, once it is
back. To have T3 Connect keep requests instead, turn on **Hold webhooks while
offline** in **Settings → Connections**. T3 Connect then stores requests to a
T3 Connect URL for up to 24 hours and delivers them when the environment
returns. Leave it off if you don't want request bodies stored outside your
machine. To skip requests that waited too long, set **Skip requests older
than** on the task.

## Defaults and inheritance

General contains the model and workspace for new threads. Integrations controls agent browser
access. Source Control contains automatic pull, the default pull request merge method and text
generation. The same rows edit environment defaults or project overrides depending on the
project crumb.

The Projects category is always available. Browse projects or review their storage there,
or choose a project in the scope picker to manage its name, icon, actions, checkouts and removal. Actions belong to a project: editing them creates the project's own list
on each selected environment, and reset returns to the environment's shared list. A project's
`t3.json` actions can be imported there.

Settings a repository can also declare in `t3.json`, such as the workspace for new threads,
resolve in one order: a project override, then the environment setting, then `t3.json`, then the
built-in default. Leave a setting on **Inherit** to let the next tier decide.
Browser access changes apply when an agent session next starts.

New worktrees initialize git submodules recursively. If that step is slow because the repository
declares many nested submodules, set **Submodules** in **Settings → General** (with the project
selected to override it there) to **Top level only** to stop at the ones the repository declares
itself, or **Skip** to leave them for a setup script. It resolves in the same order as the
workspace default: a `"worktreeSubmodules"` value in the `t3.json` of the branch being checked out
applies when the project and environment are both on **Inherit**.

## Worktree location

New worktrees go in the `worktrees` folder of the T3 home directory. To put them somewhere else,
such as another drive, set **Settings → Storage → Worktree location** to an absolute path like
`D:\worktrees` or `~/worktrees`. The setting is per machine. Existing worktrees stay where they
are, and cleanup covers both the default folder and the custom one.

## Storage cleanup

Open **Settings → Storage** to enable automatic cleanup on one machine or all connected
environments. Policies are off by default and run on the server at startup, when changed, and
hourly. Offline machines keep their existing policies.

Select a project to set **Automatic worktree cleanup** to **Inherit**, **Off**, or **Custom**.
Inherit follows each machine's rules; Off keeps that project's worktrees until you remove them
manually. Custom applies separate worktree rules to the selected project or checkout. Browser
captures and log retention remain machine-wide.

Worktrees can be removed after a chosen number of inactive days, after merging, or when they
have no commits beyond the default branch. Only T3-managed worktrees are eligible. Active
sessions prevent removal. Shared worktrees stay while any thread using them is active. **Keep worktrees with local changes** defaults
to **Uncommitted changes**, which protects tracked edits and untracked files but deletes ignored
files such as `.env` and build output. **Any local files** also protects ignored files other than
`node_modules`. **Edited tracked files** protects only tracked edits and allows untracked and
ignored files to be deleted. Branches and thread history stay; starting another turn recreates the checkout.
Merge cleanup requires a merged pull request whose commits are included in the remote default
branch. A squash or rebase merge on GitHub also counts when the pull request targeted the default
branch and the worktree is still at the pull request's last commit.

Enable **Release settled worktrees** to reclaim a managed checkout after its last active thread
settles. The server waits for settlement actions, open terminals and provider sessions. It fetches
the branch's upstream and keeps the checkout if its current commits are unpublished. This rule
always protects local files, including ignored data other than `node_modules`, regardless of the
local-change setting above. This rule keeps the project's main checkout. Continuing a released
conversation recreates its worktree checkout and waits for workspace setup before starting the agent.
Failed setup keeps the checkout and retries when you continue again, including after a restart.

Enable **Release settled project checkouts** or **Release inactive project checkouts**
to set this computer's defaults for managed primary project folders. Every conversation must
be settled for the settlement rule; inactivity uses the most recent conversation activity.
Folders opened manually and older clones stay on disk until you explicitly review and let
Loom manage them. Enabling cleanup does not adopt existing folders.

To manage an existing folder, review its working copy in Project home, or select the project
and open **Settings → Projects → Working files** on web or desktop,
or **Settings → Projects & threads → Overview** on mobile. Review the folder
on each computer, choose **Keep files here** or **Free space when settled**, then confirm.
Loom registers the existing folder without moving its files or changing its project history.
Only primary Git repositories with their own Git directory and an origin remote can be adopted;
unsafe or unavailable folders remain external. Local changes can stay in an adopted folder.

**Keep files here** overrides automatic primary-folder cleanup. Choosing it for a released
checkout restores that folder immediately; setup runs when an agent next uses the project.
**Free space when settled** permits release after every conversation settles, even if the computer's
default release setting is off. For working files Loom manages, **Use computer default** follows that computer's settlement
and inactivity defaults.
These choices govern the primary folder; worktree cleanup follows its separate settings.

Saving a release preference can release an already settled, eligible checkout during the next
cleanup. Pinned conversations, active agents or terminals, pending actions, local files and
linked worktrees keep the checkout. All local branches and tags must be published, and the
remote must be reachable when releasing. Ignored local data is protected except for rebuildable
`node_modules` folders. Repositories with submodules are kept. Keep permanent application data
outside the working folder and its disposable lane. Update Loom on a computer before managing
its existing project folders; older server versions cannot reopen folders released with the
new storage metadata.

A project groups your conversations and work in Loom. Its working files are the code and other
files stored at a particular location on a computer. The same project can have working files on
more than one computer; each location has its own keep/remove choice. These choices affect those
working files, while the project and its conversations stay in Loom.

Use **Manage working files** from Projects, or **Settings → Projects → Files on computers**
on web and desktop and **Settings → Projects & threads → Files on computers** on iPhone, to
review the working-file locations already registered in Loom. Each project lists its locations
on your computers. Select the locations you want to change and check their current files.
Choose **Keep files here**, **Free space when settled**, or **Use computer default** for each
reviewed location, then confirm the exact computers, locations and choices before saving.
Locations outside Loom file management require an explicit Keep or Free space choice first.
Offline computers keep their saved locations until they reconnect. Opening this screen or
checking files does not enable cleanup, remove files or restore a removed copy.

Saving a release choice can soon release an already settled, eligible folder. Saving Keep for a
released folder restores its working files. Cleanup still checks publication and active work
before releasing files; a storage review is not a guarantee that release is currently possible.
Completed saves remain visible if another folder fails. Review a failed or changed folder again
before choosing and saving its policy. Stop prevents remaining saves from starting; a request
already sent may still finish.

Projects and conversations stay discoverable after release. Opening a file or terminal, using
Git, or continuing work restores the saved revision from its recovery archive. Starting an agent
also waits for project setup to finish; failed setup can be retried. Compact Git recovery data
stays on the same machine, so release frees checkout and dependency space without deleting
history or requiring another download to resume. Cleanup results report the space reclaimed.

Enable **Delete worktrees with deleted threads** to remove safe worktrees after their last
thread is deleted, including archived threads and worktrees left by earlier deletions. The
server waits for sessions and terminals to stop and retries skipped worktrees after restart.
Existing prompts for deleting a worktree manually remain available when this policy is off.

Choose **Delete now** to run the enabled rules immediately. The latest results show which
worktrees were removed or kept and why, plus any failures.

Browser captures and rotated logs have separate retention periods. Expired capture links stop
working. Current logs, message attachments, and browser profiles are kept.

## Project icons

Select the project and open Project to choose an icon, emoji, monogram, or image. The choice applies to
every checkout in the project group and appears on connected clients. Choose **Automatic** to let
T3 Code detect an icon again.

Choose **Monogram** in the icon picker to set one or two letters or numbers and a color.

When no image is found, web and desktop show a two-character monogram with a color
from the icon palette, derived from the saved project name. For example, `Nebula` becomes `NA`,
`Silver Orchard` becomes `SO`, and `M7 Forge` becomes `M7`.

## Keep the default branch current

In Source Control, enable **Automatically pull** to keep the default-branch checkout up to date
with its configured upstream. Choose an environment to set the default or a project to override it.
On mobile, use **Settings → Source control** to change selected environment defaults or project overrides.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.

## Repeatable project initialization

A project's setup action can install dependencies, initialize its development database
and load sample data in one command. Store that command in `t3.json` with
`runOnWorktreeCreate: true` and `async: false`, then import the action in the project's
Actions settings. Initialization finishes before the agent starts, and its progress and
failures appear in the conversation. Setup runs for new launches in an existing checkout
as well as for new worktrees, so make the command safe to repeat and preserve existing data.

Keep a reset command as an ordinary project action for restoring known test data.
Choose the isolated development instance explicitly; resetting fixtures should never
reset an instance that holds real application data.
