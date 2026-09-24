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
- Picking the right model and effort for each message is a judgment call Kyle makes many
  times a day ("this is a rename, the fast model is fine"; "this is a design question, use
  the strongest with high effort"). Jev can make that call in about a second, but it must
  only suggest.

## What the user can do

A. Find in thread

- Press `mod+F` in a thread (on by default; or use the palette or a custom binding). A find
  bar appears at the top right of the timeline with the search field focused. Outside the
  chat (terminal, browser preview, a right-panel surface) `mod+F` keeps its usual meaning,
  including the browser's own find on web.
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

- Any agent (Claude, Cursor, Grok, OpenCode, Antigravity and Codex; the tool is offered to
  every provider) can call `loom_chat_conveniences_ask` with up to three questions and
  optional choices. The call returns immediately and the agent keeps working.
- The question appears in the thread's question panel exactly like a Codex async
  question: choose an option or type an answer, and send; or dismiss it.
- The answer is sent as a new message in the thread: it reaches the running turn or starts
  a new one, as upstream does for Codex async answers.
- Works from the phone too (upstream's mobile app already shows these questions).

E. Auto preset (Jev)

- In the presets list, "Set up Auto" opens the Auto editor: add 2 to 6 choices with "Add
  current model" (the composer's provider account, model and other options), give each a
  short description of when to use it (prefilled with the model name, edited by the user),
  and pick its allowed effort range (lowest and highest effort, from that model's own
  effort options; "No effort setting" when the model has none). Save.
- Apply "Auto" from the presets list like any preset. An "Auto" chip appears in the
  composer footer. The selection does not change.
- Type a message. After a short pause Loom asks Jev, and the chip shows the pick: "Auto
  suggests Opus, High (82% sure)" with **Use**. **Use** (or the bindable command) applies
  that model and effort exactly as applying a preset does. Sending without pressing **Use**
  sends with the current selection.
- When the pick equals the current selection, the chip says "Auto: current model fits".
- When Jev cannot help, the chip says "Auto: keeping current model" and, on hover, why:
  Jev is off for Auto, no Jev key on this environment, Jev is off for this project, no
  answer within a second, an error, or Jev was not sure.
- Click the chip's close button, or apply another preset, to turn Auto off for this thread.
- Turn "Suggest while typing" off in Settings > Loom > Chat conveniences to ask only when
  clicking the chip ("Suggest").
- While Auto is on, the message being typed is sent to Jev (TypeSafe) from the
  environment's server, after secrets are redacted. The Auto editor says so.

## Entry points

| Part     | Way in                                                                                                                                                                                                                            | Way out / state                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A        | `mod+F` in a thread view (on by default, switchable), keybinding command `loom.chat-conveniences.find` (unbound), palette "Find in thread"                                                                                        | Escape or the close button; highlights clear.                                                                |
| B        | Automatic for `mermaid` blocks                                                                                                                                                                                                    | "Code" toggle per block; Settings switch turns rendering off everywhere.                                     |
| C        | Footer presets button; palette "Apply model preset: …", "Save model preset", "Manage model presets"; `loom.chat-conveniences.presets` (opens the list), `preset-1` to `preset-5`                                                  | Escape closes the list; delete has Undo; any preset change can be changed back with the picker.              |
| D        | Agent-initiated                                                                                                                                                                                                                   | Answer or Dismiss in the question panel.                                                                     |
| E        | Presets list "Set up Auto" and "Auto"; chip **Use** or **Suggest**; `loom.chat-conveniences.auto-accept` (unbound); palette "Use Auto suggestion", "Turn off Auto"                                                                | Chip close button, applying another preset, or the palette item. The model is never changed without **Use**. |
| Settings | Settings > Loom > Chat conveniences: "`mod+F` opens Find in thread", "Render Mermaid diagrams", "Auto: suggest while typing"; Settings > Loom > Jev (ext-decide): the key and Auto's "Use Jev" switch (Auto has no agents switch) | Switch back.                                                                                                 |

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
- E: not set up: the presets list shows "Set up Auto"; Auto set up but Jev not usable for
  it on this environment (no `decide` capability, "Use Jev" off, no key, or Auto's switch
  off): "Auto" and "Set up Auto" are hidden. If Auto was already on for the thread, its chip
  stays with the reason so it can be turned off. Asking: the chip reads "Auto: thinking" (text only, no
  spinner). Suggested, fits, fallback: as above. A suggested model that is unavailable
  (account removed, thread locked to another provider): "Auto suggests <model>, which this
  thread can't use" with no **Use**. Message shorter than 12 characters: no request, the
  chip reads "Auto".

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
- E: presets list "Auto", "Set up Auto", "Edit Auto". Editor title "Auto preset"; intro
  "Loom asks Jev which of these choices fits each message and suggests it. Nothing changes
  until you press Use. The message you are typing is sent to Jev from this environment,
  with secrets removed."; "Add current model"; per choice "Description" (placeholder "When
  to use it, for example: quick questions and small edits"), "Lowest effort", "Highest
  effort", "No effort setting", "Remove"; "Save"; error "Add at least two choices." and
  "Two choices have the same name." Chip: "Auto", "Auto: thinking", "Auto suggests
  <model>, <effort> (<n>% sure)", "Use", "Auto: current model fits", "Auto: keeping
  current model", "Suggest"; fallback reasons "Jev is off for Auto. Change it in Settings >
  Loom > Jev.", "No Jev key on this environment.", "Jev is off for this project.", "Jev
  didn't answer in time.", "Jev had an error.", "Jev wasn't sure.", and, when Jev's
  unsure answer is known, "Jev leaned to <model>, <effort> but wasn't sure." (no **Use**).
- Settings section "Chat conveniences"; switch "Auto: suggest while typing", description
  "Off: Auto asks only when you click Suggest."

## Surfaces and connection modes

A, B, C are client-side (web and desktop) and work with any environment, including
upstream servers. D needs a Loom server with `chat-conveniences` in `loomFeatures`; the
answer path is upstream's, so every client (including upstream mobile) handles it. E needs
a Loom server with `chat-conveniences` and `decide`; the Jev call runs on that server, so
it works the same locally, over Tailscale and through T3 Connect, and the key never
reaches a client.

## Decisions

- Find searches message data (what the timeline has loaded), not the DOM, because the
  timeline is virtualized; highlighting uses the CSS Custom Highlight API on rendered rows,
  so no markup changes.
- `mod+F` opens Find in thread by default, with a setting to turn it off. The fork handles
  the key directly instead of a default keybinding written into `keybindings.json`, which
  upstream T3 Code would flag as invalid after a rollback (EXTENSION-POINTS.md,
  Keybindings). Outside the chat the browser's find still works, and a user binding on
  `mod+F` wins over the default.
- `mermaid` is approved as a lazily loaded `apps/web` dependency in its own chunk. It
  renders to an image (`<img>` with an SVG blob), so diagram content can never run script
  or touch the page, and it is loaded only when a diagram appears.
- Presets are per client (localStorage), like upstream's client settings.
- Ask without stopping reuses upstream's message-mode question activity and answer path
  (no new events, no new UI); the fork only adds the MCP tool that posts it. The tool is
  offered to every provider, Codex included, with no per-provider refusal; its description
  steers agents to their own blocking question tool when they cannot continue without the
  answer.
- Auto preset uses Jev through ext-decide (feature `chat-conveniences.auto-preset`) and
  only suggests: it shows the pick and its confidence and waits for **Use**. The fallback
  is always the current selection, so a Jev failure never blocks or changes a send.
- Auto picks within the user's own ranges by construction: Jev chooses among the user's
  described choices and a named effort level (light, standard, deep), and code maps the
  level to the lowest, middle or highest effort in that choice's range (Jev jaggedness:
  no numbers or ranges in the question).
- Auto sends only the typed message and a few facts computed in code (length bucket,
  images attached, new thread or follow-up), never the thread history, to keep Jev's state
  small and relevant.
