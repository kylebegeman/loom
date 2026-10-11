# L47 testing

Focused tests only. No repo-wide checks, no sleeps. No automated test runs a real slicer: the
service tests use a fake runner that writes fixture output, so CI needs no slicer installed.
Fixtures are written by hand in the documented formats; no slicer profile files are copied
into the repository (see REFERENCES.md, "Licences").

## Automated tests

- `packages/contracts/src/fork/model-slicer.test.ts`
  - Settings saved before L47 decode with `DEFAULT_SLICER_SETTINGS`; a partial `paths` object
    fills the missing apps with null.
  - `currency` refuses `usd`; `timeoutSeconds` refuses 10 and 4000; `mappings` refuses 65
    entries.
  - A `SliceResult` with `status: "none"` and nulls decodes.
  - An editor action `{ action: "layers", layer: 120 }` decodes; `layer: -1` does not.
- `apps/server/src/fork/model-preview-3d/slicer/profiles.test.ts`
  - The H2D machine chain flattens with the leaf's `printable_area` over the parent's, arrays
    replaced whole, the system preset identity retained in `inherits`, and `name` and `type` kept.
  - A user preset that inherits a system preset flattens to the system values plus its
    changes.
  - The higher index version wins between two roots for the same vendor.
  - An `inherits` loop and a missing parent fail with messages naming the profile.
  - Processes and filaments are filtered by `compatible_printers`; an empty list matches any
    printer; `instantiation: "false"` presets are not listed.
  - The flattened hash is stable when key order changes.
- `apps/server/src/fork/model-preview-3d/slicer/detect.test.ts`
  - Version parsing from `BambuStudio-02.08.04.57:` and from a PrusaSlicer first line; a
    failing `--help` falls back to the plist value; a configured path wins over candidates.
- `apps/server/src/fork/model-preview-3d/slicer/bambu.test.ts`
  - The argv matches TECHNICAL.md for one and two filaments; a path containing `;` is refused.
  - `slice_info.config` parsing: prediction, weight, filaments, `outside`, `support_used` and
    warnings.
  - Verification: a `printer_model_id` that differs from the mapping's `model_id` fails with
    the wrong-result message; empty ids require a matching exported project printer model.
    A missing 3MF with exit code 0 fails with "The slicer exited
    without a result."
- `apps/server/src/fork/model-preview-3d/slicer/gcode.test.ts`
  - Bambu header totals and Prusa footer totals, including `1d 2h 3m 4s` durations.
  - Layer and role tracking in both dialects; unknown features become `other`.
  - Absolute and relative extrusion, `G92 E0` resets and tool changes give the right support
    length per slot.
  - An arc becomes chords no longer than 2 mm; travel moves add no segments.
- `apps/server/src/fork/model-preview-3d/slicer/layers.test.ts`
  - The buffer never exceeds the cap and marks `decimated`; the written file round-trips
    through the web decoder's expectations (header, layer table, quantisation within one
    step).
- `apps/server/src/fork/model-preview-3d/slicer/prepare.test.ts`
  - A rotated STL rests at Z 0 with the expected bounds; GLB is refused with
    `unsupported-format`; without OpenSCAD a 3MF with an orientation gives
    `orientationApplied: false` and the warning.
- `apps/server/src/fork/model-preview-3d/slicer/service.test.ts` (fake runner)
  - Same inputs twice: the runner is called once and the second result is `cached`.
  - Changing a profile hash or the orientation changes the key.
  - `cachedOnly` never calls the runner and returns `none` on a miss.
  - Interrupting a slice leaves no published folder; a new request for the same file
    interrupts the first (await the first fiber's exit, no sleeps).
  - Two slices for the same app run one after the other (the second waits on the semaphore,
    proven with a `Deferred` the fake runner holds).
  - Cost is null when one used slot has no price, and is recomputed when a price changes
    without slicing again.
  - Pruning keeps 100 entries.
  - A surface bed or an unmapped bed fails with the "not set up" message.
- `apps/server/src/fork/model-preview-3d/mcp.test.ts` (extend): the slice tool refuses when
  `agentToolEnabled` is false and returns a host path when it succeeds.
- `apps/web/src/fork/model-preview-3d/slicing.test.ts`: `formatEstimate` for one and two
  filaments, missing weights, durations under a minute, and currency formatting.
- `apps/web/src/fork/model-preview-3d/viewer/layers.test.ts`: decoding a small `LLY1` buffer
  and the draw range for the first, middle and last layer.

## Commands

```sh
vp test run packages/contracts/src/fork/model-slicer.test.ts \
  apps/server/src/fork/model-preview-3d/slicer/profiles.test.ts \
  apps/server/src/fork/model-preview-3d/slicer/detect.test.ts \
  apps/server/src/fork/model-preview-3d/slicer/bambu.test.ts \
  apps/server/src/fork/model-preview-3d/slicer/gcode.test.ts \
  apps/server/src/fork/model-preview-3d/slicer/layers.test.ts \
  apps/server/src/fork/model-preview-3d/slicer/prepare.test.ts \
  apps/server/src/fork/model-preview-3d/slicer/service.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts \
  apps/web/src/fork/model-preview-3d/slicing.test.ts \
  apps/web/src/fork/model-preview-3d/useSlicing.test.ts \
  apps/web/src/fork/model-preview-3d/viewer/layers.test.ts
vp lint packages/contracts/src/fork apps/server/src/fork/model-preview-3d \
  apps/web/src/fork/model-preview-3d packages/client-runtime/src/fork/model-preview-3d.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
```

## Manual check

With Kyle's permission, on the worktree dev server seeded from real data, on Kyle's Mac with
Bambu Studio installed:

1. Loom settings, 3D models, Slicing: Bambu Studio shows its version. Map the H2D with "Use
   Bambu Studio defaults".
2. Open a SCAD part with the H2D bed. Print shows "Estimate print". Click
   it: the status shows elapsed time, then a headline and details.
3. Open the same part in Bambu Studio with the same profiles and compare time and weight.
4. Click again: the result returns at once (cached). Change a parameter: "Out of date".
5. Start a slice of a large part and cancel it: no `BambuStudio` process remains
   (`ps -p <pid>` on the PID from the log), and the panel shows the previous result.
6. Press `Y`: layers replace the part; drag the slider; arrow keys step; `Escape` hides them.
7. "Open in Bambu Studio" opens the project. In a browser over Tailscale or T3 Connect,
   "Download 3MF" downloads it and no open button appears.
8. Rename the Bambu Studio path in settings to a missing file: "Bambu Studio was not found on
   this host." Restore it.
9. Choose a surface bed: "Print estimates need a printer."
10. Variants: "Estimate print times" fills times one by one; "Cancel" stops the rest.
11. Ask an agent to compare two variants by print time with `loom_model_preview_3d_slice`.
12. Disable agent tools in settings: the tool refuses.
13. Check `~/Library/Application Support/BambuStudio` modification times before and after:
    unchanged.
14. Against an upstream T3 server: no 3D panel, nothing breaks.

## Merge safety

No upstream file changes, so the merge preview in [SEAMS.md](./SEAMS.md) must exit 0. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.

## Verified host CLI smoke

On 2026-10-10, Bambu Studio 02.08.04.57 on macOS successfully sliced a closed 10 mm
ASCII and binary STL cubes using the installed H2D 0.4 mm machine, 0.20 mm Standard process and
Bambu PLA Basic profiles. The CLI used a temporary isolated `--datadir`, fully flattened
profiles, `--arrange 1 --orient 0 --slice 0`, and a complete exported 3MF. It exited 0.
Loom's streaming archive reader accepted the project and reported 264 seconds, 0.75 g,
50 layers and nonempty toolpaths. No GUI or printer connection was opened.

This smoke established the preset identity and missing model-id behavior documented in
TECHNICAL.md. Startup purge extrusion is excluded before the first explicit print layer.
The temporary profiles and outputs are not repository fixtures. OrcaSlicer and PrusaSlicer
were not installed on this host; their real CLI runs remain unverified. Their argument and
output contracts have focused fixture coverage, including Prusa cache publication and
caller cancellation. No browser or desktop UI interaction was run for this slice.
