# L03 product

## Problem

Compacting at a moment of Kyle's choosing helps long threads, but upstream only offers it
from the context meter popover and by typing `/compact`, which is easy to miss and has no
keyboard path. Upstream's native goals (`/goal` for Codex and Claude) have the same gap: they
are set, paused, resumed and cleared by typing commands or from the goal row's buttons.

The fork's own pinned goals (a chip, a goal store and a goal sent with every turn) were
retired on 2026-10-09, Kyle approved: upstream's native `/goal` with its banner covers them
(README, "Retired parts").

## What the user can do

- **Compact now.** Run "Compact conversation" from the command palette or a keybinding.
  It behaves exactly like upstream's "Compact context" button: the provider compacts, the
  timeline shows the compaction divider with the token counts when known, and messages sent
  meanwhile wait until it finishes.
- **Set a goal.** "Set goal" (the palette or a keybinding) opens a small dialog for the
  objective and sends upstream's `/goal <objective>`. Upstream's goal row then shows it.
- **Pause, resume, clear.** Palette items send `/goal pause`, `/goal resume` and
  `/goal clear`, offered only when upstream supports them for the thread's provider and the
  thread's current goal.

## Entry points

| Action          | Where                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compact         | Palette "Compact conversation"; keybinding command `loom.compaction-and-goals.compact` (unbound). Upstream's context meter button and `/compact` keep working. |
| Set goal        | Palette "Set goal"; keybinding command `loom.compaction-and-goals.goal` (unbound). Typing `/goal ...` keeps working.                                           |
| Pause or resume | Palette "Pause goal" / "Resume goal" (Codex only). Upstream's goal row keeps its Resume button.                                                                |
| Clear           | Palette "Clear goal". Upstream's goal row keeps its Clear button.                                                                                              |
| See the state   | Upstream's goal row above the composer and the sidebar's "Goal" status.                                                                                        |

No settings in v1.

## Copy

- Palette: "Compact conversation" (disabled reason as a hint: "Compaction is unavailable
  for this provider", "Wait for the current turn to finish", "Answer the pending request
  first", "Nothing to compact yet").
- Palette: "Set goal", "Pause goal", "Resume goal", "Clear goal" (disabled reason as a hint:
  "Goals need Codex or Claude", "Wait for the current turn to finish", "Answer the pending
  request first").
- Set goal dialog: title "Set goal"; placeholder "Describe what done means, for example all
  tests in packages/api pass."; buttons "Set goal", "Cancel".

## States

- Empty: without a goal the palette offers only "Set goal".
- Error: a failed send shows a toast with the command failure; the dialog keeps the text.
- Disabled: items are disabled with a reason when upstream would refuse the command, and
  goal items are hidden on draft threads.
- In progress: compaction shows upstream's compacting state in the timeline; the palette
  items are disabled while the thread is running.

## Surfaces and connection modes

Web and desktop are required and identical. Mobile keeps upstream's own controls. Remote
works. Upstream T3 servers: everything works, since the packet only sends upstream commands.

## Decisions

- Compaction reuses upstream's `/compact` turn rather than a new command: every adapter
  already supports it (native for Codex and OpenCode, slash commands for Claude, Cursor
  (`/compress`), Grok and Antigravity), and upstream serializes it against other turns.
- Goal shortcuts send upstream's native `/goal` commands; Loom stores no goal of its own.
- Retired on 2026-10-09 (Kyle approved): fork goals with their chip, store, composer button
  and per-turn delivery, covered by upstream's native `/goal` and banner.
