# L32 technical design

Cited lines are from `feat/model-bed-picker` at `8676e099e5`.

## Overview

One pure function decides fit for one part on one bed. One pure function lists the beds. Both
live in contracts so the web Part tab and the server render tool give the same answer from the
same data:

```text
contracts/fork/model-beds.ts   listBeds(setting) -> Bed[]     fitOnBed(size, volume) -> BedFit
            |                         bedFitSummary(size, setting) -> BedFitSummary
            v
web buildPlate.ts (bedGroups, resolvePlate wrap listBeds)   server renderImages (adds `fit`)
web BedFitList.tsx in Part                                   MCP render tool result
web editor snapshot `state.fit`
```

## Today

- Bed data: `BUILD_PLATE_PRESETS`, `BuildPlatePresetId`, `BuildPlatePattern` and
  `BuildPlateSetting` in `packages/contracts/src/fork/model-preview-3d.ts:141-238`.
- Web bed helpers: `resolveBuildVolume`, `resolvePlate`, `buildPlateLabel`, `formatVolume`,
  `bedGroups`, `fitsBuildVolume` in `apps/web/src/fork/model-preview-3d/buildPlate.ts:9-52`.
- Rotation is considered about Z by 90 degrees only. Since `1f901fdd6e`, the web helper
  `bedFit(size, volume)` in `buildPlate.ts` returns `"fits" | "rotated" | "too-large"`. The
  Part tab chip says "Fits rotated" and its advice "It fits if you rotate it 90° on the plate.",
  the status bar says "Fits if rotated 90°", and variant chips say "Fits rotated". The warning
  tone and the Part badge stay, because the part does not fit as drawn. This packet replaces
  the web `bedFit` and its `BedFit` type with `fitOnBed` below and keeps those labels.
- Bed notes are read through `buildPlateNote()` in `buildPlate.ts` (used by `BedPicker.tsx` and
  `SettingsSection.tsx`); only `buildPlate.ts` reads `BUILD_PLATE_PRESETS`. This packet routes
  `buildPlateNote()` through `activeBed()`.
- The server never reads the bed setting today (`rg buildPlate apps/server` finds nothing).
- The render tool returns `{ images, summary, log }` (`apps/server/src/fork/model-preview-3d/
mcp.ts:181-200`). `summary.boundingBox` is `{ min, max }` from OpenSCAD's `--summary-file`
  (`apps/server/src/fork/model-preview-3d/openscad.ts:96-109`), present only when the build
  supports summaries (`ModelPreviewService.ts:1179-1188`).
- The editor `snapshot` returns camera, revision and `state` (`ModelPanel.tsx:376-410`);
  `ModelEditorState` has no size (`packages/contracts/src/fork/model-editor.ts:65-82`).

## Bed list in contracts (shared with L33 and L34)

MODEL-3D-FOLLOW-UPS.md says code lists beds through `bedGroups()` and `resolvePlate()` in the
web's `buildPlate.ts`. The server cannot import web code, and the agent fit summary needs the
list on the server. So the bed data and the list move to a new fork-owned contracts file,
`packages/contracts/src/fork/model-beds.ts`, and `buildPlate.ts` keeps its names as thin
wrappers. Whichever of L32, L33 or L34 lands first does this move exactly as written here; the
others then edit `model-beds.ts`.

Move, unchanged, from `model-preview-3d.ts:141-238` to `model-beds.ts`: the `BuildPlatePreset`
type, `BUILD_PLATE_PRESETS`, `BuildPlatePresetId`, `BuildPlatePattern`, `BuildPlateSetting` and
their `export type` lines (`model-preview-3d.ts:292-294`). `model-preview-3d.ts` imports
`BuildPlateSetting` from `./model-beds.ts` for `ModelPreviewSettings`. Add
`export * from "./model-beds.ts";` to `packages/contracts/src/fork/index.ts`. Every consumer
imports from `@t3tools/contracts/fork`, so no import changes elsewhere. `model-beds.ts` imports
only `effect`, which keeps `model-editor.ts` free to import it without a cycle
(`model-preview-3d.ts` already imports `model-editor.ts`, line 1).

Then add the list:

```ts
export type BedVolume = readonly [number, number, number | null];
export type Bed = {
  readonly id: string; // a BuildPlatePresetId or "custom"; L33 adds custom bed ids
  readonly label: string;
  readonly kind: "printer" | "surface" | "custom";
  readonly volumeMm: BedVolume;
  readonly note: string | null;
};
/** Every bed the user can choose, in menu order: printers, surfaces, custom. */
export const listBeds = (setting: BuildPlateSetting): readonly Bed[] => ...;
/** The bed the setting points at. Always one of listBeds(setting). */
export const activeBed = (setting: BuildPlateSetting): Bed => ...;
/** The setting with `id` made active, keeping pattern and custom sizes. */
export const selectBed = (setting: BuildPlateSetting, id: string): BuildPlateSetting => ...;
```

Without L33, `listBeds` returns the presets in table order followed by
`{ id: "custom", label: "Custom", kind: "custom", volumeMm: setting.customMm, note: null }`,
`activeBed` finds `setting.preset`, and `selectBed` returns `{ ...setting, preset: id }` for a
known id and the setting unchanged otherwise. L33 changes the bodies, not the signatures.

`buildPlate.ts` then becomes:

- `BuildVolume` = `BedVolume` (type alias, keeps existing imports compiling).
- `resolveBuildVolume(setting)` = `activeBed(setting).volumeMm`; `resolvePlate` unchanged in shape.
- `buildPlateLabel(setting)` = `activeBed(setting).label`, except that the custom slot keeps
  reading "Custom bed" as today (`buildPlate.ts:17-18`).
- `bedGroups(setting)` groups `listBeds(setting)` by kind under "Printers", "Surfaces",
  "Custom". The parameter changes from `customMm` to the whole setting; the three callers
  (`BedPicker.tsx:149`, `ModelInspector.tsx:306`, `SettingsSection.tsx:198`) pass the setting.
- `fitsBuildVolume` stays, implemented as `fitOnBed(size, volume).status === "fits"`.

## Fit

```ts
export type BedFit =
  | { readonly status: "fits" }
  | { readonly status: "fits-rotated" }
  /** Overage per axis for the part as placed, in mm; 0 where it fits. */
  | { readonly status: "too-big"; readonly overMm: readonly [number, number, number] };

export const fitOnBed = (size: readonly [number, number, number], volume: BedVolume): BedFit
```

Rules, with the existing tolerance of `1e-6` mm (`buildPlate.ts:52`):

1. Height: `volume[2] === null` (a surface) always passes; otherwise `size[2] <= volume[2]`.
2. "fits" when height passes and `size[0] <= volume[0]` and `size[1] <= volume[1]`.
3. "fits-rotated" when height passes and `size[1] <= volume[0]` and `size[0] <= volume[1]`.
4. Otherwise "too-big" with `overMm[i] = max(0, size[i] - volume[i])` (0 for a null height).
   A part too tall for the bed is "too-big" even if its footprint fits either way.

The rotated check uses the part's axis-aligned box rotated by 90 degrees, which is exact for a
quarter turn. `size` is world space after any orientation (L35 keeps `stats.size` in world
space), so this packet never rotates anything itself.

The web formats a fit with one helper in `buildPlate.ts`:

```ts
/** "Fits", "Fits rotated", or "12.0 mm too wide, 3.0 mm too tall". */
export const describeFit = (fit: BedFit, format: (mm: number) => string): string => ...;
```

It uses the `OVER` words now in `ModelInspector.tsx:180` (move them to `buildPlate.ts`) for every
axis with an overage above `1e-6`. Until L40 lands, `format` prints one decimal and " mm", as
`ModelInspector.tsx:412` does; after L40 it is `formatLength(mm, units)`. Part's
existing advice sentence (`ModelInspector.tsx:404-421`) switches to `fitOnBed` for its
`rotated` flag so the card and the list share one rule.

## Agent summary

Schema in `model-beds.ts`:

```ts
const mm = Schema.Number.check(Schema.isFinite());
export const BedFitSummary = Schema.Struct({
  /** Part size in mm (X, Y, Z), world space. */
  sizeMm: Schema.Tuple([mm, mm, mm]),
  activeBedId: Schema.String,
  beds: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      kind: Schema.Literals(["printer", "surface", "custom"]),
      volumeMm: Schema.Tuple([mm, mm, Schema.NullOr(mm)]),
      fit: Schema.Literals(["fits", "fits-rotated", "too-big"]),
      overMm: Schema.NullOr(Schema.Tuple([mm, mm, mm])),
    }),
  ).check(Schema.isMaxLength(64)),
});
export type BedFitSummary = typeof BedFitSummary.Type;
export const bedFitSummary = (size: readonly [number, number, number],
  setting: BuildPlateSetting): BedFitSummary => ...;
```

The 64 cap covers 14 presets plus L33's 24 custom beds with room for L51. L34 adds an optional
`zone` field to each row; optional fields keep this schema compatible.

### Render tool

`ModelPreviewService.renderImages` (`ModelPreviewService.ts:1104-1260`) already holds `settings`.
After `parseSummary`, it computes:

```ts
const box = summary?.boundingBox;
const fit =
  box && box.min.length === 3 && box.max.length === 3
    ? bedFitSummary(
        [0, 1, 2].map((i) => box.max[i]! - box.min[i]!),
        settings.buildPlate,
      )
    : null;
return { images, log, summary, fit };
```

The service method returns it, so the MCP handler stays a thin call (`mcp.ts:212-227`). The tool
success schema (`mcp.ts:190-195`) gains `fit: Schema.NullOr(W.BedFitSummary)`. The tool
description appends: "Includes a fit summary for the user's beds (sizes in mm), or null when this
OpenSCAD build gives no geometry summary." Beds hidden by L33 are left out; the active bed is
always in the list.

OpenSCAD's bounding box is of the rendered geometry in file coordinates. For STL, OBJ and 3MF the
wrapper scales imports to mm first (`ModelPreviewService.ts:1157-1163`), so sizes match what the
viewer shows. When L35 lands, its server-side rotation of the render makes this box world space;
this packet adds nothing for orientation.

### Editor snapshot

`ModelEditorState` (`model-editor.ts:65-82`) gains `fit: Schema.optional(BedFitSummary)`. In the
`snapshot` branch (`ModelPanel.tsx:386-410`) the panel adds
`fit: bedFitSummary(stats.size, settings.buildPlate)` when `stats` exists. This answers fit for
glTF and GLB, which the render tool does not take, and reflects the live orientation. The field
is optional, so an older panel replying to a newer server, or the reverse, still decodes.

## Contracts

| File                                              | Change                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/model-beds.ts`       | New: moved bed schemas, `listBeds`, `activeBed`, `selectBed`, `fitOnBed`, `BedFitSummary`, `bedFitSummary`. |
| `packages/contracts/src/fork/model-preview-3d.ts` | Bed definitions removed; imports `BuildPlateSetting`.                                                       |
| `packages/contracts/src/fork/model-editor.ts`     | `ModelEditorState.fit` optional.                                                                            |
| `packages/contracts/src/fork/index.ts`            | `export * from "./model-beds.ts";`                                                                          |

No persisted schema changes: settings and workspace are untouched.

## Server

Only `ModelPreviewService.renderImages` and the render tool schema and description in `mcp.ts`.
No new service, RPC, table or file.

## Storage

None.

## Clients

- `apps/web/src/fork/model-preview-3d/BedFitList.tsx` (new): props `environmentId`, `settings`,
  `size`. Uses `useBuildPlate(environmentId, settings)` (`BedPicker.tsx:44-69`) for the pending
  plate, `canSave` and `save`. Rows come from `listBeds(plate)` with
  `fitOnBed(size, bed.volumeMm)` in one `useMemo` keyed on `size` and `plate`. Clicking a row
  calls `save(selectBed(plate, bed.id))`.
- Markup: `SectionHead` titled "Which beds fit?" with a `Chip` "Fits N of M" (fits and
  fits-rotated both count). Then a `<ul>` of `<button type="button" aria-pressed={active}>`
  rows, each with the bed label, its size from `formatVolume` in muted tabular numbers, and the
  status: `Chip tone="success"` "Fits", `Chip` "Fits rotated", or the overage text in the
  warning colour. The active row shows "Active" and is not a button target. Group labels
  ("Printers", "Surfaces", "Custom") as small headings, the same as the menus.
- When `!canSave`, the rows render as plain list items with the existing tip.
- `PartSection` (`ModelInspector.tsx:336-490`) renders `<BedFitList>` after the fit card
  (`ModelInspector.tsx:387-423`) and before the facts list. Styles go in
  `workspace.module.css` under a `model-bed-fit-*` prefix, reusing `model-row-name` and
  `model-row-detail` text styles. No accent edges: the active row uses a filled muted
  background.
- Mobile: none.

## Agent-facing tools

- `loom_model_preview_3d_render`: gains `fit` (above). Lengths stay in millimetres.
- `loom_model_preview_3d_editor` with `snapshot`: gains `state.fit`.
- Selecting a bed: agents already can with `loom_model_preview_3d_save_settings`. No new tool.

## Performance

`fitOnBed` is a handful of comparisons; the list recomputes only when the part size or bed
setting changes, on at most 64 beds. No viewer work, no animation. The summary adds under 6 KB
to an MCP response at the 64-bed cap and nothing to any WebSocket subscription.

## Alternatives considered

- **Arbitrary angle about Z.** A p by q footprint (p >= q) fits an a by b bed (a >= b) at some
  angle when it fits straight, or when p > a and
  `b >= (2pqa + (p^2 - q^2) * sqrt(p^2 + q^2 - a^2)) / (p^2 + q^2)` (Carver's condition, see
  REFERENCES.md). It helps only long thin parts on nearly square beds, the answer is hard to act
  on without a placement preview, and the slicer may not find the same angle. Add it later as a
  third status "Fits diagonally" in `fitOnBed` if Kyle wants it; the UI and schema take one more
  literal.
- **Sort fitting beds first.** Rejected: rows reorder on every reload. The count chip gives the
  summary.
- **Keep the bed list in the web and send it to the server.** Rejected: agents would get
  different beds depending on whether a panel is open.
- **A new MCP tool `loom_model_preview_3d_fit`.** Rejected: the render tool already produces the
  size, and agents usually render first.
