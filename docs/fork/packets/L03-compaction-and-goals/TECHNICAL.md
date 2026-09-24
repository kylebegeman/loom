# L03 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Line numbers drift;
search for the quoted code when they do.

## Overview

```
 Compaction (client-only)
   palette / keybinding --> threadEnvironment.startTurn({ message: { text: "/compact" } })
                             --> upstream ProviderCommandReactor /compact path (unchanged)

 Goals
   chip / palette / keybinding --> loom.compaction-and-goals.{getGoal,setGoal,clearGoal}
                                    --> ThreadGoalStore (fork_compaction_and_goals_goals)
   ProviderService.sendTurn --(ext-turn-input)--> goal contributor
                                    --> prepends <loom_goal> to the provider input when active
   GoalCleanupReactor: thread.deleted / project.deleted
```

## Part A: compaction

### What upstream already does

- A user message whose text is exactly `/compact` (trimmed, lowercased, no attachments) is a
  compaction request (`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:91-94`).
  The reactor refuses it without a prior user message and while a turn is running
  (1401-1419), runs `providerService.compactThread` in a fiber (1436-1440), queues turns
  sent meanwhile (1460-1468) and replays them afterwards (322-365).
- `ProviderService.compactThread` (`apps/server/src/provider/Layers/ProviderService.ts:1795-1917`)
  uses the adapter's `compaction` (`apps/server/src/provider/Services/ProviderAdapter.ts:35-43`):
  native `start` or a slash-command turn, waits for completion (10-minute timeout), and
  synthesizes a compacted event when a slash command finishes without one (1015-1032).
- The web button is in the context meter popover
  (`apps/web/src/components/chat/ContextWindowMeter.tsx:139-152`); `ChatView.onCompactContext`
  (`apps/web/src/components/ChatView.tsx:7033-7100`) dispatches `startThreadTurn` with
  `message: { messageId, role: "user", text: "/compact", attachments: [] }` and the thread's
  model selection and modes. Availability: `providerSupportsManualCompaction` (a provider
  snapshot whose `slashCommands` include `compact`,
  `apps/web/src/components/chat/ContextWindowMeter.logic.ts:15-19`) plus the conditions at
  `ChatView.tsx:6284-6297`.

### Per-provider decision

| Provider    | Upstream mechanism                                                                                                                  | Loom decision                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Codex       | Native `thread/compact/start` (`CodexSessionRuntime.ts:2430-2433`)                                                                  | Use as is.                                                                                                                |
| Claude      | Slash command `/compact` (`ClaudeAdapter.ts:5384`); `compact_boundary` reports token counts                                         | Use as is.                                                                                                                |
| OpenCode    | Native `session.summarize` (`OpenCodeAdapter.ts:3433-3499`)                                                                         | Use as is. Needs a provider/model selection, which the command carries.                                                   |
| Cursor      | Slash command `/compress` (`CursorAdapter.ts:1241`)                                                                                 | Use as is (the user still sends `/compact`; the adapter maps it).                                                         |
| Grok        | Slash command `/compact` (`GrokAdapter.ts:2163`)                                                                                    | Use as is.                                                                                                                |
| Antigravity | Slash command `/compact` (`AntigravityAdapter.ts:1251`), advertised only if the agent lists it (`AntigravityProvider.ts:81-93,322`) | Use as is; the palette item is disabled when the snapshot lacks `compact` (unverified whether Antigravity advertises it). |

No adapter work. The palette item is the only new entry point.

### Palette and keybinding

`apps/web/src/fork/compaction-and-goals/compaction.ts` exports a pure
`resolveCompactionAvailability(input)`:

```ts
export type CompactionAvailability =
  { readonly available: true } | { readonly available: false; readonly reason: string };

export function resolveCompactionAvailability(input: {
  readonly thread: EnvironmentThreadShell | null; // null for drafts
  readonly provider: ProviderInstanceEntry | null; // the thread's session or selected instance
  readonly environmentConnected: boolean;
}): CompactionAvailability;
```

Rules (a subset of `ChatView.tsx:6284-6297` computable from the shell):

- no server thread: "Open a thread first";
- `providerSupportsManualCompaction(provider)` false: "Compaction is unavailable for this
  provider";
- `thread.latestUserMessageAt === null` (imported messages do not count, matching upstream's
  "requires an existing conversation"): "Nothing to compact yet";
- session `starting` or `running`: "Wait for the current turn to finish";
- `thread.hasPendingApprovals || thread.hasPendingUserInput`: "Answer the pending request
  first";
- environment disconnected: "Reconnect first".

Shell fields are in `OrchestrationThreadShell` (`packages/contracts/src/orchestration.ts:815-873`).
The provider entry comes from `deriveProviderInstanceEntries`
(`apps/web/src/providerInstances.ts:94`) over the environment's server config providers,
matched by `thread.session?.providerInstanceId ?? thread.modelSelection.instanceId`.

`compactThread(ref)` dispatches, through `useAtomCommand(threadEnvironment.startTurn)`
(`packages/client-runtime/src/state/threadCommands.ts:209`):

```ts
{
  environmentId: ref.environmentId,
  input: {
    threadId: ref.threadId,
    message: { messageId: newMessageId(), role: "user", text: "/compact", attachments: [] },
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    createdAt: new Date().toISOString(),
  },
}
```

Differences from the button: no optimistic bubble (the server's `thread.message-sent`
arrives within one round trip) and no `persistThreadSettingsForNextTurn` (the thread's
stored settings are used, which is what the next turn would use anyway). Errors surface as a
toast with the command failure.

Gating: compaction items do not check `loomFeatures`; they only use upstream commands, so
they also work against upstream T3 servers.

The keybinding command `loom.compaction-and-goals.compact` is handled by a component
registered in `ForkRoot` that subscribes with `onForkCommand` and reads the active thread the
same way the palette registry does (`useHandleNewThread().activeThread`,
`apps/web/src/hooks/useHandleNewThread.ts:442`).

## Part B: goals

### Contracts (`packages/contracts/src/fork/compaction-and-goals.ts`)

```ts
export const COMPACTION_AND_GOALS_WS_METHODS = {
  getGoal: "loom.compaction-and-goals.getGoal",
  setGoal: "loom.compaction-and-goals.setGoal",
  setGoalState: "loom.compaction-and-goals.setGoalState",
  clearGoal: "loom.compaction-and-goals.clearGoal",
} as const;

export const THREAD_GOAL_MAX_CHARS = 4_000;

export const ThreadGoalState = Schema.Literals(["active", "paused", "met"]);
export type ThreadGoalState = typeof ThreadGoalState.Type;

export const ThreadGoal = Schema.Struct({
  threadId: ThreadId,
  objective: TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_GOAL_MAX_CHARS)),
  state: ThreadGoalState,
  setAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ThreadGoal = typeof ThreadGoal.Type;

export class ThreadGoalError extends Schema.TaggedError<ThreadGoalError>()("ThreadGoalError", {
  reason: Schema.Literals(["thread-not-found", "goal-not-found", "persistence"]),
  detail: Schema.String,
}) {}

// getGoal:      { threadId }                         -> { goal: NullOr(ThreadGoal) }
// setGoal:      { threadId, objective, state? }      -> { goal: ThreadGoal }   (state defaults to "active")
// setGoalState: { threadId, state }                  -> { goal: ThreadGoal }   (fails goal-not-found)
// clearGoal:    { threadId }                         -> { cleared: ThreadGoal | null } (returned for Undo)
// Every error union: Schema.Union([ThreadGoalError, EnvironmentAuthorizationError]).
export const CompactionAndGoalsRpcGroup = RpcGroup.make(/* four Rpc.make(...) */);
```

Scopes: `getGoal` `orchestration:read`; the three writes `orchestration:operate`. All
unary. Register the group in `fork/rpc.ts` and export the file from `fork/index.ts`.

### Storage

Migration set slug `compaction-and-goals` (tracking table
`fork_migrations_compaction_and_goals`), id 1 `Goals`:

```sql
CREATE TABLE IF NOT EXISTS fork_compaction_and_goals_goals (
  thread_id   TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  objective   TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('active', 'paused', 'met')),
  set_at      TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fork_compaction_and_goals_goals_project
  ON fork_compaction_and_goals_goals (project_id);
```

`set_at` changes only when the objective text changes; state changes update `updated_at`.
`project_id` is copied from the thread shell at write time so a `project.deleted` cleanup
needs no join.

### Server (`apps/server/src/fork/compaction-and-goals/`)

| File                   | Contents                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations.ts`        | `CompactionAndGoalsMigrations`.                                                                                                                                                    |
| `ThreadGoalStore.ts`   | Repository: `get(threadId)`, `upsert(goal, projectId)`, `setState`, `delete`, `deleteByProject`.                                                                                   |
| `ThreadGoalService.ts` | RPC logic: validates the thread exists and is not deleted (`ProjectionSnapshotQuery.getThreadShellById`, `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:217`). |
| `goalTurnInput.ts`     | The `ext-turn-input` contributor and the pure `renderGoalBlock` formatter.                                                                                                         |
| `cleanupReactor.ts`    | `thread.deleted` and `project.deleted` cleanup with `forkParked`, like L02's.                                                                                                      |
| `rpc.ts`               | `makeCompactionAndGoalsRpcHandlers(auth)`.                                                                                                                                         |

`ThreadGoalStore` and `ThreadGoalService` join `ForkServices` and `ForkServicesLive`;
`"compaction-and-goals"` is appended to `LOOM_SERVER_FEATURES`.

The reactor mirrors `apps/server/src/orchestration/Layers/ThreadDeletionReactor.ts:92-106`
(`forkParked` at `apps/server/src/serverActivation.ts:12-26`) on
`engine.streamDomainEvents` (`OrchestrationEngine.ts:83`), with a startup sweep of goals
whose thread is gone from `getShellSnapshot()`.

### Delivery through `ext-turn-input`

The one place every provider turn passes through is `ProviderService.sendTurn`
(`apps/server/src/provider/Layers/ProviderService.ts:1569`). After it expands citations
(`const inputTextWithCitations = ...`, 1584-1585) it re-validates the text against the
schema (1586-1592) and then appends attachment paths (1594-1670) before routing to the
adapter. Adapters then add their own runtime text: Codex per turn in
`collaborationMode.settings.developer_instructions` (`CodexSessionRuntime.ts:583-606`),
Claude once per session in `systemPrompt.append` (`ClaudeAdapter.ts:4724-4729`), OpenCode
per turn as `system` (`OpenCodeAdapter.ts:3214-3227`), ACP adapters as a trailing text part
(`CursorAdapter.ts:1060-1068`, `GrokAdapter.ts:1619-1623`, `AntigravityAdapter.ts:1082-1090`).
None of those accepts a user-defined, per-thread instruction, and the provider input
contract has no field for one (`ProviderSendTurnInput`, `packages/contracts/src/provider.ts:69-82`).
Hooking `sendTurn` once covers all six adapters with one seam.

The extension point
([EXTENSION-POINTS.md, section 16](../EXTENSION-POINTS.md#16-provider-turn-input-ext-turn-input))
collects blocks from registered contributors and prepends them to the provider-bound text,
sorted by order. It already skips continuation turns (no input), slash commands such as
upstream's own `/compact` turn (which `compactThread` sends through this same `sendTurn`),
and any block that would exceed the input limit; a failing contributor is logged and skipped.
This packet's contributor has id `compaction-and-goals` and order 20, so an instruction modes
block from L22 (order 10), when present, comes first.

Prepending rather than appending keeps Claude's skill dispatch intact: a `$skill` mention
turns into a final `/name` block whose trailing text becomes the skill's arguments
(`apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts:1-24`), so appended goal text would
be passed to the skill.

`makeGoalTurnInputContributor(store)`, registered in `ThreadGoalService`'s layer with
`registerForkTurnInputContributor`:

```ts
export const renderGoalBlock = (objective: string): string =>
  `<loom_goal>\nThe user pinned this standing goal to the thread. Keep working toward it across turns, and say so when you believe it is met.\n<objective>\n${escapeGoalTags(objective)}\n</objective>\n</loom_goal>`;

export const makeGoalTurnInputContributor = (store: ThreadGoalStore["Service"]) => ({
  id: "compaction-and-goals",
  order: 20,
  contribute: ({ threadId }: ForkTurnInputContext) =>
    store.get(threadId).pipe(
      Effect.map((goal) =>
        Option.isSome(goal) && goal.value.state === "active"
          ? renderGoalBlock(goal.value.objective)
          : undefined,
      ),
      Effect.orElseSucceed(() => undefined),
    ),
});
```

`PROVIDER_SEND_TURN_MAX_INPUT_CHARS` is 120,000 (`packages/contracts/src/orchestration.ts:164`).
`escapeGoalTags` replaces `</objective>` and `</loom_goal>` in the objective with look-alikes,
so a goal cannot break the wrapper. The objective is at most 4,000 characters, so the block
stays far below the input limit.

What this means per provider:

- The goal text lands in each provider's native transcript (Claude session file, Codex
  rollout, OpenCode session) as part of the user turn. T3's timeline shows only what the user
  typed. Opening the session in the provider's own CLI shows the goal block; accepted.
- Token cost: at most about 1,100 tokens per turn while a goal is active.
- Plan mode: Codex and Claude plan turns receive the goal too; this is desirable.

### Clients

- `packages/client-runtime/src/fork/compaction-and-goals.ts`:
  `createCompactionAndGoalsAtoms(runtime)` returning `getGoal` (query family,
  `staleTimeMs: 10_000`) and `setGoal`, `setGoalState`, `clearGoal` (commands whose
  `onSuccess` refreshes the thread's `getGoal` entry). Factories at
  `packages/client-runtime/src/state/runtime.ts:612,678`.
- `apps/web/src/fork/compaction-and-goals/`:

| File                   | Purpose                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.ts`             | Atom instances with `connectionAtomRuntime`; `useThreadGoal(ref)`; capability check.                                                                                    |
| `compaction.ts`        | `resolveCompactionAvailability`, `useCompactThread()`.                                                                                                                  |
| `goalEditorStore.ts`   | Small zustand store `{ openFor: ScopedThreadRef                                                                                                                         | null }`. |
| `ThreadGoalChip.tsx`   | The chip (seam component). Renders `null` without the feature, a server thread, or a goal.                                                                              |
| `GoalEditor.tsx`       | Popover content with the 4,000-character textarea and counter.                                                                                                          |
| `GoalCommandsHost.tsx` | `ForkRoot` component: subscribes to the two keybinding commands; renders the editor dialog when opened from the palette or keybinding (the chip opens its own popover). |
| `palette.tsx`          | Palette source for compaction and goal items.                                                                                                                           |

`ThreadGoalChip` layout: it sits in the banner overlay at the top of the chat column
(`ChatView.tsx:9423-9437`), which is `pointer-events-none absolute inset-x-0 top-0 z-20`;
the chip sets `pointer-events-auto`, centers itself with the timeline's max width
(`max-w-3xl`, as the timeline root does), wraps long text (`wrap-anywhere`, one line
collapsed, full text expanded), and never animates continuously. It refetches the goal on
window focus through the query's stale time.

Goal gating: `supportsLoomFeature(serverConfig?.environment.capabilities, "compaction-and-goals")`
for the thread's environment.

## Agent-facing tools

None. An MCP tool ("read my goal") would depend on the agent choosing to call it, which
defeats a standing instruction (EXTENSION-POINTS.md, Orchestration rule 5 lists it first,
but it does not meet "passed to the provider").

## Performance

- Server: one indexed primary-key read per provider turn, only when a goal contributor is
  registered. No read at all for slash commands and continuation turns.
- Client: one small query per visible thread; the chip is a few elements. No subscription.
- Palette items are pure functions of the shell and provider entries, rebuilt per palette
  render like upstream's.

## Alternatives considered

- **Goals as orchestration state with new events** (old Loom 0011: `thread.goal-set` and
  `thread.goal-cleared` events, `goal` on the thread read model). Rejected: new events are a
  one-way door and touch the decider, projector and every read model.
- **Client-side prefix on each message.** Rejected: it shows in the user's bubble, is missed
  by turns sent from other clients (mobile, other browsers), and needs a composer send hook
  that does not exist.
- **Session-level instructions** (Claude `systemPrompt.append`, Codex
  `developerInstructions` at thread start). Rejected for v1: Claude cannot change them
  without restarting the session, and it needs adapter seams in each driver.
- **Codex native goals** (`thread/goal/set|get|clear`, `V2ThreadGoalSetParams` at
  `packages/effect-codex-app-server/src/_generated/schema.gen.ts:40443`, statuses at 6899).
  Deferred: needs access to the running Codex session from fork code (a Codex adapter seam),
  covers only one provider, and would double-deliver alongside the text path unless the
  contributor skipped Codex.
- **A composer context record per turn** (the zero-seam path L02 uses for transcripts).
  Rejected: it must be attached by the client at send time, again needing a send hook, and
  would show a chip in every message.
