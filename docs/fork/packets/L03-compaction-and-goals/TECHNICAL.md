# L03 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`), before V2. V2
removed `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`; recheck every
citation against current source before building. Line numbers drift; search for the quoted
code when they do.

The fork goal design (a goal table, RPCs, a chip, a composer button and delivery through
`ext-turn-input`) was retired on 2026-10-09, Kyle approved: upstream's native `/goal` with
its banner covers it (README, "Retired parts").

## Overview

```
 Compaction (client-only)
   palette / keybinding --> threadEnvironment.startTurn({ message: { text: "/compact" } })
                             --> upstream ProviderCommandReactor /compact path (unchanged)

 Goal shortcuts (client-only)
   palette / keybinding --> threadEnvironment.startTurn({ message: { text: "/goal ..." } })
                         --> upstream native /goal (Codex, Claude; unchanged)
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

## Part B: goal shortcuts

### What upstream already does

Codex and Claude support a native `/goal` (`docs/user/composer.md`, "Goals"). The thread
shell carries the active provider thread's goal (`goal` on the thread shell,
`packages/contracts/src/orchestrationV2.ts`, `OrchestrationV2ProviderGoal`), and
`presentProviderGoal` (`packages/client-runtime/src/state/threadExecution.ts`) derives its
title and `canResume`. `ChatView`'s goal row sends `/goal resume` and `/goal clear` through
`sendStandaloneCommand`, the same standalone turn path as `/compact`, and shows those
buttons only while the thread is idle.

### Palette and keybinding

`apps/web/src/fork/compaction-and-goals/goals.ts` exports a pure
`resolveGoalCommands(input)` over the same inputs as `resolveCompactionAvailability` plus the
shell's `goal`. It returns the items to show and, for each, `available` or a disabled reason:

- no server thread: no goal items;
- the thread's provider driver is not Codex or Claude: "Goals need Codex or Claude";
- session `starting` or `running`: "Wait for the current turn to finish";
- a pending approval or user input: "Answer the pending request first";
- "Set goal" always (it replaces an existing goal, as `/goal <objective>` does upstream);
  "Clear goal" when `goal` is set; "Pause goal" for Codex with an `active` goal; "Resume
  goal" for Codex when `presentProviderGoal(goal, false).canResume`.

Each item dispatches the same `startTurn` as compaction with the text `/goal pause`,
`/goal resume`, `/goal clear` or `/goal <objective>`. "Set goal" and the keybinding command
`loom.compaction-and-goals.goal` open a small dialog (`SetGoalDialog.tsx`, a textarea and
"Set goal"/"Cancel"); the trimmed objective must be non-empty and is sent as one line after
`/goal `. Errors surface as a toast with the command failure.

Gating: no `loomFeatures` check; the items only send upstream commands.

### Files (`apps/web/src/fork/compaction-and-goals/`)

| File                | Purpose                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `compaction.ts`     | `resolveCompactionAvailability`, `useCompactThread()`.                                           |
| `goals.ts`          | `resolveGoalCommands`, `useSendGoalCommand()`.                                                   |
| `SetGoalDialog.tsx` | The set goal dialog.                                                                             |
| `CommandsHost.tsx`  | `ForkRoot` component: subscribes to the two keybinding commands and renders the set goal dialog. |
| `palette.tsx`       | Palette source for compaction and goal items.                                                    |

## Agent-facing tools

None. Agents can already send `/compact` and `/goal` as ordinary turns.

## Performance

Palette items are pure functions of the shell and provider entries, rebuilt per palette
render like upstream's. No server work, no subscriptions.

## Alternatives considered

- **Fork goals with per-turn delivery** (a goal table, a chip, and a `<loom_goal>` block
  prepended to every turn through `ext-turn-input`). Designed here, then retired on
  2026-10-09, Kyle approved: upstream's native `/goal` and banner cover it.
- **Goals as orchestration state with new events** (old Loom 0011). Rejected: new events are
  a one-way door; upstream now owns goal state natively.
