# L06: Source control cockpit

Status: In progress. The minimal recovery slice is implemented in the existing Git controls on web,
desktop and mobile. Graph, Checks and safe Switch remain planned. The lane card is retired.

The Git control shows an in-progress merge, rebase, cherry-pick or revert and its unmerged
files. Ask the agent prepares a draft; Continue and Abort require confirmation. Commit
refuses to stage unmerged files. Diverged branches offer an agent sync prompt. Running
stacked Git actions can be cancelled; silent pushes name possible SSH approval on the
host and stop after ten minutes. Default-branch confirmation can be remembered per
project, and a clean worktree whose HEAD is in the fetched remote default shows Landed
with an explicit Settle action.

The remaining cockpit is a Source control right panel for commit history, branch checks
and safe branch switching. It will reuse the existing recovery behavior and Git status
stream instead of introducing a second conflict workflow.

## Retired parts

Kyle approved this retirement on 2026-10-09.

- **Lane card** (the default view with branch, ahead/behind, dirty count, worktree or project
  root, other threads on the checkout, linked pull requests and CI rollup). Covered by
  upstream's Thread details panel, which shows the same information. The two lane card items
  that other views depend on move: the in-progress operation banner goes to the panel header,
  and stashes with Apply and Pop go to the Switch view. The fork `lane` facts query stays as
  the data source for those.

## Remaining panel scope

- In:
  - **Panel header**: the branch, the environment, and an in-progress merge or rebase banner
    that opens Conflicts.
  - **Graph** (default view): a real commit graph (`git log --topo-order`) for HEAD, its upstream and the
    default branch, 200 commits, with ref labels and the merge base marked.
  - **Checks**: GitHub check runs and commit statuses for the branch head, with or without a
    PR; per-check log tail for GitHub Actions jobs (last 64 KB, lightly redacted); "Ask the
    agent to fix" puts a prompt with the failing step into the composer for the user to
    review and send (never sent automatically).
  - **Conflicts**: the operation in progress, unmerged files with conflict kind and marker
    count, lockfile and generated-file hints, "Open file", "Ask the agent to resolve",
    Continue and Abort buttons (each behind a confirmation), and copyable continue and abort
    commands.
  - **Switch** (safe switch): a preflight before switching the thread's branch (dirty files that would
    be overwritten, operation in progress, other threads on a shared checkout, branch
    already checked out in another worktree), then Switch, Stash and switch, or Cancel.
    "Stash and switch" includes untracked files (`git stash push --include-untracked`) and
    never ignored files. The view lists stashes with Apply and Pop.
  - Optional **leak check** with `varlock scan`, in the Checks view, when varlock is installed
    on the environment and the checkout has a `.env.schema`.
  - Palette actions and one unbound keybinding command to toggle the panel.
- Out:
  - The lane card (retired, see above).
  - The cross-project lanes board (F13), deferred by the brief.
  - Pull request review, comments, merge buttons: upstream's pull request panel owns them.
  - Commit, push, create PR: upstream's `GitActionsControl` owns them.
  - Restack and virtual branches.
  - Non-GitHub CI (GitLab, Forgejo, Azure DevOps, Bitbucket). The Checks view says
    "Checks are available for GitHub repositories" for other remotes. Upstream's PR panel
    still shows their PR checks.
  - Installing git hooks for varlock.
  - Mobile UI for Graph, Checks and safe Switch. Recovery already works on mobile.

## Surfaces

Recovery: web, desktop and mobile, including remote connections. Commands run on the
checkout's environment through the existing typed Git service and RPC path. The remaining
right panel views target web and desktop; mobile has no equivalent panel system.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (fork RPC group, `ForkLayer` service, capability `source-control-cockpit`).
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (panel `source-control-cockpit`).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (palette actions).
- [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (command `loom.source-control-cockpit.toggle`), which requires
  [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root).

No new tables. Branch facts remain derived. Direct-default-branch consent is one project
override in the existing server settings, shared by clients of that environment.

## Packet seams

The recovery slice uses the `source-control-cockpit` seam in the existing Git status,
workflow, client controls and keybinding contracts. The future panel reuses those paths.

## Optional integrations

- The L19 (project lifecycle) "Park this project" link lived on the lane card and was retired
  with it.
- Follow-up, not built by this packet: if L15 (AI code review) is present, the Checks view
  may offer its review action; not required.

## Size estimate

Medium to large: about 2.5k lines including tests. Server (git facts, graph, checks, logs,
conflicts, continue and abort, preflight, stash, varlock) ~1,000, contracts ~280, web panel
and views ~880, graph layout ~150, tests ~450. Each view can land as its own commit.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
this folder: PRODUCT, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING. Build the panel header and
Graph first (no network), then Conflicts and Safe switch, then Checks and logs, then the
optional leak check.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
