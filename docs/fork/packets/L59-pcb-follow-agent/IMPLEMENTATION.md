# L59 implementation

Read L41's TECHNICAL.md ("Turn models", "Background tabs", "Turn chip") first; this packet
reuses its rules. Each step leaves the tree compiling. Check first whether L41 has landed:
`rg -n "turnFiles|ModelTurnChip|fork: model-follow-agent" apps`.

1. **Shared turn files.** If `apps/server/src/fork/turnFiles.ts` does not exist, create it as
   TECHNICAL.md specifies (`makeTurnFiles` with `repoPrefix`, `turnCheckpoints`,
   `workspaceFiles`, `turnCheckpointEvents`). If L41 landed with private copies inside
   `ModelPreviewService`, move them here and have L41's methods call the module; its tests must
   still pass. Add `apps/server/src/fork/turnFiles.test.ts`.
   Done when the module's tests pass and the server typechecks.

2. **Extension point.** Create `ext-changed-files` exactly as SEAMS.md shows, as its own commit
   `feat(fork): add the changed files card extension point`, with an empty registry (or L41's
   chip, converted). Add entry 18 to EXTENSION-POINTS.md (copy the structure of entry 17),
   the FORK.md row and the `seams.tsv` row. Skip if it exists.
   Done when `scripts/fork/loom.sh check` passes and `ChangedFilesTree.test.tsx` still passes.

3. **Sources per design.** In `PcbPreviewService.ts`, make `sourceSnapshot` (`:518-608`) also
   return `files`, lift the two relevance tests (`:557-564`) into an exported
   `isPcbSource(kind, name)`, and extract `resolveFound(ws, design)` from `resolveDesign`
   (`:500-516`). No behavior change.
   Done when the existing `PcbPreviewService.test.ts` and `helpers.test.ts` pass.

4. **Contracts.** Add `PcbTurnDesign`, `PcbTurnDesigns`, `PcbTurnDesignsInput`, the two
   methods and RPCs to `packages/contracts/src/fork/pcb-preview.ts`, the stream tag to
   `rpc.ts`, and the read scopes to `apps/server/src/fork/rpcAuthorization.ts`.
   Done when `@t3tools/contracts` typechecks.

5. **Turn designs.** Create `apps/server/src/fork/pcb-preview/turnDesigns.ts` with
   `designsForFiles` (pure over its inputs: changed paths, discovered designs, a
   `snapshotFiles` function) and `makeTurnDesigns`. Wire `turnDesigns` and `turnDesignEvents`
   into `make` and the service object, and the handlers into `rpc.ts`.
   Done when `turnDesigns.test.ts` passes and `t3` typechecks.

6. **Atoms and helpers.** Add the three atoms to
   `packages/client-runtime/src/fork/pcb-preview.ts`. Create
   `apps/web/src/fork/pcb-preview/agentDesigns.ts` (`pcbSurface`, `mayAffectDesigns`,
   `openDesigns`, `hasPcbTab`; `pcbDesignName` comes from `usePcbPreview.logic.ts` when
   `f4941963a6` is on the base, otherwise define it here). Reuse L41's background tab helper if it
   exists; otherwise put it in `apps/web/src/fork/panels/backgroundSurfaces.ts`.
   Use `pcbSurface` in `commands.tsx:47` so agent-opened tabs have titles.
   Done when `agentDesigns.test.ts` passes.

7. **Preference.** Add `agentDesigns` with its decoding default to `preferences.ts`, the
   default value, and `setAgentDesigns`. Add the settings row to `settings.tsx`.
   Done when a stored record without the field loads with its selections intact (test).

8. **Chip.** Create `PcbTurnChip.tsx` and `pcbFollowAgentAction` and append it to
   `FORK_CHANGED_FILES_ACTIONS`.
   Done when the chip appears on a turn that changed a design and not on one that did not.

9. **Host and palette.** Create `AgentDesignsHost.tsx`, render it from
   `PcbPreviewCommandHost`, and add the palette item.
   Done when a turn that changes a design while a PCB tab is open adds a background tab.

10. **Docs.** Add a short "When an agent changes a design" section to
    `docs/fork/user/pcb-preview.md`: the chip, background tabs, the setting.

## Done when

- A turn that edits `board.kicad_sch` and `board.kicad_pcb` shows one chip, "Open board", and
  clicking it opens the `board.kicad_pro` design titled "board".
- A turn that edits only a sub-sheet offers the root project, with the sub-sheet in the
  tooltip. A turn that edits a module imported by `amp.circuit.tsx` offers `amp`.
- A turn that edits only TypeScript outside any tscircuit package shows no chip and the server
  log shows no source walk.
- With a PCB tab open, a new design from a turn appears as a background tab; the active tab
  does not change. With "Open automatically" and no PCB tab, the panel opens on it.
- "Hide for this turn" survives a reload. Mode "off" removes chips and stops background tabs.
- The palette item opens the last turn's designs or shows the toast.
- `loom_pcb_editor` `open` produces a tab titled with the design name.
- Saved PCB preferences from before this packet still load with their selections.
- The `ext-changed-files` existence check passes; L41 and L59 chips render side by side.
