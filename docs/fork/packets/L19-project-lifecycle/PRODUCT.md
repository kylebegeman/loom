# L19 product

## Problem

Kyle treats local checkouts as a cache: clone into `~/Developer/active/<name>` when work
starts, push everything, and remove the folder when done
(`~/Developer/docs/workflow/ephemeral-checkouts.md`). Today that is `git clone` by hand, the
`dev-park` shell script to remove a checkout, and remembering which repositories exist. The
dangerous step is parking: a local-only branch, a stash, a `.env` or a local database can
disappear with the folder. Loom already runs on the machine that holds the checkouts and
already knows the projects, so it is the natural place to see the whole picture and to park
safely.

## What the user can do

- Open Repositories from the sidebar footer (a Repositories icon next to Pull Requests), the
  command palette, a shortcut, or Loom settings.
- Pick which environment (machine) to look at. The page says which machine it is showing.
- See every GitHub repository the environment's `gh` account can access, marked Cloned,
  Not cloned or Parked, plus clones that are not on GitHub ("Local only").
- Search by name and filter by All, Cloned, Not cloned, Parked.
- Clone a repository into the clone location as a Loom project. The clone location is
  upstream's "Add project starts in" folder (Settings, General) when set, otherwise
  `~/Developer/active`; the page shows which folder is in use and where it comes from.
  Progress shows in upstream's clone toast; the destination is editable before cloning (for
  nested products).
- Adopt a clone that is not a project yet.
- Open the project for a cloned repository.
- Park a checkout:
  1. Loom checks it and shows a report.
  2. Anything that would be lost blocks parking, with the reason and how to fix it.
  3. Branches and tags that are not on GitHub get a "Push all branches and tags" button,
     after which the report refreshes.
  4. Ignored files are sorted into "Safe to lose" (build output), "Keep" (`.env` files,
     local databases, keys, recordings) and "Review" (anything else). The dialog lists every
     Keep file by path. Keep files never block parking, but Park stays disabled until the
     "I have these elsewhere" box is ticked. Review files need only the general
     acknowledgement. Loom never copies `.env` files or any other Keep file anywhere.
  5. The project's threads can be archived at the same time (on by default).
  6. "Move to Trash" moves the folder, and any clean linked worktrees, to the Trash on that
     machine. The project stays in Loom.
- Reopen a parked repository: Loom clones it back to the same path. When the project still
  exists it keeps its threads (and can unarchive them); otherwise a new project is created.
- Forget a parked record (the reverse of the record; the Trash is untouched).
- Add extra "safe to lose" or "keep" patterns per environment in Settings, Loom,
  Repositories. The section shows the clone location in use with a link to Settings, General
  to change it.

## Entry points

| Entry                 | What it does                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar footer        | Repositories icon (tooltip "Repositories") next to Pull Requests, shown when any connected environment supports the feature.                    |
| Command palette       | "Open Repositories"; "Park this project" (active thread's project); "Reopen a parked repository".                                               |
| Keybinding            | `loom.project-lifecycle.open`, unbound by default; handled by the fork keydown listener, never written into `keybindings.json`.                 |
| Page                  | `/loom/repositories`, optional search params `environmentId`, `filter`, `park=<projectId>`.                                                     |
| Loom settings         | "Repositories" section: clone location in use (read only, with a link to Settings, General), extra patterns, and an "Open Repositories" button. |
| Upstream clone toast  | Shows clone and reopen progress with cancel and retry (upstream behavior, no fork code).                                                        |
| Upstream Archive page | Threads archived by Park appear there and can be unarchived individually (upstream behavior).                                                   |

Ways out and ways to see state: Park has Reopen; a parked record has Forget; archived
threads have upstream's unarchive and Reopen's "Unarchive threads" choice; a clone has
upstream's cancel. The Parked filter shows every parked record with its date, old path and
where it went in the Trash (when known).

There is no project context-menu item in this packet (see Out of scope); the palette's "Park
this project" covers it.

## States

- Loading: skeleton rows while the inventory loads; GitHub and local sections load
  independently, so local clones show even while `gh` is slow.
- Empty: "No repositories found on <environment>." with a hint to check `gh auth status`
  and the clone location.
- GitHub unavailable: a banner in place of the GitHub rows. `gh` missing: "The GitHub CLI
  is not installed on <environment>." Not signed in: "Run `gh auth login` on <environment>
  to list GitHub repositories." Local clones still show.
- Error: per-section error text with Retry.
- Disabled (server lacks `project-lifecycle`): the palette items are hidden; the page shows
  "Repositories needs a Loom server. <environment> runs T3 Code <version>." and the
  environment picker offers the environments that support it.
- In progress: Clone and Reopen use upstream's clone toast. Assess, Push and Park show a
  spinner on the dialog button; the dialog cannot be dismissed mid-move.
- Park unavailable: on Windows environments ("Parking is not supported on Windows yet") and
  on Linux without `gio` ("Install gio (glib) to enable the Trash on <environment>").

## Copy

- Page title: "Repositories". Subtitle: "GitHub is the source of truth. Local clones on
  <environment> live in <clone location>." followed by the source: "(from Add project
  starts in)" or "(default)", and a "Change" link to Settings, General.
- Row badges: "Cloned", "Not cloned", "Parked", "Local only", "Project", "Private",
  "Archived", "Fork".
- Park dialog title: "Park <name>". Intro: "Parking moves <path> to the Trash on
  <environment>. Loom checks that nothing unique would be lost first."
- Blocker headings: "Uncommitted changes", "Untracked files", "Stashes", "Commits not on
  GitHub", "Tags not on GitHub", "No origin remote", "GitHub is unreachable", "A thread is
  still working", "A clone is in progress", "A merge or rebase is in progress", "Linked
  worktree has changes", "Nested repository", "A safety check did not finish", "This folder
  cannot be parked".
- Push button: "Push all branches and tags". After success: "Pushed <n> branches."
- Keep list heading: "Files to keep (<n>)". Checkbox: "I have these elsewhere". Hint under
  it: "These files go to the Trash with the folder. Loom does not copy them."
- Review acknowledgement: "I have looked at the other ignored files and do not need them."
- Archive option: "Archive this project's <n> threads".
- Confirm button: "Move to Trash". Toast: "Parked <name>. The folder is in the Trash on
  <environment>."
- Reopen dialog: "Reopen <name> into <path>?" with "Unarchive <n> threads".

No em dashes in product copy.

## Surfaces and connection modes

- Web and desktop: full feature.
- Mobile: none; upstream mobile never sees it.
- Remote environments (LAN, Tailscale, T3 Connect): supported. All work runs on the chosen
  environment's server. The Trash is that machine's Trash. The page and every confirmation
  name the environment by its label; it never says "This Mac" for an environment it has not
  identified as the client's own machine.
- Upstream T3 server: feature hidden or explained as above; no fork RPC is sent.
- Upstream client talking to a Loom server: unaffected.

## Decisions

- Parking never deletes. macOS uses `/usr/bin/trash` (present on macOS 15 and later),
  falling back to a rename into `~/.Trash` on the same volume (what `dev-park` does). Linux
  uses `gio trash`. Anything else refuses. Reason: old Loom's reclaim deleted permanently on
  the server's disk.
- The environment is always named by its label. Reason: old Loom labeled every node
  "This Mac".
- Parking keeps the project and its threads, archiving the threads by default. Removing a
  project stays upstream's own action ("Remove project"), which deletes its threads.
  Reason: chat history survives a park, and Reopen can restore the same project.
- Clone uses upstream's tracked project clone instead of a fork clone. Reason: progress,
  cancel, retry and project creation already exist and are tested.
- Inventory is GitHub only, via `gh` on the selected environment. Reason: Kyle's workflow
  is GitHub based; other forges can come later through the same service.
- Blocking rules follow `dev-park` and the workflow doc: dirty tracked files, untracked
  files, stashes, commits or tags not on origin, and no or unreachable origin all block.
  Ignored files never block. Reason: those are the ways unique work gets lost.
- Clone location: upstream's `addProjectBaseDirectory` ("Add project starts in") when set,
  otherwise `~/Developer/active`; the page shows the folder in use. Loom keeps no clone
  location setting of its own. Reason: Kyle's answer; one setting, owned upstream, instead of
  two that can disagree (Kyle has not set the upstream one, so the default applies).
- A Repositories icon sits in the sidebar footer next to Pull Requests, through a small
  packet seam next to the existing `fork: brand` seam in `SidebarChrome.tsx`. Reason: Kyle
  wants a visible entry; the file changes often (28 upstream commits since June), so the
  seam is three inserted lines (two markers) and all logic lives in a fork component.
- Keep files: a confirmation, not a block. The Park dialog lists each Keep file and enables
  Park only after "I have these elsewhere" is ticked; Review files need only the general
  acknowledgement; Loom never copies `.env` files. Reason: Kyle's answer; a block would
  force moving files he already has elsewhere, and copying would spread secrets.

## Out of scope

- Follow-up: "Park" in the sidebar project context menu. Reason: the menu lives in
  `LegacySidebar.tsx` (33 upstream commits since June) and is likely being replaced; revisit
  when upstream's new sidebar settles. The palette item covers it meanwhile.
