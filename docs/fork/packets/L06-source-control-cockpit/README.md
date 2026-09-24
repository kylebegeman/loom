# L06: Source control cockpit

Status: Ready to build. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

A "Source control" right panel for the current thread's branch. It answers the questions
upstream leaves scattered or unanswered: which branch and worktree this thread is on, which
other threads share it, whether its pull request and CI are green, what the commit history
around it looks like, why a check failed (with the log tail), which files are in conflict
during a merge or rebase, and whether switching branches right now would lose or collide
with uncommitted work. It builds on upstream's pull request panel, Git status stream and
branch selector instead of duplicating them.

## Scope

- In:
  - **Lane card** (default view): branch, ahead/behind, dirty count, worktree or project
    root, other threads on the same checkout and branch, linked pull requests with state,
    review decision, mergeability and CI rollup, in-progress merge or rebase banner, stashes
    with Apply and Pop. PR rows open upstream's pull request panel.
  - **Graph**: a real commit graph (`git log --topo-order`) for HEAD, its upstream and the
    default branch, 200 commits, with ref labels and the merge base marked.
  - **Checks**: GitHub check runs and commit statuses for the branch head, with or without a
    PR; per-check log tail for GitHub Actions jobs (last 64 KB, lightly redacted); "Ask the
    agent to fix" puts a prompt with the failing step into the composer for the user to
    review and send (never sent automatically).
  - **Conflicts**: the operation in progress, unmerged files with conflict kind and marker
    count, lockfile and generated-file hints, "Open file", "Ask the agent to resolve",
    Continue and Abort buttons (each behind a confirmation), and copyable continue and abort
    commands.
  - **Safe switch**: a preflight before switching the thread's branch (dirty files that would
    be overwritten, operation in progress, other threads on a shared checkout, branch
    already checked out in another worktree), then Switch, Stash and switch, or Cancel.
    "Stash and switch" includes untracked files (`git stash push --include-untracked`) and
    never ignored files.
  - Optional **leak check** with `varlock scan` when varlock is installed on the environment
    and the checkout has a `.env.schema`.
  - Palette actions and one unbound keybinding command to toggle the panel.
- Out:
  - The cross-project lanes board (F13), deferred by the brief.
  - Pull request review, comments, merge buttons: upstream's pull request panel owns them.
  - Commit, push, create PR: upstream's `GitActionsControl` owns them.
  - Restack and virtual branches.
  - Follow-up: a Jev CI failure classification for the Checks view. Not selected for now;
    kept as an idea in L29's catalog.
  - Non-GitHub CI (GitLab, Forgejo, Azure DevOps, Bitbucket). The Checks view says
    "Checks are available for GitHub repositories" for other remotes. Upstream's PR panel
    still shows their PR checks.
  - Installing git hooks for varlock.
  - Mobile UI.

## Surfaces

Web and desktop: supported (same bundle). Mobile: not supported; mobile has no right panel
system. Remote: every git and gh command runs on the thread's environment through fork RPCs
keyed by thread id, so it works locally, over Tailscale and through T3 Connect.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (fork RPC group, `ForkLayer` service, capability `source-control-cockpit`).
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (panel `source-control-cockpit`).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (palette actions).
- [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (command `loom.source-control-cockpit.toggle`), which requires
  [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root).

No storage: the packet keeps no tables (server caches are in memory).

## Packet seams

None. All upstream behavior is reused through exported stores, hooks and RPCs.

## Optional integrations

- If L19 (project lifecycle) is present, the lane card shows "Park this project" for the
  thread's project when the lane is clean, linking to `/loom/repositories?park=<projectId>`.
- If L15 (AI code review) is present, the Checks view may offer its review action; not
  required.

## Size estimate

Medium to large: about 2.7k lines including tests. Server (git facts, graph, checks, logs,
conflicts, continue and abort, preflight, stash, varlock) ~1,000, contracts ~280, web panel
and views ~1,080, graph layout ~150, tests ~450. Each view can land as its own commit.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
this folder: PRODUCT, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING. Build the Lane card and
Graph first (no network), then Conflicts and Safe switch, then Checks and logs, then the
optional leak check.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
