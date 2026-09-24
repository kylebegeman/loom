# L03 product

## Problem

Long threads drift. The agent forgets the point of the work after a few detours or after
compaction, and Kyle retypes the same framing ("remember, the goal is ...") into later
messages. Compacting at a moment of his choosing helps, but upstream only offers it from the
context meter popover and by typing `/compact`, which is easy to miss and has no keyboard
path.

## What the user can do

- **Compact now.** Run "Compact conversation" from the command palette or a keybinding.
  It behaves exactly like upstream's "Compact context" button: the provider compacts, the
  timeline shows the compaction divider with the token counts when known, and messages sent
  meanwhile wait until it finishes.
- **Pin a goal.** "Set goal" (the composer footer button, the palette or a keybinding)
  opens an editor for a standing objective of up to 4,000 characters. The goal appears as
  a chip at the top of the chat column.
- **Keep the agent on it.** While the goal is active, every turn the provider receives
  starts with the goal and a short instruction to keep working toward it, placed before
  Kyle's message text. Kyle's own messages stay as he typed them in the timeline.
- **Pause, resume, mark met, edit, clear.** Paused and met goals stay visible on the chip
  but are no longer sent. Clear removes the goal.
- **Survive compaction.** The goal lives outside the conversation, so compaction cannot
  drop it; the next turn after compaction carries it again.

## Entry points

| Action           | Where                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compact          | Palette "Compact conversation"; keybinding command `loom.compaction-and-goals.compact` (unbound). Upstream's context meter button and `/compact` keep working.                            |
| Set or edit goal | Composer footer button "Set goal" ("Edit goal" when one exists); palette "Set goal" / "Edit goal"; keybinding command `loom.compaction-and-goals.goal` (unbound); the chip's Edit button. |
| Pause or resume  | Chip buttons; palette "Pause goal" / "Resume goal".                                                                                                                                       |
| Mark met         | Chip button; palette "Mark goal met". Reverse: "Resume goal" makes it active again.                                                                                                       |
| Clear            | Chip button (with an Undo toast); palette "Clear goal".                                                                                                                                   |
| See the state    | The chip: target icon, objective (one line, click to expand), state badge "Working", "Paused" or "Met".                                                                                   |

No settings in v1.

## Copy

- Palette: "Compact conversation" (disabled reason as a hint: "Compaction is unavailable
  for this provider", "Wait for the current turn to finish", "Answer the pending request
  first", "Nothing to compact yet").
- Editor title "Thread goal"; placeholder "Describe the outcome the agent should keep
  working toward."; counter "1,203 / 4,000"; buttons "Save goal", "Cancel".
- Composer footer button: target icon with the label "Goal" (icon only in the compact
  strip); tooltip "Set goal" or "Edit goal".
- Chip badges: "Working", "Paused", "Met". Tooltips: "Pause goal", "Resume goal", "Mark
  met", "Edit goal", "Clear goal".
- Clear toast: "Goal cleared" with "Undo".
- What the agent receives (prepended before the message text, not shown in the timeline):

  ```
  <loom_goal>
  The user pinned this standing goal to the thread. Keep working toward it across turns,
  and say so when you believe it is met.
  <objective>
  ...
  </objective>
  </loom_goal>
  ```

## States

- Loading: the chip renders nothing until the goal query resolves (no layout shift for
  threads without a goal).
- Empty: no chip. The palette offers "Set goal".
- Error: saving shows the error inside the editor and keeps the text; failed state changes
  show a toast and leave the chip unchanged.
- Disabled: goal items, the footer button and the chip are hidden on servers without
  `compaction-and-goals` and on draft threads. On narrow composers the footer button is
  hidden with other overflow blocks; the palette and keybinding still work. Compaction items are disabled with a reason when upstream would
  disable its button.
- In progress: compaction shows upstream's compacting state in the timeline; the palette
  item is disabled while the thread is running.

## Surfaces and connection modes

Web and desktop are required and identical. Mobile shows no goal UI; turns sent from the
upstream mobile app to a Loom server still carry the goal. Remote works. Upstream T3
servers: compaction entry points work, goal UI is hidden. An upstream client on a Loom
server sees no goal UI, but its turns still carry the goal (server-side delivery); that is
intended.

## Decisions

- Compaction reuses upstream's `/compact` turn rather than a new command: every adapter
  already supports it (native for Codex and OpenCode, slash commands for Claude, Cursor
  (`/compress`), Grok and Antigravity), and upstream serializes it against other turns.
- Goals are delivered as text prepended to each turn on the server (`ext-turn-input`,
  order 20). Claude's system prompt is fixed for the session's lifetime, so a changing goal
  cannot live there without restarting the session; the per-turn path is the one hook every
  adapter shares. Prepending (not appending) keeps Claude's `$skill` arguments intact.
- The goal is not stored in the conversation or as an orchestration event, so rollback to
  upstream T3 simply drops it.
- Paused and met goals are not sent at all (no "goal paused" notice to the model).
- A "Set goal" composer footer button ships in v1 through `ext-composer`: the shared hook
  costs this packet no extra upstream seam, and the composer is where Kyle looks when
  framing work.
- No Codex native goal mirroring now: goals reach every provider, Codex included, through
  `ext-turn-input`. Revisit only if Codex native goals add behavior (for example persistence
  across Codex's own compaction); recorded as a follow-up in README.md.
