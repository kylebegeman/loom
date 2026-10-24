# Projects and starting work

A Library project keeps a shared brief, repositories, links and conversations. Its files
can live on several computers. Removing a working copy does not delete the project or
its saved conversations.

## Start with what you have

Open **New conversation** and search for a project, paste a repository URL, or enter a
folder path. Repository matches offer existing projects before creating another one.
Folder paths open the computer and folder chooser; the path belongs to the computer you
choose, which may be remote. With search empty, **No project** comes first, then recent
projects. **No project** starts right away on the computer you are working on, or on another
connected computer that can run work.

Continue through the same searchable popup to choose files, computer and conversation
settings. The final preview explains what will start. The **+** on an existing thread
keeps its settings as the starting point for the next conversation.

A project can contain several repositories under one root, such as separate web and
mobile applications. Adding an existing folder keeps its files in place. Loom records
that it is a borrowed folder and will only forget it, never delete it.

## See what needs attention

The project overview ranks pending decisions, failed runs, local changes, unpublished
commits and running work, then offers your most recent unfinished conversation. Each
entry shows when it was observed. Saved observations are not a live connection check.
Use **Files** to refresh a connected computer and its remotes.

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
Sign in again and resume when authorization has expired. Restore operations require a
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
