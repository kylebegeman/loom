# L03 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Compaction (step 2) is
independent of goals and can ship first if Kyle wants it early.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and every
file in this folder. Work in a worktree seeded with a copy of real data for the manual check.

## Steps

### 1. Extension points

Existence checks, in order: `ext-core`, `ext-web-root`, `ext-keybindings`, `ext-palette`
(`ext-turn-input` follows in step 3, `ext-composer` in step 7).
Create missing ones exactly as EXTENSION-POINTS.md specifies, one commit each, with FORK.md
rows.

### 2. Compaction entry points (client only)

- `apps/web/src/fork/compaction-and-goals/compaction.ts`: `resolveCompactionAvailability`
  (pure) and `useCompactThread()` (dispatches the `/compact` turn, TECHNICAL.md).
- `compaction.test.ts`: every disabled reason, and "available" for an idle thread with a
  prior user message on a provider advertising `compact`.
- Palette items "Compact conversation" (value `action:loom:compaction-and-goals:compact`).
  When unavailable, set `disabled: true` and put the reason in `description` (both are
  fields of `CommandPaletteItem`, `apps/web/src/components/CommandPalette.logic.ts:127-142`).
  Set `shortcutCommand: "loom.compaction-and-goals.compact"` so a user binding shows.
- Keybinding command `loom.compaction-and-goals.compact` in `FORK_KEYBINDING_COMMANDS`;
  `GoalCommandsHost` (created now, extended in step 7) subscribes to it.

### 3. `ext-turn-input`

Run its existence check; if it fails, create it exactly as EXTENSION-POINTS.md section 16
specifies, in its own commit (`feat(fork): add the provider turn input extension point`),
with `turnInput/registry.test.ts` and its FORK.md row. Typecheck
`t3` and run upstream's `apps/server/src/provider/Layers/ProviderService.test.ts` once to
confirm it is unaffected.

### 4. Contracts

`packages/contracts/src/fork/compaction-and-goals.ts`; register the group and export.
Typecheck `@t3tools/contracts`.

### 5. Server

- `migrations.ts`, `ThreadGoalStore.ts` (+ store test on `SqlitePersistenceMemory`).
- `ThreadGoalService.ts` and `rpc.ts`; scopes; `LOOM_SERVER_FEATURES`; `ForkServices`,
  `ForkServicesLive`.
- `goalTurnInput.ts` with `renderGoalBlock` (pure, tested: wrapper text, escaping of
  closing tags) and the contributor; `ThreadGoalService`'s layer registers it with
  `registerForkTurnInputContributor` (id `compaction-and-goals`, order 20).
- `cleanupReactor.ts` (+ test with a `Deferred`).

### 6. Client runtime

`packages/client-runtime/src/fork/compaction-and-goals.ts`; export it. Typecheck
`@t3tools/client-runtime`.

### 7. Web goals

1. `state.ts`, `goalEditorStore.ts`.
2. `GoalEditor.tsx` (textarea, counter, Save disabled when empty or unchanged, Escape
   closes).
3. `ThreadGoalChip.tsx`; apply the two `ChatView.tsx` seams from SEAMS.md; run `vp fmt` on
   the file and re-check the marker count.
4. Extend `GoalCommandsHost` with `loom.compaction-and-goals.goal` and the editor dialog for
   palette and keybinding entry.
5. Palette goal items, returning `[]` without the feature or without a server thread; show
   "Set goal" or "Edit goal", and state items according to the current goal.
6. Clear shows a toast with Undo, which calls `setGoal` with the returned objective and state.
7. `ext-composer`: run its existence check
   (`git grep -cE 'fork: ext-composer([^a-z0-9-]|$)' -- apps/web/src/components/chat/ChatComposer.tsx`
   prints 5); if missing, create it exactly as EXTENSION-POINTS.md section 11 specifies, in
   its own commit with its FORK.md row. Then `GoalComposerButton.tsx` (TECHNICAL.md,
   Clients) and its `FORK_COMPOSER_BLOCKS` entry.

### 8. Documentation and status

- `docs/fork/user/compaction-and-goals.md`: how to compact from the palette, how to set a
  goal (composer "Goal" button, palette, keybinding), what a goal does, that the agent
  receives it before every message while active, that it costs tokens, and
  that it appears in the provider's own session history.
- FORK.md rows; packet index Status.

## Pitfalls

- Slash commands are skipped by the `ext-turn-input` registry itself; upstream's compaction
  turn goes through the same `sendTurn`, so check it in the manual test.
- The contributor runs for every turn of every thread: one primary-key read, nothing else.
- The chip lives in a `pointer-events-none` overlay; forgetting `pointer-events-auto` makes
  it unclickable, and a full-width block would swallow clicks meant for the timeline. Keep
  the chip compact and centered.
- `thread.latestUserMessageAt` ignores imported messages; this matches upstream's rule that
  compaction needs a real conversation.
- Never write goal data into upstream `ServerSettings` or thread metadata.
- The goal block is prepended by `ext-turn-input`, never appended: appended text would
  become a Claude skill's arguments. Docs and copy say "prepended" or "before the message".
- The footer button must not subscribe to anything beyond the goal query it already shares
  with the chip; the composer re-renders often.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Compaction from the palette works for a Claude and a Codex thread and is disabled with the
  right reason while a turn runs.
- With an active goal, the provider receives the goal block on each turn (verified in the
  provider's native transcript or with a debug log of the sent length), and the
  timeline shows only the typed text.
- Paused and met goals are not sent; resuming sends again.
- The composer footer button opens the goal editor on a server thread and is absent on
  draft threads and servers without the feature.
- Deleting a thread removes its goal.
