# L51 technical design

Cited lines are from `docs/model-preview-follow-ups` at `8676e099e5`, which includes the bed
picker. Line numbers in files that L32, L33 or L34 change will move; the function names will
not.

## Overview

Beds become data in two layers. Built-in printers and surfaces are a constant in contracts
(`BUILT_IN_PRINTERS`), keyed by today's preset ids. User printers, starter materials and the
list of hidden built-ins are one `PrinterLibrary` value stored on the environment host with a
version number. The shared bed list (`listBeds`, `activeBed`, `selectBed` in
`packages/contracts/src/fork/model-beds.ts`, created by L32, L33 or L34) takes the library as
an optional argument and merges the two. Every reader already goes through that list or the
web wrappers `bedGroups()` and `resolvePlate()` (MODEL-3D-FOLLOW-UPS.md, "Bed source"), so
the rest of the panel, L32's fit list and the agent fit summary follow without change.

```
contracts: BUILT_IN_PRINTERS ─┐
                              ├─ listBeds(setting, { library }) ─ bedGroups / resolvePlate ─ UI
server: printers row ─ RPC ───┘                                 └─ fit summary, MCP tools
```

## Today

- Beds are `BUILD_PLATE_PRESETS` (`packages/contracts/src/fork/model-preview-3d.ts:154-219`)
  and the `preset` literal union built from its keys (`:221-224`). L32 moves both to
  `model-beds.ts` unchanged.
- The setting is `{ preset, customMm, pattern }` (`model-preview-3d.ts:229-238`), stored as one
  JSON row with key `'settings'` in `fork_model_preview_3d_settings`
  (`apps/server/src/fork/model-preview-3d/store.ts:46-62`, table created in
  `migrations.ts:28`). L33 adds `customBedId`, `customBeds` (24 at most) and
  `hiddenPresets` with decoding defaults and makes `updateSettings` a merge
  (L33 TECHNICAL.md, "Contracts").
- The web reads beds through `bedGroups` and `resolvePlate`
  (`apps/web/src/fork/model-preview-3d/buildPlate.ts:13-39`), except two direct reads of
  `BUILD_PLATE_PRESETS[...].note` (`BedPicker.tsx:125`, `SettingsSection.tsx:238-240`). This
  packet removes both.
- The PCB hardware library is the closest precedent for an editable library: a versioned
  value with starter data when absent and an `expectedVersion` conflict check
  (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1319-1331`; contracts
  `packages/contracts/src/fork/pcb-workspace.ts:277-286`).

## Contracts

New file `packages/contracts/src/fork/model-printers.ts`, exported from
`packages/contracts/src/fork/index.ts`. It imports `effect`, `./model-beds.ts` and
`./model-slicer.ts` for `SlicerApp`, the shared definition in L47 TECHNICAL.md (if L47 has not
landed, create that file with only `SlicerApp`).

```ts
import { SlicerApp } from "./model-slicer.ts";

const mm = Schema.Number.check(Schema.isBetween({ minimum: 10, maximum: 2000 }));
const bedMm = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 2000 }));
const text = (max: number) => Schema.String.check(Schema.isMaxLength(max));
const name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60));

/** User entries share L33's custom bed id form, so `customBedId` selects them. */
export const UserPrinterId = CustomBedId; // /^custom-[0-9a-f-]{8,36}$/, from model-beds.ts
export const MaterialId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/));

/** L34's zone shape: offset from the bed's front-left corner; no heightMm = full height. */
export const NozzleZone = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  label: name,
  footprintMm: Schema.Tuple([mm, mm]),
  offsetMm: Schema.Tuple([bedMm, bedMm]),
  heightMm: Schema.optionalKey(mm),
});

/** A polygon the nozzle must avoid, such as the X1 and P1 purge corner. */
export const ExcludedArea = Schema.Array(Schema.Tuple([bedMm, bedMm])).check(
  Schema.isMinLength(3),
  Schema.isMaxLength(32),
);

export const Printer = Schema.Struct({
  id: UserPrinterId,
  name,
  kind: Schema.Literals(["printer", "surface"]),
  /** Width, depth, height; a round bed uses its diameter for width and depth. */
  volumeMm: Schema.Tuple([mm, mm, Schema.NullOr(mm)]),
  bedShape: Schema.Literals(["rectangle", "round"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("rectangle" as const)),
  ),
  nozzlesMm: Schema.Array(
    Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 2 })),
  ).check(Schema.isMaxLength(8)),
  materialIds: Schema.Array(MaterialId).check(Schema.isMaxLength(32)),
  defaultMaterialId: Schema.NullOr(MaterialId),
  zones: Schema.Array(NozzleZone).check(Schema.isMaxLength(8)),
  excludedAreasMm: Schema.Array(ExcludedArea).check(Schema.isMaxLength(8)),
  notes: text(2000),
  /** Where the numbers came from; shown as a tag and used to suggest L47 mappings. */
  source: Schema.Struct({
    kind: Schema.Literals(["user", "imported"]),
    app: Schema.NullOr(SlicerApp),
    profileName: Schema.NullOr(text(200)),
  }),
  /** The built-in this entry was duplicated from; older clients fall back to it. */
  basedOn: Schema.NullOr(Schema.String),
});

export const Material = Schema.Struct({
  id: MaterialId,
  name,
  type: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20)), // "PLA", "PETG"
  brand: Schema.NullOr(text(60)),
  colorHex: Schema.NullOr(Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))),
  densityGCm3: Schema.Number.check(Schema.isBetween({ minimum: 0.5, maximum: 3 })),
  /** Price per kilogram in the user's currency; null when unknown. */
  costPerKg: Schema.NullOr(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 10000 }))),
  nozzleC: Schema.NullOr(Schema.Tuple([Schema.Int, Schema.Int])),
  bedC: Schema.NullOr(Schema.Tuple([Schema.Int, Schema.Int])),
  notes: text(2000),
});

export const USER_PRINTER_LIMIT = 50; // plus 14 built-ins = L32's 64-bed cap
export const MATERIAL_LIMIT = 100;

export const PrinterLibrary = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  printers: Schema.Array(Printer).check(Schema.isMaxLength(USER_PRINTER_LIMIT)),
  materials: Schema.Array(Material).check(Schema.isMaxLength(MATERIAL_LIMIT)),
  hiddenBuiltIns: Schema.Array(BuildPlatePresetId).check(Schema.isMaxLength(64)),
});

export const PrinterLibraryUpdate = Schema.Struct({
  expectedVersion: Schema.Int,
  printers: PrinterLibrary.fields.printers,
  materials: PrinterLibrary.fields.materials,
  hiddenBuiltIns: PrinterLibrary.fields.hiddenBuiltIns,
});

export const PrinterProfileDraft = Schema.Struct({
  printer: Printer,
  /** Plain sentences, for example "Excluded areas are listed but not drawn." */
  warnings: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
});
```

Uniqueness (printer ids, material ids, names within a kind) and references (`materialIds`
and `defaultMaterialId` must exist, zones must lie inside the bed) are checked by a pure
`libraryProblems(library): string[]` in the same file, used by the server before saving and by
the web editor for field messages. The schema checks only shapes and limits, so a library
saved by a future version with a looser rule still loads.

### Built-ins

`BUILT_IN_PRINTERS` replaces `BUILD_PLATE_PRESETS` as the source of preset data in
`model-beds.ts`. It keeps the same ids, labels, kinds, volumes and notes, and adds
`bedShape: "rectangle"`, `nozzlesMm`, `zones` (L34's values for `bambu-h2d` and `bambu-h2c`)
and `excludedAreasMm`. `BuildPlatePresetId` is built from its keys.

Nozzle sizes come from the vendor data where Loom has verified it (Bambu Studio's
`machine/Bambu Lab H2D.json` lists `"0.4;0.2;0.6;0.8"`); other printers list the stock
0.4 mm nozzle only. Built-ins have `materialIds: []`, which the editor shows as "Any material".

`STARTER_MATERIALS` are written into the library when it is first created, so they are
editable like any user entry (the PCB starter data pattern, `PcbPreviewService.ts:1320-1321`):

| id             | type | densityGCm3 | nozzleC    | bedC (hot plate) |
| -------------- | ---- | ----------- | ---------- | ---------------- |
| `generic-pla`  | PLA  | 1.24        | 190 to 240 | 55               |
| `generic-petg` | PETG | 1.27        | 220 to 270 | 70               |
| `generic-abs`  | ABS  | 1.04        | 240 to 280 | 90               |
| `generic-asa`  | ASA  | 1.04        | 240 to 280 | 100              |
| `generic-tpu`  | TPU  | 1.24        | 200 to 250 | 35               |

`costPerKg` is null for all of them (see REFERENCES.md for where each number comes from).

### Bed list changes in `model-beds.ts`

```ts
export type Bed = {
  readonly id: string;
  readonly label: string;
  readonly kind: "printer" | "surface" | "custom"; // "custom" is only the Custom size slot
  readonly origin: "built-in" | "user";
  readonly volumeMm: BedVolume;
  readonly bedShape: "rectangle" | "round";
  readonly nozzlesMm: readonly number[];
  readonly zones: readonly NozzleZone[];
  readonly note: string | null;
};
export type BedListOptions = { readonly library?: PrinterLibrary; readonly includeHidden?: boolean };
export const listBeds = (setting: BuildPlateSetting, options?: BedListOptions): readonly Bed[];
export const activeBed = (setting: BuildPlateSetting, options?: BedListOptions): Bed;
export const selectBed = (
  setting: BuildPlateSetting, id: string, options?: BedListOptions,
): BuildPlateSetting;
```

The options object is additive: L33's `includeHidden` and L51's `library` live side by side,
and callers that pass nothing get built-ins plus the Custom size slot, which is what a client
sees before the library loads.

- `listBeds`: visible built-ins (hidden by `library.hiddenBuiltIns`, or by L33's
  `setting.hiddenPresets` when no library is given), then library printers, then
  `{ id: "custom", label: "Custom size", kind: "custom", ... }` from `customMm`. The active
  bed is always included even if hidden.
- `activeBed`: a built-in `preset`; or with `preset: "custom"`, the library printer named by
  `customBedId`, falling back to L33's `customBeds` entry with that id (before migration), then
  to "Custom size". This order makes a migrated id and an unmigrated id resolve to the same bed.
- `selectBed`: a built-in id sets `preset` and clears `customBedId`; a library id sets
  `preset: "custom"` and `customBedId`; `"custom"` selects "Custom size". `customMm` is never
  overwritten, so the Custom size scratch survives.

`bedGroups(setting, library?)` in `buildPlate.ts` groups the list as "Your printers",
"Printers", "Surfaces", "Custom". `resolvePlate(setting, library?)` returns
`{ volume, pattern, shape }`; `shape` is new and optional in `Plate` so callers that ignore
it keep compiling. `buildPlateLabel(setting, library?)` is `activeBed(...).label`.

### Settings

No new settings field (Decision 2 in PRODUCT.md). If L33 has not landed, L51 adds exactly
L33's `customBedId` (`Schema.NullOr(CustomBedId)` with a `null` decoding default) and nothing
else. If L33 has landed, `customBeds` and `hiddenPresets` stay in `BuildPlateSetting` for the
migration, rollback and older clients. They remain accepted in `BuildPlateSettingUpdate`
for compatibility. After migration the versioned printer library is authoritative for the
new client; library editors write `updatePrinters`, and older-server clients retain L33's
settings editor.

### RPC methods

Added to `MODEL_PREVIEW_3D_WS_METHODS` (`model-preview-3d.ts:10-28`) and to
`ModelPreview3dRpcGroup` with the shared `rpc` helper (`:307-316`), so errors are
`ModelPreviewError | EnvironmentAuthorizationError`:

| Tag                                         | Payload                                           | Success               | Scope                           |
| ------------------------------------------- | ------------------------------------------------- | --------------------- | ------------------------------- |
| `loom.model-preview-3d.printers`            | `{}`                                              | `PrinterLibrary`      | `AuthOrchestrationReadScope`    |
| `loom.model-preview-3d.updatePrinters`      | `PrinterLibraryUpdate`                            | `PrinterLibrary`      | `AuthOrchestrationOperateScope` |
| `loom.model-preview-3d.parsePrinterProfile` | `{ fileName: text(255), text: String max 2 MiB }` | `PrinterProfileDraft` | `AuthOrchestrationReadScope`    |

`ModelPreviewError.reason` (`model-preview-3d.ts:264-280`) gains `"conflict"`.
The server scope table is `apps/server/src/fork/rpcAuthorization.ts:49-65`; the client table
is `packages/contracts/src/fork/clientRpcPermissions.ts:24-31` (operate only).

## Server

New file `apps/server/src/fork/model-preview-3d/printers.ts` with a factory
`makePrinterLibrary({ store, settings })` returning `{ library, update, parseProfile }`, created
inside `make` in `ModelPreviewService.ts` (after the store, near `:116`) and spread into the
returned object next to `getSettings` (`:971-982`). Keeping it in its own file means the
service diff is a few lines.

- `library()`: reads the `printers` row. When the row is absent it runs the migration (below)
  under a `Semaphore.make(1)` lock and writes version 1. Decode failure of a stored row is an
  error ("The printer library could not be read."), not a silent reset.
- `update(input)`: under the same lock, reads the current value, fails with `conflict` and
  "Printers changed on another client. Reload to see the latest." when
  `current.version !== input.expectedVersion`, runs `libraryProblems`, then writes
  `{ ...input, version: current.version + 1 }`. If the active bed was deleted, it also saves
  settings with `selectBed(settings, DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate.preset)` so no
  client points at a missing id.
- `parseProfile({ fileName, text })`: calls the pure parsers below and returns a draft with a
  fresh `custom-<uuid>` id. It never writes.

### Migration

Runs once, when no `printers` row exists:

1. Start from `{ version: 1, printers: [], materials: STARTER_MATERIALS, hiddenBuiltIns: [] }`.
2. Each L33 `customBeds` entry becomes a printer with the same `id` and `name`, `volumeMm`
   unchanged, `kind: volumeMm[2] === null ? "surface" : "printer"`, `bedShape: "rectangle"`,
   empty nozzles, materials, zones and notes, `source: { kind: "user", app: null,
   profileName: null }`, `basedOn: null`.
3. L33 `hiddenPresets` are copied into `hiddenBuiltIns`.
4. The settings row is not changed: `preset`, `customBedId` and `customMm` already resolve
   through the new `activeBed`.

It is idempotent because it only runs when the row is absent, and it never deletes the L33
fields, so rolling back to a Loom without L51 finds the old beds where it left them.

### Profile parsers

New file `apps/server/src/fork/model-preview-3d/printerProfiles.ts`, pure functions with
fixtures:

- `parseBambuProfile(json)` for Bambu Studio and OrcaSlicer machine profiles. Reads
  `printable_area` (points `"WxH"`), `printable_height`, `nozzle_diameter` (array of strings,
  deduplicated), `extruder_printable_area` and `extruder_printable_height` (one entry per
  nozzle; each becomes a zone, "Left nozzle" and "Right nozzle" in order),
  `bed_exclude_area` (an excluded polygon when non-empty) and `name`. A profile with
  `inherits` and missing keys is resolved against installed system profiles with
  `flattenProfile` from `slicer/profiles.ts` (shared with L47, see below). If the parent cannot
  be found the parser fails with "This profile inherits from "<name>", which Loom could not
  find on this host. Export it from the slicer as a full profile." The app is `orca-slicer`
  when the JSON names an Orca vendor or `from` and `inherits` resolve under OrcaSlicer's
  folders, otherwise `bambu-studio`.
- `parsePrusaIni(text)` for a PrusaSlicer config exported with File, Export, Export Config.
  Reads `bed_shape` (comma-separated `XxY` points), `max_print_height`, `nozzle_diameter`
  (comma-separated) and `printer_model`/`printer_settings_id` for the name. Vendor bundle INIs
  with `[printer:...]` sections are refused with "Export a single config from PrusaSlicer
  (File, Export, Export Config) and import that."
- `shapeFromPolygon(points)`: an axis-aligned rectangle from its bounding box when the polygon
  is a rectangle; `round` when there are 8 or more points that sit at an equal distance
  (within 0.5 mm) from their centroid, with the diameter as width and depth; otherwise the
  bounding box with the warning "The bed outline is not a rectangle or circle; Loom uses its
  bounding box."
- A bed whose origin is not at 0,0 (PrusaSlicer deltas use a centred origin, for example
  `-90x-90`) is normalised so offsets stay measured from the front-left corner.

The H2D machine profile in Bambu Studio 02.08.04.57 gives `printable_area`
`0x0,350x0,350x320,0x320`, `extruder_printable_area`
`["0x0,325x0,325x320,0x320","25x0,350x0,350x320,25x320"]` and `extruder_printable_height`
`["320","325"]`, which the parser turns into L34's two zones. These are the test fixtures.

### Shared slicer profile module

`flattenProfile` is the same operation L47 needs to slice with installed profiles. Whichever of
L47 or L51 lands first creates `apps/server/src/fork/model-preview-3d/slicer/profiles.ts` with
the definitions in L47 TECHNICAL.md, "Profiles"; the other imports it. L51 uses only
`slicerProfileRoots(app, home, executable)` and `flattenProfile(roots, "machine", name)`.

## Storage

One new row in the existing key/value table: `fork_model_preview_3d_settings` with
`key = 'printers'` and the encoded `PrinterLibrary` as `value_json`. `store.ts` gains
`getPrinters()` (returns `Option`) and `savePrinters(value)`, written like
`getSettings`/`updateSettings` (`store.ts:46-62`). No migration id is needed because the
table exists. The value is at most about 300 KB at the limits; typical libraries are a few
kilobytes.

## Clients

### Shared atoms

`packages/client-runtime/src/fork/model-preview-3d.ts` gains `printers`
(`createEnvironmentRpcQueryAtomFamily` on `M.printers`), `updatePrinters` and
`parsePrinterProfile` (`createEnvironmentRpcCommand`), following `settings` and
`updateSettings` (`:59-62`, `:83-86`). After a successful update the web refreshes the
`printers` atom, as the settings form refreshes settings today.

### Web

- `usePrinterLibrary(environmentId)` in a new `apps/web/src/fork/model-preview-3d/printers.ts`
  returns the loaded library or `undefined`. Callers pass it to `bedGroups`, `resolvePlate`
  and `buildPlateLabel`. Call sites: `ModelPanel.tsx:443`, `BedPicker.tsx:124-126` and `:149`,
  `ModelInspector.tsx:288` and `:306`, `SettingsSection.tsx:195` and `:198`, plus any L32 and
  L34 add. `BedPicker.tsx:125` and `SettingsSection.tsx:238-240` switch to `activeBed(...).note`.
- `viewer/bed.ts`: `createBed(width, depth, pattern, shape = "rectangle")`. A round bed draws a
  circle outline (64 segments) and clips grid lines to the circle in `bedLines`. `setBed` in
  `createViewer.ts:410` takes the shape from `Plate`. One extra argument; no factory change.
- Fit on a round bed: the part fits when its footprint's diagonal is at most the diameter and
  its height fits. This goes into L32's `fitOnBed` as one branch, conservative by design.
- `PrintersSection.tsx` (new), rendered by `SettingsSection.tsx` in place of the Bed row's
  custom size block and of L33's `ManageBeds.tsx` if present:
  - Groups "Your printers", "Printers", "Surfaces"; each row shows name, size
    (`formatVolume`), nozzles and tags ("Built in", "Imported from Bambu Studio", "Hidden").
  - Row actions in a menu: "Edit" (user rows), "Duplicate", "Hide"/"Show" (built-ins),
    "Delete" (user rows). Delete shows a toast with "Undo" that re-saves the previous library.
  - "Add printer", "Add surface", "Import printer profile" (a hidden
    `<input type="file" accept=".json,.ini">`; the file is read with `File.text()` and sent to
    `parsePrinterProfile`; files over 2 MiB are refused in the browser).
  - `PrinterEditor.tsx` (new): a `Dialog` with name, kind, width, depth, height or "No height
    limit", "Round bed", nozzle sizes (comma-separated input), materials (checkbox list) and
    default material, zones (rows of label, offset and size; "Add zone"), notes. Field messages
    come from `libraryProblems`. "Save" calls `updatePrinters` with the current version.
- `MaterialsSection.tsx` (new): a table of materials with inline edit of name, type, brand,
  colour, density, cost per kg and temperature ranges; "Add material", "Duplicate", "Delete".
  A material in use by a printer shows "Used by 2 printers" and asks before deleting.
- "Export library" downloads `loom-printers.json` (a `Blob`, an object URL and an
  `<a download>` click, like `downloadMedia` in
  `apps/web/src/components/media/mediaContent.ts:29-39`; reuse L44's `saveImage` if it has
  landed, since it takes any `Blob`). "Import library" reads a file, decodes `PrinterExport`, and merges:
  new ids are added, existing ids are kept (counted in the toast), all in one
  `updatePrinters` call.
- The Bed menu (`BedPicker.tsx`) gains "Manage printers" at the bottom, a link to
  `/settings/loom` as `ModelInspector.tsx:326` does.

### Export format

```ts
export const PrinterExport = Schema.Struct({
  format: Schema.Literal("loom.printers"),
  version: Schema.Literal(1),
  exportedAt: Schema.String,
  printers: PrinterLibrary.fields.printers,
  materials: PrinterLibrary.fields.materials,
});
```

It maps onto the Fabrication app's planned tables
(`~/Developer/docs/apps/fabrication/ARCHITECTURE.md:221-240`, `:342-357`):

| Loom field                             | Fabrication column             | Notes                                                          |
| -------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| `Printer.id`                           | `printers.id`                  | Built-in ids match Fabrication preset ids (`bambu-h2d`).       |
| `name`                                 | `name`                         |                                                                |
| `nozzlesMm[0]`                         | `nozzle_mm`                    | Fabrication stores one nozzle; the first is the installed one. |
| `volumeMm`                             | `build_volume_json`            | `[x, y, z]`; Fabrication needs a number for z.                 |
| `source.app`                           | `slicer`                       | `bambu-studio` to `bambu_studio` and so on.                    |
| `Material.id`, `name`, `type`, `brand` | same names                     |                                                                |
| `colorHex`                             | `color_hex`                    |                                                                |
| `densityGCm3`                          | `density_g_cm3`                |                                                                |
| `costPerKg`                            | `cost_per_kg`                  |                                                                |
| `nozzleC`                              | `nozzle_min_c`, `nozzle_max_c` | Fabrication requires them; null means its import asks.         |
| `bedC`                                 | `bed_min_c`, `bed_max_c`       | As above.                                                      |
| `notes`                                | `notes`                        |                                                                |

Fields Fabrication has and Loom does not (driver, host, credentials, policy, spools) are
printer control and stay out of Loom.

### Mobile

None. Mobile has no 3D panel or 3D settings.

## Agent-facing tools

Three tools in `apps/server/src/fork/model-preview-3d/mcp.ts`, each calling one service
method, gated by `agentToolEnabled` like the editor tool (`mcp.ts:241-245`):

- `loom_model_preview_3d_printers` (readonly, `readsAsCaller`): returns the library plus the
  built-ins, so an agent sees every bed id it can select with `save_settings`.
- `loom_model_preview_3d_save_printers` (`writesEnvironment`, like `save_settings` at
  `mcp.ts:438`): takes `PrinterLibraryUpdate`. The description says to read first and pass
  `expectedVersion`.
- `loom_model_preview_3d_read_printer_profile` (readonly): takes a workspace-relative path to
  a `.json` or `.ini` profile, resolves it with `resolveFile`, and returns a
  `PrinterProfileDraft` for the agent to review and save.

Agents need these so "add my Voron 350 with a 0.6 nozzle and PETG at 24 per kilo" is one
request, and so L47 and L46 answers can name a printer the user defined.

## Performance

The library is loaded once per environment by a query atom and is a few kilobytes. Bed menus
render at most 64 rows. Nothing animates. A round bed adds one 64-segment line loop to the
viewer and is drawn only on demand, like the rest of the bed. Profile files are capped at
2 MiB and parsed once.

## Alternatives considered

- **A `printers.json` file under `<stateDir>/fork/model-preview-3d/`** (the PCB pattern).
  Easier to edit by hand, but needs atomic writes and a lock outside the database the rest of
  the 3D settings live in. The key/value row is simpler. Kyle may prefer the file; switching is
  confined to `store.ts`.
- **Keep beds inside the settings row.** Every settings save would carry the library, an
  older client would drop it on save, and settings have no version to detect conflicts.
- **A new `bedId` selection field.** Clearer, but an older client or server would not know it
  and would fall back unpredictably. Reusing L33's `customBedId` keeps one way to select a
  user entry.
- **Store built-ins in the library too.** Then a Loom update could not fix a wrong number in a
  built-in without a data migration. Duplicating covers the "I want different numbers" case.
- **Read every installed slicer profile into the library automatically.** Hundreds of vendor
  printers would swamp the menus and the 64-bed cap. One reviewed import at a time is enough.
- **Parse profiles in the browser.** Bambu and Orca profiles inherit from files that exist only
  on the host, so the server has to flatten them anyway.
