# L51 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md,
MODEL-3D-FOLLOW-UPS.md and this folder. Then read L32 TECHNICAL.md ("Bed list in contracts"),
L33 TECHNICAL.md and L34's zone definition, and check which of them have landed:

```sh
test -f packages/contracts/src/fork/model-beds.ts && echo "bed list exists"
rg -n "customBedId|customBeds|hiddenPresets" packages/contracts/src/fork/model-beds.ts
rg -n "zones" packages/contracts/src/fork/model-beds.ts
test -f apps/server/src/fork/model-preview-3d/slicer/profiles.ts && echo "L47 profiles exist"
```

If `model-beds.ts` does not exist, create it first exactly as L32 TECHNICAL.md describes, in
its own commit (`feat(fork-printer-library): move bed definitions to model-beds`).

Kyle's decisions in PRODUCT.md ("Decisions needed from Kyle") must be answered. The steps
below assume the recommended answers; if Kyle picks the JSON file, only step 3 changes.

Seed the worktree `.t3` with `vp run migrate-dev-db` (AGENTS.md, "Test data") so the
migration runs against real settings.

## Steps

1. **Printer schema and built-ins.** Create `packages/contracts/src/fork/model-printers.ts`
   with `NozzleZone` (reuse L34's export if present), `ExcludedArea`, `Printer`, `Material`,
   `PrinterLibrary`, `PrinterLibraryUpdate`, `PrinterProfileDraft`, `PrinterExport`,
   `STARTER_MATERIALS`, the limits and `libraryProblems`. Import `SlicerApp` from
   `model-slicer.ts`, creating that file with only `SlicerApp` if L47 has not. Export it from
   `packages/contracts/src/fork/index.ts`. Add `model-printers.test.ts` (step list in
   TESTING.md). Typecheck contracts.
2. **Bed list reads the library.** In `model-beds.ts`, add `BUILT_IN_PRINTERS` with the fields
   in TECHNICAL.md ("Built-ins") and make `BUILD_PLATE_PRESETS` a derived alias. Extend `Bed`
   and give `listBeds`, `activeBed` and `selectBed` the optional `BedListOptions`. Add
   `customBedId` only if L33 is absent. Remove `customBeds` and `hiddenPresets` from
   `BuildPlateSettingUpdate` if L33 is present. Extend the existing bed list tests. Typecheck
   contracts, server, web and client-runtime (the alias keeps every caller compiling).
3. **Storage.** In `apps/server/src/fork/model-preview-3d/store.ts`, add `getPrinters` and
   `savePrinters` on the `'printers'` key of `fork_model_preview_3d_settings`. Extend
   `store.test.ts` with a round trip and an absent row.
4. **Profile parsers.** Create `printerProfiles.ts` with `parseBambuProfile`,
   `parsePrusaIni`, `shapeFromPolygon` and origin normalisation. If
   `slicer/profiles.ts` does not exist, create it with `slicerProfileRoots` and
   `flattenProfile` exactly as L47 TECHNICAL.md ("Profiles") defines them. Add fixtures under
   `apps/server/src/fork/model-preview-3d/__fixtures__/profiles/`: a trimmed copy of the H2D
   machine chain (leaf, `fdm_bbl_3dp_002_common`, `fdm_machine_common`, only the keys used),
   an X1 Carbon leaf with `bed_exclude_area`, a PrusaSlicer MK4S config, a delta config with a
   round `bed_shape`, and a vendor bundle INI that must be refused.
5. **Service.** Create `printers.ts` with `makePrinterLibrary` (library, migration, update,
   parseProfile) and wire it into `make` in `ModelPreviewService.ts`; spread its methods into
   the returned object. On delete of the active bed, save settings with the default bed.
   Add focused tests in `printers.test.ts`.
6. **RPC.** Add the three tags to `MODEL_PREVIEW_3D_WS_METHODS`, the group entries, the
   `"conflict"` reason, the handlers in `rpc.ts`, the scopes in `rpcAuthorization.ts` and
   `clientRpcPermissions.ts`. Typecheck server and contracts.
7. **MCP tools.** Add `loom_model_preview_3d_printers`, `..._save_printers` and
   `..._read_printer_profile` to `mcp.ts` with the gating in TECHNICAL.md. Extend
   `mcp.test.ts`.
8. **Client atoms.** Add `printers`, `updatePrinters` and `parsePrinterProfile` to
   `createModelPreviewAtoms`.
9. **Web bed helpers.** Add `usePrinterLibrary` in `printers.ts`; give `bedGroups`,
   `resolvePlate` and `buildPlateLabel` the optional library; pass it at every call site listed
   in TECHNICAL.md ("Web"). Replace the two direct `BUILD_PLATE_PRESETS[...].note` reads with
   `activeBed(...).note`. Extend `buildPlate.test.ts`.
10. **Round beds.** Add the `shape` argument to `createBed` and `bedLines` in
    `viewer/bed.ts`, pass it from `setBed`, and add the round branch to the fit helper.
    Extend `bed.test.ts`.
11. **Settings UI.** Add `PrintersSection.tsx`, `PrinterEditor.tsx` and
    `MaterialsSection.tsx`; render them from `SettingsSection.tsx`. Add import and export of
    the library. Add "Manage printers" to the Bed menu.
12. **Docs.** Update `docs/fork/user/model-preview-3d.md`: a short "Printers and materials"
    section (what the library is, how to import a slicer profile, that exports are the
    backup). Set this packet's Status and the index row in `docs/fork/packets/README.md`.

Commit after each step with `feat(fork-printer-library): ...`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Every bed menu, Part's printer menu and settings list built-ins, user printers and Custom
  size from one list, and no web file reads `BUILD_PLATE_PRESETS` directly
  (`rg -n "BUILD_PLATE_PRESETS" apps/web/src` finds only `buildPlate.ts` or nothing).
- A real settings row with L33 custom beds and hidden presets migrates once: the same ids, the
  same active bed, hidden presets still hidden; running the server again changes nothing.
- Importing Bambu Studio's own `Bambu Lab H2D 0.4 nozzle.json` on Kyle's Mac gives a
  350 × 320 × 325 mm printer with nozzle 0.4 and two zones matching L34's numbers.
- A PrusaSlicer exported config imports with the right size; a round delta bed draws as a
  circle.
- Two clients editing at once: the second save shows the conflict message and nothing is lost.
- Deleting the active printer moves every client to the default bed.
- An agent can list printers, add one with `save_printers` and select it with
  `save_settings`.
- Export, delete, then import restores the entries with the same ids.
