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
`apps/server/src/project/ProjectSetupScriptRunner.ts:341`). Kyle decided to keep them
visible there (PRODUCT.md, Decisions), so no drawer seam is needed. Tasks never allocate ids from the drawer's `term-N` sequence, so the
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
| `messages` (user, assistant; skip streaming partials) | message                                | Messages toggle  |
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

`deriveActivityRows(thread, { includeMessages })` skips the `messages` source entirely when
`includeMessages` is false (the default), so a long chat costs nothing until the toggle is
on. The memo key includes the flag.

Upstream's work-log derivation (`deriveWorkLogEntries`, `apps/web/src/session-logic.ts:451`)
hides noise rows (tool started, progress, context-window updates, internal agent rows).
Activity uses the same exclusions by calling the exported predicates where they are exported,
and otherwise a local copy of the kind list with a comment pointing at the upstream lines.

### Search and filters

The query uses `useDeferredValue`; matching is token-based substring over `searchText`
(every token must match), the same rule as the command palette
(`CommandPalette.logic.ts:420-423`). Filter chips (All, Work, Decisions, Errors), the
"Messages" toggle (default off) and "Group by turn" are in-memory state per thread (not
persisted). When the toggle is off and the thread has messages but no other rows, the empty
state is "Only chat messages so far." with a "Show messages" button that turns the toggle on.

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
  (`packages/client-runtime/src/pendingRequests.ts:122`, `PendingApproval` at `:12-19`).
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

## Phase 5: approval risk badge (Jev)

Advisory labels on pending approvals, from Jev through the shared `ext-decide` extension
point (EXTENSION-POINTS.md section 18). This is the only phase with server code.

### Feature registration

```ts
// apps/server/src/fork/bottom-dock/decide.ts
import type { DecideFeature } from "../decide/registry.ts";

export const APPROVAL_RISK_FEATURE: DecideFeature = {
  id: "bottom-dock.approval-risk",
  packet: "L07",
  label: "Approval risk badge",
  description:
    "Labels each pending approval in the bottom dock as read-only, reversible or irreversible; without Jev no badge is shown.",
  defaultMode: "manual",
  defaultThreshold: 0.6,
  agentTool: false,
};
```

Appended to `FORK_DECIDE_FEATURES` in `apps/server/src/fork/decide/registry.ts`. `manual`
means the badge is computed for every approval the Approvals tab shows once a Jev key is saved
(an automatic Loom use, origin `"auto"`). With `agentTool: false` the feature has only `off`
and `manual`: the Jev settings section hides "Let agents use this", `updateFeature` rejects
`manual-agents`, and agents never trigger this call.

### Contract (`packages/contracts/src/fork/bottom-dock.ts`)

```ts
export const BOTTOM_DOCK_WS_METHODS = {
  approvalRisk: "loom.bottom-dock.approvalRisk",
} as const;

export const ApprovalRiskLabel = Schema.Literals(["read-only", "reversible", "irreversible"]);

export const ApprovalRiskResult = Schema.Union([
  Schema.TaggedStruct("labeled", {
    label: ApprovalRiskLabel,
    confidence: Schema.Number,
    decisionId: Schema.String,
  }),
  /** No badge: Jev fell back (reason from ext-decide) or the request is no longer pending. */
  Schema.TaggedStruct("none", {
    reason: Schema.Literals([
      "not-pending",
      "disabled",
      "no-key",
      "project-off",
      "agent-not-allowed",
      "timeout",
      "error",
      "low-confidence",
    ]),
  }),
]);

export const BottomDockRpcGroup = RpcGroup.make(
  Rpc.make(BOTTOM_DOCK_WS_METHODS.approvalRisk, {
    payload: Schema.Struct({ threadId: ThreadId, requestId: ApprovalRequestId }),
    success: ApprovalRiskResult,
    error: EnvironmentAuthorizationError,
  }),
);
```

Scope `orchestration:read` (it reads a thread and changes nothing). Jev failures are not RPC
errors: they come back as `none` with the reason, so the client has one code path.

### Server (`apps/server/src/fork/bottom-dock/`)

| File                     | Contents                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `decide.ts`              | Feature definition above, the question, `buildApprovalRiskState`.                  |
| `pendingApproval.ts`     | `findPendingApproval(activities, requestId)` (pure).                               |
| `ApprovalRiskService.ts` | `loom/ApprovalRiskService`: lookup, in-flight dedupe, per-request cache, `decide`. |
| `rpc.ts`                 | `makeBottomDockRpcHandlers(auth)`.                                                 |

Data flow for `approvalRisk({ threadId, requestId })`:

1. Cache: an in-memory `Map<requestId, ApprovalRiskResult>` (request ids are unique; at most
   500 entries, oldest dropped) and a map of in-flight `Deferred`s, so two clients asking for
   the same request cause one Jev call.
2. Lookup: `ProjectionSnapshotQuery.getThreadDetailById(threadId)` (`apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:249`),
   then `findPendingApproval(detail.activities, requestId)`. The server cannot import
   `@t3tools/client-runtime` (not an `apps/server` dependency), so `pendingApproval.ts` is a
   short copy of the approval half of `derivePendingRequests`
   (`packages/client-runtime/src/pendingRequests.ts:122-196`: an `approval.requested`
   activity with that `requestId`, not followed by `approval.resolved` or a stale
   `provider.approval.respond.failed`; `requestKind` from the payload, else from
   `requestType` as `requestKindFromRequestType` maps it, `:49-66`), with a comment pointing
   at the upstream lines. Not pending gives `none` / `not-pending` without calling Jev.
3. State, built in code and kept to what the question needs (jev-1.13 accuracy drops with
   unrelated state, https://docs.typesafe.ai/model-jaggedness/jev-1.13):

   ```ts
   // buildApprovalRiskState(approval)
   {
     request_kind: "command" | "file-read" | "file-change" | "mcp-elicitation",
     app_name: string | null,          // payload.appName
     request_text: string,             // payload.detail, capped in code (below)
   }
   ```

   `request_text` is capped in code at 4,000 estimated tokens with `estimateTokens` from
   `apps/server/src/fork/decide/budget.ts` (longer text keeps the head and tail around a
   `[... N characters trimmed ...]` marker). The builder does not redact: `decide` always
   runs `redactState` and `fitBudget` on the state it sends, so key-like strings and `.env*`
   contents never leave the machine. No thread history, no file contents, no paths outside
   the request text.

4. Question (one Choice, criteria written literally, per the jev-1.13 guidance on literal
   reading):

   ```ts
   const APPROVAL_RISK_QUESTIONS = {
     risk: {
       type: "choice",
       instructions:
         "The coding agent asks permission for the action in `request_text`. " +
         "What is the worst lasting effect of allowing exactly that action?",
       criteria: {
         "read-only":
           "Only reads or inspects: lists or reads files, searches, shows status, diffs or logs, " +
           "runs a build or tests that write only build output. Nothing outside build output changes.",
         reversible:
           "Changes files or local state that can be undone locally: edits or creates files in the " +
           "project, installs dependencies, creates a local branch or commit, starts or stops a local process.",
         irreversible:
           "Cannot be undone locally: deletes files outside version control, discards uncommitted work, " +
           "rewrites or force-pushes git history, pushes, publishes or deploys, changes remote services " +
           "or accounts, sends messages or payments, or changes system settings.",
       },
     },
   } as const;
   ```

5. `LoomDecide.decide("bottom-dock.approval-risk", { state, questions }, { origin: "auto",
threadId, projectId })` (no `threshold`: the feature's configured threshold, else its
   `defaultThreshold` 0.6, applies). `decide` applies the threshold itself, so `answered` is
   already confident: it gives `labeled` with `answers.risk.choice` and
   `answers.risk.confidence`, with no second check here. Every `fallback` gives `none` with
   the same reason; the answers a `low-confidence` fallback carries are ignored (no badge).
   `projectId` comes from the thread shell (`decide` could derive it from `threadId`; passing
   it saves a lookup). The decision is logged by `ext-decide` in `fork_decide_decisions`.
6. Cache the result, including `none` results except `timeout` and `error` (those may
   succeed on the next tab open).

The service never dispatches an orchestration command. It has no access to
`respondToApproval`, and a test asserts that no command is dispatched.

Registration (fork-owned files): `BottomDockRpcGroup` in `packages/contracts/src/fork/rpc.ts`,
`"bottom-dock"` in `LOOM_SERVER_FEATURES`, `ApprovalRiskService` in `ForkServices` and
`ForkServicesLive`, the handler spread in `apps/server/src/fork/rpc.ts`, the scope in
`rpcAuthorization.ts`, and `APPROVAL_RISK_FEATURE` in `FORK_DECIDE_FEATURES`
(`apps/server/src/fork/decide/registry.ts`).

### Client

- `packages/client-runtime/src/fork/bottom-dock.ts`: `createBottomDockAtoms(runtime)` with
  one query family `approvalRisk` keyed by `(environmentId, threadId, requestId)`,
  `staleTimeMs: Infinity` (the answer for a request id never changes).
- `apps/web/src/fork/bottom-dock/approvals/RiskBadge.tsx`: rendered by
  `ApprovalThreadGroup` next to each approval's header. `ApprovalsTab` calls
  `useDecideFeature(environmentId, "bottom-dock.approval-risk")`
  (`apps/web/src/fork/decide/state.ts`) once per environment; the badge mounts its query only
  when that state is `usable` (the `decide` capability, "Use Jev" on, a key set, the feature
  not off) and the environment's `loomFeatures` includes `bottom-dock`; otherwise it renders
  nothing and sends nothing. "Jev off for this project" is not in that state; the server
  answers `none` / `project-off` for those threads. While loading it renders nothing (no spinner: the badge is
  optional and a spinner per row would be noise). `labeled` renders the badge with the
  tooltip "Jev's estimate, confidence 0.82. Advisory only: read the request before you
  answer."; `none` renders nothing.
- Styles: Read-only and Reversible use the muted badge variant; Irreversible uses the warning
  variant. No success (green) variant.
- The badge sits outside `ComposerPendingApprovalActions`; it has no click handler.

Because the Approvals tab mounts at most 20 thread groups, and only while visible, at most the
pending approvals of those groups are classified, each once per server run.

## Surfaces and version skew

Phases 1 to 4 are client-only and use upstream RPCs and data, so they have no `loomFeatures`
entry and no server change. A Loom client on an upstream server gets the full dock.
Upstream clients are unaffected.

Phase 5 adds the `bottom-dock` capability and one fork RPC. The badge is shown only when the
environment reports `bottom-dock` and `useDecideFeature` reports the feature `usable` (which
includes the `decide` capability); a Loom client on an upstream server, or on a Loom server
without Jev, shows the Approvals tab without badges and sends no `loom.decide.*` request.

## Performance

- Closed dock: `ForkBottomDock` subscribes only to the active thread's `terminalOpen` and its
  own store slice, and renders nothing.
- Hidden tabs are unmounted; only the visible tab's subscriptions exist.
- Activity derivation is memoized on the thread's arrays; search is deferred; the list is
  virtualized.
- Approvals subscribe to at most 20 thread details, only while visible.
- Risk badges: one small unary RPC per visible pending approval, cached forever on the client
  and per server run on the server; Jev calls are bounded by `ext-decide`'s 1 second timeout
  and never block the buttons.
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
