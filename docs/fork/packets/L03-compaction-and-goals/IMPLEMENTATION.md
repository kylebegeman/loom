# L03 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Compaction (step 2) is
independent of the goal shortcuts and can ship first if Kyle wants it early. The fork goal
steps (contracts, server store, `ext-turn-input`, chip and composer button) were retired on
2026-10-09 (README, "Retired parts").

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and every
file in this folder. Recheck TECHNICAL.md's citations against current V2 source. Work in a
worktree seeded with a copy of real data for the manual check.

## Steps

### 1. Extension points

Existence checks, in order: `ext-web-root`, `ext-keybindings`, `ext-palette`. Create missing
ones exactly as EXTENSION-POINTS.md specifies, one commit each, with FORK.md rows.

### 2. Compaction entry points

- `apps/web/src/fork/compaction-and-goals/compaction.ts`: `resolveCompactionAvailability`
  (pure) and `useCompactThread()` (dispatches the `/compact` turn, TECHNICAL.md).
- `compaction.test.ts`: every disabled reason, and "available" for an idle thread with a
  prior user message on a provider advertising `compact`.
- Palette item "Compact conversation" (value `action:loom:compaction-and-goals:compact`).
  When unavailable, set `disabled: true` and put the reason in `description` (both are
  fields of `CommandPaletteItem`, `apps/web/src/components/CommandPalette.logic.ts`).
  Set `shortcutCommand: "loom.compaction-and-goals.compact"` so a user binding shows.
- Keybinding command `loom.compaction-and-goals.compact` in `FORK_KEYBINDING_COMMANDS`;
  `CommandsHost` (created now, extended in step 3) subscribes to it.

### 3. Goal shortcuts

- `goals.ts`: `resolveGoalCommands` (pure) and `useSendGoalCommand()` (dispatches the
  `/goal ...` turn).
- `goals.test.ts`: provider gating, idle and pending-request reasons, which items appear for
  no goal, an active Codex goal, a paused Codex goal and an active Claude goal, and the sent
  text for each item (including trimming and a one-line objective).
- `SetGoalDialog.tsx`; extend `CommandsHost` with `loom.compaction-and-goals.goal` and the
  dialog; palette goal items with `shortcutCommand` on "Set goal".

### 4. Documentation and status

- `docs/fork/user/compaction-and-goals.md`: how to compact and manage upstream goals from the
  palette and keybindings, with a link to upstream's `docs/user/composer.md` "Goals".
- FORK.md rows; packet index Status.

## Pitfalls

- `thread.latestUserMessageAt` ignores imported messages; this matches upstream's rule that
  compaction needs a real conversation.
- Do not store goal data anywhere. Upstream owns goal state; read it from the thread shell.
- Pause and resume are Codex only upstream; do not offer them for Claude.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Compaction from the palette works for a Claude and a Codex thread and is disabled with the
  right reason while a turn runs.
- "Set goal" from the palette and the keybinding sets an upstream goal on a Codex and a
  Claude thread, and upstream's goal row shows it.
- Pause, resume and clear from the palette match upstream's typed commands.
