# L49: Model history

Status: Ready to build

Approved by Kyle on 2026-10-10.

A model in the 3D panel gets a timeline of the thread's turns that changed it. Press `T` (or the
History button) and a strip appears under the viewport: "Start", "Turn 2", "Turn 4", "Turn 7",
"Now". Clicking a chip, or pressing `[` and `]`, shows that version read-only, labelled
"Viewing turn 4 of 9". SCAD versions render from the files as they were at that turn, includes
and imported meshes too. "Compare" overlays a second version as a translucent ghost and shows
how its size and triangle count changed. "Restore this version" writes the model (and, if
asked, its included files) back into the workspace as an ordinary edit, with a confirmation and
an Undo. Annotations accepted in the panel remember the turn that resolved them, so "Accepted in
turn 6" links straight to that version. Agents get the same list and restore through two MCP
tools and can render any version to PNG.

## Scope

In:

- A per-model version list built from the thread's own turn checkpoints (hidden Git refs), plus
  the thread's starting state. A version is listed when the turn changed the model file or a
  file the model reads now (SCAD `include`, `use`, `import()`, `surface()`).
- Lazy, paged loading (30 versions a page) and on-demand, cancellable materialization and
  rendering of one version at a time.
- Read-only viewing of any version, with the same camera, display and section state.
- Compare: one other version as a ghost overlay with a size and triangle delta.
- Restore of the model file, optionally with the included files as they were at that version,
  as a normal workspace write with conflict detection and a one-step Undo.
- `resolvedIn` on accepted annotations, set by the server, and "View turn N" from Markup.
- Agent access: `loom_model_preview_3d_history`, `loom_model_preview_3d_restore_version`, a
  `checkpointId` option on `loom_model_preview_3d_render`, and editor command actions for the
  strip.
- `T`, `[` and `]` keys, palette entries and a toolbar button.

Out:

- Git commit history (`git log`). Checkpoints only cover this thread's turns; commit history is
  a separate source and a possible later packet.
- Versions from other threads. Each thread has its own checkpoints and turn numbers.
- Following renames. History follows the model's current path.
- Side-by-side comparison panes (the variants dialog's `ComparePane` stays variant-only).
- Restoring a deleted model or deleting files. Restore only writes files that existed at the
  version.
- Rendering old SCAD with today's parameter sets or customizer values. Old versions render with
  the defaults written in their source.
- Whole-workspace revert. Upstream's thread rollback already does that.
- Mobile UI. Mobile has no 3D panel; mobile-started turns still produce versions.

## Surfaces

| Surface                      | Behavior                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web (`npx t3`, app.t3.codes) | Full feature in the 3D panel.                                                                                                                                                 |
| Desktop                      | Same as web.                                                                                                                                                                  |
| Mobile                       | No 3D panel. Agents in mobile-started turns can use the MCP tools.                                                                                                            |
| Agents                       | Two new MCP tools, a render option and editor command actions; the `t3 model` CLI follows the tool names automatically (`apps/server/src/fork/model-preview-3d/cli.ts:5-15`). |
| Remote and tunnel            | Version meshes use the existing signed file route; nothing new is exposed.                                                                                                    |

## Extension points used

Only L23's existing ones: `ext-core` (fork RPC group, authorization table, MCP toolkit),
`ext-panels` (the 3D panel), `ext-palette` (palette entries) and `ext-web-root` (unchanged).
No new extension point.

## Packet seams

None. Every edit is in fork-owned files. The panel reads the thread projection through the
existing upstream export `useThreadProjection` (`apps/web/src/state/entities.ts:126`) and the
server reads checkpoints through `ProjectionStoreV2.getThreadRecords`
(`apps/server/src/orchestration-v2/ProjectionStore.ts:364`); importing them is not a seam.

## New dependencies

None. Git plumbing runs through the existing `ProcessRunner`.

## Relationship to other follow-up packets

- **L41 `model-follow-agent`**: shares `apps/server/src/fork/model-preview-3d/scadIncludes.ts`
  and `formats.ts`. Whichever lands first creates them exactly as L41's TECHNICAL.md defines.
  Without L41, L49 creates them. With L41, a changed tab's dot clears when the strip is opened
  on that model, because opening the tab already clears it.
- **L42 `model-change-ghost`**: shares `viewer/ghost.ts` and the viewer's `ghosts` group. Each
  keeps its own ghost instance, so L42's previous-version ghost and L49's compare ghost can be
  on at once. Without L42, L49 creates `ghost.ts` per the shared definition.
- **L40 `model-units`**: the compare delta uses `formatLength` when it exists; otherwise
  millimetres with one decimal, like the status bar today.
- **L35 `model-lay-flat`**: when its placement rotation exists, the compare ghost gets the same
  rotation as the model so the two line up.
- **L44 `model-capture-export`** and **L46 `model-print-check`**: unaffected; they act on the
  current version. Capture is disabled while viewing a version.
- Everything else is neutral.

## Documents

- [PRODUCT.md](./PRODUCT.md): what the user sees and decides.
- [TECHNICAL.md](./TECHNICAL.md): contracts, server, storage, clients, tools.
- [SEAMS.md](./SEAMS.md): files touched.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): build order and "Done when".
- [TESTING.md](./TESTING.md): tests, commands, manual checks.
- [REFERENCES.md](./REFERENCES.md): source references and external facts.
