# L04: Thread Inspector

Status: Done.

One status view for the current thread: what it is doing, where it works (project, branch,
worktree, pull request), what it changed (uncommitted files, last turn's files), its plan,
what it is waiting for (approvals, questions), its subagents, terminals and context window
use, each with a jump to the place that handles it. It comes as a glance card anchored under
an eye button in the chat header and as a right panel tab that shows everything with tools.
Both read one model. It is entirely client-side: every value comes from state the web app
already holds, so it works against any T3 server.

## Scope

- In:
  - Right panel `thread-inspector` ("Inspector", launcher letter I).
  - An eye toggle in the chat header that shows the card anchored under the button. Like
    old Loom's final design (ledger 1359) it light-dismisses: a press outside it, Escape, or
    a jump from one of its lines closes it.
  - Areas: the status hero, Needs you, Workspace, Changes, Plan, Agents, Terminals, Context.
  - Jump actions: open the diff panel (all changes, or the last turn's changes), the
    subagents panel, the pull requests panel, a running terminal, and focus the composer
    for pending approvals and questions.
  - Palette items "Show thread inspector" and "Show thread inspector card"; unbound keybinding
    commands `loom.thread-inspector.toggle` and `loom.thread-inspector.card`.
  - A small section registry so other fork packets can add rows (for example L02 lineage
    or L03 goal) when both are present.
- Out:
  - Server-side data (no new RPCs, no `loomFeatures` entry).
  - Scrolling the timeline to a message or plan card: the timeline is virtualized inside
    `ChatView` with no external scroll API; the plan's steps are shown in the card instead.
  - Editing anything from the inspector (approving, rewording plans).
  - Old Loom's "Sources / Related context" section (it depended on old Loom's Context layer).
  - Mobile: upstream mobile already has its own tablet inspector (git, files and route
    panes), a different feature.
  - A "keep open" pin on the card (decided: not wanted). The panel tab is the keep-open
    view.

## Surfaces

Web and desktop: supported. Mobile: not supported (nothing new shows). Remote: works over
every connection mode; it reads the same atoms and queries the chat view already uses.
Upstream T3 servers: fully supported, since it needs no server support.

## Extension points used

- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (the panel).
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (command listener host) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (two unbound commands).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (two items).
- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core), only as the prerequisite of `ext-panels` and `ext-palette` (their client
  helper); no server code.

It creates any that are missing, exactly as EXTENSION-POINTS.md specifies.

## Packet seams

- `apps/web/src/components/chat/ChatHeader.tsx`: the eye button as the first header
  action (import plus one JSX line).

## Optional integrations

- L02 (thread lineage), L03 (goals) and L08 (runs) can each add an inspector row through
  `FORK_INSPECTOR_SECTIONS` (`apps/web/src/fork/thread-inspector/sections.ts`) when this
  packet is present. This packet ships none of those rows and depends on none of them.

## Size

About 1,800 lines including tests, all in `apps/web/src/fork/thread-inspector/`, plus the
extension points if missing.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
every file here, then follow [IMPLEMENTATION.md](./IMPLEMENTATION.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
