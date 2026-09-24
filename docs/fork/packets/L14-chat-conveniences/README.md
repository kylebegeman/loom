# L14: Chat conveniences

Status: Ready to build. <!-- Not started | Designing | Ready to build | In progress | Done | Blocked: reason -->

Five small improvements to the chat view. Each part ships on its own and has its own
commit; an agent can build any subset, except that E builds on C.

- **A. Find in thread**: `mod+F` (on by default, with a switch to turn it off) opens a find
  bar over the timeline; it searches the thread's loaded messages as you type, shows "3 of
  12", highlights matches, and moves between them with Enter and Shift+Enter.
- **B. Mermaid diagrams**: a ` ```mermaid ` block in a message renders as a diagram
  (the approved `mermaid` dependency, loaded on demand in its own chunk after the message
  finishes streaming), with a toggle to see the code.
- **C. Model presets**: save the current model, provider account and effort as a named
  preset, and apply it from the composer, the command palette or a keybinding.
- **D. Ask without stopping**: an agent-facing tool that lets any provider post a question
  and keep working. The user answers in upstream's existing question panel; the answer
  arrives as a new message. It is offered to every provider, Codex included (Codex also
  has its own native async questions); this brings the behavior to Claude, Cursor, Grok,
  OpenCode and Antigravity.
- **E. Auto preset (Jev)**: a special "Auto" preset whose choices are a few models, each
  with a description and an allowed effort range. While it is on, Loom asks Jev which
  model and effort fit the message being typed and shows the pick with its confidence;
  the user accepts it or keeps the current selection. It never switches on its own.

Selection item: F8 (Chat conveniences: find in thread, Mermaid diagrams, model picker
presets, answering a provider's question without stopping it), see
[selections.md](../../selections.md). Clipboard history (also F8) is in L13; file outline
(also F8) is L05.

## Scope

- In: the five parts above, their settings (find shortcut, Mermaid on or off, Auto
  suggestions while typing), keybinding commands and palette items.
- Out:
  - Searching tool output, work log entries or other threads (upstream's command palette
    already searches thread content across threads).
  - Searching turns that are not loaded; the bar offers "Load earlier turns" instead.
  - Mermaid in pull request descriptions (`PullRequestMarkdown.tsx`) and on mobile.
  - Diagram zoom and pan (old Loom had them); the diagram fits the message width and
    scrolls.
  - Presets that also set access level or plan mode (possible later; they are thread
    settings with different rules).
  - A redesigned async question panel (old Loom's non-blocking panel). Upstream's panel
    already handles message-mode questions, including dismiss.
  - Automatic switching by the Auto preset. It only suggests (Kyle's rule).
  - Follow-up: more than one Auto preset, and Auto for new threads started from the
    sidebar (v1 has one Auto preset, used in the composer).

## Surfaces

- A, B, C, E: web and desktop. Mobile: not supported (nothing changes there).
- D: every client, because the question is an ordinary upstream `user-input.requested`
  activity in message mode. Web, desktop and upstream's own mobile app show it and send
  the answer. Needs a Loom server; on an upstream server agents do not see the tool.
- Remote: A to C are client-side; D and E run on the thread's environment (E's Jev call
  and key live on that environment's server).
- E needs a Loom server with `decide` (ext-decide) and `chat-conveniences` in
  `loomFeatures`; without them the Auto preset is hidden.

## Extension points used

- A: [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root), [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings), [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette), [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings).
- B: `ext-settings`.
- C: [`ext-composer`](../EXTENSION-POINTS.md#11-composer-ext-composer) (footer block), `ext-keybindings`, `ext-palette`.
- D: [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core), [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp).
- E: `ext-core` (RPC group and capability), [`ext-decide`](../EXTENSION-POINTS.md#18-decisions-with-jev-ext-decide)
  (EXTENSION-POINTS.md section 18; create if missing, exactly as specified there; feature
  `chat-conveniences.auto-preset`, `packet: "L14"`, `agentTool: false`; client gate
  `useDecideFeature`), plus everything C uses and `ext-settings`.

Each may have to be created by this packet (existence check first).

## Packet seams

- `apps/web/src/components/ChatView.tsx` (A): one hook call that hands the timeline list
  handle to the fork.
- `apps/web/src/components/ChatMarkdown.tsx` (B): an import and one early return in the
  `pre` renderer for `mermaid` blocks.
- `apps/web/package.json` (B, no marker): the `mermaid` dependency, approved by Kyle as a
  lazily loaded `apps/web` dependency.

Part E adds no seam.

Details in [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L13's Once is armed, applying a preset (or accepting an Auto suggestion) is one more
  change that Once reverts.
- If L01 is present, nothing interacts.
- If L29 (Jev hub) is present, Auto's decisions appear in its Decisions panel for rating,
  and its test sets can tune the feature's threshold and pin a model version. Without L29,
  ext-decide's minimal "Jev" settings section is enough to use Auto.
- If L18 (project profiles) is present, nothing changes: "Jev off for this project" comes
  from ext-decide.

## Size estimate

Medium to large: about 1,800 to 2,200 lines including tests. A about 450, B about 250, C
about 400, D about 250, E about 500 (server request builder, service and RPC about 200, web
editor, chip and suggestion hook about 300), glue and settings about 120.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
every file here. IMPLEMENTATION.md has one section per part; start with the part Kyle
asked for, or with D (smallest, no UI). E comes after C.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
