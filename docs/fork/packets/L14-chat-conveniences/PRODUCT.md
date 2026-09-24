# L14 product

## Problem

- Long threads are hard to navigate: there is no way to find "that command the agent
  suggested earlier" except scrolling. Web users get the browser's find, which misses
  messages scrolled out of the virtualized list; the desktop app has no find at all.
- Agents often explain architecture with Mermaid diagrams, which arrive as unreadable code.
- Switching between a few favorite model setups (for example "Opus, high effort" and
  "Codex personal account, medium") takes several clicks in the picker every time.
- Codex can ask a question and keep working; other providers either block on the question
  or cannot ask at all mid-turn. Kyle wants every provider to be able to ask without
  stopping.

## What the user can do

A. Find in thread

- Press `mod+F` in a thread (or use the palette or a custom binding). A find bar appears at
  the top right of the timeline with the search field focused.
- Type: matching messages are counted live ("3 of 12"), matches in visible messages are
  highlighted, and the current match is scrolled into view with a stronger highlight.
- Enter goes to the next match, Shift+Enter to the previous (wrapping). Escape closes and
  removes highlights.
- Toggle "Match case". Search covers user and assistant messages that are loaded; when the
  thread has older turns, the bar shows "Searching loaded turns. Load earlier" and the
  link loads more.

B. Mermaid diagrams

- A ` ```mermaid ` code block in a message shows as a diagram once the message is
  complete. While the message is still streaming it shows as code.
- The block header has "Code" to switch to the source (with upstream's copy and wrap
  buttons) and "Diagram" to switch back, plus "Copy source".
- A diagram that fails to render shows the code with "Couldn't render this diagram: <reason>".
- Turn diagrams off in Settings > Loom > Chat conveniences.

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

- An agent (Claude, Cursor, Grok, OpenCode, Antigravity, and Codex if it chooses the tool)
  can call `loom_chat_conveniences_ask` with up to three questions and optional choices.
  The call returns immediately and the agent keeps working.
- The question appears in the thread's question panel exactly like a Codex async
  question: choose an option or type an answer, and send; or dismiss it.
- The answer is sent as a new message in the thread: it reaches the running turn or starts
  a new one, as upstream does for Codex async answers.
- Works from the phone too (upstream's mobile app already shows these questions).

## Entry points

| Part     | Way in                                                                                                                                                                           | Way out / state                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A        | `mod+F` in a thread view (on by default, switchable), keybinding command `loom.chat-conveniences.find` (unbound), palette "Find in thread"                                       | Escape or the close button; highlights clear.                                                   |
| B        | Automatic for `mermaid` blocks                                                                                                                                                   | "Code" toggle per block; Settings switch turns rendering off everywhere.                        |
| C        | Footer presets button; palette "Apply model preset: …", "Save model preset", "Manage model presets"; `loom.chat-conveniences.presets` (opens the list), `preset-1` to `preset-5` | Escape closes the list; delete has Undo; any preset change can be changed back with the picker. |
| D        | Agent-initiated                                                                                                                                                                  | Answer or Dismiss in the question panel.                                                        |
| Settings | Settings > Loom > Chat conveniences: "`mod+F` opens Find in thread", "Render Mermaid diagrams"                                                                                   | Switch back.                                                                                    |

## States

- A: no query: "Type to search this thread"; no results: "No matches"; the timeline not
  mounted yet: the bar does not open. `mod+F` falls through to the browser (web) or does
  nothing (desktop) when focus is in a terminal, the browser preview, a right-panel
  surface, or when the setting is off.
- B: rendering: the block keeps the code's height with a "Rendering diagram" label (no
  spinner animation); error as above; source over 20,000 characters: shown as code with
  "Diagram too large to render."
- C: no presets: "No presets yet" and "Save current setup"; unavailable preset as above;
  saving with 9 presets: "Replace a preset" mode (choose one to overwrite, Escape cancels).
- D: too many open questions from the tool on one thread (3): the tool fails with "There
  are already 3 unanswered questions in this thread. Wait for answers before asking more."

## Copy

- A: placeholder "Find in thread"; counter "3 of 12"; "No matches"; "Match case" (toggle
  with `Aa` icon); "Searching loaded turns. Load earlier".
- B: header label "Diagram"; buttons "Code", "Diagram", "Copy source"; "Rendering diagram";
  "Couldn't render this diagram: …"; "Diagram too large to render."
- C: "Presets"; "Save current setup"; "Name" placeholder "Opus, high effort"; toast
  "Preset deleted" with "Undo"; unavailable reasons "This account isn't set up on this
  environment.", "This model is no longer available.", "This thread uses <provider>;
  presets for other providers apply to new threads."
- D: tool title "Ask the user without stopping"; tool description (short, it costs tokens
  on every turn): "Ask the user up to 3 questions without waiting. Returns immediately;
  their answer arrives later as a new user message. Keep working meanwhile. Use your
  built-in question tool instead when you cannot continue without the answer."
- Settings section "Chat conveniences".

## Surfaces and connection modes

A, B, C are client-side (web and desktop) and work with any environment, including
upstream servers. D needs a Loom server with `chat-conveniences` in `loomFeatures`; the
answer path is upstream's, so every client (including upstream mobile) handles it.

## Decisions and open questions

Decisions:

- Find searches message data (what the timeline has loaded), not the DOM, because the
  timeline is virtualized; highlighting uses the CSS Custom Highlight API on rendered rows,
  so no markup changes.
- `mod+F` is handled directly by the fork (with a setting to turn it off) instead of a
  default keybinding written into `keybindings.json`, which upstream T3 Code would flag as
  invalid after a rollback (EXTENSION-POINTS.md, Keybindings).
- Mermaid renders to an image (`<img>` with an SVG blob), so diagram content can never run
  script or touch the page, and it is loaded only when a diagram appears.
- Presets are per client (localStorage), like upstream's client settings.
- Ask without stopping reuses upstream's message-mode question activity and answer path
  (no new events, no new UI); the fork only adds the MCP tool that posts it.

Open questions for Kyle:

1. Approve `mermaid` as a new dependency of `apps/web` (MIT, loaded lazily into its own
   chunk; old Loom used 11.16.0)?
2. `mod+F` on by default?
3. The ask tool is also listed to Codex sessions (MCP tool lists are not filtered per
   provider, EXTENSION-POINTS.md, MCP tools). Its description steers agents with a native
   async tool to prefer theirs. Acceptable, or should the handler refuse Codex threads?
