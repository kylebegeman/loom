# L04 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Line numbers drift;
search for the quoted code when they do.

## Overview

```
 ThreadInspectorHeaderButton (ChatHeader seam)        ForkPanelHost (ext-panels)
   Popover anchored to the eye button                   |
   '- InspectorCard (the glance)                        '- ThreadInspectorPanel (the workbench)
        |                                                    |
        +---------------- both read ------------------------+
        |
        |- useInspectorInputs(threadRef)   (hooks over upstream atoms)
        |- deriveInspectorModel(inputs)    (pure, tested; one typed model)
        |- InspectorHero                   (status, elapsed, step, facts, Respond)
        '- parts.tsx primitives + useInspectorActions(threadRef)
```

No server code, no contracts, no RPCs, no persisted state.

## Data sources (all existing)

| Datum                      | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread (shell plus detail) | `useThread(ref)` (`apps/web/src/state/entities.ts:128-146`): session, latestTurn, modelSelection, runtimeMode, interactionMode, branch, worktreePath, activities, messages, proposedPlans, checkpoints. Same atoms as `ChatView`, so no extra subscription for the active thread.                                                                                                                                                                           |
| Shell flags                | `useThreadShell(ref)`: `hasPendingApprovals`, `hasPendingUserInput` (the header dot), `planProgress`, `backgroundLiveness` (`packages/contracts/src/orchestration.ts:815-873`).                                                                                                                                                                                                                                                                             |
| Project                    | `useProject(scopeProjectRef(env, thread.projectId))` (`apps/web/src/state/entities.ts:95`) for `workspaceRoot` and name.                                                                                                                                                                                                                                                                                                                                    |
| Session phase              | `derivePhase(session)` (`apps/web/src/session-logic.ts:1735`).                                                                                                                                                                                                                                                                                                                                                                                              |
| Git status                 | `useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd } }))` with `cwd = thread.worktreePath ?? project.workspaceRoot`, the same key `ChatView` uses (`apps/web/src/components/ChatView.tsx:3585-3595`), so the query is shared, not duplicated. Result `VcsStatusResult` (`packages/contracts/src/git.ts:212-251`): `isRepo`, `refName`, `workingTree.files[{path, insertions, deletions}]`, totals, `aheadCount`, `behindCount`, `pr`. |
| Last turn's files          | `thread.checkpoints.at(-1)` (`OrchestrationCheckpointSummary`, `orchestration.ts:577-585`): `turnId`, `files[{path, kind, additions, deletions}]`, `status`.                                                                                                                                                                                                                                                                                                |
| Plan                       | `deriveActivePlanState(activities, latestTurnId)` (`session-logic.ts:324`, `ActivePlanState` at 113) and `findLatestProposedPlan(...)` (353, `LatestProposedPlanState` at 124, with `implementationThreadId`). Match `ChatView`'s arguments at `ChatView.tsx:3020-3031`.                                                                                                                                                                                    |
| Approvals and questions    | `derivePendingRequests(activities)` (`packages/client-runtime/src/pendingRequests.ts:122`): `approvals[]` (`requestKind`, `detail`, `appName`), `userInputs[]` (`questions[]`).                                                                                                                                                                                                                                                                             |
| Subagents                  | `deriveAgentPanelModel({ agents: foldSubagentActivities(activities, { sessionLive }) })` (`packages/client-runtime/src/state/subagentRuntime.ts:463,732`; `AgentPanelModel` at 698: counts, `directAgents`, `workflows`), as `ChatView.tsx:2869-2878` does.                                                                                                                                                                                                 |
| Terminals                  | `useKnownTerminalSessions({ environmentId, threadId })` (`apps/web/src/state/terminalSessions.ts:160`) filtered to `state.hasRunningSubprocess`, labeled with `resolveTerminalSessionLabel` (`packages/shared/src/terminalLabels.ts`), the same label the terminal tabs show.                                                                                                                                                                               |
| Context window             | `deriveLatestContextWindowSnapshot(activities)` (`apps/web/src/lib/contextWindow.ts:28`): used and max tokens, percentages, total processed, automatic compaction.                                                                                                                                                                                                                                                                                          |
| Provider and model         | `deriveProviderInstanceEntries(serverConfig.providers)` (`apps/web/src/providerInstances.ts:94`) matched by `session.providerInstanceId ?? modelSelection.instanceId`; the model's display name from the entry's `models`, else the slug; `driverKind` picks the glyph from `PROVIDER_ICON_BY_PROVIDER`.                                                                                                                                                    |
| Working since              | `resolveWorkingStartedAt(thread)` and `formatWorkingDurationLabel` (`apps/web/src/components/Sidebar.logic.ts`), so the elapsed time matches the sidebar's.                                                                                                                                                                                                                                                                                                 |

Derivations over `activities` (up to 500 rows, `projector.ts:63-66`) are memoized on the
activities array identity, exactly as `ChatView` memoizes them. They run only while the panel
tab is visible or the card is open.

## Model (`apps/web/src/fork/thread-inspector/model.ts`, pure)

The source is the spec; in outline:

- `InspectorInputs`: the thread's session, latest turn, modes, branch, worktree, shell
  `planProgress` and `backgroundLiveness`, linked pull request; project name; provider
  (display name, model, driver kind); `supportsPullRequests`; git as
  `none | loading | error | ready`; last checkpoint; active and proposed plan; approvals;
  questions; the agent panel model; running terminals (id and label); context window. No
  clock: a running status or agent carries `since` and the view ticks it (below).
- `InspectorModel`, one typed shape per area rather than a generic row list, so the two
  surfaces can render the same value differently: `status` (label, tone, detail, since,
  progress, respond), `facts` (model with `driverKind`, runtime, plan mode), `attention`
  (approvals and questions, `mono` for commands and paths), `workspace` (project, git
  state, branch, remote, worktree; `short` for the card, `copy` for the panel),
  `pullRequest` (number, state, tone, glyph, title, action), `changes` (every file sorted by
  churn, totals, last turn), `plan` (steps, completed, current, proposed), `agents` (counts,
  summary, rows: working first, at most `INSPECTOR_AGENT_ROW_LIMIT`), `terminals`,
  `context` (tokens, percentage, tone at 75 and 90 percent, total processed, compaction),
  `needsAttention`.
- `InspectorTone`: `default | muted | info | warning | accent | danger | success`, rendered
  with theme tokens only (`info`, `warning`, `primary`, `destructive`, `success`).
- `InspectorAction`: `open-diff`, `open-turn-diff`, `open-agents`, `open-pull-request` (the
  thread's linked pull request), `open-terminal`, `focus-composer`, `open-thread`.

Rules worth testing:

- Status precedence matches upstream's pill: pending approval, pending input, error,
  working (with plan step `planProgress.step` and `completedSteps/totalSteps`), a ready
  proposed plan in plan mode, background work, monitoring, interrupted, ready.
- Elapsed time uses `latestTurn.startedAt` while running.
- Changes: when `git.status.isRepo` is false, `changes` is null and Workspace says "Not a
  git repository". Files sorted by `insertions + deletions`, then path.
- Last turn only when the last checkpoint `status === "ready"` and has files.
- A pull request known from git status shows its state and title; a linked one carries the
  `open-pull-request` action, and "Linked" when git status has no match.
- `needsAttention` is `approvals.length + userInputs.length > 0`.
- A draft yields the status and workspace only.

## Hook (`useInspectorInputs.ts`)

Gathers the inputs above for a `ScopedThreadRef`, memoizing each derivation on its source
identity and the result on its parts. A draft (no shell yet) reads its project, modes, branch
and worktree from the composer draft store and skips the git query.

Elapsed time is `InspectorElapsed` in `parts.tsx`: a 1 s `setInterval` that writes the text
node directly (as `AgentsPanel` does) and stops while `document.visibilityState` is not
`"visible"`. Ticks never re-render React.

## Actions (`actions.ts`)

`useInspectorActions(ref, onDone?)` returns `run(action)`; `onDone(action)` lets the card
close after a jump.

| Action              | Implementation                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-diff`         | `useDiffPanelStore.getState().selectGitScope(ref, "unstaged")` so the panel shows the uncommitted changes the inspector counted, then `useRightPanelStore.getState().open(ref, "diff")` (`apps/web/src/rightPanelStore.ts:130-133`).                                                                                                                                               |
| `open-turn-diff`    | `useDiffPanelStore.getState().selectTurn(ref, turnId)` (`apps/web/src/diffPanelStore.ts`, as `ChatView.tsx:9032` does), then `open(ref, "diff")`.                                                                                                                                                                                                                                  |
| `open-agents`       | `open(ref, "agents")` (as `ChatView.tsx:4511`).                                                                                                                                                                                                                                                                                                                                    |
| `open-pull-request` | `openPullRequest(ref, linkedPullRequest)`, as `ChatView`'s pull request surface does.                                                                                                                                                                                                                                                                                              |
| `open-terminal`     | `useRightPanelStore.getState().openTerminal(ref, terminalId)` (`rightPanelStore.ts:150`).                                                                                                                                                                                                                                                                                          |
| `focus-composer`    | `useComposerHandleContext()?.current?.focusAtEnd()` (`apps/web/src/composerHandleContext.ts`; the context is provided by `CommandPalette` around the whole app shell, `apps/web/src/components/CommandPalette.tsx:542` and `apps/web/src/routes/__root.tsx:195-201`, so both the panel and the header button can reach it). The approval and question panels live in the composer. |
| `open-thread`       | `navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) })` (`apps/web/src/threadRoutes.ts:42`).                                                                                                                                                                                                                                                          |

Copy is not an action: `InspectorCopyButton` in `parts.tsx` uses upstream's
`useCopyToClipboard` with the anchored copy toasts, like `DiffFilePathCopyButton`.

## Components (`apps/web/src/fork/thread-inspector/`)

| File                              | Purpose                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.ts`, `model.test.ts`       | Pure model and its tests.                                                                                                                                                                                                                                                                                                                                  |
| `useInspectorInputs.ts`           | Hook above.                                                                                                                                                                                                                                                                                                                                                |
| `actions.ts`                      | `useInspectorActions(ref, onDone?)` returning `run(action)`.                                                                                                                                                                                                                                                                                               |
| `parts.tsx`                       | Primitives both surfaces and registered sections build from: status dot, elapsed time, progress bar, text (end or middle truncation), row (a button with a chevron when it has `onClick`), field, note, section (title, digest, one tool), copy button, attention row, pull request state icon. Tones map to theme tokens here and nowhere else.           |
| `InspectorHero.tsx`               | The status block both surfaces open with: dot and label, elapsed time, Respond, the detail (plan step, error, question), the plan progress bar, the fact chips (`Badge` outline with the provider glyph).                                                                                                                                                  |
| `InspectorCard.tsx`               | The glance content: hero, up to three attention rows, one row per area (workspace lines, pull request, changes or last turn, plan, agents, up to three terminals, context with a small bar), registered sections with `surface: "card"`, and the "Open inspector panel" footer with the shortcut label.                                                    |
| `ThreadInspectorPanel.tsx`        | The workbench: the hero in a bordered header, then a `ScrollArea` of sections (Needs you, Workspace with copy buttons and the pull request, Changes with the eight largest files and the last turn, Plan with every step, Agents, Terminals, Context) and registered sections with `surface: "panel"`. Mounted only while its tab is visible.              |
| `panel.tsx`                       | `ForkPanelDefinition` `{ id: "thread-inspector", title: "Inspector", icon: PanelTopIcon, shortcut: "I", isAvailable: ({ threadRef }) => threadRef !== null }`.                                                                                                                                                                                             |
| `commands.ts`                     | `openThreadInspectorPanel(ref)` and `toggleThreadInspectorPanel(ref)`.                                                                                                                                                                                                                                                                                     |
| `sections.ts`                     | `FORK_INSPECTOR_SECTIONS` registry for other packets (below).                                                                                                                                                                                                                                                                                              |
| `cardStore.ts`                    | Zustand store `{ open, setOpen, toggle, close }` (in memory; the keybinding host and the button share it).                                                                                                                                                                                                                                                 |
| `ThreadInspectorHeaderButton.tsx` | The header seam component: the eye button (`EyeIcon`, attention dot) as a `PopoverTrigger`, the card in a `PopoverPopup`.                                                                                                                                                                                                                                  |
| `InspectorCommandsHost.tsx`       | `ForkRoot` component: for a sent thread on the route (`useRouteThread`, which reads the route and draft store, not the thread's detail), `onForkCommand("loom.thread-inspector.toggle")` toggles the panel and `onForkCommand("loom.thread-inspector.card")` toggles `cardStore`. On drafts and other routes nothing subscribes, so the keys fall through. |
| `palette.tsx`                     | Palette source. Its "Show" items open the panel or the card; only the keybindings toggle.                                                                                                                                                                                                                                                                  |

Module graph: `ThreadInspectorHeaderButton` imports `commands.ts`, which imports the panel
registry, which imports `panel.tsx` and the panel component. Nothing under the panel imports
`commands.ts` or the registry, so the graph has no cycle; keep it that way.

### The card

The card is upstream's `Popover` (`apps/web/src/components/ui/popover.tsx`, base-ui):
`PopoverTrigger` wraps the eye button and `PopoverPopup` takes `side="bottom"`,
`align="end"`, `sideOffset={6}`, `padding="none"` and `width="md"` (20 rem), so its right
edge sits on the button's right edge. base-ui portals it, positions it against the button,
flips and shifts it inside the viewport, scrolls its viewport at `--available-height`,
closes it on an outside press or Escape, and returns focus to the button on close. The open
state lives in `cardStore` so the keybinding host can toggle it; a thread switch closes it
(an effect keyed by thread). Respond hands focus to the composer, so after a
`focus-composer` action the popup's `finalFocus` answers false once. The content mounts only
while open, so a closed card subscribes to nothing.

Toggle panel command: if the active surface for the thread is the inspector, `close(ref)`;
else `openSurface(ref, forkPanelSurface("thread-inspector"))` (EXTENSION-POINTS.md, Right
panels).

### Section registry for other packets

```ts
export type InspectorSurface = "card" | "panel";

export interface ForkInspectorSection {
  readonly id: string; // "<slug>:<name>"
  readonly title: string;
  /** A hook-backed component; render null when there is nothing to show. */
  readonly Component: ComponentType<{
    readonly threadRef: ScopedThreadRef;
    readonly surface: InspectorSurface;
  }>;
}
/** One line per packet; rendered after the built-in sections in this order. */
export const FORK_INSPECTOR_SECTIONS: ReadonlyArray<ForkInspectorSection> = [];
```

A packet that registers here checks its own `loomFeatures` entry inside its component and
builds its rows from `parts.tsx` (`InspectorSection`, `InspectorRow`) so they read like the
built-in ones. On the card, render one line; on the panel, a section.

## Agent-facing tools

None.

## Performance

- Nothing is mounted unless the panel tab is visible or the card is open.
- The git status query is shared with `ChatView` (same atom key), so opening the inspector
  adds no RPC for the active thread.
- Derivations are memoized per activities identity; streaming assistant text changes
  messages, not activities, so most streaming updates do not recompute them. Changes to
  `activities` recompute a few linear passes over at most 500 rows.
- Lists are capped (eight files, five agents, three approvals and terminals on the card);
  the diff and agents panels list everything.
- No continuous animation. The elapsed-time ticker runs at 1 Hz only while working and
  visible; bars transition only when their value changes.

## Alternatives considered

- **A fixed-position card docked under the header** (the first build). Replaced by the
  popover: base-ui already handles anchoring, viewport collision, dismissal and focus return,
  and the card follows the button when the header reflows instead of closing.
- **A persistent card or a "keep open" pin.** Rejected: Kyle confirmed light dismissal
  only (as for old Loom's card, ledger 1359); the panel tab is the keep-open view.
- **A compact density for narrow windows.** Dropped: the card is the compact form; the panel
  scrolls.
- **Reuse `ChatView`'s already-derived values** (pass them down). Would need props threaded
  through `ChatView` and `ChatHeader`: more seams. Recomputing from the same atoms is cheap.
- **A server-side status RPC** (old Loom's later designs). Unnecessary: every datum is
  already on the client.
