# L07 implementation plan

One agent per phase. Each phase leaves the tree compiling, tested and shippable. Phase 1
comes first; phases 2, 3 and 4 are independent of each other; phase 5 follows phase 4.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. For the manual checks, seed a worktree `.t3` with real data (AGENTS.md, "Test data"):
threads with long histories for Activity, a project with scripts for Tasks, and (for
Approvals) a thread in "Ask" permission mode.

## File layout (all phases)

```
apps/web/src/fork/bottom-dock/
  ForkBottomDock.tsx      phase 1: the seam target; strip + active fork tab
  DockTabStrip.tsx        phase 1
  DockResizeHandle.tsx    phase 1
  dockView.ts             phase 1: resolveDockView (pure) + tests
  layout.ts               phase 1: height limits, clamp (pure) + tests
  store.ts                phase 1: persisted per-thread dock state
  registry.ts             phase 1: DOCK_TABS
  DockCommandHost.tsx     phase 1: ForkRoot component for loom.bottom-dock.* commands
  palette.tsx             phase 1: palette source
  tasks/                  phase 2: TasksTab.tsx, taskModel.ts (+ test), useTaskActions.ts, tab.ts
  activity/               phase 3: ActivityTab.tsx, rows.ts (+ test), search.ts (+ test), tab.ts
  approvals/              phase 4: ApprovalsTab.tsx, ApprovalThreadGroup.tsx, grouping.ts (+ test), tab.ts
                          phase 5: RiskBadge.tsx
packages/contracts/src/fork/bottom-dock.ts          phase 5
packages/client-runtime/src/fork/bottom-dock.ts     phase 5
apps/server/src/fork/bottom-dock/                   phase 5: decide.ts, pendingApproval.ts (+ test),
                                                    ApprovalRiskService.ts (+ test), rpc.ts
docs/fork/user/bottom-dock.md
```

## Phase 1: shell

1. **Extension points.** Existence checks for `ext-core`, `ext-web-root`,
   `ext-keybindings`, `ext-palette`; create missing ones in their own commits.

2. **Pure logic, test first.**

   ```ts
   // dockView.ts
   export type DockView =
     | { readonly kind: "closed" }
     | { readonly kind: "terminal"; readonly showStrip: boolean }
     | { readonly kind: "fork"; readonly tabId: string };

   export function resolveDockView(input: {
     readonly terminalOpen: boolean;
     readonly forkTab: string | null;
     readonly registeredTabIds: ReadonlyArray<string>;
   }): DockView {
     const forkTab =
       input.forkTab !== null && input.registeredTabIds.includes(input.forkTab)
         ? input.forkTab
         : null;
     if (input.terminalOpen)
       return { kind: "terminal", showStrip: input.registeredTabIds.length > 0 };
     if (forkTab !== null) return { kind: "fork", tabId: forkTab };
     return { kind: "closed" };
   }

   // layout.ts: mirrors ThreadTerminalDrawer.tsx:93-105 (module-private upstream).
   export const DOCK_MIN_HEIGHT = 180;
   export const DOCK_MAX_HEIGHT_RATIO = 0.75;
   export const clampDockHeight = (height: number, windowHeight: number) =>
     Math.min(
       Math.max(height, DOCK_MIN_HEIGHT),
       Math.max(DOCK_MIN_HEIGHT, windowHeight * DOCK_MAX_HEIGHT_RATIO),
     );
   ```

3. **Store and registry** (`store.ts`, `registry.ts`) as in TECHNICAL.md.

4. **`ForkBottomDock`.**

   ```tsx
   export function ForkBottomDock({ threadRef }: { threadRef: ScopedThreadRef | null }) {
     if (threadRef === null || DOCK_TABS.length === 0) return null;
     return <BottomDock threadRef={threadRef} />;
   }

   function BottomDock({ threadRef }: { threadRef: ScopedThreadRef }) {
     const terminal = useTerminalUiStateStore((s) =>
       selectThreadTerminalUiState(s.terminalUiStateByThreadKey, threadRef),
     );
     const forkTab = useBottomDockStore(
       (s) => s.byThreadKey[scopedThreadKey(threadRef)]?.forkTab ?? null,
     );
     const view = resolveDockView({
       terminalOpen: terminal.terminalOpen,
       forkTab,
       registeredTabIds: DOCK_TAB_IDS,
     });
     // Upstream opened the terminal while a fork tab showed: terminal wins.
     useEffect(() => {
       if (terminal.terminalOpen && forkTab !== null)
         useBottomDockStore.getState().setForkTab(threadRef, null);
     }, [terminal.terminalOpen, forkTab, threadRef]);
     const badges = useDockBadges(threadRef); // fixed-order hook calls over DOCK_TABS
     if (view.kind === "closed") return null;
     return (
       <>
         {(view.kind === "fork" || view.showStrip) && (
           <DockTabStrip
             threadRef={threadRef}
             active={view.kind === "fork" ? view.tabId : "terminal"}
             badges={badges}
           />
         )}
         {view.kind === "fork" && (
           <DockTabBody threadRef={threadRef} tabId={view.tabId} height={terminal.terminalHeight} />
         )}
       </>
     );
   }
   ```

   `DockTabBody` wraps the tab in the same grid wrapper classes as upstream's drawer
   (`ChatView.tsx:1196-1204`), renders `DockResizeHandle` at its top edge, and renders
   `tab.Component` inside an error boundary that shows "This tab failed to render. Close it
   and try again." and logs, so a broken tab cannot take down ChatView.

   Resize handle: pointer capture, local height during the drag, `setTerminalHeight(ref,
clamped)` on pointer-up, re-clamp on window resize. Copy the behavior from
   `ThreadTerminalDrawer.tsx:1321-1377`, not its code wholesale.

5. **Seam.** Apply the two hunks in SEAMS.md to `ChatView.tsx`. Run `vp fmt` on the file and
   confirm the marker lines survived.

6. **Commands and palette.** Append `"loom.bottom-dock.toggle"` to `FORK_KEYBINDING_COMMANDS`;
   add `DockCommandHost` to `FORK_ROOT_COMPONENTS`; add the palette source to
   `FORK_COMMAND_PALETTE_SOURCES`. Actions live in `store.ts` as plain functions:

   ```ts
   export function showDockTab(ref: ScopedThreadRef, tabId: string) {
     useTerminalUiStateStore.getState().setTerminalOpen(ref, false);
     useBottomDockStore.getState().setForkTab(ref, tabId);
   }
   export function showTerminalTab(ref: ScopedThreadRef) {
     useBottomDockStore.getState().setForkTab(ref, null);
     useTerminalUiStateStore.getState().setTerminalOpen(ref, true);
   }
   export function hideDock(ref: ScopedThreadRef) {
     useBottomDockStore.getState().setForkTab(ref, null);
     useTerminalUiStateStore.getState().setTerminalOpen(ref, false);
   }
   ```

7. **Docs.** `docs/fork/user/bottom-dock.md` (the dock, the one-tab rule, the shared
   height). FORK.md "Packet seams" row. Packet index Status: "In progress (phase 1 done)".

Phase 1 alone renders nothing new (no tabs registered). Its proof is the unit tests and a
manual check that the terminal behaves exactly as upstream. It is fine, and simpler to
review, to land phase 1 together with the first tab phase.

## Phase 2: Tasks

1. `tasks/taskModel.ts` (pure, test first): `taskTerminalId(scriptId)`,
   `adHocTerminalId(n)`, `isTaskTerminalId`, `taskRowState(summary, hasRunSinceOpen)`,
   `nextAdHocIndex(sessions)`, recent-command list update (dedupe, cap 10).
2. `tasks/useTaskActions.ts`: `run`, `stop`, `restart`, `remove`, built on
   `useAtomCommand(terminalEnvironment.open | write | close)` with cwd and env computed with
   `projectScriptCwd` and `projectScriptRuntimeEnv` exactly as `runProjectScript`
   (`ChatView.tsx:4159-4200`). Failures surface on the row (not `setThreadError`, which is
   ChatView-local).
3. `tasks/TasksTab.tsx`: two-pane layout (list 240 px, output fills), stacking under 560 px
   wide; the command field with recent commands in a menu; the selected task's
   `TerminalViewport` (`ThreadTerminalDrawer.tsx:335`). Pass `keybindings` from
   `primaryServerKeybindingsAtom` (as `ext-keybindings`' `ForkGlobalShortcuts` does) and
   `advancedTypography` from the same `useLocalStorage` value the drawer reads
   (`ThreadTerminalDrawer.tsx:1080`).
4. `tasks/tab.ts`: `DockTabDefinition` (`id: "tasks"`, `ListChecksIcon` from lucide,
   `command: "loom.bottom-dock.tasks"`, `useBadge` = running task count). Append to
   `DOCK_TABS`; append the command; add "Run task: <name>" palette items for the active
   thread's scripts.
5. User doc section.

Pitfalls: the terminal must be opened before the first write; a task row for a script whose
id changed in settings becomes an orphan session (list it under "Other tasks" with Remove);
never write to a `term-N` session.

## Phase 3: Activity

1. `activity/rows.ts` (pure, test first): `deriveActivityRows(thread, { includeMessages })`,
   with the noise-kind exclusions mirroring `deriveWorkLogEntries`
   (`apps/web/src/session-logic.ts:451-512`); messages are skipped unless `includeMessages`.
2. `activity/search.ts` (pure): `filterRows(rows, { query, chips })`, token matching, and
   `groupByTurn(rows)`; `activityEmptyState(thread, { includeMessages, rows })` returning
   `"empty"`, `"only-messages"` or `"no-matches"`.
3. `activity/ActivityTab.tsx`: search input with `useDeferredValue`, chips (All, Work,
   Decisions, Errors), the "Messages" toggle (off by default, per thread, in memory), the
   virtualized list (`@legendapp/list`, as `MessagesTimeline.tsx` uses it), expandable rows
   with Copy, "Load older turns" via `threadHasOlderTurns` / `requestOlderThreadTurns`, and
   the "Only chat messages so far." state with "Show messages".
4. `activity/tab.ts`: `id: "activity"`, `HistoryIcon`, `command: "loom.bottom-dock.activity"`,
   no badge. Register; append the command; user doc section.

Pitfall: `thread.activities` can hold 500+ items with large payloads; never stringify
payloads during derivation, only in `detail()` on expand.

## Phase 4: Approvals

1. `approvals/grouping.ts` (pure, test first): from shells, the ordered list of threads to
   show (pending first by `updatedAt` ascending, archived excluded), the first 20 marked for
   detail loading; badge count.
2. `approvals/ApprovalThreadGroup.tsx`: `useThreadDetail(ref)`, `derivePendingRequests`,
   `ComposerPendingApprovalPanel` plus `ComposerPendingApprovalActions` per approval,
   `respondToApproval` via `useAtomCommand`, per-row responding and error state; user-input
   requests with "Open thread".
3. `approvals/ApprovalsTab.tsx`: groups, empty state, overflow list.
4. `approvals/tab.ts`: `id: "approvals"`, `ShieldQuestionIcon`,
   `command: "loom.bottom-dock.approvals"`, `useBadge` = threads with pending approvals.
   Register; append the command; user doc section.

Pitfall: a thread's shell can lag its detail by a moment after a response; hide a group only
when its derived pending list is empty, not when the shell flag clears.

## Phase 5: approval risk badge (Jev)

1. **Extension points.** Existence checks for `ext-settings` (EXTENSION-POINTS.md section 7)
   and then `ext-decide` (section 18); create each missing one, exactly as specified there, in
   its own commit, `ext-settings` first. `ext-core`'s server parts exist already if any
   server packet landed; otherwise its existence check covers them.
2. **Pure logic, test first.**
   - `apps/server/src/fork/bottom-dock/pendingApproval.ts`: `findPendingApproval(activities,
requestId)` returning `{ requestKind, detail, appName } | null`, copied from the approval
     half of `derivePendingRequests` with a comment pointing at
     `packages/client-runtime/src/pendingRequests.ts:122-196`.
   - `decide.ts`: `APPROVAL_RISK_FEATURE` (a `DecideFeature` with `agentTool: false`),
     `APPROVAL_RISK_QUESTIONS` and `buildApprovalRiskState(approval)` (TECHNICAL.md, Phase 5;
     caps `request_text` with `estimateTokens`, leaves redaction to `decide`), plus
     `toRiskResult(decideResult)` mapping `answered` to `labeled` and every `fallback`
     (including `low-confidence` with answers) to `none`.
3. **Contract.** `packages/contracts/src/fork/bottom-dock.ts` with `BottomDockRpcGroup`;
   register in `fork/index.ts` and `fork/rpc.ts`. Typecheck contracts.
4. **Service.** `ApprovalRiskService.ts`: cache (500 entries), in-flight dedupe with a
   `Deferred` per request id, lookup through `ProjectionSnapshotQuery`, then
   `LoomDecide.decide("bottom-dock.approval-risk", { state, questions }, { origin: "auto",
threadId, projectId })` with no `threshold` and no confidence re-check. Do not cache
   `timeout` or `error`. The service has no dependency on the
   orchestration engine, so it cannot dispatch commands.
5. **Registration.** `APPROVAL_RISK_FEATURE` appended to `FORK_DECIDE_FEATURES`
   (`apps/server/src/fork/decide/registry.ts`); `"bottom-dock"` in
   `LOOM_SERVER_FEATURES`; service in `ForkServices` and `ForkServicesLive`; `rpc.ts`
   handler with `auth.effect(TAG, withForkRuntime(...))`; scope `orchestration:read`.
6. **Client.** `packages/client-runtime/src/fork/bottom-dock.ts` (query family,
   `staleTimeMs: Infinity`); `approvals/RiskBadge.tsx` mounted by `ApprovalThreadGroup` next
   to each approval header, gated on `useDecideFeature(environmentId,
"bottom-dock.approval-risk").usable` and `bottom-dock` in `loomFeatures`; renders
   nothing while loading and on `none`; muted variant for Read-only and Reversible, warning
   variant for Irreversible; tooltip copy from PRODUCT.md.
7. **Docs.** User doc section "Approval risk badge": what the three labels mean, that it is
   Jev's estimate from the request text only, that it never answers anything, and where to
   turn it off (Loom settings, Jev, "Approval risk badge", "Use Jev"; or "Jev off for this
   project").

Pitfalls: never send more than the request text (no thread history); never show a badge on
fallback or while loading; the badge must not be focusable in a way that steals the
keyboard path to Approve and Decline.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done) (server and
`loomFeatures` items apply to phase 5 only), plus per phase:

- Phase 1: with no tabs registered, the terminal drawer is pixel- and behavior-identical to
  upstream; with a tab registered, the one-tab rule holds for every way in (tab click,
  Cmd+J, header button, script run, palette, fork commands).
- Phase 2: a dev server and a test watcher run side by side as tasks, survive closing the
  dock and switching threads, and stop with Stop.
- Phase 3: search finds a tool call from 200 turns ago after "Load older turns"; typing stays
  smooth on a 500-activity thread.
- Phase 3: with "Messages" off, no message rows appear and a messages-only thread shows the
  "Only chat messages so far." state; turning it on adds them.
- Phase 4: approving from the dock resolves the request in the thread on another client.
- Phase 5: with a Jev key, a pending `rm -rf` style command shows Irreversible and a `git
status` command shows Read-only (manual check); with no key, "Use Jev" off, the project
  switched off, or a scripted timeout, no badge appears and the tab is otherwise unchanged; no
  badge path can answer an approval.
