# L96: Bots from threads

Status: Selected; queued.

Turn a conversation that worked into a bot. "Save as bot" on any thread opens the bot editor
filled from that thread: the opening brief becomes the instructions, file paths and pull request
numbers in it become parameters, and the thread's model, modes and workspace carry over. An
optional "Refine" pass asks a model to tidy the draft. Loom also notices when Kyle (or an
orchestrator) keeps opening threads with the same brief and suggests making it a bot.

B02 | Complexity: Medium | Impact: High | Depends on: L89

## Scope

- In: a server-side deterministic draft from a thread; the thread menu item and a palette item;
  the editor opened with the draft; optional model refinement in a hidden drafting thread;
  repeated-brief detection with suggestions on the Bots page; dismissing a suggestion; MCP
  `loom_bots_draft_from_thread` and `loom_bots_suggestions`.
- Out: drafting from several threads at once; editing the source thread; mobile thread menu
  (the draft is reachable from mobile only through an agent).

## Surfaces

Web and desktop: the sidebar thread context menu and the thread header menu, palette, Bots page
suggestions. Mobile: nothing new. Remote: RPC only. Gated on `bots-from-thread`.

## Extension points used

None new (L89's): `ext-core`, persistence, background work under `forkParked`, `ext-palette`
(the existing bots source gains one item), `ext-mcp`. Capability sub-feature `bots-from-thread`.

## Packet seams

Three files, `fork: bots`: `apps/web/src/components/threadActionMenu.logic.ts`,
`apps/web/src/hooks/useThreadActionMenu.ts` and `apps/web/src/components/Sidebar.tsx`, for the
"Save as bot" item in the thread header menu and the sidebar context menu. See
[SEAMS.md](./SEAMS.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
