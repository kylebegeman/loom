# L07 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Search for the
quoted code when line numbers drift.

## How upstream's terminal drawer works

- `ThreadTerminalDrawer` (`apps/web/src/components/ThreadTerminalDrawer.tsx:1050`) renders
  either as the drawer (`mode="drawer"`) or inside the right panel (`mode="panel"`). The
  drawer root is `<aside data-terminal-owner="drawer">` with an inline `height`
  (`:1424-1430`) and a resize handle only in drawer mode (`:1432-1440`). Height limits:
  `MIN_DRAWER_HEIGHT = 180`, `MAX_DRAWER_HEIGHT_RATIO = 0.75` (`:93-94`,
  `clampDrawerHeight` at `:101-105`); drags update locally and commit on pointer-up
  (`:1321-1354`).
- `PersistentThreadTerminalDrawer` (`apps/web/src/components/ChatView.tsx:879`) wraps it per
  mounted thread; `visible = active && terminalUiState.terminalOpen` (`:906`); the wrapper
  animates with `grid-rows-[1fr]` / `grid-rows-[0fr]` and the
  `--panel-animation-duration` variable under `data-panel-animations=true` (`:1196-1204`).
- State is per thread in `useTerminalUiStateStore` (`apps/web/src/terminalUiStateStore.ts`,
  persisted as `t3code:terminal-state:v1`, `:30`): `terminalOpen`, `terminalHeight`,
  `terminalIds`, groups (`:20-27`). Actions `setTerminalOpen(ref, open)` and
  `setTerminalHeight(ref, height)` (`:567-568`); selector `selectThreadTerminalUiState`
  (`:480`). Default height 280 (`apps/web/src/types.ts:29`).
- ChatView keeps up to 10 hidden threads' drawers mounted (`ChatView.tsx:2077-2091`,
  `MAX_HIDDEN_MOUNTED_TERMINAL_THREADS` in `ChatView.logic.ts:65`) and renders them in one
  place, directly under the main content row, inside the chat column wrapper
  (`ChatView.tsx:9849-9865`). The right panel is a sibling of that wrapper, so the drawer
  spans the chat column only.
- `terminal.toggle` (`mod+j`, `packages/shared/src/keybindings.ts:22`) is handled in
  ChatView's capture-phase keydown handler (`ChatView.tsx:6659`, installed at `:6814`) and
  by the header button (`PanelLayoutControls`, `:9099-9113`).
- Project scripts run by typing the command into a drawer terminal
  (`runProjectScript`, `ChatView.tsx:4141-4263`): open with `terminalEnvironment.open`,
  then `terminalEnvironment.write` with `${script.command}\r`; cwd from
  `projectScriptCwd` and env from `projectScriptRuntimeEnv`
  (`packages/shared/src/projectScripts.ts:49-75`).

## Phase 1: the dock shell

### Shape

```
chat column wrapper (upstream, flex-col)
  header
  main content row (messages, composer)
  <ForkBottomDock threadRef={activeThreadRef} />     <- fork seam: strip + fork tab content
  {mountedTerminalThreadRefs.map(... PersistentThreadTerminalDrawer ...)}   <- upstream, unchanged
```

`ForkBottomDock` is inserted as a sibling directly above upstream's drawer list. It never
wraps or re-parents the drawer, so the drawer's DOM, focus routing
(`data-terminal-owner`), mounting and animation are exactly upstream's.

### One tab at a time

The dock's visible tab per thread is derived from two stores:

| `terminalOpen` (upstream) | `forkTab` (fork) | Shown                                                     |
| ------------------------- | ---------------- | --------------------------------------------------------- |
| false                     | null             | nothing (dock closed)                                     |
| true                      | null             | Terminal (upstream drawer) plus the strip                 |
| false                     | `"tasks"` etc.   | the strip plus that fork tab                              |
| true                      | set              | not allowed: the dock closes the fork tab (terminal wins) |

Transitions:

- Select a fork tab: `setTerminalOpen(ref, false)`, then `setForkTab(ref, id)`.
- Select Terminal: `setForkTab(ref, null)`, then `setTerminalOpen(ref, true)`.
- Collapse: `setForkTab(ref, null)` and `setTerminalOpen(ref, false)`.
- Upstream opens the terminal (Cmd+J, header button, running a script): an effect in
  `ForkBottomDock` sees `terminalOpen && forkTab !== null` and clears `forkTab`.

The rule is a pure function, `resolveDockView({ terminalOpen, forkTab, registeredTabs })`,
tested on its own.

### Height and animation

All tabs share the thread's `terminalHeight` from upstream's store. Fork tabs read it with
`selectThreadTerminalUiState` and write it with `setTerminalHeight` on pointer-up, so the
height never jumps when switching between Terminal and a fork tab. The fork resize handle
copies the drawer's behavior (local height during the drag, commit on pointer-up, re-clamp
on window resize) with the same limits (180 px, 75% of the window), redeclared in
`apps/web/src/fork/bottom-dock/layout.ts` because upstream's are module-private.

The fork tab container uses the same wrapper classes as upstream's drawer
(`grid shrink-0 overflow-clip`, `grid-rows-[1fr]`/`[0fr]`, the `--panel-animation-duration`
transition under `data-panel-animations=true`), so when switching between Terminal and a
fork tab one side collapses while the other expands with the same duration and easing and
the total height stays steady. No animation runs while idle.

### Tab strip

A 28 px row (`apps/web/src/fork/bottom-dock/DockTabStrip.tsx`) rendered by `ForkBottomDock`
whenever the dock is open for the active thread and at least one fork tab is registered.
Tabs: Terminal first, then registered tabs in registry order, each with an icon, a label and
an optional badge; a collapse button on the right. It uses upstream's tab styling tokens (the
right panel tab bar in `apps/web/src/components/RightPanelTabs.tsx` is the visual reference)
and `role="tablist"` with arrow-key navigation.

### Registry

```ts
// apps/web/src/fork/bottom-dock/registry.ts
export interface DockTabContext {
  readonly threadRef: ScopedThreadRef;
  readonly height: number;
}

export interface DockTabDefinition {
  /** Stable id, also the persisted value: "tasks" | "activity" | "approvals" | ... */
  readonly id: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** Keybinding command that shows this tab, if any. */
  readonly command?: ForkKeybindingCommand;
  /** Small hook for the tab label badge; must be cheap (shell-level data only). */
  readonly useBadge?: (threadRef: ScopedThreadRef) => number;
  /** Mounted only while the tab is visible. */
  readonly Component: ComponentType<DockTabContext>;
}

/** One line per phase. Order is strip order after Terminal. */
export const DOCK_TABS: ReadonlyArray<DockTabDefinition> = [
  // tasksDockTab,
  // activityDockTab,
  // approvalsDockTab,
];
```

`useBadge` hooks are called in a fixed order over the static array (same pattern as
`useForkComposerDrawer` in EXTENSION-POINTS.md).

### Store

```ts
// apps/web/src/fork/bottom-dock/store.ts  (zustand + persist)
interface BottomDockState {
  /** Keyed by scopedThreadKey(ref). */
  readonly byThreadKey: Readonly<
    Record<string, { forkTab: string | null; lastForkTab: string | null }>
  >;
  setForkTab(ref: ScopedThreadRef, tab: string | null): void;
  removeThread(threadKey: string): void;
}
// storage key "loom:bottom-dock:state:v1", version 1; unknown tab ids load as null
```

`scopedThreadKey` is upstream's key function (used by `terminalThreadKey`,
`terminalUiStateStore.ts:242-244`). Entries for threads that no longer exist are pruned when
the dock mounts, bounded to 200 entries (oldest first).

### Commands and palette

- `FORK_KEYBINDING_COMMANDS`: `"loom.bottom-dock.toggle"` in phase 1; each tab phase adds
  its own (`"loom.bottom-dock.tasks"`, `".activity"`, `".approvals"`). No default bindings.
- `DockCommandHost` (a `ForkRoot` component) subscribes with `onForkCommand` and acts on the
  active thread (found as the palette registry finds it, `useHandleNewThread`).
- Palette source: "Show <Tab>" per registered tab, "Hide bottom dock" when open. Values
  `action:loom:bottom-dock:<id>`.

### What phase 1 does not change

Terminal ids, groups, splits, the right-panel terminal, the header toggle, `terminal.*`
shortcuts and their `when` context (`terminalOpen` is still upstream's value), script
running, the setup-script terminal, and the pull request page (it renders no drawer,
`routes/_chat.pull-requests.tsx:1583-1595`).

## Phase 2: Tasks

### Model

A task is a terminal session in the thread with a reserved id:

- `task-<scriptId>` for a project script (script ids match `^[a-z0-9][a-z0-9-]*$`, at most
  24 characters, `packages/contracts/src/keybindings.ts:7,93-99`, so the terminal id stays
  short).
- `task-cmd-<n>` for an ad-hoc command (`n` increments per thread).

Task rows come from `resolveProjectScripts(settings, project)`
(`packages/shared/src/projectScripts.ts:17-27`; settings via `useEnvironmentSettings`, the
project via `useProject`, both as ChatView gets them at `:1565,2098,2104-2107`) plus ad-hoc
tasks found among the thread's known sessions (`useKnownTerminalSessions`,
`apps/web/src/state/terminalSessions.ts:160`) whose id starts with `task-cmd-`. Ad-hoc
commands and their text are kept in the dock store per thread (memory plus the persisted
recent list below).

Status from `TerminalSummary` (`packages/contracts/src/terminal.ts:118-131`):

| Summary                                                        | Row state                              |
| -------------------------------------------------------------- | -------------------------------------- |
| no session                                                     | Idle                                   |
| `status` `starting` or `running` and `hasRunningSubprocess`    | Running                                |
| `status` `running` and not `hasRunningSubprocess`, after a run | Finished                               |
| `status` `exited` or `error`                                   | Stopped (the shell ended) with Restart |

### Actions

- **Run:** `terminalEnvironment.open` with `{ threadId, terminalId, cwd, worktreePath, env,
cols: 120, rows: 30 }` (cwd and env exactly as `runProjectScript` computes them), then
  `terminalEnvironment.write` with `${command}\r`. Both through `useAtomCommand` as ChatView
  does (`ChatView.tsx:1476-1477`).
- **Stop:** write `"\u0003"` (Ctrl-C) to the session.
- **Restart:** Stop, then Run once the summary shows no running subprocess (or after the
  user confirms "Force restart" if it does not stop).
- **Remove** (ad-hoc, finished): `terminalEnvironment.close`.
- **Open in Terminal tab:** `ensureTerminal(ref, id, { open: true, active: true })`
  (`terminalUiStateStore.ts:572-576`), which also switches the dock to Terminal by the
  one-tab rule.

### Output

The selected task's live output renders with upstream's exported `TerminalViewport`
(`ThreadTerminalDrawer.tsx:335`, props at `:305-327`): real terminal rendering, scrollback,
links, input. It is mounted only for the selected task and only while the Tasks tab is
visible, with `visible` and `drawerHeight` passed from the dock.

### Drawer interplay

Task sessions are ordinary terminal sessions, so upstream's drawer lists them in its
terminal sidebar like setup-script terminals (`setup-<id>`,
`apps/server/src/project/ProjectSetupScriptRunner.ts:341`). This is accepted (PRODUCT.md,
open question 1). Tasks never allocate ids from the drawer's `term-N` sequence, so the
drawer's own id allocation (`ChatView.tsx:977-986,1991-1994`) is unaffected.

### Recent commands

`loom:bottom-dock:recent-commands:v1`: `{ [projectKey]: string[] }`, at most 10 per project,
through `resolveStorage` in try/catch. Commands are what the user typed; they are not
secrets by nature, but the list has a "Clear" action.

### Tab badge

Running task count for the active thread, from the known sessions (already subscribed by
ChatView, so no extra traffic).

## Phase 3: Activity

### Data

Everything comes from the active thread's detail, which ChatView already subscribes to
(`useThread`, `apps/web/src/state/entities.ts:128`; activities at
`packages/contracts/src/orchestration.ts:596-606`, thread fields `messages`,
`proposedPlans`, `activities`, `checkpoints` at `:780-786`). Reading the same atom from the
dock costs no extra subscription.

`deriveActivityRows(thread)` (pure, `apps/web/src/fork/bottom-dock/activity/rows.ts`) maps:

| Source                                                | Row kind                               | Tone for filters |
| ----------------------------------------------------- | -------------------------------------- | ---------------- |
| `messages` (user, assistant; skip streaming partials) | message                                | Messages         |
| `activities` with tone `tool`                         | work                                   | Work             |
| `activities` with tone `approval`                     | decision                               | Decisions        |
| `activities` with tone `error`, and `runtime.warning` | error or warning                       | Errors           |
| other `activities` (`info`)                           | info                                   | Work             |
| `proposedPlans`                                       | plan                                   | Work             |
| `checkpoints`                                         | checkpoint ("Turn N: 4 files changed") | Work             |

Each row: `id`, `turnId`, `createdAt`, `kind`, `tone`, `title` (activity `summary`, or the
message's first line up to 160 characters), `searchText` (lowercased title plus kind plus,
for messages, the full text up to 4 KB), and a lazy `detail()` returning the payload as
formatted JSON (capped at 20 KB) or the message text. Sorted newest first by `createdAt`,
then `sequence`.

Upstream's work-log derivation (`deriveWorkLogEntries`, `apps/web/src/session-logic.ts:451`)
hides noise rows (tool started, progress, context-window updates, internal agent rows).
Activity uses the same exclusions by calling the exported predicates where they are exported,
and otherwise a local copy of the kind list with a comment pointing at the upstream lines.

### Search and filters

The query uses `useDeferredValue`; matching is token-based substring over `searchText`
(every token must match), the same rule as the command palette
(`CommandPalette.logic.ts:420-423`). Filter chips and "Group by turn" are in-memory state
per thread (not persisted).

### Rendering

A virtualized list with `@legendapp/list` (already used by
`apps/web/src/components/chat/MessagesTimeline.tsx`), fixed estimated row height 32 px,
expanded rows measured. The dock height bounds the viewport.

### Older history

The client holds a window of the thread (the server sends at most 500 activities per detail
load, `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:97`). When
`threadHasOlderTurns(state)` (`packages/client-runtime/src/state/threadState.ts:35`) is true
for `useEnvironmentThread(environmentId, threadId)` (`apps/web/src/state/threads.ts:35`),
the list ends with "Load older turns", which calls `requestOlderThreadTurns(environmentId,
threadId)` (`packages/client-runtime/src/state/threads.ts:115`), the same call ChatView's
"load earlier" header uses (`ChatView.tsx:1547-1563`). A search that finds nothing shows the
same button when older history exists.

## Phase 4: Approvals

### Data

- Which threads: `useThreadShells()` (`apps/web/src/state/entities.ts:77-79`), filtered to
  `hasPendingApprovals || hasPendingUserInput`
  (`packages/contracts/src/orchestration.ts:850-851`), non-archived, across all connected
  environments. This is shell data the sidebar already holds.
- What is pending: one `ApprovalThreadGroup` component per flagged thread, each calling
  `useThreadDetail(ref)` (`entities.ts:105-109`) and
  `derivePendingRequests(detail.activities)`
  (`packages/client-runtime/src/pendingRequests.ts:121`, `PendingApproval` at `:12-19`).
  At most 20 groups subscribe (oldest pending first); the rest render from shell data with
  "Open thread to review". Subscriptions exist only while the Approvals tab is visible,
  because tab content is unmounted when hidden.

### Rendering and responding

Each approval reuses upstream's exported `ComposerPendingApprovalPanel`
(`apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx:11`) for the request body and
`ComposerPendingApprovalActions` (`ComposerPendingApprovalActions.tsx:29`) for the buttons,
so wording and options match the composer exactly. Responding uses
`useAtomCommand(threadEnvironment.respondToApproval, { reportFailure: false })` with
`{ environmentId, input: { threadId, requestId, decision } }`, as ChatView does
(`ChatView.tsx:1502-1504,8246-8270`); the command is
`thread.approval.respond` (`orchestration.ts:1288-1295`). A failure shows inline on the row.
User-input requests show their question text and an "Open thread" button (navigate to
`/$environmentId/$threadId`, `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`).

### Tab badge

Count of shells with `hasPendingApprovals` (cheap; shell data). It counts threads, not
requests, because request counts need details; the label says "Approvals 3" meaning three
threads, with the tooltip "3 threads waiting".

## Surfaces and version skew

Every phase is client-only and uses upstream RPCs and data, so there is no `loomFeatures`
entry and no server change. A Loom client on an upstream server gets the full dock.
Upstream clients are unaffected.

## Performance

- Closed dock: `ForkBottomDock` subscribes only to the active thread's `terminalOpen` and its
  own store slice, and renders nothing.
- Hidden tabs are unmounted; only the visible tab's subscriptions exist.
- Activity derivation is memoized on the thread's arrays; search is deferred; the list is
  virtualized.
- Approvals subscribe to at most 20 thread details, only while visible.
- Tasks mounts one terminal viewport at a time.
- No continuous animation; the only transition is upstream's panel animation during open,
  close and tab switches.

## Alternatives considered

- **Wrapping the drawer list in a `<BottomDock>` element.** It would re-indent 17 upstream
  lines, turning every upstream edit there into a conflict. Inserting a sibling above the
  list needs 2 lines.
- **Hosting the terminal inside the dock with `mode="panel"`** (old Loom did this). It would
  duplicate upstream's drawer logic (mounting of hidden threads, id allocation, focus
  routing) and diverge on every upstream change.
- **A dock height separate from the terminal's.** Switching tabs would jump; sharing
  upstream's per-thread height is simpler and already persisted.
- **Server-run tasks with captured exit codes.** Needs a fork process runner with
  streaming, kill and reconnect semantics; the terminal already has all of that. Exit codes
  are a possible later addition.
- **Server-side Activity search** (old Loom's paged SQL over `projection_thread_activities`).
  Worth it only if client-side search over the loaded window proves insufficient.
- **Columns** (old Loom). More layout state for little gain; one tab at a time is simpler.
