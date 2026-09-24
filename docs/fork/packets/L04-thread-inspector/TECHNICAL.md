# L04 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Line numbers drift;
search for the quoted code when they do.

## Overview

```
 ForkPanelHost (ext-panels) ----\
                                  >-- ThreadInspector({ threadRef, density })
 ThreadInspectorHeaderButton ---/        |
   (ChatHeader seam, portal card)        |- useInspectorInputs(threadRef)   (hooks over upstream atoms)
                                         |- deriveInspectorModel(inputs)    (pure, tested)
                                         '- InspectorSection rows + jump actions
```

No server code, no contracts, no RPCs, no persisted state.

## Data sources (all existing)

| Datum                      | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread (shell plus detail) | `useThread(ref)` (`apps/web/src/state/entities.ts:128-146`): session, latestTurn, modelSelection, runtimeMode, interactionMode, branch, worktreePath, activities, messages, proposedPlans, checkpoints. Same atoms as `ChatView`, so no extra subscription for the active thread.                                                                                                                                                                           |
| Shell flags                | `latestUserMessageAt`, `hasPendingApprovals`, `hasPendingUserInput`, `planProgress`, `backgroundLiveness`, `linkedPullRequest` (`packages/contracts/src/orchestration.ts:815-873`).                                                                                                                                                                                                                                                                         |
| Project                    | `useProject(scopeProjectRef(env, thread.projectId))` (`apps/web/src/state/entities.ts:95`) for `workspaceRoot` and name.                                                                                                                                                                                                                                                                                                                                    |
| Session phase              | `derivePhase(session)` (`apps/web/src/session-logic.ts:1735`).                                                                                                                                                                                                                                                                                                                                                                                              |
| Git status                 | `useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd } }))` with `cwd = thread.worktreePath ?? project.workspaceRoot`, the same key `ChatView` uses (`apps/web/src/components/ChatView.tsx:3585-3595`), so the query is shared, not duplicated. Result `VcsStatusResult` (`packages/contracts/src/git.ts:212-251`): `isRepo`, `refName`, `workingTree.files[{path, insertions, deletions}]`, totals, `aheadCount`, `behindCount`, `pr`. |
| Last turn's files          | `thread.checkpoints.at(-1)` (`OrchestrationCheckpointSummary`, `orchestration.ts:577-585`): `turnId`, `files[{path, kind, additions, deletions}]`, `status`.                                                                                                                                                                                                                                                                                                |
| Plan                       | `deriveActivePlanState(activities, latestTurnId)` (`session-logic.ts:324`, `ActivePlanState` at 113) and `findLatestProposedPlan(...)` (353, `LatestProposedPlanState` at 124, with `implementationThreadId`). Match `ChatView`'s arguments at `ChatView.tsx:3020-3031`.                                                                                                                                                                                    |
| Approvals and questions    | `derivePendingRequests(activities)` (`packages/client-runtime/src/pendingRequests.ts:122`): `approvals[]` (`requestKind`, `detail`, `createdAt`), `userInputs[]`.                                                                                                                                                                                                                                                                                           |
| Subagents                  | `deriveAgentPanelModel({ agents: foldSubagentActivities(activities, { sessionLive }) })` (`packages/client-runtime/src/state/subagentRuntime.ts:463,732`; `AgentPanelModel` at 698: running, waiting, idle, settled counts, `liveCount`, `totalTokens`), as `ChatView.tsx:2869-2878` does.                                                                                                                                                                  |
| Terminals                  | `useThreadRunningTerminalIds({ environmentId, threadId })` (`apps/web/src/state/terminalSessions.ts:178`).                                                                                                                                                                                                                                                                                                                                                  |
| Context window             | `deriveLatestContextWindowSnapshot(activities)` (`apps/web/src/lib/contextWindow.ts:28`): used and max tokens, percentages.                                                                                                                                                                                                                                                                                                                                 |
| Provider label             | `deriveProviderInstanceEntries(serverConfig.providers)` (`apps/web/src/providerInstances.ts:94`) matched by `session.providerInstanceId ?? modelSelection.instanceId`.                                                                                                                                                                                                                                                                                      |
| Status pill                | `resolveThreadStatusPill({ thread })` (`apps/web/src/components/Sidebar.logic.ts:985`) for consistent wording and colors with the sidebar.                                                                                                                                                                                                                                                                                                                  |

Derivations over `activities` (up to 500 rows, `projector.ts:63-66`) are memoized on the
activities array identity, exactly as `ChatView` memoizes them. They run only while the panel
or the card is open.

## Model (`apps/web/src/fork/thread-inspector/model.ts`, pure)

```ts
export interface InspectorInputs {
  readonly now: string; // ISO, from a 1 s ticker only while working and visible
  readonly thread: {
    readonly isDraft: boolean;
    readonly title: string;
    readonly session: OrchestrationSession | null;
    readonly latestTurn: OrchestrationLatestTurn | null;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly planProgress: { step: string; completedSteps: number; totalSteps: number } | null;
    readonly lastError: string | null;
  };
  readonly projectName: string | null;
  readonly providerLabel: string | null; // "Codex, gpt-5.x"
  readonly git: {
    readonly state: "loading" | "error" | "ready";
    readonly status: VcsStatusResult | null;
    readonly error: string | null;
  };
  readonly lastCheckpoint: OrchestrationCheckpointSummary | null;
  readonly activePlan: ActivePlanState | null;
  readonly proposedPlan: LatestProposedPlanState | null;
  readonly approvals: ReadonlyArray<PendingApproval>;
  readonly userInputs: ReadonlyArray<PendingUserInput>;
  readonly agents: AgentPanelModel;
  readonly runningTerminalIds: ReadonlyArray<string>;
  readonly contextWindow: ContextWindowSnapshot | null;
}

export type InspectorAction =
  | { readonly kind: "open-diff" }
  | { readonly kind: "open-turn-diff"; readonly turnId: TurnId }
  | { readonly kind: "open-agents" }
  | { readonly kind: "open-pull-requests" }
  | { readonly kind: "open-terminal"; readonly terminalId: string }
  | { readonly kind: "focus-composer" }
  | { readonly kind: "open-thread"; readonly threadId: ThreadId }
  | { readonly kind: "copy"; readonly text: string; readonly label: string };

export interface InspectorRow {
  readonly id: string;
  readonly icon: InspectorIconName; // mapped to lucide icons in the view
  readonly label: string;
  readonly value?: string;
  readonly tone?: "default" | "muted" | "warning" | "danger" | "success";
  readonly action?: { readonly label: string; readonly action: InspectorAction };
}

export interface InspectorSectionModel {
  readonly id:
    "status" | "workspace" | "changes" | "plan" | "attention" | "agents" | "terminals" | "context";
  readonly title: string;
  readonly rows: ReadonlyArray<InspectorRow>;
  /** Shown in the compact (card on a narrow window) density. */
  readonly essential: boolean;
}

export interface InspectorModel {
  readonly sections: ReadonlyArray<InspectorSectionModel>;
  readonly needsAttention: boolean; // drives the header button dot
}

export function deriveInspectorModel(inputs: InspectorInputs): InspectorModel;
```

Rules worth testing:

- Status precedence matches upstream's pill: pending approval, pending input, error,
  working (with plan step `planProgress.step` and `completedSteps/totalSteps`), interrupted,
  ready.
- Elapsed time uses `latestTurn.startedAt` while running.
- Changes: when `git.status.isRepo` is false, the section is omitted and Workspace says
  "Not a git repository". Top five files by `insertions + deletions`.
- Last turn row only when the last checkpoint `status === "ready"` and has files; action
  `open-turn-diff`.
- Plan: steps from `activePlan` (at most eight, then "and N more"); a proposed plan with
  `implementationThreadId` adds an `open-thread` action.
- `needsAttention` is `approvals.length + userInputs.length > 0`.
- Essential sections: status, attention.

## Hook (`useInspectorInputs.ts`)

Gathers the inputs above for a `ScopedThreadRef | null`, memoizing each derivation on its
source identity. The 1 s ticker runs only when the thread is running and the component is
mounted and `document.visibilityState === "visible"`; it is a `setInterval`, not an
animation frame loop.

## Actions (`actions.ts`)

| Action               | Implementation                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-diff`          | `useRightPanelStore.getState().open(ref, "diff")` (`apps/web/src/rightPanelStore.ts:130-133`).                                                                                                                                                                                                                                                                                     |
| `open-turn-diff`     | `useDiffPanelStore.getState().selectTurn(ref, turnId)` (`apps/web/src/diffPanelStore.ts`, as `ChatView.tsx:9032` does), then `open(ref, "diff")`.                                                                                                                                                                                                                                  |
| `open-agents`        | `open(ref, "agents")` (as `ChatView.tsx:4511`).                                                                                                                                                                                                                                                                                                                                    |
| `open-pull-requests` | `open(ref, "pull-requests")`.                                                                                                                                                                                                                                                                                                                                                      |
| `open-terminal`      | `useRightPanelStore.getState().openTerminal(ref, terminalId)` (`rightPanelStore.ts:150`).                                                                                                                                                                                                                                                                                          |
| `focus-composer`     | `useComposerHandleContext()?.current?.focusAtEnd()` (`apps/web/src/composerHandleContext.ts`; the context is provided by `CommandPalette` around the whole app shell, `apps/web/src/components/CommandPalette.tsx:542` and `apps/web/src/routes/__root.tsx:195-201`, so both the panel and the header button can reach it). The approval and question panels live in the composer. |
| `open-thread`        | `navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) })` (`apps/web/src/threadRoutes.ts:42`).                                                                                                                                                                                                                                                          |
| `copy`               | Upstream's `useCopyToClipboard` (`apps/web/src/hooks/useCopyToClipboard.ts`), with a success toast.                                                                                                                                                                                                                                                                                |

## Components (`apps/web/src/fork/thread-inspector/`)

| File                              | Purpose                                                                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.ts`, `model.test.ts`       | Pure model and its tests.                                                                                                                                                                                                    |
| `useInspectorInputs.ts`           | Hook above.                                                                                                                                                                                                                  |
| `actions.ts`                      | `useInspectorActions(ref)` returning `run(action)`.                                                                                                                                                                          |
| `ThreadInspector.tsx`             | Renders sections with `density: "full"                                                                                                                                                                                       | "compact"`; section and row primitives local to the folder (small, like old Loom's `threadInspectorParts`). |
| `sections.ts`                     | `FORK_INSPECTOR_SECTIONS` registry for other packets (below).                                                                                                                                                                |
| `panel.tsx`                       | `ForkPanelDefinition` `{ id: "thread-inspector", title: "Inspector", icon: PanelTopIcon, shortcut: "I", isAvailable: ({ threadRef }) => threadRef !== null }`.                                                               |
| `cardStore.ts`                    | Zustand store `{ open: boolean, toggle, close }` (in memory; the keybinding host and the button share it).                                                                                                                   |
| `ThreadInspectorHeaderButton.tsx` | The header seam component: eye icon button (`EyeIcon`) with the attention dot and a `data-loom-inspector-trigger` attribute; when open, renders `InspectorCard` in a portal.                                                 |
| `InspectorCard.tsx`               | Fixed-position card docked under the header at the chat's top-right; width 340 px; max height 60 vh with its own scroll; light dismissal (below).                                                                            |
| `InspectorCommandsHost.tsx`       | `ForkRoot` component: `onForkCommand("loom.thread-inspector.toggle")` toggles the panel for the active thread (from `useHandleNewThread().activeThread`); `onForkCommand("loom.thread-inspector.card")` toggles `cardStore`. |
| `palette.tsx`                     | Palette source.                                                                                                                                                                                                              |

Positioning and dismissal of the card, modeled on old Loom's `ThreadInspectorPinned`
(ledger 1359): on open, read the `[data-chat-header]` element's rect (set by
`ChatView.tsx:9356`) and place the card `position: fixed` just below it, right-aligned with
the header's right edge minus the header's own padding. It closes on a capture-phase
`pointerdown` outside the card that is not on the trigger (`[data-loom-inspector-trigger]`),
on Escape, on `window` `resize`, when a `ResizeObserver` on the header element reports a
width change (opening a panel, dragging a splitter, collapsing the sidebar), and after any
row action. Height changes are ignored so streaming replies do not close it. No scroll
listeners, no animation frames. `z-index` stays below dialogs and toasts; the surface uses
upstream's popover classes.

Toggle panel command: if the active surface for the thread is the inspector, `close(ref)`;
else `openSurface(ref, forkPanelSurface("thread-inspector"))` (EXTENSION-POINTS.md, Right
panels).

### Section registry for other packets

```ts
export interface ForkInspectorSection {
  readonly id: string; // "<slug>:<name>"
  readonly title: string;
  /** A hook-backed component; render null when there is nothing to show. */
  readonly Component: ComponentType<{
    readonly threadRef: ScopedThreadRef;
    readonly density: "full" | "compact";
  }>;
}
/** One line per packet; rendered after the built-in sections in this order. */
export const FORK_INSPECTOR_SECTIONS: ReadonlyArray<ForkInspectorSection> = [];
```

A packet that registers here checks its own `loomFeatures` entry inside its component.

## Agent-facing tools

None.

## Performance

- Nothing is mounted unless the panel tab is active or the card is open.
- The git status query is shared with `ChatView` (same atom key), so opening the inspector
  adds no RPC for the active thread.
- Derivations are memoized per activities identity; streaming assistant text changes
  messages, not activities, so most streaming updates do not recompute them. Changes to
  `activities` recompute a few linear passes over at most 500 rows.
- No continuous animation. The elapsed-time ticker runs at 1 Hz only while working and
  visible.

## Alternatives considered

- **Mount the card in `ChatView`'s banner overlay.** Would need a `ChatView` seam in
  addition to the header button; a portal positioned from the header keeps it to one seam.
- **A persistent card.** Kyle chose light dismissal for old Loom's card (ledger
  1359); the panel tab is the persistent view. Open question in PRODUCT.md.
- **Reuse `ChatView`'s already-derived values** (pass them down). Would need props threaded
  through `ChatView` and `ChatHeader`: more seams. Recomputing from the same atoms is cheap.
- **A server-side status RPC** (old Loom's later designs). Unnecessary: every datum is
  already on the client.
