# Projects and starting work

A project keeps a shared brief, repositories, links and conversations. Its files
can live on several computers. Removing a working copy does not delete the project or
its saved conversations.

## Start with what you have

Open **New conversation** and search for a project, paste a repository URL, or enter a
folder path. Repository matches offer existing projects before creating another one.
Folder paths open the computer and folder chooser; the path belongs to the computer you
choose, which may be remote. With search empty, **No project** comes first, then recent
projects. **No project** starts right away on the computer you are working on, or on another
connected computer that can run work.

To make a project without starting a conversation, open **New project** and choose **Empty
project**, **Existing folder** or **Git repository**, or type a name, folder path or Git URL. A
project from a Git URL continues into choosing the computer and folder for its working copy.
Once the files are ready, open the project or choose to start a conversation separately.
If file preparation fails, the project stays saved so you can finish preparing it later.

Review repository access on the selected computer. Use its configured Git credentials,
or choose a dedicated Vault GitHub connection for a matching repository. Vault selection
keeps the reviewed connection and version; it never falls back to another account. If
access fails before any files are created, **Change setup** lets you review another
connection or destination after checking and cancelling the previous preparation.

You can also ask an authorized agent to add an existing folder to Projects. Loom inspects
its repositories and registers its files together, reusing a unique matching project.
If more than one project matches, the agent can choose the intended project by name.
Projects created from a folder, a Git clone, or a new name are saved through the connected
Library automatically. If sharing is temporarily unavailable, the project and its settings
remain usable on that computer, and Projects keeps the failed operation for recovery.

Projects live in your Library. On a device that is not connected to one yet, **New project**
opens **Connect your Library** first and continues once you choose it, and **New conversation**
lists **Connect your Library** after **No project**. For a Library this device has never
reached, open **Sign in to a Library address** in that dialog and enter its web address.

Continue through the same searchable popup to choose files, computer and conversation
settings. The final preview explains what will start. The **+** on an existing thread
keeps its settings as the starting point for the next conversation.

A project can contain several repositories under one root, such as separate web and
mobile applications. Adding an existing folder keeps its files in place. Loom records
that it is a borrowed folder and will only forget it, never delete it.

New copies follow each repository's current default branch. To use a specific branch,
open the project's **Files** view, edit the repository and set **Branch override**.
Clear the override to follow the repository default again. Existing working copies keep
their checked-out branches; saved conversations retain their project version and history.

A folder on a computer belongs to one project at a time. If it already belongs to another
project, add it to that project instead. A folder whose project is archived or no longer in
your Library can move to a new one; the old project's conversations stay where they were.
A folder holding files Loom created for another project moves only after you review and
remove those files from that project, restoring it first if it is archived. If that project
is no longer in your Library, choose another folder.
Loom checks which project owns a folder with your Library, so adding one needs the Library
connected.

## Change settings from a conversation

Ask your agent to change project settings, such as its model, worktree defaults or tools.
An authorized agent can read the current values and change the fields you requested.
Browser, device and Tools for agents changes apply to the current conversation. An
explicitly disabled tool stays disabled until you authorize changing that preference.

Folders that have not been added to shared Projects also have **Settings** in Projects.
You do not need to add a folder to your Library to configure the agents working in it.

## See what needs attention

The project overview ranks pending decisions, failed runs, local changes, unpublished
commits and running work, then offers your most recent unfinished conversation. Each
entry shows when it was observed. Saved observations are not a live connection check.
Use **Files** to refresh a connected computer and its remotes.

## Understand project dependencies

The project's **Ecosystem** shows the other projects it depends on and which projects
use it. Declare dependencies by selecting existing projects from the same Library.
Each project keeps its own repositories and releases; a dependency does not grant access
or start work. Archived dependencies stay visible.

Registered services come from Sites links for the project and its dependencies. Their
endpoint and last observed health help identify the affected service. An old or unavailable
observation cannot confirm that a service is working or that its sign-in is ready.

## Group a larger goal

Open a project's **Workstreams** to group conversations, copies, repositories, branches,
pull requests and checks around an outcome. Workstreams are optional. Review linked
items and record their progress before completing the workstream. Completion refuses
unfinished references, running linked conversations and linked copies whose changes or
remote preservation still need review. A completed workstream can be reopened or archived.

Branch, pull-request and verification states are recorded observations. Marking a check
passed does not run tests or independently verify an upstream merge. The linked evidence
and the time of the observation remain part of your review.

## Carry setup to another project or computer

In **Preferences**, export a project blueprint. You can save the downloaded JSON as
`.loom/project.json` in your repository and import it when creating a project, or apply
it to an existing project's shared details. Mobile supports sharing and pasting JSON.
Review the repository layout, tools, scripts and named connections before importing.
Importing does not execute scripts or prepare files.

Blueprints carry the brief, relative repository layout and shared setup. Computer and
provider selections stay local. Connection names describe requirements; credentials
remain in Vault and are not exported. Applying a blueprint preserves existing working
copies and the project versions already selected by conversations. Choose or prepare
files for the new project version before starting new work.

## Recover an interrupted operation

Creation, file preparation, recovery, conversation launch and file removal are recorded
as operations on the computer doing the work. Closing the window does not cancel them.
Open **Files** to see progress or resume a failed operation. After an app restart, Loom
resumes pending work only while its original session or agent run remains authorized.
Sign in again and explicitly resume when authorization has expired. Reopening the new-project
form or restoring access keeps the saved request without submitting it automatically. Restore operations require a
fresh recovery authorization from **Start**; that credential is not stored in history.

Cancellation keeps completed steps. A filesystem step already in progress must finish
before cancellation. Retrying the same operation preserves its identity, so a lost
response does not create a second conversation or project.

## Preserve before reclaiming space

Open **Preservation and cleanup** from Projects or a project's Files view to review
copies across projects. Connect the computer that owns the files and check its files
and remotes. Save a recovery archive when local-only files or history need preservation.
A repository URL alone is not proof that ignored files, stashes, other branches or local
history are safe.

**Review file removal** opens the existing detailed blockers and exact removal preview.
Nothing is removed by opening the center or refreshing observations. A final removal
rechecks the reviewed files and refuses changes that invalidate the review. Existing
borrowed folders can only be forgotten. Released managed copies can be restored through
Start from their saved recovery archive or prepared again from their repositories.

These workflows require updated Library and execution computers. Older computers retain
their existing Start flow; connect an updated computer to see durable operation history.

## Deleted conversations

Open **Recently deleted** in a project's Conversations view or the saved-conversation list to
read a deleted conversation. **Continue in a new conversation** starts a linked continuation;
it does not reopen the deleted thread. These controls require an updated Library.

The Library keeps deleted conversations for 30 days by default. The owner can change
**Erase deleted conversations after** in Settings → Computers → Library. **Erase now** permanently removes
the saved conversation and attachments that no remaining conversation uses. If storage cleanup
fails, retry the action to finish it. Independently published pages keep their own lifecycle.

Deleting a conversation removes its attachment files right away. After a day the computer
also removes its history and keeps only the record that it was deleted. For a conversation
saved to the Library, both wait until the Library has recorded the deletion, so the Library's
copy keeps its attachments. On a computer that is not connected to its Library, such a
conversation's files are removed shortly after deletion and its history waits. A conversation
exported to the Library from a computer that has not been activated yet keeps its history until
activation, so the Library still learns of the deletion.

History that a remaining conversation still shares, such as the source of a fork, stays
until that conversation is deleted too. An older database keeps the freed space on disk
until its one-time repair; see
[Reclaim database space](../../user/background-service.md#reclaim-database-space).

## Delegate to another computer

A Library conversation delegates within its pinned project and component scope. Prepare a copy on the destination computer and link the environments first. Loom checks that copy's repository origin and required tools before starting work. If several copies match, choose the exact destination project ID. An explicit computer or copy stays selected; Loom refuses an unavailable choice instead of substituting another.

Remote tasks keep their result and a link to the destination conversation in their receipt. Cancellation and result following use the environment link and recover across restarts. Credentials and local attachments do not travel with the task.
