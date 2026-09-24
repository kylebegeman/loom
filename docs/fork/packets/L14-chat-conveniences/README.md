# L14: Chat conveniences

Status: Not started. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

Four small improvements to the chat view. Each part ships on its own and has its own
commit; an agent can build any subset.

- **A. Find in thread**: `mod+F` opens a find bar over the timeline; it searches the
  thread's loaded messages as you type, shows "3 of 12", highlights matches, and moves
  between them with Enter and Shift+Enter.
- **B. Mermaid diagrams**: a ` ```mermaid ` block in a message renders as a diagram
  (loaded on demand, after the message finishes streaming), with a toggle to see the code.
- **C. Model presets**: save the current model, provider account and effort as a named
  preset, and apply it from the composer, the command palette or a keybinding.
- **D. Ask without stopping**: an agent-facing tool that lets any provider post a question
  and keep working. The user answers in upstream's existing question panel; the answer
  arrives as a new message. Codex already does this natively; this brings it to Claude,
  Cursor, Grok, OpenCode and Antigravity.

Selection item: F8 (Chat conveniences: find in thread, Mermaid diagrams, model picker
presets, answering a provider's question without stopping it), see
[selections.md](../../selections.md). Clipboard history (also F8) is in L13; file outline
(also F8) is L05.

## Scope

- In: the four parts above, their settings (find shortcut, Mermaid on or off), keybinding
  commands and palette items.
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

## Surfaces

- A, B, C: web and desktop. Mobile: not supported (nothing changes there).
- D: every client, because the question is an ordinary upstream `user-input.requested`
  activity in message mode. Web, desktop and upstream's own mobile app show it and send
  the answer. Needs a Loom server; on an upstream server agents do not see the tool.
- Remote: A to C are client-side; D runs on the thread's environment.

## Extension points used

- A: [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root), [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings), [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette), [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings).
- B: `ext-settings`.
- C: [`ext-composer`](../EXTENSION-POINTS.md#11-composer-ext-composer) (footer block), `ext-keybindings`, `ext-palette`.
- D: [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core), [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp).

Each may have to be created by this packet (existence check first).

## Packet seams

- `apps/web/src/components/ChatView.tsx` (A): one hook call that hands the timeline list
  handle to the fork.
- `apps/web/src/components/ChatMarkdown.tsx` (B): an import and one early return in the
  `pre` renderer for `mermaid` blocks.
- `apps/web/package.json` (B, no marker): the `mermaid` dependency, which needs Kyle's
  approval (new production dependency).

Details in [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L13's Once is armed, applying a preset is one more change that Once reverts.
- If L01 is present, nothing interacts.

## Size estimate

Medium: about 1,300 to 1,600 lines including tests. A about 450, B about 250, C about 400,
D about 250, glue and settings about 100.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
every file here. IMPLEMENTATION.md has one section per part; start with the part Kyle
asked for, or with D (smallest, no UI).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
