# L14 product

## Problem

- Switching between a few favorite model setups (for example "Opus, high effort" and
  "Codex personal account, medium") takes several clicks in the picker every time.
- Codex can ask a question and keep working; other providers either block on the question
  or cannot ask at all mid-turn. Kyle wants every provider to be able to ask without
  stopping.

## What the user can do

Parts A (find in thread) and B (Mermaid diagrams) were retired on 2026-10-09 because
upstream ships both, and part E (Auto preset with Jev) the same day because Jev moved to
its own project outside Loom (README, "Retired parts").

C. Model presets

- A presets button in the composer footer (bookmark icon) opens a small list: apply a
  preset with a click or Enter; "Save current setup" saves the composer's current provider
  account, model and effort options under a name (up to 9 presets); rename, reorder and
  delete from the same list (delete can be undone from the toast).
- A preset that no longer fits (the account was removed, the model is gone, or the thread
  is locked to another provider) is shown dimmed with the reason and cannot be applied.
- The palette lists "Apply model preset: <name>" and "Save model preset"; the first five
  presets can be bound to keys (`loom.chat-conveniences.preset-1` to `preset-5`).

D. Ask without stopping

- Any agent (Claude, Cursor, Grok, OpenCode, Antigravity and Codex; the tool is offered to
  every provider) can call `loom_chat_conveniences_ask` with up to three questions and
  optional choices. The call returns immediately and the agent keeps working.
- The question appears in the thread's question panel exactly like a Codex async
  question: choose an option or type an answer, and send; or dismiss it.
- The answer is sent as a new message in the thread: it reaches the running turn or starts
  a new one, as upstream does for Codex async answers.
- Works from the phone too (upstream's mobile app already shows these questions).

## Entry points

| Part | Way in                                                                                                                                                                           | Way out / state                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| C    | Footer presets button; palette "Apply model preset: …", "Save model preset", "Manage model presets"; `loom.chat-conveniences.presets` (opens the list), `preset-1` to `preset-5` | Escape closes the list; delete has Undo; any preset change can be changed back with the picker. |
| D    | Agent-initiated                                                                                                                                                                  | Answer or Dismiss in the question panel.                                                        |

## States

- C: no presets: "No presets yet" and "Save current setup"; unavailable preset as above;
  saving with 9 presets: "Replace a preset" mode (choose one to overwrite, Escape cancels).
- D: too many open asks from the tool on one thread (3 unanswered calls, each with up to 3
  questions): the tool fails with "You already have 3 unanswered asks in this thread. Wait
  for answers before asking more."

## Copy

- C: "Presets"; "Save current setup"; "Name" placeholder "Opus, high effort"; toast
  "Preset deleted" with "Undo"; unavailable reasons "This account isn't set up on this
  environment.", "This model is no longer available.", "This thread uses <provider>;
  presets for other providers apply to new threads."
- D: tool title "Ask the user without stopping"; tool description (short, it costs tokens
  on every turn): "Ask the user up to 3 questions without waiting. Returns immediately;
  their answer arrives later as a new user message. Keep working meanwhile. Use your
  built-in question tool instead when you cannot continue without the answer."

## Surfaces and connection modes

C is client-side (web and desktop) and works with any environment, including upstream
servers. D needs a Loom server with `chat-conveniences` in `loomFeatures`; the
answer path is upstream's, so every client (including upstream mobile) handles it.

## Decisions

- Find in thread and Mermaid diagrams: retired by Kyle on 2026-10-09; upstream ships both.
  The earlier approval of a `mermaid` dependency no longer applies to this packet.
- Auto preset (Jev): retired by Kyle on 2026-10-09; Jev moved to its own project outside
  Loom.
- Presets are per client (localStorage), like upstream's client settings.
- Ask without stopping reuses upstream's message-mode question activity and answer path
  (no new events, no new UI); the fork only adds the MCP tool that posts it. The tool is
  offered to every provider, Codex included, with no per-provider refusal; its description
  steers agents to their own blocking question tool when they cannot continue without the
  answer.
