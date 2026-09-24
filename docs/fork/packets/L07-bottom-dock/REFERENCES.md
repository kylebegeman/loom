# L07 references

Treat external repositories as references, not code to copy.

## Old Loom

P10 in [selections.md](../../selections.md). Old Loom (`bagelvault/loom` 0.13.10):

- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/bottomPanelStore.ts
  (613 lines). Keep: per-thread state keyed by scoped thread key, a persisted store with a
  version, singleton non-terminal tabs. Drop: up to three columns with percentage widths and
  module-counter column ids (not stable across sessions), and the hand-written migration.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/bottomPanelSurfaceRegistry.ts
  (103 lines: tab ids, labels, icons, order). Keep the registry idea; this packet's
  `DOCK_TABS` is the same shape, smaller.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/BottomPanelTabs.tsx
  (302 lines). Adapt: the per-frame drag handle. Drop: sliding the dock away with a negative
  `marginBottom` (upstream's grid-rows transition is the house style now).
- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/regionPanelStore.ts
  (500 lines) and https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/terminal/openDockTerminalSurface.ts
  (54 lines). Drop: two stores kept in sync by hand after every action; this packet derives
  the view from upstream's terminal store plus one fork store.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/panelLayout.ts (232 lines;
  `DOCK_MIN_HEIGHT = 180`, `DOCK_MAX_HEIGHT_RATIO = 0.72`, `clampDockHeight`). Keep the single
  clamp function; use upstream's 0.75 ratio so tabs match the terminal.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/chat/ThreadRuntimePanels.tsx
  (1,890 lines). `ThreadTasksPanel` (lines 347-461) was plan steps and pending requests, not
  scripts; this packet's Tasks is project scripts and commands as the brief asks.
  `ThreadApprovalsPanel` (619-866) read a cross-thread decisions API and polled secret
  requirements every 5 s; drop both (upstream has neither) and note its counter bug
  (lines 755 and 763 show the same number). `ThreadRunLedgerPanel` (463-516) and
  `ThreadRunPacketsPanel` (1429-1890): dropped by the brief.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/chat/ThreadActivityLedgerPanel.tsx
  (504 lines). Keep: search, tone chips (All, Work, Decisions, Errors), expandable rows with
  payload on demand, compact and full layouts. Drop: the server ledger RPC with facets and
  paging (`apps/server/src/persistence/Layers/ProjectionThreadActivities.ts:199-282` in old
  Loom); this packet searches the client window and pages with upstream's older-turns load.
- https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/ChatView.tsx
  (12,528 lines; `renderBottomPanelSurface` at 11916, `runProjectScript` at 5916-6005). The
  main lesson: old Loom put all dock wiring inside ChatView; this packet keeps ChatView to a
  three-line seam.

## Upstream T3 Code

- `apps/web/src/components/ThreadTerminalDrawer.tsx:93-105,305-335,989-1050,1321-1440`:
  drawer limits, `TerminalViewport`, props, drag, root element.
- `apps/web/src/components/ChatView.tsx:879-927,1196-1215,1476-1477,1502-1504,1547-1563,1943,1999-2005,2077-2091,2104-2107,4141-4263,6659,6814,8246-8270,9099-9113,9847-9866`.
- `apps/web/src/terminalUiStateStore.ts:20-30,242-244,352-353,480,567-582,771-778`.
- `apps/web/src/types.ts:29-38`, `apps/web/src/components/ChatView.logic.ts:65`.
- `apps/web/src/lib/terminalFocus.ts:1-3`: focus owner routing.
- `apps/web/src/rightPanelStore.ts:28,46-53,616-656`: right panel terminal surface.
- `packages/contracts/src/keybindings.ts:7,59-63,93-99`, `packages/shared/src/keybindings.ts:22-27`.
- `packages/contracts/src/terminal.ts:40-49,97-131`: open input and summaries.
- `apps/web/src/state/terminalSessions.ts:124,160,178`, `apps/web/src/state/terminal.ts:5`.
- `packages/shared/src/projectScripts.ts:17-75`, `packages/contracts/src/orchestration.ts:391-425`.
- `apps/server/src/project/ProjectSetupScriptRunner.ts:341`: `setup-<id>` terminals.
- `packages/contracts/src/orchestration.ts:596-606,780-786,815-851,1288-1295`.
- `apps/web/src/session-logic.ts:451-512`: work log derivation and exclusions.
- `apps/web/src/state/entities.ts:77-79,95-140`, `apps/web/src/state/threads.ts:35`.
- `packages/client-runtime/src/state/threadState.ts:35`,
  `packages/client-runtime/src/state/threads.ts:115,634`.
- `packages/client-runtime/src/pendingRequests.ts:12-19,86-93,121`.
- `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx:11`,
  `apps/web/src/components/chat/ComposerPendingApprovalActions.tsx:29`.
- `apps/web/src/components/Sidebar.logic.ts:526-534,985-996`: sidebar pending pills.
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:97`: 500-activity window.
- `apps/web/src/components/CommandPalette.logic.ts:369-443`: token matching.

## External

- `@legendapp/list` (already an `apps/web` dependency, MIT): https://github.com/LegendApp/legend-list.
- WAI-ARIA tabs pattern for the strip's keyboard behavior:
  https://www.w3.org/WAI/ARIA/apg/patterns/tabs/.
- Reference repositories in selections.md: none relevant.
