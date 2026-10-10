# L47 technical design

Cited lines are from `docs/model-preview-follow-ups` at `8676e099e5`. Slicer facts are in
REFERENCES.md with their sources; anything marked "verify" there must be checked against a real
slicer before the step that relies on it is finished.

## Overview

A slice is one server method. It resolves the model to a mesh (rendering SCAD through the
existing render cache), applies the saved orientation, flattens the mapped slicer profiles
into full JSON files, runs the slicer CLI in a job folder, reads the slicer's own numbers from
its output, writes a compact layer file, and publishes everything under a cache key. The
client gets a small JSON result plus two signed URLs (the sliced project and the layer file),
which it fetches only when the user asks.

```
Part "Estimate print" ─┐                       ┌─ renderScad cache (SCAD) / workspace file
agent slice tool ──────┼─ ModelPreview.slice ──┼─ orientation (L35) ─ mesh in job folder
variants batch ────────┘        │              └─ profiles.ts: flatten machine/process/filament
                                ├─ bambu.ts or prusa.ts: argv, run, verify
                                ├─ sliceInfo.ts + gcode.ts: one streaming pass
                                └─ slices/<key>/{result.json, result.3mf, layers.bin}
                                         │
                       signed route ─────┴─ "Download 3MF", layer preview
```

## Today

- The model service renders SCAD with OpenSCAD through `runner.run` with a timeout, truncated
  output and a pending output stem that is published only on success
  (`apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:403-586`, run at `:469-487`).
  `renderScad` serialises jobs per file and variant and interrupts the previous one
  (`:587-622`). Render outputs live in `cacheDir/<revision>.<stl|3mf>`, where the revision is
  the render hash (`:445-455`, `:577-585`), guarded by `protectStem` (`:135-139`).
- Host tool detection: `status` probes OpenSCAD with `--version` and `--help` under a short
  timeout and caches the result for 60 seconds (`:268-322`). Settings changes reset it
  (`:973-982`).
- Files reach clients through `sign(root, absolute, allowLarge)` (`:179-202`) and the signed
  route (`apps/server/src/fork/model-preview-3d/http.ts:7-44`), which serves unknown
  extensions as `application/octet-stream`.
- `renderImages` already wraps a mesh in a one-line OpenSCAD file to transform it
  (`ModelPreviewService.ts:1153-1160`); the slicer reuses that trick for rotated 3MF and OBJ.
- The server can read zip archives with `yauzl` and regex the XML it needs without buffering
  the archive (`threeMfUnits.ts:1-60`).
- Opening a host app from a client has a precedent: `openResultBundle` runs `open <path>` on a
  Mac host (`apps/server/src/fork/apple-build-tooling/AppleBuildService.ts:1524-1531`), and
  the web shows the button only when `isElectron && primaryEnvironmentId === environmentId`
  (`apps/web/src/fork/apple-build-tooling/AppleBuildPanel.tsx:69-70`).

## Contracts

New file `packages/contracts/src/fork/model-slicer.ts`, exported from `index.ts`. It imports
`effect`, `./model-preview-3d.ts` (for `ModelFileRef`, `SignedFile`, `ScadRenderResult`).
`SlicerApp` lives here; L51 imports it (if L51 lands first it creates this file with only
`SlicerApp`).

```ts
export const SlicerApp = Schema.Literals(["bambu-studio", "orca-slicer", "prusa-slicer"]);
export const SLICER_LABELS = {
  "bambu-studio": "Bambu Studio",
  "orca-slicer": "OrcaSlicer",
  "prusa-slicer": "PrusaSlicer",
} as const;

const profileName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
export const SlicerProfileRef = Schema.Struct({
  /** "installed": a slicer system or user preset by name. "imported": a file Loom stored. */
  source: Schema.Literals(["installed", "imported"]),
  name: profileName,
});

export const SlicerMapping = Schema.Struct({
  app: SlicerApp,
  /** Bambu and Orca: the printer preset. PrusaSlicer: the imported config file. */
  machine: SlicerProfileRef,
  /** Null for a PrusaSlicer config, which already contains print settings. */
  process: Schema.NullOr(SlicerProfileRef),
  filaments: Schema.Array(SlicerProfileRef).check(Schema.isMaxLength(16)),
  /** L51 material per filament slot, for density and price. */
  materialIds: Schema.optionalKey(
    Schema.Array(Schema.NullOr(Schema.String)).check(Schema.isMaxLength(16)),
  ),
});

export const DEFAULT_SLICER_SETTINGS = {
  paths: { "bambu-studio": null, "orca-slicer": null, "prusa-slicer": null },
  timeoutSeconds: 300,
  currency: "USD",
  mappings: {},
} as const;

const nullPath = Schema.NullOr(Schema.String).pipe(
  Schema.withDecodingDefault(Effect.succeed(null)),
);
export const SlicerSettings = Schema.Struct({
  paths: Schema.Struct({
    "bambu-studio": nullPath,
    "orca-slicer": nullPath,
    "prusa-slicer": nullPath,
  }),
  timeoutSeconds: Schema.Int.check(Schema.isBetween({ minimum: 30, maximum: 1800 })),
  /** ISO 4217 code used to format costs. Prices themselves carry no currency. */
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  /** Keyed by bed id: a built-in preset id or an L51 printer id. */
  mappings: Schema.Record(Schema.String, SlicerMapping).check(Schema.isMaxProperties(64)),
});
```

`ModelPreviewSettings` (`model-preview-3d.ts:240-262`) gains

```ts
slicer: SlicerSettings.pipe(
  Schema.withDecodingDefault(Effect.succeed(DEFAULT_SLICER_SETTINGS)),
),
```

and `DEFAULT_MODEL_PREVIEW_SETTINGS` (`:297-306`) gains `slicer: DEFAULT_SLICER_SETTINGS`.
Saved settings without the key decode to the default. If L33 has landed,
`ModelPreviewSettingsUpdate` gets `slicer: Schema.optionalKey(SlicerSettings)` and the server
merges it, so an older client saving settings keeps the stored mappings. Without L33, an older
client saving settings would reset `slicer` to the default; note this in the release notes
rather than adding a second merge mechanism.

### Status

```ts
export const SlicerInfo = Schema.Struct({
  app: SlicerApp,
  path: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String), // "02.08.04.57"
  /** True for the adapters this build of Loom has been tested with. */
  supported: Schema.Boolean,
});
```

`ModelPreviewStatus` (`model-preview-3d.ts:64-67`) gains
`slicers: Schema.optionalKey(Schema.Array(SlicerInfo))`. Older servers omit it; newer clients
treat a missing key as "slicing not available on this server" and hide Print.

### Slice input and result

```ts
export const SliceInput = Schema.Struct({
  file: ModelFileRef,
  variantId: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  ),
  overrides: Schema.Record(Schema.String, Schema.String), // {} for meshes
  parameterSet: Schema.NullOr(Schema.String),
  /** Defaults to the active bed. */
  bedId: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))),
  /** Return the cached result or status "none" without running the slicer. */
  cachedOnly: Schema.optionalKey(Schema.Boolean),
});

export const SliceRole = Schema.Literals([
  "outer-wall",
  "inner-wall",
  "infill",
  "solid-infill",
  "top",
  "bottom",
  "bridge",
  "support",
  "support-interface",
  "skirt",
  "other",
]);

export const PrintEstimate = Schema.Struct({
  printSeconds: Schema.NullOr(Schema.Number),
  layerCount: Schema.NullOr(Schema.Int),
  filaments: Schema.Array(
    Schema.Struct({
      slot: Schema.Int,
      type: Schema.NullOr(Schema.String),
      colorHex: Schema.NullOr(Schema.String),
      lengthMm: Schema.NullOr(Schema.Number),
      grams: Schema.NullOr(Schema.Number),
    }),
  ).check(Schema.isMaxLength(16)),
  totalGrams: Schema.NullOr(Schema.Number),
  /** From the slicer when it says so; otherwise null. */
  supportUsed: Schema.NullOr(Schema.Boolean),
  /** Loom's estimate from support toolpaths; always "about". */
  supportGrams: Schema.NullOr(Schema.Number),
  /** Computed when every used filament has a price; null otherwise. */
  cost: Schema.NullOr(Schema.Number),
  currency: Schema.String,
});

export const SliceResult = Schema.Struct({
  status: Schema.Literals(["ok", "error", "cancelled", "none"]),
  key: Schema.NullOr(Schema.String),
  cached: Schema.Boolean,
  durationMs: Schema.Number,
  bedId: Schema.String,
  app: Schema.NullOr(SlicerApp),
  appVersion: Schema.NullOr(Schema.String),
  profiles: Schema.NullOr(
    Schema.Struct({
      machine: Schema.String,
      process: Schema.NullOr(Schema.String),
      filaments: Schema.Array(Schema.String),
    }),
  ),
  estimate: Schema.NullOr(PrintEstimate),
  orientationApplied: Schema.NullOr(Schema.Boolean), // null when no orientation is saved
  warnings: Schema.Array(Schema.String).check(Schema.isMaxLength(50)),
  log: ScadRenderResult.fields.log,
  /** The sliced 3MF (Bambu, Orca) or G-code (Prusa), for download or opening. */
  project: Schema.NullOr(SignedFile),
  layers: Schema.NullOr(
    Schema.Struct({
      file: SignedFile,
      layerCount: Schema.Int,
      segmentCount: Schema.Int,
      decimated: Schema.Boolean,
    }),
  ),
});
```

`ModelPreviewError.reason` (`model-preview-3d.ts:264-280`) gains `"slicer-missing"`.

### Profile listing and import

```ts
export const SlicerProfileEntry = Schema.Struct({
  name: profileName,
  source: Schema.Literals(["system", "user", "imported"]),
  /** Machine presets only: nozzle size and the printer model, for display and checks. */
  nozzleMm: Schema.NullOr(Schema.Number),
  printerModel: Schema.NullOr(Schema.String),
});
export const SlicerProfileList = Schema.Struct({
  app: SlicerApp,
  version: Schema.NullOr(Schema.String),
  machines: Schema.Array(SlicerProfileEntry).check(Schema.isMaxLength(1000)),
  /** Filtered by compatibility with `machine` when it is given; empty otherwise. */
  processes: Schema.Array(SlicerProfileEntry).check(Schema.isMaxLength(1000)),
  filaments: Schema.Array(SlicerProfileEntry).check(Schema.isMaxLength(1000)),
});
```

### RPC methods

Added to `MODEL_PREVIEW_3D_WS_METHODS` (`model-preview-3d.ts:10-28`) and the group with the
`rpc` helper (`:307-316`):

| Tag                                         | Payload                                                                                              | Success              | Scope                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------- | --------------------- |
| `loom.model-preview-3d.slice`               | `SliceInput`                                                                                         | `SliceResult`        | Orchestration operate |
| `loom.model-preview-3d.slicerProfiles`      | `{ app, machine?: string }`                                                                          | `SlicerProfileList`  | Orchestration read    |
| `loom.model-preview-3d.importSlicerProfile` | `{ app, kind: "machine" \| "process" \| "filament" \| "config", fileName, text }` (text up to 2 MiB) | `SlicerProfileEntry` | Orchestration operate |
| `loom.model-preview-3d.openSlice`           | `{ key: string }`                                                                                    | `Schema.Void`        | Terminal operate      |

`openSlice` uses terminal operate, like `openResultBundle`
(`packages/contracts/src/fork/clientRpcPermissions.ts:43`), because it launches a program on
the host. Entries go in `apps/server/src/fork/rpcAuthorization.ts:49-65` and the operate ones in
`clientRpcPermissions.ts:24-31`. Cancelling is interrupting the `slice` request, as render
cancellation works today; no separate method.

### Editor command

In `packages/contracts/src/fork/model-editor.ts`, add `"layers"` to the action literals
(`:6-34`) and a field `layer: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0,
maximum: 100000 })))`. `index` is capped at 79 (`:36`), too small for layers, so it is not
reused. `ModelEditorState` (`:65-82`) gains
`layers: Schema.optionalKey(Schema.NullOr(Schema.Struct({ layer: Schema.Int, count: Schema.Int,
zMm: Schema.Number })))`. `{ action: "layers", enabled: true }` shows layers (slicing first if
there is no current result), `layer` jumps to a layer, `enabled: false` hides them.

## Server

New folder `apps/server/src/fork/model-preview-3d/slicer/`. Each file is pure or takes its
dependencies as arguments, so `ModelPreviewService.ts` only creates the slicer service inside
`make` and spreads `slice`, `slicerProfiles`, `importSlicerProfile` and `openSlice` into the
returned object.

| File          | Contents                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------- |
| `detect.ts`   | Candidate paths, `--help` probe, version parsing.                                           |
| `profiles.ts` | Profile roots, vendor index, flattening, listing, imports. Shared with L51.                 |
| `prepare.ts`  | Mesh resolution, orientation, job folder.                                                   |
| `bambu.ts`    | Argv for Bambu Studio and OrcaSlicer, 3MF reading, verification.                            |
| `prusa.ts`    | Argv for PrusaSlicer, G-code footer reading.                                                |
| `gcode.ts`    | Streaming G-code pass: header and footer totals, layers, roles, support filament, segments. |
| `layers.ts`   | Segment buffer with bounded decimation and the `layers.bin` writer.                         |
| `service.ts`  | `makeSlicer(deps)`: cache, jobs, semaphores, cost, publishing.                              |

### Detection (`detect.ts`)

For each app, the configured path wins; otherwise the first existing candidate:

| App          | macOS                                                                                                                                         | Linux (`PATH`) | Windows                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------- |
| Bambu Studio | `/Applications/BambuStudio.app/Contents/MacOS/BambuStudio`, same under `~/Applications`                                                       | `bambu-studio` | `C:\Program Files\Bambu Studio\bambu-studio.exe`                |
| OrcaSlicer   | `/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer`                                                                                      | `orca-slicer`  | `C:\Program Files\OrcaSlicer\orca-slicer.exe`                   |
| PrusaSlicer  | `/Applications/Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer`, `/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer` | `prusa-slicer` | `C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer-console.exe` |

Only the Bambu Studio macOS path is verified; the rest are marked in REFERENCES.md. The probe
runs `<exe> --help` with a 10 second timeout and `maxOutputBytes` 64 KiB; the version is the
first `(\d+\.\d+\.\d+(\.\d+)?)` on the first line (Bambu Studio prints
`BambuStudio-02.08.04.57:`). On macOS, when `--help` fails, read `CFBundleShortVersionString`
from `Contents/Info.plist` (XML in Bambu Studio's case). Results are cached for 60 seconds
like OpenSCAD's and reset by `updateSettings`. Detection runs only when the `status` RPC or a
slice asks for it: the internal OpenSCAD `status()` used by renders does not probe slicers.

`supported` is true for Bambu Studio 02.08.x and later and for the Orca and Prusa versions
tested when their adapters land.

### Profiles (`profiles.ts`, shared definition with L51)

```ts
export type ProfileKind = "machine" | "process" | "filament";
export type ProfileRoot = {
  readonly source: "system" | "user";
  readonly vendor: string | null; // "BBL", "Anycubic"; null for user folders
  readonly directory: string; // contains machine/, process/, filament/
  readonly version: string | null;
};
/** System vendor folders (highest index version wins per vendor) and user preset folders. */
export const slicerProfileRoots: (
  app: "bambu-studio" | "orca-slicer",
  home: string,
  executable: string,
) => Effect<ProfileRoot[]>;
/** The full profile: inherits followed, leaf keys over parent keys, ready for the CLI. */
export const flattenProfile: (
  roots: ProfileRoot[],
  kind: ProfileKind,
  name: string,
) => Effect<{ json: Record<string, unknown>; hash: string }, ModelPreviewError>;
```

- **Roots.** System profiles ship inside the app (`<App>.app/Contents/Resources/profiles/` on
  macOS) and newer downloads land in the data folder's `system/` (on Kyle's Mac,
  `~/Library/Application Support/BambuStudio/system/`). Each vendor has an index
  `<Vendor>.json` with a `version` and `machine_list`, `process_list`, `filament_list` entries
  of `{ name, sub_path }`. For each vendor, use the folder whose index has the higher version.
  User presets are in `<data>/user/<user id or "default">/{machine,process,filament}/`.
  Data folders: macOS `~/Library/Application Support/<BambuStudio|OrcaSlicer>`; Linux
  `~/.config/<BambuStudio|OrcaSlicer>` and Windows `%APPDATA%\<BambuStudio|OrcaSlicer>`
  (unverified).
- **Lookup.** A name resolves to the user preset first, then the vendor index entry, then
  `<directory>/<kind>/<name>.json`. Parents named by `inherits` resolve in the same vendor.
- **Flatten.** Load the leaf, follow `inherits` up to 16 levels (a loop or a missing parent is
  an error naming it), merge from the root down with child keys replacing parent keys
  (arrays replace whole), then delete `inherits`, keep `name` and `type`, and set
  `from: "User"` and `instantiation: "true"`. The Fabrication research found the CLI accepts
  this form; verify on the first real slice. The hash is SHA-256 of the canonical JSON (keys
  sorted). Flattened files are written once to
  `<stateDir>/fork/model-preview-3d/slicer/profiles/<hash>.json`.
- **Listing.** Only presets with `instantiation: "true"` are selectable. Processes and
  filaments are filtered by the chosen machine's name in `compatible_printers` (an empty list
  means any printer). Orca's `compatible_printers_condition` expressions are not evaluated in
  v1; such presets are listed. Reading 2000 filament files per request is too slow, so the
  listing builds an index once per app version and caches it in memory and in
  `slicer/index-<app>-<version>.json` (names, kind, `compatible_printers`, `instantiation`,
  nozzle and printer model; under 1 MB).
- **Imports.** `importSlicerProfile` stores the text under
  `slicer/imported/<app>/<kind>/<sha256>.<json|ini>` and records its display name (the JSON
  `name`, or the file name for a Prusa config). An imported Bambu or Orca preset is flattened
  against the installed roots like any other.
- Loom never writes inside the slicer's folders.

### Preparing the mesh (`prepare.ts`)

- **SCAD** (and L50 sources): call the existing render for the same `file`, `overrides` and
  `parameterSet` inside `renderSlots`, take `mesh.revision` as the geometry revision and
  `cacheDir/<revision>.<meshFormat>` as the input, and hold `protectStem` until the slice ends
  so pruning cannot remove it.
- **STL, 3MF, OBJ**: the workspace file through `resolveFile`. The geometry revision is the
  SHA-256 of its bytes, streamed (the mtime revision at `ModelPreviewService.ts:88-102` changes
  on a copy and would miss the cache).
- **GLB, glTF**: refused with `unsupported-format`.
- **Orientation** (L35's workspace entity, if present): STL is read, rotated by the quaternion,
  dropped so its minimum Z is 0, and written as binary STL into the job folder in TypeScript
  (`rotateStl` in `prepare.ts`). 3MF and OBJ are converted to a rotated binary STL with
  OpenSCAD: `multmatrix(<4x4 from the quaternion>) scale(<3MF unit scale>) import("<path>");`,
  as `renderImages` does for previews. Without OpenSCAD the slice proceeds unrotated and adds
  the "Orientation not applied" warning; `orientationApplied` is false.
- The job folder is `<stateDir>/fork/model-preview-3d/slices/pending-<uuid>/` with
  `machine.json`, `process.json`, `filament-<n>.json` (copies of the flattened files), the
  input mesh when it was transformed, and `out/`. Paths containing `;` are refused, because
  the Bambu CLI splits `--load-settings` on semicolons.

### Bambu Studio and OrcaSlicer (`bambu.ts`)

```
<exe> --datadir <stateDir>/fork/model-preview-3d/slicer/datadir-<app>
      --debug 2
      --load-settings "<job>/machine.json;<job>/process.json"
      --load-filaments "<job>/filament-1.json[;...]"
      --arrange 1 --orient 0
      --slice 0
      --outputdir <job>/out
      --export-3mf result.3mf
      <mesh>
```

- `--datadir` points at a Loom-owned throwaway folder so the CLI never reads or writes the
  GUI's settings, login or plugins (help text: "Use and store all program settings at the
  given directory instead of the default"). Verify that a slice with flattened files needs
  nothing else in that folder.
- No `--min-save`: the exported project must be complete so "Open in slicer" shows it.
- No `--export-png`: thumbnails need a GPU context on the host.
- `--orient 0` keeps Loom's (or L35's) orientation; `--arrange 1` centres the part on the
  plate.
- Run with `runner.run` (`cwd` the job folder, `timeout` from `slicer.timeoutSeconds`,
  `timeoutBehavior: "timedOutResult"`, `outputMode: "truncate"`, `maxOutputBytes` 512 KiB),
  exactly like the OpenSCAD call at `ModelPreviewService.ts:469-487`. Interrupting the fiber
  stops the process.
- **Reading the result.** Open `out/result.3mf` with `yauzl` (pattern of
  `threeMfUnits.ts`) and read two entries:
  - `Metadata/slice_info.config`: per `<plate>`, `<metadata key=... value=...>` for
    `prediction` (seconds), `weight` (grams), `printer_model_id`, `nozzle_diameters`,
    `outside`, `support_used`; `<filament id type color used_m used_g>`; and
    `<warning msg level error_code>`. Regex parsing, as the 3MF unit reader does.
  - `Metadata/plate_1.gcode`: streamed into the G-code pass below.
- **Verification.** Exit code 0 is not proof (OrcaSlicer issue #15450 reports a clean exit
  with the wrong printer). The result is accepted only when the 3MF exists, `slice_info.config`
  has plate 1 with a `prediction`, and `printer_model_id` matches the `model_id` of the
  mapped machine's printer model (`machine_model_list` entry, for example `O1D` for the H2D).
  Otherwise the job fails with the wrong-result message in PRODUCT.md. A non-zero exit maps to
  "Slicing failed" plus the last `error`-level lines of the log.
- `outside="true"` adds "Part of the model is outside the plate." Each slicer `<warning>`
  becomes a warning string.

### PrusaSlicer (`prusa.ts`)

```
<exe> --datadir <stateDir>/fork/model-preview-3d/slicer/datadir-prusa-slicer
      --load <imported config.ini>
      --export-gcode --binary-gcode 0
      --output <job>/out/result.gcode
      <mesh>
```

PrusaSlicer system presets live in its GUI data folder, so v1 slices with a config the user
exported (File, Export, Export Config) and imported into Loom. `--binary-gcode 0` keeps the
output readable when the printer profile enables binary G-code (the `binary_gcode` option exists
in `PrintConfig.cpp`; the CLI form is unverified). Totals come from the footer comments
(`; filament used [mm] =`, `[cm3]`, `[g]`, `; total filament used [g] =`,
`; filament cost =`, `; estimated printing time (normal mode) =`). Layer count is the number of
`;LAYER_CHANGE` lines. "Open in slicer" opens the G-code, which PrusaSlicer shows in its
G-code viewer.

### The G-code pass (`gcode.ts`)

One streaming pass over the G-code (from the 3MF entry or the file), line by line, never
holding the file in memory:

- **Totals.** Bambu Studio writes `; model printing time: X; total estimated time: Y`,
  `; total layer number: N`, `; total filament length [mm] : a,b` and
  `; total filament weight [g] : a,b` near the top of the file. Orca footer for non-Bambu
  printers: `; total filament used [g] =`, `; total filament cost =`,
  `; total layers count =`, `; estimated printing time (normal mode) =`. Prusa footer as above.
  Durations like `1d 2h 3m 4s` parse to seconds. Values from `slice_info.config` win when both
  exist.
- **Layers and roles.** Bambu dialect: `; CHANGE_LAYER`, `; LAYER_HEIGHT: h`,
  `; FEATURE: <name>`. Prusa dialect (also Orca for non-Bambu printers): `;LAYER_CHANGE`,
  `;Z:z`, `;HEIGHT:h`, `;TYPE:<name>`. A layer's Z is the `;Z:` value when present, otherwise
  the Z of the first extruding move after the layer change (a `; Z_HEIGHT:` comment may exist
  in Bambu output; it is unverified and not relied on). Feature names map to `SliceRole`
  through one table built from Bambu Studio's `role_to_string` names ("Outer wall",
  "Inner wall", "Overhang wall", "Sparse infill", "Internal solid infill", "Top surface",
  "Bottom surface", "Bridge", "Gap infill", "Skirt", "Brim", "Support", "Support interface",
  "Support transition", "Prime tower") and PrusaSlicer's `;TYPE:` names ("Perimeter",
  "External perimeter", "Internal infill", "Solid infill", "Top solid infill",
  "Bridge infill", "Support material", "Support material interface"); unknown names map to
  `other`.
- **Moves.** Track `G90`/`G91`, `M82`/`M83` and `G92 E` resets. A `G1` (or `G2`/`G3`, split
  into chords of at most 2 mm) with a positive extrusion delta is an extrusion segment; travel
  moves are ignored. Tool changes (`T<n>`) set the active filament slot.
- **Support weight.** Sum positive E deltas while the role is a support role, per slot. Grams
  = length × π × (d / 2)² / 1000 × density, with `filament_diameter` from the filament profile
  and density from the L51 material, else `filament_density`. Shown as "about".
- **Segments.** Passed to the layer buffer below.

### Layer file (`layers.ts`)

The buffer keeps at most 1,000,000 segments. When it fills, it drops every other segment and
doubles its keep interval, so memory stays bounded for any print and the result is evenly
thinned (`decimated: true`). The writer stores little-endian:

| Offset | Type                                            | Content                                                            |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------ |
| 0      | 4 bytes                                         | `LLY1`                                                             |
| 4      | u32                                             | layer count                                                        |
| 8      | u32                                             | segment count                                                      |
| 12     | f32 × 2                                         | origin X, Y in mm (minimum extrusion X, Y)                         |
| 20     | f32                                             | step in mm per unit (0.01, or 0.02 when the extent exceeds 655 mm) |
| 24     | per layer: f32 z, f32 height, u32 first segment | layer table                                                        |
| then   | per segment: u16 × 4 (x0, y0, x1, y1)           | quantised coordinates                                              |
| then   | per segment: u8                                 | `SliceRole` index                                                  |

A million segments is about 9 MB; typical prints are 1 to 4 MB. The file is published with
the rest of the job and signed with `sign(slicesDir, path, true)` only in the result.

### Cost

`cost` is computed when the result is returned, not cached, so a price change applies at
once. For each used slot, the price per kilogram comes from the L51 material mapped to that
slot, else the flattened filament profile's `filament_cost` when it is above zero (Bambu's
generic defaults are placeholders; see REFERENCES.md). If any used slot has no price, `cost` is
null. `currency` is `slicer.currency`.

### Cache and jobs (`service.ts`)

- **Key.** SHA-256 of JSON `[ADAPTER_VERSION, app, appVersion, executable path, geometry
revision, orientation quaternion or null, machine hash, process hash, filament hashes]`.
  `ADAPTER_VERSION` is a constant bumped when parsing changes.
- **Layout.** `<stateDir>/fork/model-preview-3d/slices/<key>/` with `result.json` (the
  `SliceResult` without URLs and cost), `result.3mf` or `result.gcode`, `layers.bin` and
  `slicer.log`. A job works in `pending-<uuid>/` and is renamed to `<key>/` only after
  verification, so a cancelled or failed job never leaves a half result. Pending folders older
  than a day are removed at startup.
- **Pruning.** After each publish, keep at most 100 slices and 2 GiB using `pruneList`
  (`renderCache.ts:27-39`) over per-folder sizes. `clearCache` (`ModelPreviewService.ts:1082`)
  also clears `slices/`.
- **Jobs.** One slice at a time per slicer app (`Semaphore.make(1)` each), so two Bambu
  slices queue but a Bambu and a Prusa slice may overlap. Per `file + variantId`, a new request
  interrupts the previous one, as `renderScad` does with its `jobs` map (`:587-622`).
- `cachedOnly: true` computes the key (rendering SCAD only if its render is already cached;
  otherwise returns `none`) and returns the cached result or `{ status: "none" }`. It never
  runs the slicer.

### Opening in the slicer

`openSlice({ key })` finds `slices/<key>/result.*` and the app from `result.json`. On macOS it
runs `open -a <app bundle> <file>` through `runner.run` (it returns at once). On Linux and
Windows it spawns the executable with the file, detached with ignored stdio and unref'd, the
way `launchAndUnref` does in `apps/server/src/process/externalLauncher.ts:692-705`. The web
offers it only when the desktop app is connected to its own environment (the
`AppleBuildPanel.tsx:69-70` check); everyone else gets "Download 3MF" from `project`.

## Storage

Files only, all under `<stateDir>/fork/model-preview-3d/`:

| Path                                   | Content                         | Lifetime                                               |
| -------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| `slices/<key>/`                        | Results, projects, layer files  | Pruned to 100 entries and 2 GiB                        |
| `slicer/profiles/<hash>.json`          | Flattened profiles              | Pruned with unreferenced hashes when `clearCache` runs |
| `slicer/index-<app>-<version>.json`    | Profile index                   | Replaced when the version changes                      |
| `slicer/imported/<app>/<kind>/<sha>.*` | Imported profiles               | Until the user removes them in settings                |
| `slicer/datadir-<app>/`                | The CLI's throwaway data folder | Kept; may be deleted at any time                       |

Settings gain the `slicer` field (decoding default). No table or migration.

## Clients

### Shared atoms

`packages/client-runtime/src/fork/model-preview-3d.ts` gains `slice`
(`createEnvironmentRpcCommand` on `M.slice`, label `loom:model-slice`), `slicerProfiles` (a
query family keyed by app and machine), `importSlicerProfile` and `openSlice`, following the
existing render command (`:14-22`).

### Web

- **`PrintSection.tsx`** (new), rendered in `PartSection` (`ModelInspector.tsx:336`) after
  the facts list (`:424`) and before "Render log" (`:454`):
  - On mount and whenever the geometry revision, orientation or active bed changes, it calls
    `slice` with `cachedOnly: true`. A hit shows the result; a miss shows "Estimate print".
  - The headline is `formatEstimate(estimate)` in a new `slicing.ts`: "4 h 12 m, 38 g PLA";
    two filaments read "4 h 12 m, 38 g PLA + 6 g PETG". The facts list adds "Print time",
    "Filament" ("12.71 m, 38 g"), "Support" ("about 6 g" or "None"), "Layers" and "Cost"
    (`Intl.NumberFormat(undefined, { style: "currency", currency })`).
  - Buttons: "Estimate print" or "Estimate again", "Show layers" or "Hide layers", and
    "Open in <slicer>" or "Download 3MF" (an anchor to `resolveAssetUrl(project.relativeUrl)`).
  - The result keeps the inputs it was made from; when they differ from the current ones, the
    section is dimmed with the existing "Out of date" `Chip` (as `VariantsInspector.tsx:315`).
- **Layer preview.** `viewer/layers.ts` (new) exports
  `createLayers(requestRender)` returning `{ object, set(data | null), showThrough(layer),
dispose() }`. `set` builds one `BufferGeometry` with `Float32Array` positions (x, y, z per
  vertex) and role colours from a fixed palette checked in both themes, and a
  `LineSegments` with a basic material. `showThrough(n)` calls `setDrawRange(0, end of layer
n)` and `requestRender()` once. Nothing animates. `createViewer.ts` gains
  `setLayers(data | null)` and `showLayersThrough(n)`, which also hide the model mesh while
  layers are shown; the data is centred on the part's footprint like the bed
  (`createViewer.ts:431-438`).
- **Slider.** A small bar at the bottom of the viewport while layers are shown: a native
  `<input type="range">` with an accessible name "Layer", and the label "Layer 120 of 210,
  Z 24.20 mm". Arrow keys step one layer while it has focus; `Escape` hides layers.
- **Key.** `Y` toggles layers: one `else if` in the key handler at `ModelPanel.tsx:749-769`.
- **Palette.** `ModelAction` (`actions.ts:2`) gains `"estimate-print"` and `"toggle-layers"`;
  `palette.tsx:54-61` lists them as "3D model: Estimate print" and "3D model: Show or hide
  sliced layers".
- **Editor command.** The `layers` case in the editor action switch (`ModelPanel.tsx:200-380`)
  drives the same state and reports it in `snapshot`.
- **Variants.** The detail line at `VariantsInspector.tsx:323-330` appends ", about 4 h 12 m"
  when a cached estimate exists for that variant (looked up with `cachedOnly`, keyed by the
  variant's values). An "Estimate print times" button in the variants toolbar slices up to 12
  variants one after another, with "Cancel". Nothing new is stored in the workspace: results
  live in the slice cache, so no `ModelVariant` schema change is needed.
- **Settings.** `SlicingSettings.tsx` (new), rendered by `SettingsSection.tsx` after the bed
  rows:
  - One row per slicer: the detection line ("Bambu Studio 02.08.04.57" or "Not found"), a path
    `Input`, and "Detect again" (the existing refresh).
  - "Slice timeout" (seconds) and "Currency" (a `Select` of common ISO codes plus a text
    field).
  - "Printer profiles": one row per printer from `listBeds` (surfaces are skipped): slicer,
    printer preset, process preset, filament presets, and with L51 a material per filament.
    Each `Select` is fed by `slicerProfiles`. "Use Bambu Studio defaults" fills the
    suggestions below. "Import profile" accepts `.json` (Bambu, Orca) or `.ini` (Prusa config).
    "Remove" clears a mapping.

Suggested Bambu Studio mappings (names verified in Bambu Studio 02.08.04.57's profiles):

| Bed              | Printer                          | Process                    | Filament                   |
| ---------------- | -------------------------------- | -------------------------- | -------------------------- |
| `bambu-h2d`      | `Bambu Lab H2D 0.4 nozzle`       | `0.20mm Standard @BBL H2D` | `Bambu PLA Basic @BBL H2D` |
| `bambu-h2c`      | `Bambu Lab H2C 0.4 nozzle`       | `0.20mm Standard @BBL H2C` | `Bambu PLA Basic @BBL H2C` |
| `bambu-x1-p1-a1` | `Bambu Lab X1 Carbon 0.4 nozzle` | `0.20mm Standard @BBL X1C` | `Bambu PLA Basic @BBL X1C` |
| `bambu-a1-mini`  | `Bambu Lab A1 mini 0.4 nozzle`   | `0.20mm Standard @BBL A1M` | `Bambu PLA Basic @BBL A1M` |

### Mobile

None. Mobile has no 3D panel.

## Agent-facing tools

- **New tool `loom_model_preview_3d_slice`** in `mcp.ts` (`actsAsCaller`, gated by
  `agentToolEnabled` like the render tool at `ModelPreviewService.ts:1116`): parameters
  `{ path, overrides?, bedId?, cachedOnly? }`; returns the estimate, profiles, warnings,
  `orientationApplied`, and the host path of the sliced project (as the render tool returns
  host PNG paths). A new tool is clearer than overloading `render`, which returns images and
  must stay fast. Description: "Estimate print time, filament and support for a workspace model
  by slicing it with the host slicer mapped to the bed. Never prints."
- **`loom_model_preview_3d_editor`** gains the `layers` action, so an agent can show the
  layers and capture them.
- **`loom_model_preview_3d_status`** reports `slicers`.
- **`loom_model_preview_3d_save_settings`** already carries settings, so agents can set
  mappings. It is not gated by `agentToolEnabled` today (`mcp.ts:438`); see the final report
  of this packet's author.

## Performance

- Nothing runs unless asked: no slicing on edits, no polling. Cached lookups are one small
  RPC per Part open or revision change.
- Slices run one per slicer app, never more than the host's slicer can handle; the timeout
  bounds every run; cancellation kills the process.
- The G-code pass streams, so a 200 MB G-code costs one pass and constant memory apart from
  the bounded segment buffer (about 9 MB at the cap).
- WebSocket payloads are the JSON result (a few kilobytes) and profile lists (under 100 KB,
  filtered by machine). Projects and layer files go through the signed route, fetched only when
  the user opens them, so remote clients pay nothing until then.
- The layer preview is one geometry and one draw call; moving the slider changes the draw
  range and renders one frame. GPU memory at the cap is about 24 MB of positions and colours
  and is freed when layers are hidden.

## Alternatives considered

- **Show only the slicer's estimate from a project the user saves.** Loses the loop: the point
  is estimating the part the agent just changed.
- **Run slicing in the browser (a WASM slicer).** No maintained WASM build of these slicers,
  and the user's profiles are on the host.
- **Ship flattened profiles with Loom.** Stale within a release, and AGPL vendor data. Reading
  what the user has installed matches what they print with.
- **Use the CLI's `--rotate`, `--rotate-x` and `--rotate-y` flags for orientation.** The
  rotation order is not documented, and PrusaSlicer's flags differ. Rotating the mesh in Loom
  is exact and works for every slicer.
- **Store print estimates on variants in the workspace.** A schema change that an older
  client would strip on save. The slice cache already answers by key.
- **Return layer data over the WebSocket.** Megabytes per request would block other traffic
  on remote connections. The signed route exists for bytes.
- **Use `--export-slicedata` instead of reading the 3MF.** Its format is internal to Bambu
  Studio and undocumented; `slice_info.config` and G-code comments are what other tools read.
