# L47 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. The Bambu Studio path ships
first; OrcaSlicer and PrusaSlicer are separate later steps and may be separate PRs if Kyle asks.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md,
MODEL-3D-FOLLOW-UPS.md and this folder. Check which related packets have landed:

```sh
test -f packages/contracts/src/fork/model-slicer.ts && echo "SlicerApp exists (L51)"
test -f apps/server/src/fork/model-preview-3d/slicer/profiles.ts && echo "profiles exist (L51)"
test -f packages/contracts/src/fork/model-beds.ts && echo "bed list exists (L32/L33/L34)"
rg -n "orientation" packages/contracts/src/fork/model-workspace.ts
test -f packages/contracts/src/fork/model-printers.ts && echo "printer library exists (L51)"
```

Kyle's answers in PRODUCT.md ("Decisions needed from Kyle") must be in. The steps assume the
recommended answers.

Confirm Bambu Studio is installed on the host (`/Applications/BambuStudio.app`). The flags in
REFERENCES.md marked "verify" are checked in step 4 with one real slice of a fixture cube.
Ask Kyle before running it, and record the outcome in REFERENCES.md.

## Steps

1. **Contracts.** Create (or extend) `packages/contracts/src/fork/model-slicer.ts` with every
   schema in TECHNICAL.md ("Contracts"). Add `slicer` to `ModelPreviewSettings` with its
   decoding default and to `DEFAULT_MODEL_PREVIEW_SETTINGS`, `slicers` to
   `ModelPreviewStatus`, `"slicer-missing"` to the error reasons, the four RPC tags and group
   entries, and the `layers` editor action, field and state. Add the scopes in
   `rpcAuthorization.ts` and `clientRpcPermissions.ts`. Add `model-slicer.test.ts`. Typecheck
   contracts and server (handlers may return `Effect.die("not implemented")` until step 6).
2. **Profiles.** Create `slicer/profiles.ts` (skip what L51 already created) with roots,
   vendor index, lookup, flattening, the compatibility filter, the cached index and imports.
   Fixtures under `apps/server/src/fork/model-preview-3d/__fixtures__/slicer/`: a hand-written
   trimmed BBL tree (index JSON, the H2D machine chain, one process chain, one filament chain,
   only the keys the code reads) and a user preset that `inherits` a system one. Add
   `profiles.test.ts`.
3. **Detection.** Create `slicer/detect.ts` and report `slicers` from the `status` RPC, cached
   for 60 seconds and reset by `updateSettings`. Add `detect.test.ts` with a fake runner.
4. **Bambu adapter and parsing.** Create `slicer/bambu.ts` (argv, result reading,
   verification), `slicer/gcode.ts` (streaming pass) and `slicer/layers.ts` (bounded buffer and
   writer). Fixtures: a small `slice_info.config` and a few hundred lines of Bambu G-code
   written by hand in the documented format, with two layers, a support feature, a tool change
   and an arc. Then run one real slice of the 20 mm cube fixture with Bambu Studio and the H2D
   profiles to confirm the argv, the flattened profile format and the output names; fix the
   adapter and update REFERENCES.md. Add `bambu.test.ts`, `gcode.test.ts`, `layers.test.ts`.
5. **Preparing the mesh.** Create `slicer/prepare.ts`: SCAD through the render cache with
   `protectStem`, content hashes for meshes, STL rotation in TypeScript, the OpenSCAD wrapper
   for 3MF and OBJ, and the job folder. If L35 has not landed, orientation is always null.
   Add `prepare.test.ts` (rotation and resting at Z 0, refusal of GLB and of `;` paths).
6. **Service.** Create `slicer/service.ts` with `makeSlicer`: key, cache, pending folders,
   pruning, per-app semaphores, per-file interruption, `cachedOnly`, cost and publishing; wire
   it into `make` in `ModelPreviewService.ts`; implement the four RPC handlers in `rpc.ts`;
   clear `slices/` in `clearCache`. Add `service.test.ts` with a fake runner that writes a
   fixture 3MF, so no test needs a slicer.
7. **Opening in the slicer.** `openSlice` on macOS with `open -a`, elsewhere a detached spawn.
   Test the argv only.
8. **MCP.** Add `loom_model_preview_3d_slice`, the `layers` editor action and `slicers` in the
   status tool. Extend `mcp.test.ts` (gating, host path in the result).
9. **Client atoms.** Add `slice`, `slicerProfiles`, `importSlicerProfile` and `openSlice` to
   `createModelPreviewAtoms`.
10. **Print section.** Add `slicing.ts` (`formatEstimate`, `formatDuration`, cost formatting,
    with tests) and `PrintSection.tsx`, rendered in `PartSection`. All states in PRODUCT.md
    ("States"), the "Out of date" chip, "Open in Bambu Studio" only on the local desktop,
    "Download 3MF" elsewhere.
11. **Layer preview.** Add `viewer/layers.ts` (fetch, decode `LLY1`, geometry, draw range),
    `setLayers` and `showLayersThrough` on the viewer, the slider, the `Y` key, the palette
    actions and the `layers` editor case. Add `layers.test.ts` for decoding and draw ranges.
12. **Settings.** Add `SlicingSettings.tsx`: detection rows, paths, timeout, currency,
    per-printer mappings with profile pickers, "Use Bambu Studio defaults", "Import profile"
    and "Remove". Render it from `SettingsSection.tsx`.
13. **Variants.** Cached estimates on the detail line and "Estimate print times" with
    "Cancel".
14. **OrcaSlicer.** Reuse `bambu.ts` with Orca's paths, data folder and footer keys. Verify
    one Orca machine profile and one slice on a machine with Orca installed (or mark the Orca
    branch unverified in settings with `supported: false`).
15. **PrusaSlicer.** Add `prusa.ts`, imported config files and the footer parser, with a
    hand-written G-code fixture. Same verification rule as step 14.
16. **Docs.** Update `docs/fork/user/model-preview-3d.md` with a short "Print estimates"
    section: what it needs (a slicer installed on the host), how to map a printer, that Loom
    never prints, and that support weight is an estimate. Set this packet's Status and the
    index row in `docs/fork/packets/README.md`.

Commit after each step with `feat(fork-model-slicer-bridge): ...`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- On Kyle's Mac, the H2D mapped to its suggested Bambu Studio profiles, "Estimate print" on a
  SCAD part gives a time and weight that match Bambu Studio's own numbers for the same part and
  profiles within one minute and one gram.
- A second click returns the cached result without running the slicer; changing a parameter
  marks the result "Out of date".
- Cancelling stops the slicer process and leaves no `pending-*` folder after the next start.
- `Y` shows the layers, the slider steps through them, and a 4-hour print draws without a
  frame drop on Kyle's Mac.
- "Open in Bambu Studio" opens the project on the local desktop app; a remote browser over
  T3 Connect downloads the 3MF instead.
- An agent compares two variants with `loom_model_preview_3d_slice` and gets both estimates.
- The slicer's GUI settings are unchanged after slicing (its data folder's modification
  times are untouched).
