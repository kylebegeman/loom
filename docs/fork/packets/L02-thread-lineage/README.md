# L02: Thread lineage

Status: Ready to build.

Threads stop being isolated. From any message, the user forks the conversation into a new
thread that starts with the history up to that point, optionally on another provider, model
or worktree. Loom remembers which thread came from which, so a Related threads panel shows
the parent, the children and the siblings of the current thread, each with its status, and
lets the user message any of them from a small composer without leaving the current thread.
A sidecar is a child thread for a side conversation about the same project that keeps the
main thread's context clean, opened next to the main thread in the right panel. Side by side
opens any other thread of the project in the right panel so two approaches can be read and
steered at once. There is no automatic merge.

## Scope

- In:
  - Fork from any user or assistant message (hover action on the message, command palette,
    unbound keybinding). The fork dialog chooses title, provider and model, workspace (a new
    worktree by default for forks, with "Same workspace" and "Project root" as options) and
    how context is carried.
  - Context carried by replay in phase 1 (every provider): the visible history is copied into
    the child (as imported messages), and the model receives it as a transcript attached to
    the child's first message as a composer context record. The transcript budget is fixed
    at about 90,000 characters (oldest messages dropped first) and the fork shows an
    "earlier messages trimmed" notice when trimming happens. No upstream seam is needed for
    this.
  - Native provider forks in phase 2 (optional, behind a spike): Claude through the SDK's
    `forkSession`, Codex through app-server `thread/fork`. The child then resumes the forked
    native session instead of reading a transcript.
  - A fork-owned lineage table (`fork_thread_lineage_links`) with parent, child, kind (fork,
    sidecar, delegate, review) and fork point. Siblings are derived. Unlink is the reverse
    action.
  - Related threads panel (right panel `thread-lineage`): parent, children, siblings and
    plan implementation threads, with status, open, open side by side, and a compact
    composer that sends a turn to the selected related thread.
  - Sidecar: create a sidecar child (same workspace, clean context by default, optional
    transcript), shown as a thread pane tab in the right panel of the main thread.
  - Side by side: a thread pane panel (`thread-lineage:thread`) that shows any thread of the
    same environment next to the current one, with its own compact composer and a Stop
    button.
  - Command palette items for fork, sidecar, related threads and side by side, and unbound
    keybinding commands for fork, sidecar and related threads.
  - Server cleanup: a fork reactor removes lineage rows when threads or projects are deleted.
- Out:
  - Automatic merge of two threads or their changes (explicitly dropped).
  - Rewind in place (upstream already has "Edit from here", which reverts the current thread).
  - Native forks for OpenCode, Cursor, Grok and Antigravity. OpenCode's fork needs the
    adapter's own server process; ACP's `session/fork` copies the whole session without a
    message point and is marked unstable. They use replay.
  - Answering approvals and user-input questions from inside a thread pane (v1 shows the
    request and an "Open thread" button).
  - Hiding sidecar threads from the sidebar (would need a sidebar seam; sidecars are
    titled "Sidecar: ..." instead).
  - A dedicated two-column split route. Side by side lives in the right panel, which the user
    can widen or maximize with upstream's layout controls.
  - Mobile UI.
  - A setting for the transcript budget. It stays fixed at about 90,000 characters
    (decided); it leaves room for the first message under upstream's input limit.

## Surfaces

Web and desktop: supported (same bundle; no Electron-only parts). Mobile: not supported; the
upstream mobile app shows forks and sidecars as ordinary threads (their imported history is
visible). Remote: works over every connection mode, since forks run on the environment's
server through a fork RPC and the panels read threads over the same WebSocket. On an
upstream T3 server the message action, panels and palette items are hidden
(`loomFeatures` lacks `thread-lineage`).

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (fork RPC group, `ForkLayer` service, persistence, a reactor, capability flag).
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (the fork dialog host and the keybinding listener).
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (Related threads and thread pane panels).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (palette items).
- [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (three unbound commands; requires `ext-web-root`).

This packet creates any of them that are missing, exactly as EXTENSION-POINTS.md specifies,
each in its own commit.

## Packet seams

- `apps/web/src/components/chat/MessagesTimeline.tsx`: the "Fork from here" button in the
  user message action bar and in the assistant message meta row (import plus two JSX lines).

Details in [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L08 (multi-thread runs) is present, its agent-started child threads appear here as
  `delegate` children: L08 writes rows into `fork_thread_lineage_links` when that table
  exists. Nothing in this packet depends on L08.
- If L15 (AI code review) is present, its reviewer threads appear here as `review`
  children under Reviews: L15 writes rows into `fork_thread_lineage_links` when that table
  exists. Nothing in this packet depends on L15.
- Follow-up, not built by this packet: if L04 (thread inspector) is present, register a
  "Lineage" section in its `FORK_INSPECTOR_SECTIONS`
  (`apps/web/src/fork/thread-inspector/sections.ts`): parent title and child counts from
  `listForThread`, with a button that opens Related threads. The section checks
  `loomFeatures` itself. Nothing here depends on L04.

## Size

Phase 1: about 2,000 to 2,600 lines including tests (server service and reactor about 700,
contracts 150, web panels, pane, dialog and button about 1,300). Phase 2 (native forks):
about 600 to 900 lines, gated on the spike in IMPLEMENTATION.md.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
every file in this folder, then follow [IMPLEMENTATION.md](./IMPLEMENTATION.md) from step 1.
Seed a worktree `.t3` with real data before the manual check (AGENTS.md, "Test data").

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
