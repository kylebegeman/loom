# L03 references

Treat external repositories as references, not code to copy.

## Old Loom

Selection: F2 (manual compaction and goals). Source: `bagelvault/loom` at `a79ec506`
(release 0.13.10, private).

| File                                                                                                                                                                  | LOC | Keep, adapt or drop                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [.ledger/entries/0009-manual-compaction.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0009-manual-compaction.md)                               | 150 | Drop the mechanism (a `thread.compact` command and a `thread.compact-requested` event). Upstream now has the `/compact` path for every adapter, which old Loom 2577 later converged on.                                                                                                                                           |
| [.ledger/entries/2577-cross-harness-context-compaction.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/2577-cross-harness-context-compaction.md) | 330 | Context only: old Loom's adaptation of upstream T3 #9293 (compaction on every provider, settle on the terminal event, token deltas). Upstream v0.0.42 already contains that behavior (`ProviderService.compactThread`, pending compaction, synthesized compacted events), so L03 adds entry points only.                          |
| [.ledger/entries/0011-goals.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0011-goals.md)                                                       | 145 | Keep the UX: objective up to 4,000 characters, states Working, Paused, Met, chip with pause, resume, mark met, edit, clear. Drop the mechanism: `thread.goal.set`/`clear` commands, new events, a `goal` field on thread read models, `supportsGoals` provider flag, and mirroring to Codex `thread/goal/set` and Claude `/goal`. |
| [.ledger/entries/0038-hide-empty-goal-affordance.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0038-hide-empty-goal-affordance.md)             | 96  | Keep: no empty "Set goal" bar in the chat column; long objectives wrap and never widen the column.                                                                                                                                                                                                                                |
| [apps/web/src/components/chat/GoalChip.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/chat/GoalChip.tsx)                               | 188 | Adapt: editor with counter, state badges (and the "Blocked" badge idea for a future Codex-native phase). Rebuild on the fork store and upstream UI primitives.                                                                                                                                                                    |
| [apps/web/src/components/chat/GoalChip.test.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/chat/GoalChip.test.tsx)                     | 62  | Drop: markup test. L03 tests logic only (AGENTS.md).                                                                                                                                                                                                                                                                              |

Old Loom's Claude goal mirroring sent `/goal <objective>` into the SDK prompt queue. Whether
current Claude Code supports a `/goal` command is unverified; L03 does not rely on it.

## Upstream T3 Code

| Path                                                                                                                                       | Why                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:91-94,322-365,1401-1468`                                                   | `/compact` detection, refusal rules, queueing and replay.                                        |
| `apps/server/src/provider/Services/ProviderAdapter.ts:31-43`                                                                               | `ProviderCompaction`: native or slash command.                                                   |
| `apps/server/src/provider/Services/ProviderService.ts:57-61`                                                                               | `compactThread` signature.                                                                       |
| `apps/server/src/provider/Layers/ProviderService.ts:233-243,1015-1032,1569-1612,1795-1917`                                                 | Pending compaction, synthesized events, `sendTurn` (the `ext-turn-input` hook), `compactThread`. |
| `apps/server/src/provider/Layers/CodexSessionRuntime.ts:583-606,2430-2433`                                                                 | Codex per-turn developer instructions; native compaction.                                        |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts:3456-3480,4724-4729,5384`                                                                | Claude compact boundary, session-level system prompt, `/compact`.                                |
| `apps/server/src/provider/Layers/OpenCodeAdapter.ts:3214-3227,3433-3499`                                                                   | OpenCode per-turn `system`, `session.summarize`.                                                 |
| `apps/server/src/provider/Layers/CursorAdapter.ts:1060-1068,1241`, `GrokAdapter.ts:1619-1623,2163`, `AntigravityAdapter.ts:1082-1090,1251` | ACP trailing runtime text; slash-command compaction.                                             |
| `apps/server/src/provider/Layers/AntigravityProvider.ts:81-93,322`                                                                         | Antigravity advertises only the commands the agent lists.                                        |
| `apps/server/src/provider/RuntimeInstructions.ts:6-17`                                                                                     | The only runtime text adapters add today.                                                        |
| `apps/server/src/mcp/McpProviderSession.ts:37-47`                                                                                          | Precedent for a module-level per-thread registry.                                                |
| `packages/contracts/src/provider.ts:69-82`, `packages/contracts/src/orchestration.ts:164`                                                  | `ProviderSendTurnInput`; the 120,000-character input limit.                                      |
| `packages/contracts/src/orchestration.ts:815-873`                                                                                          | Thread shell fields used for compaction availability.                                            |
| `apps/web/src/components/ChatView.tsx:6284-6305,7033-7100,9423-9437`                                                                       | Upstream compaction gating, `onCompactContext`, banner overlay (seam).                           |
| `apps/web/src/components/chat/ContextWindowMeter.tsx:139-152`, `ContextWindowMeter.logic.ts:15-19`                                         | Upstream button and `providerSupportsManualCompaction`.                                          |
| `apps/web/src/components/CommandPalette.logic.ts:127-161`                                                                                  | Palette item shape (`disabled`, `description`, `shortcutCommand`).                               |
| `packages/client-runtime/src/state/threadCommands.ts:209`                                                                                  | `startTurn` command.                                                                             |
| `docs/user/providers-claude.md:44-54`, `docs/user/composer.md:151-152`                                                                     | Upstream user docs for compaction.                                                               |
| `packages/effect-codex-app-server/src/_generated/meta.gen.ts:15-17,128-129`, `schema.gen.ts:6899,16184,40443`                              | Codex goal API (deferred follow-up).                                                             |

## External

- Codex app-server goal methods (`thread/goal/set|get|clear`, notifications
  `thread/goal/updated|cleared`), from https://github.com/openai/codex (Apache-2.0) as
  generated in `packages/effect-codex-app-server`. Not used in v1.
- DietrichGebert/ponytail (https://github.com/DietrichGebert/ponytail, MIT): rule packs
  delivered to agents, relevant to the shared `ext-turn-input` extension point that L22 also uses. No
  code reused.
