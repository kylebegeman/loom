# L24: PCB workspace

Status: Complete. Included in Loom `0.0.46-nightly.20261008.2801` on `main` (2026-10-08).
See [TESTING.md](./TESTING.md) for evidence and compatibility limits.
Integration baseline: `23b9bdc48dc8ca3356df5b686c11e02a7519cb76`.

Kyle authorized the original KiCad/tscircuit preview packet, all eight editor additions,
theme-aware drawings, rotatable 3D boards, a reusable hardware library, cross-thread board
references, and PCB/3D MCP and CLI parity. This is an editor with optional tools. Educational
content, slicing, fabrication and ordering remain outside this work.

## Scope

- Discover saved KiCad projects, standalone schematics/boards, `*.circuit.tsx`, and
  tscircuit configuration entrypoints in the current thread workspace.
- Render schematic sheets and board drawings on the environment host, with live reload,
  fit/zoom/pan, navigation history, named views and custom layer visibility/opacity/Solo/sets.
- Inspect components, pins and nets with linked board/schematic highlighting.
- Measure distance and angles, pin annotations, and attach captures to composer drafts.
- Compare Git commits, checkpoints and the saved working tree with structural changes and
  aligned board overlays.
- Run KiCad ERC/DRC, retain bounded reports and prepare summaries without sending messages.
- Run ngspice operating-point, transient and AC analyses, parameter sweeps, saved setups,
  waveform plots and CSV export. Designs need actual SPICE models or a supplied netlist.
- Review/apply explicitly declared tscircuit parameters and save reusable variants.
- Export and rotate actual GLB boards; reuse the L23 viewer without an idle render loop.
- Keep an environment hardware catalog with manufacturer references, owned inventory,
  dimensions, provenance and explicitly linked local assets. Starter entries do not bundle
  third-party CAD files. Copy linked assets into immutable project folders for reuse.
- Export a board GLB and mechanical revision metadata to this or another thread workspace
  for enclosure design. No messages are sent to another thread.
- Expose service operations and visible editor actions through MCP and authenticated CLI
  commands. Visible canvas actions require a connected editor; host operations do not.

Web and desktop share this surface. Remote data uses scoped RPC and signed HTTP assets;
relay/tunnel verification remains a separate compatibility limit. Mobile has shared contracts
but no PCB UI. Upstream servers disable the fork launcher through capability gating.

No new production dependency or database migration was added. Tools are detected on the
environment host, never downloaded by Loom. The Electronics app link remains optional.
Task-owned scratch is removed after phases; the active review preview retains only its
needed tools, fixture workspace, dependencies and isolated state.

## Documents

- [PRODUCT.md](./PRODUCT.md): editor scope and product decisions.
- [TECHNICAL.md](./TECHNICAL.md): boundaries and lifetime constraints.
- [SEAMS.md](./SEAMS.md): upstream integrations.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): delivery status.
- [TESTING.md](./TESTING.md): focused and integrated evidence.
- [REFERENCES.md](./REFERENCES.md): tools and sources.
- [User guide](../../user/pcb-preview.md): how to use the workspace.
