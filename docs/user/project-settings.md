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
the server-setting pages, such as Threads, Source control and Worktrees, edit the selected
environments' defaults. Choosing a project edits its overrides on the selected
environments. Use **Use defaults** in a page to remove that page's project overrides.
Open **Settings → Computer folders** to rename the project across its selected
connected checkouts, see where they live, and review each checkout's storage preference.
Settings that are environment-wide stay read-only while a project is selected. When selected
targets disagree, a control shows **Mixed** until you choose one value. Appearance, keyboard,
and other phone-only settings ignore the filter.

<!-- fork: library-projects -->

## Projects and files

Shared projects keep their brief, components and saved conversation history independently
of their execution computers. Configure the Library connection in **Settings → Computers**.
If that server has Identity configured, **Sign in with Identity** opens its account sign-in.
You can enter a Library address on web, desktop, or mobile before saving its connection.
Sign-in opens your browser and returns to Loom after verification. Each Identity sign-in
lasts up to an hour, and the desktop and iPhone apps renew it on their own when the Library
sets a sign-in limit; otherwise, sign in again when it expires. Existing pairing and T3
Connect remain available. Changing your Library selection does not move records from the
previous Library.

**New project** asks how to start. **Empty project** needs only a name, and **Git
repository** clones a Git URL onto the computer and folder you choose once the project exists.
Add repositories, reference links or a brief whenever useful. **Existing folder**, also
**Add existing folder** in the command palette, finds repositories in a folder and suggests an
existing project when the repository origins and layout match. This leaves your files in place.
When you browse to a folder, Loom says what adding it will do, such as joining a matching
project or creating a new one, and Enter does exactly that. If adding a folder does not
finish, Add existing folder offers to retry it or start over, and you can still browse to a
different folder instead.
A folder that already belongs to a current project is added to that project instead of a
new one. A folder held by an archived project moves to the new project, and the archived
project's conversations stay in the archive. Files Loom created for an archived project stay
with it until you restore that project and remove them.
The Projects page lists each computer folder still waiting to be added, so you can work
through existing projects without losing your place.

**New conversation** lists your projects, with the project you are in first. A project that
can start right away shows the computer, model and permissions it will use, and New worktree
when it will start in one. Press Enter, or
tap it on iPhone, to start with them, or open its options first (Right Arrow on a keyboard)
to change them. A project that needs a choice opens its options instead. Loom chooses an
available computer and prepares its files automatically, and you can choose another computer
or work on one repository. On an up-to-date computer the conversation opens right away and shows
its files downloading there; you can send your first message before they finish, and it starts
once they arrive. If a start gets stuck, **Start over** drops that attempt and keeps
its model, permissions and folder; a conversation it already created stays in your list.
A title you type is kept after the first message; without one, the first message names the
conversation. If you leave a conversation you just started without sending anything, Loom
offers **Discard empty conversation**, unless it holds something you shared to Loom from another
app. You can undo it from the notice that follows; on iPhone, choose **Keep** to leave it in your
list instead.
Conversations share the project's folder unless you choose **Workspace → New worktree** before
starting, which gives the conversation a branch and folder of its own so other conversations'
changes stay apart. Loom picks New worktree while another conversation is working in the folder.
A new worktree needs a project with one repository, or one repository chosen to work on.
**Remove files** stays unavailable until worktrees made from the files are landed or removed.
Continuing on another computer brings a worktree's commits; its uncommitted changes stay behind.
The conversation uses your chosen model, then any computer folder override, the project's
preference, the model you used last on this device if that computer can run it, and the
computer's default. Editing the brief applies to new conversations; earlier conversations keep
their original context.

T3's folder records are the computer locations of these projects. Adding an existing folder
reuses its folder record and settings. Once added, **Project settings** from a thread opens
that shared project's preferences. Use **Files → Computer details → Computer folder settings**
for local actions and overrides. Folders not yet added offer **Add folder to Projects** in their
settings, with the existing location filled in.

Conversations in an added existing folder save to your Library automatically once they have a
message, including ones in worktrees, and keep running where they started. Conversations from
before the folder was added catch up one at a time in the background; until a conversation's
history reaches the Library, its header shows **Not saved to Library yet**. **Stop using this
folder** or archiving the project stops saving; adding the folder again resumes it.

If you rename or move a folder yourself, choose **Update folder location** from
its working files or computer folder settings and enter its current path on that
computer. Loom keeps the same project and conversations. This updates the saved
location without moving files. Folders managed by Loom use their existing file
recovery controls instead.

Use **Files** in the project to manage its repositories, links and files on computers.
**Keep files on this computer** leaves files available. With Keep off, Loom can free space
after all related conversations are finished and saved. Active work, unpublished commits
and unsaved changes prevent automatic cleanup. Existing folders stay kept until you
explicitly allow Loom to manage them.

**Temporary resources** shows build and scratch space used by these files, including
resources shared by conversations. Keep preserves your working files; temporary resources
are cleaned up separately after work and finish actions complete. Advanced controls stay
in the computer's storage settings.

**Remove files** saves and verifies a recovery archive before freeing space. Your project
and conversations stay available. **Restore files** brings the saved contents back to the
same computer and keeps them there. Starting another conversation or resuming work also restores
files automatically and preserves your Keep choice. Reading saved history does not download files.
To continue on another computer, choose that computer when starting a conversation. Loom uses
its existing files or brings over the saved project files, including local-only files and
unpushed commits. When the original files are still present, their computer must be connected
and its work finished so Loom can save the current contents first. Files already saved and
removed can be restored while their original computer is offline. If different locations have
different files, Loom asks which to use and preserves the other locations.

Recovery uses a verified archive in your Library. The destination computer and Library must
be connected to restore files on another computer. Reading saved history does not require
restoring files.

Computer details show repository changes and optional tools. When a repository is behind
and has no local changes, **Pull** updates it. Offline computers show their last reported
state and when it was checked.

The command palette reaches projects from anywhere. Type part of a project's name to open it,
or use **Go to project...** and **Open project brief...** to pick one, most recently active
first. **New conversation in...** opens the New conversation project list. In a thread that
belongs to a project, **Go to this thread's project** opens it, even when that thread's
computer is offline. Press `Cmd/Ctrl+Alt+P` for **Go to project** and `Cmd/Ctrl+Alt+Shift+N`
for **New conversation in**. To change them, rebind `loom.library.goToProject` or
`loom.library.newConversationIn` in **Settings → Keybindings**.

**Preferences** on the project page records how work gets going on any computer, and it is saved
with the brief. **Use this copy's scripts** brings in the scripts a working copy's local
project already has. Required tools are picked from a fixed list, with an optional minimum
version, so a setup never asks a computer to run an arbitrary command. Secret names list the
environment variables a computer must provide, such as `GITHUB_TOKEN`. Save only the name:
each computer keeps its own value. A new entry that looks like a token, password or random
key is refused, and the message names which entry to fix; entries saved earlier are kept. You
can also mark preferred computers and allow Mini jobs. On mobile, edit the setup from the
project's **Edit project** screen. Setup appears once your Library supports it. Agents can edit it
through `loom_library_project_update`.

When a computer gets or reuses a copy, the setup's scripts and default model fill in only the
settings its local projects leave empty. Settings someone already chose on that computer are
never replaced on their own: the copy lists where they differ from the setup, and **Use the
project setup** replaces exactly the differences shown. If they change before you choose, the
copy asks you to review them again. Each ready copy, and New conversation when it offers to
get a copy, also checks the required tools on that computer, showing each tool's version, a tool that is missing, or one
older than the minimum. A check that fails shows the tool as not checked rather than ready. The
secret names are listed as a reminder; their values are never read. Agents can run the same
check with `loom_library_profile_readiness`. Computers on an older version show neither.

New conversation also uses those checks to choose a computer. A computer that is missing a
required tool, or has one older than the minimum, is listed after the ready ones with the
problem beside its name, for example "Go 1.21 (needs 1.24)", and is never chosen for you. A
computer whose tools could not be checked keeps its usual place. When the setup allows Mini
jobs and a Mini worker registered on the chosen computer is ready with every required tool,
the dialog names it under the computer. The conversation still starts on the computer; its
agent can send long builds and tests to that worker. Agents can ask the Library for the same
ranking with `loom_library_launch_candidates`, which uses the copies and computers the Library
knows about and leaves tool checks to `loom_library_profile_readiness`.

**Timeline** on the project page lists what happened on the project from every computer,
including offline ones: conversations started, settled, failed or archived, pull requests
opened, merged, closed or failing checks, brief revisions and copies coming and going. It also
shows new commits in each copy, and scheduled runs and Mini jobs that finished in one, with their
title, result and a short summary, never the prompt or command. A computer sends runs and jobs
when it next reaches the Library, so they stay listed after it goes offline. A commit count
appears when the computer could count from the last head it reported; after a force push or a
restart the entry says only where the branch moved. Use the chips to show only some kinds, and
scroll to read further back. Selecting a conversation opens
the live thread when its computer is connected and the saved conversation otherwise; a pull
request opens in your browser. Entries marked **estimated time** were rebuilt from records saved
before the Library kept a timeline. A Library that does not keep a timeline yet shows a shorter
**History** of copies instead. Agents can read the timeline through `loom_library_timeline`.

<!-- fork: library-projects -->

Search finds what was said in saved conversations from every computer, including offline
ones. The search field on the Projects page looks through every project, and the one on a
project page looks through that project only. Each result shows the matching words with the
project, the computer and when it was said. Selecting a result opens the saved conversation
at that message and highlights it. Archived conversations are included and marked. In the
command palette, **Search project history...** jumps to the search field for the project you
have open, or for every project. Search appears once your Library supports it. Agents can
search the same history through `loom_library_search` from a computer connected to the Library.

<!-- fork: library-projects -->

Agents can list your Library projects with `loom_library_projects` and page through saved
conversations with `loom_library_conversations`, optionally filtered by project. These reads
use the computer's enrolled Library connection and need an up-to-date Library. Agents can
start work in a registered copy with `t3_thread_launch` using the project root. Loom links the
new conversation to that copy before its first turn. A bound agent's batch conversations and
shared delegated tasks keep its Library scope. Library conversations cannot move to separate
worktrees; start in the copy's folder instead. `loom_library_bound_project` returns both the
pinned project brief and its copy binding, including when the Library is offline.

When your Library is set up for semantic search, results also include messages that are close
in meaning to your words without using them, marked **Similar meaning**. Put a phrase in quotes
to match exact words only. The model runs on the Library server itself, so your history is not
sent anywhere else to be searched.

Agents can suggest changes to the brief, but only you can accept them. When suggestions are
waiting, the brief shows **N suggested updates**. Open it to see each suggestion's reason and
what it would change in the brief as it reads now. **Accept** saves it as the new brief,
**Edit, then accept** lets you adjust the text first, and **Dismiss** drops it. If the brief
changed after an agent made its suggestion, Loom says so and asks before replacing the newer
text. Accepted changes apply to new conversations. To ask for suggestions, open a settled
conversation from its project and choose **Suggest brief updates**. Its computer must be
connected; the agent receives a short follow-up asking it to review what changed. Suggestions
appear once your Library supports them.

To have Loom ask on its own, set **Suggest brief updates when a conversation settles** in the
project's **Setup**. **Off**, the default, waits for you to ask. **Ask first** puts an offer on
each settled conversation's Library page; choose **Suggest updates** to run it or **Not now**
to drop it. **Automatic** runs as soon as a conversation settles. Either way a separate
background conversation reads the settled one with its model, on the computer where it settled,
and makes at most one suggestion for you to review. Your conversation is left as it was. Each
computer runs at most 3 a day for a project; later settles are skipped, and the conversation's
page says so. The setting appears once your Library supports it, and that computer needs the
same update to run suggestions.

A conversation stays on its original computer. **Continue elsewhere** creates a linked
conversation with a fresh agent session and the context you choose to carry forward.
Removing project files preserves the project and saved conversations. Active work prevents
removal. A project does not need to stay on any computer.

A project rests on its own after two weeks without a conversation or an edit, and its next
conversation brings it back. Resting projects show a **Tidy** chip on the Projects page. Tidy
lists which copies are safe to remove, meaning their computer is connected and nothing is
uncommitted or unpushed, and which need attention and why. One confirmation removes the safe
copies, checking each one again just before removing it, and can also archive the project.
Archive is for work you have finished or set aside: an archived project leaves the project
pickers, its conversations stay readable, and you can restore it any time from **Archived**.

On mobile, a project page shows the same copy states and required-tool checks, its latest
entries under **Lately** with **Full timeline** for the rest, and waiting brief suggestions in
its Brief section. **Search conversation history** on the Projects page and **Search this
project's history** on a project page search saved conversations. Resting projects are listed
under **Resting** on the Projects page; select one to tidy it up. New conversation chooses a
computer the same way, but mobile does not name Mini workers.

Ask an agent to search your Library's recorded decisions or catalogued ideas when you need
the reasoning behind a project choice. Results identify the repository, file, heading, date
and status. Superseded records are hidden unless you ask for them. The Library reads the
repository's committed default branch, so uncommitted notes and other branches do not appear.

Saved projects and conversation history remain readable when a computer is offline.
Conversation history shows when it was last saved to the Library; work that has not uploaded
may be missing. Very long conversations upload less often in the background. Open saved
attachments from the Library, and use **Save pending history** to upload newer work now. A
conversation too large for this computer's upload storage keeps waiting, and **Save pending
history** says so.
<!-- fork: library-projects -->

A disconnected Library keeps its selected identity. You can start a conversation from a ready,
registered copy on a connected computer; its history syncs when the Library reconnects.
Creating or registering copies, restoring files, changing retention, and editing projects still
require the Library connection. Loom never silently switches to another Library server.

<!-- fork: project-home -->

## Computer folders and earlier work

The thread list keeps existing work on connected computers accessible. Its project filter
narrows that list without opening a separate project catalog.

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

In **Settings → Worktrees → Worktree branch naming**, choose a static prefix,
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

Deleting a thread also deletes tasks that post into that thread. Tasks that start
a new thread on each run survive deletion of their previous threads.

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

Each value reaches the agent wrapped in `<webhook-data-…>` tags and marked as
untrusted request data. This helps the agent tell it apart from your
instructions, but it doesn't guarantee the agent ignores what the text says.
Inside a value, every `$`, other currency sign and `@`, and a `/` that starts
a lone word, gets an invisible character after it, so mentions like `$skill`,
`@file` and `/command` don't act. Text copied from a value, such as an email
address or a command, carries that character too. Without a signature, anyone
with the URL can start a run with any content. A signature only proves which
service sent the request: a GitHub payload still carries text written by any
GitHub user.

For GitHub, turn on **Require signature**, keep the header
`x-hub-signature-256`, hex encoding and the `sha256=` prefix, and enter the
same secret in the repository's webhook settings with content type
`application/json`. Requests without a valid signature are rejected. Set this
up on desktop or web; mobile keeps an existing signature check but can't turn
one on.

To run only for some requests, add **Filters**. Each one tests a value named
like a placeholder, without the braces, such as `headers.x-github-event` equals
`pull_request` or `body.action` is one of `opened, reopened`. A task runs only
when every filter matches; other requests are answered normally, logged as
**Filtered** with the first filter that failed, and start nothing. Values
compare as text, and a value that is an object or a list only passes
**exists**. Separate **is one of** values with commas; a value can't contain
a comma or start or end with a space.

To suppress repeated deliveries, set a **Replay key** template, such as
`{{headers.delivery-id}}`. The same key is ignored for seven days per task.
To combine a burst, set a **Coalesce key**, such as `{{body.id}}`, and a window
of 10–3600 seconds (120 by default). One run uses the latest body, headers,
and query when the window from the first delivery closes; later requests
do not extend it. Pending windows survive a server restart. Keys must contain
request placeholders; if any placeholder is missing, or the render is empty,
that key's rule is skipped. Clear the templates to turn dedupe off.

Duplicate and coalesced log entries share a limit of 10 per task per minute.
Additional deliveries are accepted without a log entry, and coalesced deliveries
always replace the persisted payload. Coalesced updates count toward a separate
60-per-minute validation limit; exceeding it receives HTTP 429.

On desktop and web, pick **Deliveries** from a task's menu to see recent
requests and the prompt each one produced.

If the environment is offline, the sender gets an error and nothing runs;
redeliver from the sender, such as GitHub's **Recent Deliveries**, once it is
back. To have T3 Connect keep requests instead, turn on **Hold webhooks while
offline** in **Settings → Sharing & access**. T3 Connect then stores requests to a
T3 Connect URL for up to 24 hours and delivers them when the environment
returns. Leave it off if you don't want request bodies stored outside your
machine. To skip requests that waited too long, set **Skip requests older
than** on the task.

## Defaults and inheritance

Threads contains the model and workspace for new threads. Browser controls agent browser
access. Source control contains automatic pull, the default pull request merge method and text
generation. The same rows edit environment defaults or project overrides depending on the
project crumb.

The Projects category, under Code, is always available. Browse projects or review their storage
there, or choose a project in the scope picker to manage its name, icon, actions, checkouts and
removal. Actions belong to a project: editing them creates the project's own list
on each selected environment, and reset returns to the environment's shared list. A project's
`t3.json` actions can be imported there.

Settings a repository can also declare in `t3.json`, such as the workspace for new threads,
resolve in one order: a project override, then the environment setting, then `t3.json`, then the
built-in default. Leave a setting on **Inherit** to let the next tier decide.
Browser access changes apply when an agent session next starts.

New worktrees initialize git submodules recursively. If that step is slow because the repository
declares many nested submodules, set **Submodules** in **Settings → Worktrees** under Advanced (with the project
selected to override it there) to **Top level only** to stop at the ones the repository declares
itself, or **Skip** to leave them for a setup script. It resolves in the same order as the
workspace default: a `"worktreeSubmodules"` value in the `t3.json` of the branch being checked out
applies when the project and environment are both on **Inherit**.

## Worktree location

New worktrees go in the `worktrees` folder of the T3 home directory. To put them somewhere else,
such as another drive, select **Choose** beside **Settings → Worktrees → Worktree location** and <!-- fork: path-picker -->
pick a folder in that machine's folder browser, or type a path like `D:\worktrees` or <!-- fork: path-picker -->
`~/worktrees` in its search. The setting is per machine. Existing worktrees stay where they <!-- fork: path-picker -->
are, and cleanup covers both the default folder and the custom one.

<!-- fork: file-placement -->

New projects and prepared Library files go in **Settings → Threads → Projects folder** on the
chosen computer, which reuses a checkout of the same repository it already has there. Select
**Choose** to pick the folder in that computer's folder browser, or type a path in its search.
When Settings covers several computers, select one first.

## Storage cleanup

<!-- fork: retention-defaults -->

Open **Settings → Worktrees → Cleanup** for worktree policies and **Settings → Maintenance** for
browser captures and logs, on one machine or all connected environments. Loom deletes browser
captures after 14 days unless you choose another period or Off. **Delete landed worktrees and branches** is
also on; other policies are off by default. <!-- fork: project-lifecycle -->
Policies run on the server at startup, when changed, and hourly. Offline machines keep their
existing policies.

Select a project to set **Automatic worktree cleanup** to **Inherit**, **Off**, or **Custom**.
Inherit follows each machine's rules; Off keeps that project's worktrees until you remove them
manually. Custom applies separate worktree rules to the selected project or checkout. Browser
captures and log retention remain machine-wide.

Worktrees can be removed after a chosen number of inactive days, after a thread settles, after
merging, or when they have no commits beyond the default branch. Set settled retention to 0 days
to remove a worktree at the next cleanup after settlement. Only T3-managed worktrees are eligible.
Active sessions prevent removal. <!-- fork: project-lifecycle -->
Other rules keep a worktree that several threads share. **Release settled worktrees once pushed** removes it
once every thread using it is settled, and **Delete landed worktrees and branches** once each is settled or
archived. A thread and its subagents count as one. **Keep worktrees with local changes** defaults
to **Uncommitted changes**, which protects tracked edits and untracked files but deletes ignored
files such as `.env` and build output. **Any local files** also protects ignored files other than
`node_modules`. **Edited tracked files** protects only tracked edits and allows untracked and
ignored files to be deleted. Branches and thread history stay, except for the landed rule below; <!-- fork: project-lifecycle -->
starting another turn recreates the checkout.
Merge cleanup requires a merged pull request whose commits are included in the remote default
branch. A squash or rebase merge on GitHub also counts when the pull request targeted the default
branch and the worktree is still at the pull request's last commit.

Enable **Release settled worktrees once pushed** to reclaim a managed checkout after its last active thread
settles. The server waits for settlement actions, open terminals and provider sessions. It fetches
the branch's upstream and keeps the checkout if its current commits are unpublished. This rule
always protects local files, including ignored data other than `node_modules`, regardless of the
local-change setting above. This rule keeps the project's main checkout. Continuing a released
conversation recreates its worktree checkout and waits for workspace setup before starting the agent.
Failed setup keeps the checkout and retries when you continue again, including after a restart.

<!-- fork: project-lifecycle -->

**Delete landed worktrees and branches** is on by default. Once a managed worktree's commits are in the remote
default branch and every thread using it is settled or archived, cleanup removes the worktree and
deletes its local branch. It uses the default branch as of your last fetch, pull or push and never
fetches by itself. It keeps worktrees with uncommitted changes, untracked files, ignored files
such as `.env` (dependencies and build output excepted), open terminals, or other programs using
the folder. The branch stays if it moved since the check, is the default branch, another checkout
uses it, or a conversation's latest checkpoint is missing or older than the branch. Continuing a
conversation recreates the branch from its latest checkpoint. Turn the rule off in
**Settings → Worktrees → Cleanup**, or for one project with **Off** or **Custom**.

Enable **Release settled project checkouts** or **Release inactive project checkouts**
to set this computer's defaults for managed primary project folders. Every conversation must
be settled for the settlement rule; inactivity uses the most recent conversation activity.
Folders opened manually and older clones stay on disk until you explicitly review and let
Loom manage them. Enabling cleanup does not adopt existing folders.

To manage an existing folder, review its working copy in Project home, or select the project
and open **Settings → Projects → Working files** on web or desktop,
or **Settings → Computer folders** on mobile. Review the folder
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
on web and desktop and **Settings → Files on computers** on iPhone, to
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
<!-- fork: project-lifecycle -->

Results also list folders in the worktree folder that no thread uses, with their sizes.
Choose **Remove** for a clean orphan worktree. Loom checks again for local files,
open programs and conversation ownership before removing it; its branch and commits stay saved.
For work held by a conversation, use **Open conversation** or **Settle** to finish it.

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

In Source control, enable **Automatically pull** to keep the default-branch checkout up to date
with its configured upstream. Choose an environment to set the default or a project to override it.
On mobile, use **Settings → Source control** to change selected environment defaults or project overrides.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.

<!-- fork: project-lifecycle -->

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

<!-- fork: sites -->

## Sites and the personal API

Open **Sites** from the sidebar or command palette to see registered websites,
whether they are up, and the visits they receive. On mobile, open **Sites and
activity** from Projects. Sites uses your chosen Library server independently of
the computer running your work. Results do not refresh while the page stays
open: choose **Updated** beside the summary, on Sites or on a site's page, to
read them again. Results older than the server's freshness window show as out of
date, and checks that have not run yet show as not checked; neither counts as
healthy.

To see a site on web or desktop, open it and choose **Preview**. The site runs
live inside Loom at desktop, tablet, or phone width. Type a page into the
address bar or choose one from **Pages**; the Traffic tab and project pages can
also open a page there. Each preview load counts as a visit in the site's
traffic. Some sites refuse to be shown inside other apps and leave the preview
blank, so use **Open in new tab** for those. After you follow a link inside the
preview, **Reload** and **Open in new tab** still go to the page you typed. To
show live front pages on the Sites cards, turn on **Display** > **Live
previews**. It is off by default because every card's load counts as a visit
too.

Register and edit sites directly in Loom. Each site belongs to at least one
Library project; project pages link back to their sites. Register shared
services on the **Services** tab, link them to sites, and add HTTPS endpoint
checks. Pause a site, service, or check from its menu to stop its checks without
deleting its history, and resume it the same way or from the notice on a paused
site's page. Each pause or resume offers **Undo**. **Run all checks** runs every
check in the Library, even from one site's page. Management needs a manager
connection configured on your Library server and permission to change its
settings.

Agents use `loom_sites`, `loom_site_analytics`, `loom_site_save`,
`loom_site_service_save`, `loom_site_check_save`, and `loom_site_checks_run`.
The same operations are available from a configured terminal through
`t3 sites list`, `analytics`, `save`, `save-service`, `save-check`, and `run-checks`.
Pass a JSON object matching the corresponding MCP tool. Saves replace the entry's
settings, so include its project, origin, and service selections.
Use the agent terminal's MCP connection or set `LOOM_MCP_ENDPOINT` and
`LOOM_MCP_AUTHORIZATION` privately. Management tools require full access.

Sites reads the personal API through your Library server, using client
credentials set in that server's environment. Set `LOOM_IDENTITY_ISSUER`,
`LOOM_SITES_CLIENT_ID`, and `LOOM_SITES_CLIENT_SECRET` to connect it, and
`LOOM_SITES_API_ORIGIN` only for an API other than `https://api.begam.in`. Both
addresses must be HTTPS origins. To manage sites from Loom, also set
`LOOM_SITES_MANAGER_CLIENT_ID` and `LOOM_SITES_MANAGER_CLIENT_SECRET` for a
separate client. Restart the server after changing them.

The personal API catalog at `https://api.begam.in/v1/public/catalog` lists
capabilities available to other projects. Public reads work across origins;
private data and administration keep their own access requirements.
