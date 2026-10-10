# L66: PCB history

Status: Ready to build

Approved by Kyle on 2026-10-10.

A design in the PCB panel gets a timeline of the thread's turns that changed it. Press `T` (or
the History button) and a strip appears under the drawing: "Start", "Turn 2", "Turn 5",
"Turn 8", "Now". Clicking a chip, or pressing `[` and `]`, shows the schematic, board or 3D
board as it was after that turn, read-only, labelled "Viewing turn 5 of 9". KiCad projects come
back whole: the board, the root schematic, every sub-sheet and the project's own libraries as
they were at that turn. "Compare" sends the version to the existing Compare tool, so the
structural changes and board overlay work between any two turns or against today. "Restore this
version" writes the design's files back into the workspace together, as one edit with a
confirmation and one Undo. The Compare tool's revision list stops showing other threads' hidden
refs and shows this thread's turns as "Turn N" instead. Agents get the same list and restore
through MCP tools and can render or export any version.

## Scope

In:

- A per-design version list built from the thread's own turn checkpoints plus its starting
  state. A turn is listed when it changed any file the design uses today: KiCad project,
  schematics and sub-sheets, board, design rules, library tables and project-local libraries;
  for tscircuit, the entry file and the local files it imports.
- Paged loading (30 versions a page) and on-demand materialization of one version's design
  files, shared with L49's history service.
- Read-only viewing of a version in every view the design has: schematic sheets, board layer
  presets and custom layers, and the 3D board.
- Compare through the existing Compare tab, prefilled with the version and the current files.
- Restore of the whole design file set as one write with conflict detection and one Undo,
  optionally with supporting files (libraries, assets) and the removal of sheets or modules
  added since that turn.
- The `loom_pcb_revisions` defect: the list is scoped to this thread's turns that touched the
  design, labelled by turn, instead of every `refs/t3/` ref in the repository.
- Agent access: `loom_pcb_history`, `loom_pcb_restore_version`, a `checkpointId` option on
  `loom_pcb_render` and `loom_pcb_asset`, and editor command actions for the strip. `t3 pcb`
  follows the tool names.
- `T`, `[` and `]` keys, palette entries, a toolbar button and the `?` shortcut list.

Out:

- Git commit history as a timeline. Commits stay available in Compare, as today.
- Versions from other threads, or following a renamed design.
- Restoring a design that no longer exists today. History starts from a design in the list.
- Running ERC, DRC, simulation, Inspect or parameter edits against an old version. Those apply
  to the current files; Compare covers "what changed".
- Versioning 3D component bodies (`.step`, `.wrl`). A version's 3D board uses the component
  models available today.
- Whole-workspace revert. Upstream's thread rollback does that.
- Mobile UI. Mobile has no PCB panel.

## Surfaces

| Surface                      | Behavior                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web (`npx t3`, app.t3.codes) | Full feature in the PCB panel.                                                                                                                                   |
| Desktop                      | Same as web.                                                                                                                                                     |
| Mobile                       | No PCB panel. Agents in mobile-started turns can use the MCP tools.                                                                                              |
| Agents                       | Two new MCP tools, a `checkpointId` option on render and asset, editor actions; `t3 pcb` maps actions to tool names (`apps/server/src/fork/pcb-preview/cli.ts`). |
| Remote and tunnel            | Sheets come through the existing `readSheet` RPC and 3D boards through the existing signed URL; nothing new is exposed.                                          |

## Extension points used

Only L24's existing ones: the fork RPC group and authorization table, the `loom_pcb_*` MCP
toolkit, the PCB panel and the palette source. No new extension point.

## Packet seams

None. Every edit is in fork-owned files. The panel reads the thread projection through the
existing upstream export `useThreadProjection` (`apps/web/src/state/entities.ts:126`) and the
server reads checkpoints through `ProjectionStoreV2.getThreadRecords`
(`apps/server/src/orchestration-v2/ProjectionStore.ts:364`). See [SEAMS.md](./SEAMS.md).

## New dependencies

None. Git plumbing runs through the existing `ProcessRunner`.

## Relationship to other follow-up packets

- **L49 `model-history`**: owns the shared history service in
  `apps/server/src/fork/model-preview-3d/` (`history.ts`, `historyGit.ts`) and the restore and
  undo file operations. With L49 landed, L66 imports them and moves L49's inline restore and
  undo into `historyRestore.ts` unchanged. Without L49, L66 creates all three files exactly as
  L49's TECHNICAL.md and this packet describe, and L49 calls them when it lands.
- **L41 `model-follow-agent`**: the repository prefix helper (`git rev-parse --show-prefix`)
  is reused if L41 or L49 created it.
- **L59 `pcb-follow-agent`** and **L60 `pcb-change-highlight`**: neutral. While a version is
  shown, L60's highlight stays off and L59 does not switch the shown design away from it; it
  marks the tab as changed instead.
- **L52 `pcb-check-markers`** and **L58 `pcb-auto-checks`**: findings belong to the current
  files and are hidden while a version is shown.
- **L62 `pcb-capture-export`**: capture is disabled while a version is shown, as for L49.
- **L63 `pcb-viewport-access`**: announces "Viewing turn 5 of 9" through its live region when
  both have landed.
- **L69 `pcb-change-requests`**: a request accepted in a later turn can link to that turn with
  `turn-history`; L69 owns that link.
- **L70 `pcb-variant-sweeps`**: neutral; variants act on current files.
- Everything else is neutral.

## Documents

- [PRODUCT.md](./PRODUCT.md): what the user sees and decides.
- [TECHNICAL.md](./TECHNICAL.md): contracts, server, storage, clients, tools.
- [SEAMS.md](./SEAMS.md): files touched.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): build order and "Done when".
- [TESTING.md](./TESTING.md): tests, commands, manual checks.
- [REFERENCES.md](./REFERENCES.md): source references and external facts.
