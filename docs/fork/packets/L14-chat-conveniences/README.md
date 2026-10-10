# L14: Chat conveniences

Status: Ready to build. <!-- Not started | Designing | Ready to build | In progress | Done | Blocked: reason -->

Two improvements to the chat view. Each part ships on its own and has its own commit; an
agent can build either or both. Parts keep their original letters.

- **C. Model presets**: save the current model, provider account and effort as a named
  preset, and apply it from the composer, the command palette or a keybinding.
- **D. Ask without stopping**: an agent-facing tool that lets any provider post a question
  and keep working. The user answers in upstream's existing question panel; the answer
  arrives as a new message. It is offered to every provider, Codex included (Codex also
  has its own native async questions); this brings the behavior to Claude, Cursor, Grok,
  OpenCode and Antigravity.

## Retired parts

Kyle approved on 2026-10-09 retiring parts A and B, because upstream T3 Code
(Orchestrator V2, now in Loom nightly) ships both:

- **A. Find in thread**: upstream has find in thread.
- **B. Mermaid diagrams**: upstream renders Mermaid diagrams.

Kyle also retired part E on 2026-10-09:

- **E. Auto preset (Jev)**: Jev moved to its own project outside Loom.

Their design, seams and the `mermaid` dependency are removed from this folder; git history
keeps them. With them go the packet's only default shortcut (`mod+F`), its settings
section, its RPC group and every packet seam.

Selection item: F8 (Chat conveniences: find in thread, Mermaid diagrams, model picker
presets, answering a provider's question without stopping it), see
[selections.md](../../selections.md). Clipboard history (also F8) is in L13; file outline
(also F8) is L05.

## Scope

- In: parts C and D, their keybinding commands and palette items.
- Out:
  - Find in thread and Mermaid diagrams: retired, see above.
  - The Auto preset (Jev): retired, see above.
  - Presets that also set access level or plan mode (possible later; they are thread
    settings with different rules).
  - A redesigned async question panel (old Loom's non-blocking panel). Upstream's panel
    already handles message-mode questions, including dismiss.

## Surfaces

- C: web and desktop. Mobile: not supported (nothing changes there).
- D: every client, because the question is an ordinary upstream `user-input.requested`
  activity in message mode. Web, desktop and upstream's own mobile app show it and send
  the answer. Needs a Loom server; on an upstream server agents do not see the tool.
- Remote: C is client-side; D runs on the thread's environment.

## Extension points used

- C: [`ext-composer`](../EXTENSION-POINTS.md#11-composer-ext-composer) (footer block), [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings), [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette).
- D: [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core), [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp).

Each may have to be created by this packet (existence check first).

## Packet seams

None. The seams for parts A and B left with them. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L13's Once is armed, applying a preset is one more change that Once reverts.
- If L01 is present, nothing interacts.

## Size estimate

Small to medium: about 650 to 750 lines including tests. C about 400, D about 250, glue
(palette source and command handlers) about 50.

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
