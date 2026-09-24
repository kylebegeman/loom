# L06 product

## Problem

When several agents work in one project, the state that matters for the current thread is
spread out: the branch in the composer toolbar, the PR in its own panel, CI only when a PR
exists, other threads on the same checkout nowhere, and conflicts only as a vague "git
checkout failed" toast. Upstream's branch switch has no dirty-tree guard (git refuses and
the reason is dropped), and nothing shows an in-progress rebase or which files conflict.
Kyle wants one panel that shows the thread's lane and makes the risky moves (switching,
resolving conflicts, chasing a red check) safe and quick.

## What the user can do

- Open the Source control panel from the right panel launcher, the "+" menu, the command
  palette, or a shortcut.
- See the lane at a glance: branch, ahead and behind, uncommitted files, where the checkout
  lives (worktree path or project root), the other threads using it, the linked PRs with
  review, mergeability and CI state, and any merge or rebase in progress.
- Open a PR in upstream's pull request panel from the lane card.
- See the commit graph around the branch: HEAD, its upstream, the default branch and where
  they diverge.
- See CI for the branch head even before a PR exists, open a failing check's log tail in
  the panel, open it on GitHub, and ask the agent to fix it.
- During a merge, rebase, cherry-pick or revert: see which files conflict and how, open each
  file, ask the agent to resolve them, and copy the continue or abort command.
- Switch the thread's branch safely: Loom checks first and explains what would happen, then
  offers Switch, Stash and switch, or Cancel. Stashes show on the lane card with Apply and
  Pop, so a stash is never a one-way door.
- Run a leak check on staged or all files when varlock is set up for the project.

## Entry points

| Entry                | Behavior                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Right panel launcher | "Source control", letter G, available when the thread's environment supports the feature.                           |
| "+" menu             | Same entry.                                                                                                         |
| Command palette      | "Open source control", "Switch branch safely" (opens the panel on Safe switch), "Show CI checks", "Show conflicts". |
| Keybinding           | `loom.source-control-cockpit.toggle`, unbound by default; opens the panel or closes it when active.                 |
| Lane card            | Conflict banner opens Conflicts; CI rollup opens Checks; PR row opens upstream's PR panel.                          |

Ways out: the panel closes like any right panel tab (and with the toggle command). Stash has
Apply and Pop. Safe switch has Cancel and the reverse switch is the same flow. There is no
destructive action without a confirmation; abort is only offered as a copyable command.

## States

- Loading: skeleton rows per view; the lane card renders from upstream's status stream as
  soon as it has a snapshot.
- Not a git repository: "This thread's folder is not a Git repository."
- Draft thread without a server thread: the panel works on the project root and says so.
- Empty: Graph "No commits yet"; Checks "No checks ran for <sha>"; Conflicts "No merge or
  rebase in progress" with a clean-state icon.
- Errors: per view, with Retry. Checks: "The GitHub CLI is not installed on <environment>",
  "Run gh auth login on <environment>", "Checks are available for GitHub repositories",
  "GitHub rate limit reached. Try again at <time>."
- Disabled (server lacks `source-control-cockpit`): the launcher entry is disabled with
  "Needs a Loom server"; palette items are hidden.
- In progress: Stash, Apply, Pop and Switch disable their buttons and show a spinner; the
  panel re-reads state from upstream's status stream afterwards.
- Pending checks: the Checks view refreshes every 30 seconds while visible and any check is
  pending, and stops when all are complete.

## Copy

- Panel title: "Source control". View tabs: "Lane", "Graph", "Checks", "Conflicts".
- Lane rows: "On <branch>", "<n> ahead, <m> behind <upstream>", "<n> uncommitted files",
  "Worktree <path>" or "Project folder <path>", "Also on this checkout: <n> threads",
  "Rebase in progress: <n> conflicted files".
- Safe switch results: "Safe to switch.", "<n> uncommitted files would be overwritten by
  <branch>.", "<branch> is checked out in another worktree. This thread will move there.",
  "<n> other threads use this folder. Switching changes their branch too."
- Buttons: "Switch", "Stash and switch", "Cancel", "Apply", "Pop", "Open log", "Open on
  GitHub", "Ask the agent to fix", "Ask the agent to resolve", "Copy command".
- Leak check: "No leaked values found." / "<n> sensitive values found in <m> files."

No em dashes in product copy.

## Surfaces and connection modes

- Web and desktop: full feature.
- Mobile: none.
- Remote: supported; the environment that owns the thread runs every command. Logs and
  graph data travel over the WebSocket with explicit size caps.
- Upstream T3 server: panel entry disabled with "Needs a Loom server"; no fork RPC is sent.
- Upstream client on a Loom server: unaffected.

## Decisions and open questions

Decisions:

- One panel with four views rather than four panels. Reason: the lane is one object; tabs
  inside the panel keep the right panel tab strip short.
- The lane is derived, never stored. Reason: old Loom persisted lanes and they went stale
  when agents switched branches (old ledger 1841).
- Upstream owns PR detail, review and merge; the cockpit links to it.
- Checks come from the GitHub API for the head commit, not from the PR, so branches without
  a PR are covered; logs are fetched per job and truncated from the end (old Loom kept the
  first 64 KB, which cuts off the failure).
- No merge or rebase is continued or aborted by a button. Reason: git's state after a
  conflict is the user's to finish (old ledger 1000); the agent or the terminal does it.
- Switching reuses upstream's `vcs.switchRef` and thread metadata update; the fork only adds
  the preflight and the optional stash.
- varlock is optional and auto-detected; its exit code 1 is ambiguous, so the panel reads
  its output.

Open questions for Kyle:

1. Should "Ask the agent to fix" put the prompt in the composer (current design, you press
   send) or send it immediately?
2. Do you want Continue and Abort buttons for rebases and merges later, behind a
   confirmation?
3. Stash and switch includes untracked files (`--include-untracked`). Keep that default?
