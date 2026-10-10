# L51 testing

Focused tests only. No repo-wide checks, no sleeps: the service tests await the effects they
call.

## Automated tests

- `packages/contracts/src/fork/model-printers.test.ts`
  - `libraryProblems` flags duplicate printer and material ids, a `defaultMaterialId` not in
    `materialIds`, a material id that does not exist, and a zone that leaves the bed.
  - A library saved with an unknown future key still decodes (forward compatibility).
  - `STARTER_MATERIALS` decode, have unique ids and null prices.
  - `PrinterExport` round-trips through JSON.
- `packages/contracts/src/fork/model-beds.test.ts` (extend the file L32 creates)
  - Built-in ids equal the old `BUILD_PLATE_PRESETS` keys, in the same order, with the same
    volumes (no saved setting changes meaning).
  - `listBeds` with no options returns built-ins and Custom size, with a library adds user
    printers, hides `hiddenBuiltIns`, and always includes the active bed.
  - `activeBed` resolves a migrated id from the library and an unmigrated id from L33's
    `customBeds` to the same bed, and falls back to Custom size for a missing id.
  - `selectBed` never changes `customMm`.
  - The total of built-ins and `USER_PRINTER_LIMIT` is at most L32's 64-bed cap.
- `apps/server/src/fork/model-preview-3d/printerProfiles.test.ts`
  - The H2D fixture chain flattens and gives 350 × 320 × 325, nozzle 0.4, and two zones
    (offset 0 and 25, footprint 325 × 320, heights 320 and 325).
  - The X1 Carbon fixture keeps its 18 × 28 excluded corner.
  - A profile whose parent is missing fails with the "could not find" message.
  - PrusaSlicer config: size from `bed_shape`, height from `max_print_height`, nozzles from a
    comma list; a vendor bundle INI is refused; a centred delta `bed_shape` becomes a round bed
    with its diameter and zero-based offsets.
  - `shapeFromPolygon`: rectangle, circle, and an irregular outline with the bounding-box
    warning.
- `apps/server/src/fork/model-preview-3d/printers.test.ts`
  - Migration: a settings row with two L33 custom beds and one hidden preset creates a library
    with the same ids, kinds and hidden list; a second `library()` call does not rewrite it.
  - No L33 fields: the library starts with only the starter materials.
  - `update` with a stale `expectedVersion` fails with `conflict` and leaves storage unchanged.
  - Deleting the active printer saves settings pointing at the default bed.
- `apps/server/src/fork/model-preview-3d/store.test.ts` (extend): `getPrinters` on an empty
  table is `None`; save then get round-trips.
- `apps/server/src/fork/model-preview-3d/mcp.test.ts` (extend): the three tools refuse when
  `agentToolEnabled` is false; `read_printer_profile` refuses a path outside the workspace.
- `apps/web/src/fork/model-preview-3d/buildPlate.test.ts` (extend): `bedGroups` with a library
  puts user entries under "Your printers"; `resolvePlate` returns `shape: "round"` for a round
  printer.
- `apps/web/src/fork/model-preview-3d/viewer/bed.test.ts` (extend): round `bedLines` stay
  inside the circle.

## Commands

```sh
vp test run packages/contracts/src/fork/model-printers.test.ts \
  packages/contracts/src/fork/model-beds.test.ts \
  apps/server/src/fork/model-preview-3d/printerProfiles.test.ts \
  apps/server/src/fork/model-preview-3d/printers.test.ts \
  apps/server/src/fork/model-preview-3d/store.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts \
  apps/web/src/fork/model-preview-3d/buildPlate.test.ts \
  apps/web/src/fork/model-preview-3d/viewer/bed.test.ts
vp lint packages/contracts/src/fork apps/server/src/fork/model-preview-3d \
  apps/web/src/fork/model-preview-3d packages/client-runtime/src/fork/model-preview-3d.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
```

## Manual check

With Kyle's permission, on the worktree dev server seeded from real data:

1. Open Loom settings, 3D models. Built-ins, any migrated custom beds and the starter materials
   are listed; the active bed is unchanged from before the upgrade.
2. Import `/Applications/BambuStudio.app/Contents/Resources/profiles/BBL/machine/Bambu Lab
H2D 0.4 nozzle.json`. Review shows 350 × 320 × 325 and two zones; save it; pick it in the
   Bed menu; with L34 landed, the zones draw as on the built-in H2D.
3. Duplicate the built-in Prusa MK4S, change the nozzle to 0.6, save, select it.
4. Add a round 200 mm delta surface; the viewport plate is a circle.
5. Set a price on PLA. With L47 landed, a slice estimate shows a cost.
6. Open settings in a second browser, edit there, then save in the first: the conflict
   message appears.
7. Delete the active printer: the bed falls back to the H2D on both clients; "Undo" restores it.
8. Export the library, delete two entries, import the file: they come back with the same ids.
9. Over a remote connection (Tailscale or T3 Connect), import a profile from the browser's
   machine.
10. Ask an agent to "add a 300 mm Voron with a 0.4 nozzle" and select it.
11. Against an upstream T3 server: no 3D settings appear.

## Merge safety

No upstream file changes, so the merge preview in [SEAMS.md](./SEAMS.md) must exit 0. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
