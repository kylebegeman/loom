# L19: Project lifecycle

Status: Ready to build. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

Loom gets a Repositories page that follows Kyle's ephemeral checkout workflow
(`~/Developer/docs/workflow/ephemeral-checkouts.md`): GitHub is the source of truth and the
local disk is a cache. The page lists the GitHub repositories the environment's `gh` account
can see next to the clones that exist on that machine. From it you clone a repository into
the clone location (upstream's "Add project starts in" folder when set, otherwise
`~/Developer/active`) as a Loom project, adopt an existing clone
as a project, park a checkout when the work is done, and reopen a parked checkout later by
cloning it again. Parking runs a safety report first (dirty files, unpushed commits, stashes,
local-only branches, linked worktrees, ignored files sorted into "safe to lose" and "keep"),
offers to push what is missing, asks you to confirm you have the "keep" files elsewhere,
and then moves the folder to the Trash on the machine that holds it. Nothing is ever deleted
permanently, and Loom never copies `.env` files.

## Scope

- In:
  - A `/loom/repositories` page with an environment picker, search and filters (All,
    Cloned, Not cloned, Parked), opened from a Repositories icon in the sidebar footer (next
    to Pull Requests), the palette, a shortcut or Loom settings.
  - GitHub inventory through `gh` on the selected environment, cached on the server.
  - Local clone discovery under the clone location (two levels deep, for multi-repo
    products such as `active/aspectavy/aspectavy-ios`) plus every project root on that
    environment, matched to GitHub by normalized remote URL.
  - Clone: reuses upstream's tracked project clone (`projectClone.start`), so progress,
    cancel, retry and project creation are upstream's.
  - Adopt: an existing clone becomes a project through upstream's `project.create`.
  - Park: safety assessment, "Push all branches and tags", a listed confirmation for Keep
    files ("I have these elsewhere") and a general one for Review files, optional archiving
    of the project's threads, move to the Trash (checkout plus clean linked worktrees), and a
    parked record.
  - Reopen: clones a parked repository back into its old path for a project that still
    exists (same project, same threads, optional unarchive), or as a new project when the
    project is gone. Forget removes a parked record.
  - Loom settings section: the clone location in use (read only; it is upstream's setting),
    extra "safe to lose" and "keep" patterns.
  - Command palette actions and one unbound keybinding command.
- Out:
  - Other forges (GitLab, Forgejo, Azure DevOps, Bitbucket) in the inventory. Local clones
    with those remotes still show and can be parked.
  - Automatic parking, schedules, disk-usage reports or size-based suggestions.
  - WIP snapshot commits (`dev-park --wip`) and saving stashes as branches. The report says
    how; the agent or the user does it.
  - Follow-up: "Park" in the sidebar project context menu. The menu lives in
    `LegacySidebar.tsx`, which upstream is likely replacing; revisit when the new sidebar
    settles.
  - A Loom-owned clone location setting (upstream's "Add project starts in" is the one
    setting).
  - Mobile UI.
  - Old Loom's estate registry (provider identity joins, leases, receipts, multi-repo
    project bindings).

## Surfaces

Web and desktop: supported (same bundle). Mobile: not supported; the phone runs upstream's
app, and nothing on mobile changes. Remote: every read and action runs on the selected
environment's server over the WebSocket RPC, so cloning and parking happen on the machine
that owns the files. The page names that machine by its environment label and never
assumes it is the machine running the client.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (RPC group, `ForkLayer` service, persistence, capability `project-lifecycle`).
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings) (Loom settings section).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (palette actions).
- [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (command `loom.project-lifecycle.open`, unbound; handled by the fork keydown
  listener, never written into `keybindings.json`), which requires
  [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (a shortcut host component).

Any of these may be missing when this packet starts; create them exactly as
EXTENSION-POINTS.md specifies, each in its own commit.

## Packet seams

- `apps/web/src/components/sidebar/SidebarChrome.tsx`: two inserted lines marked
  `fork: project-lifecycle` (an import below the `fork: brand` import, and
  `<RepositoriesSidebarItem />` after the Pull Requests item).
- `apps/web/src/routes/loom.repositories.tsx`: new fork-owned route file (lives in the
  routes directory because the router requires it).
- `apps/web/src/routeTree.gen.ts`: regenerated, not hand-edited.

No existing upstream line is edited. Details in [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L18 (project profiles) is present, nothing changes: parking does not touch project
  settings, and a reopened project keeps its id, so profile rows keyed by project id still
  apply.
- If L06 (source control cockpit) is present, its lane view may link to "Park this
  project"; not required.

## Size estimate

Medium: about 1.5k to 2k lines including tests. Server service and git/trash logic ~700,
contracts ~200, web page, dialogs, settings and the sidebar item ~850, tests ~400.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
this folder in order: PRODUCT, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING. Seed a worktree
`.t3` with real data (AGENTS.md, "Test data") so the page has projects to match. Never run
Park against a real checkout during development; TESTING.md has a disposable fixture script.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
