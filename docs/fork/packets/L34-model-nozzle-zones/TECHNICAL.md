# L34 technical design

Cited lines are from `feat/model-bed-picker` at `8676e099e5`.

## Overview

Zones are static vendor data on two presets. Everything else is derived from them by pure
functions in contracts: the area both nozzles reach, the strips only one reaches, and a
zone-aware fit. The viewer draws the strips as extra flat meshes inside the existing bed group,
so placement, visibility, theme and captures follow the bed with no new render path. One
boolean setting turns the tint off.

## Before this batch

- The H2D and H2C presets have an outer `volumeMm` and a free-text `note`
  (`packages/contracts/src/fork/model-preview-3d.ts:155-168`). The notes were corrected to the
  slicer profiles in `1f901fdd6e` (see PRODUCT.md, "Decisions").
- `resolvePlate` returns `{ volume, pattern }` (`apps/web/src/fork/model-preview-3d/
buildPlate.ts:12-16`); `ModelPanel.tsx:443` memoises it.
- Fit is `fitsBuildVolume(size, volume)` against the outer volume (`buildPlate.ts:50-52`), used by
  Part (`ModelInspector.tsx:362-370`, card at `:387-423`) and the status bar
  (`ModelPanel.tsx:695`, `:1146-1150`). L32 replaces it with `fitOnBed`.
- The bed is a `Group` of a fill mesh (`renderOrder` -4) and three line sets (-3 to -1), all
  with `depthTest` and `depthWrite` off, centred on the origin (`viewer/bed.ts:59-94`). The
  viewer places it under the part's footprint centre at the part's lowest Z
  (`viewer/createViewer.ts:432-440`), re-themes it from a class observer (`:379-390`), and
  `setBed(footprint, pattern)` rebuilds it (`:410-430`). `ViewerCanvas.tsx:99-101` and
  `VariantsInspector.tsx:721` call `setBed`.
- Part draws a to-scale top view of the plate in SVG (`ModelInspector.tsx:184-272`).

## Contracts

In `packages/contracts/src/fork/model-beds.ts` (created by the first of L32, L33, L34; see L32
TECHNICAL.md, "Bed list in contracts").

### Zone data

The shared shape from MODEL-3D-FOLLOW-UPS.md ("Bed source"), plus an optional height:

```ts
export type BedZone = {
  readonly id: string;
  readonly label: string;
  /** Width and depth this nozzle reaches, in mm. */
  readonly footprintMm: readonly [number, number];
  /** From the bed's front-left corner (X right, Y back), in mm. */
  readonly offsetMm: readonly [number, number];
  /** Highest Z this nozzle prints, in mm. Absent means the bed's height. */
  readonly heightMm?: number;
};
```

`heightMm` is needed because the left nozzle stops at 320 mm and the right at 325 mm; without it
a 323 mm part would be told it fits with both nozzles. It is optional, so the shared shape stays
valid and L51 can add it to its schema as an optional field. MODEL-3D-FOLLOW-UPS.md is updated
to list it.

`BuildPlatePreset` and `Bed` in the existing `model-beds.ts` gain `zones?: readonly BedZone[]`,
filled by `listBeds` from the preset. Data, from Bambu Studio's machine profiles
(REFERENCES.md):

```ts
"bambu-h2d": { ..., zones: [
  { id: "left", label: "Left nozzle", footprintMm: [325, 320], offsetMm: [0, 0], heightMm: 320 },
  { id: "right", label: "Right nozzle", footprintMm: [325, 320], offsetMm: [25, 0],
    heightMm: 325 },
] },
"bambu-h2c": { ..., zones: [
  { id: "left", label: "Left nozzle", footprintMm: [325, 320], offsetMm: [0, 0], heightMm: 320 },
  { id: "right", label: "Right nozzle", footprintMm: [305, 320], offsetMm: [25, 0],
    heightMm: 325 },
] },
```

The notes already match PRODUCT.md, "Decisions" (`1f901fdd6e`). `volumeMm` is unchanged.

### Geometry

```ts
export type ZoneRect = { readonly offsetMm: readonly [number, number];
  readonly footprintMm: readonly [number, number] };
/** Where every zone reaches, with the lowest zone height; null when zones do not overlap. */
export const sharedZone = (zones: readonly BedZone[], bedHeight: number | null):
  (ZoneRect & { readonly heightMm: number | null }) | null;
/** Bed areas only one zone reaches, for drawing: each zone's rectangle minus sharedZone. */
export const singleZoneStrips = (zones: readonly BedZone[]):
  readonly (ZoneRect & { readonly zoneId: string })[];
```

`singleZoneStrips` subtracts one axis-aligned rectangle from another, giving up to four slabs
per zone; empty slabs (under `1e-6` mm) are dropped. For the H2D it returns left X 0 to 25 and
right X 325 to 350, both full depth; for the H2C, left X 0 to 25 and right X 325 to 330.

### Fit

```ts
export type ZoneFit =
  /** Inside the area every nozzle reaches. */
  | { readonly reach: "all-zones" }
  /** Inside these nozzles' reach, but not the shared area. */
  | { readonly reach: "one-zone"; readonly zoneIds: readonly string[] }
  /** Only across the whole bed, with every nozzle printing the same filament. */
  | { readonly reach: "whole-bed" };
export type BedFitResult = {
  readonly fit: BedFit;               // L32's union
  readonly zone: ZoneFit | null;      // null for beds without zones, and when too big
  /** The volume the answer was measured against, for clearance text. */
  readonly withinMm: BedVolume;
};
export const fitBed = (size: readonly [number, number, number],
  bed: { readonly volumeMm: BedVolume; readonly zones?: readonly BedZone[] }): BedFitResult;
```

Rules, each test using L32's `fitOnBed` (so a quarter turn is always considered):

1. No zones: `{ fit: fitOnBed(size, volumeMm), zone: null, withinMm: volumeMm }`.
2. Candidates, in order: the shared zone; each zone (its own height, or the bed's); the whole
   bed footprint at the lowest zone height (`[w, d, min heights]`).
3. The shared zone fits: `reach: "all-zones"`.
4. Otherwise, if any single zone fits: `reach: "one-zone"` with every fitting zone's id, in data
   order. `fit` is `"fits"` if any of them fits unturned, else `"fits-rotated"`.
5. Otherwise the whole-bed candidate fits: `reach: "whole-bed"`.
6. Otherwise `"too-big"` with the `overMm` of the candidate whose overages sum lowest (first in
   order on a tie), `zone: null`. A 200 x 200 x 330 mm part on the H2D reports 5 mm too tall
   (right nozzle); a 340 x 200 x 324 mm part reports 4 mm too tall (whole bed at 320 mm).

`fitBed` replaces `fitOnBed` at the bed level in L32's `bedFitSummary`, the Part fit list and
card, and the status bar check. `fitOnBed` stays as the per-volume primitive.

### Setting

`BuildPlateSetting` gains
`showZones: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true)))`, and
`DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate` gains `showZones: true`. If L33 has landed,
`BuildPlateSettingUpdate` gets `showZones: Schema.optionalKey(Schema.Boolean)`. If L33 lands
later, it adds that line.

### Agent summary (with L32)

Each row of L32's `BedFitSummary.beds` gains

```ts
zone: Schema.optionalKey(Schema.NullOr(Schema.Struct({
  reach: Schema.Literals(["all-zones", "one-zone", "whole-bed"]),
  zoneIds: Schema.Array(Schema.String),   // empty unless reach is "one-zone"
}))),
```

set only for beds with zones. Editor snapshots and host render summaries both use the same
`bedFitSummary` helper. Hiding zone tint leaves the fit answer unchanged. The render tool description (`apps/server/src/fork/model-preview-3d/
mcp.ts:182-183`, as extended by L32) appends: "For printers with two nozzles, zone.reach says
whether the part fits where both nozzles reach, only one nozzle's reach (zoneIds), or only
across the whole bed with the same filament in both nozzles."

Without L32 there is no summary and no server change; the step is done by whichever packet lands
second.

## Server

No new code. `renderImages` already computes the summary through `bedFitSummary` (L32), which
now calls `fitBed`. `loom_model_preview_3d_save_settings` accepts `showZones` through the schema.

## Clients

### Plate

`Plate` (`buildPlate.ts:12`) gains `zones: readonly BedZone[]` (the active bed's, empty if
none) and `showZones: boolean`. `resolvePlate` fills both from `activeBed(setting)`.
`ModelPanel.tsx:443` already memoises the plate on the setting, so the viewer effect runs only on
real changes.

Web helpers in `buildPlate.ts`:

- `fitPlate(size, plate) = fitBed(size, { volumeMm: plate.volume, zones: plate.zones })`.
- `describeZoneFit(result, zones, format): { short: string; long: string } | null`, null for
  beds without zones. Short forms for list rows: "Both nozzles", "Left nozzle only", "Right
  nozzle only", "Either nozzle, not both", "Same filament in both nozzles". Long forms are the
  PRODUCT.md sentences; the both-nozzle size comes from `sharedZone` through `format`. The word
  "both" is used when there are two zones, "every" otherwise.

### Viewport

New `apps/web/src/fork/model-preview-3d/viewer/zones.ts`:

```ts
/** Where a strip's plane sits in bed coordinates (bed centred on the origin). */
export const stripPlacement = (bed: readonly [number, number], strip: ZoneRect) => ({
  x: -bed[0] / 2 + strip.offsetMm[0] + strip.footprintMm[0] / 2,
  y: -bed[1] / 2 + strip.offsetMm[1] + strip.footprintMm[1] / 2,
});
export const ZONE_TINT = { dark: 0x262236, light: 0xdcd6ea };
/** Flat tinted planes for the single-nozzle strips, drawn above the fill and under the grid. */
export function createZoneStrips(
  bed: readonly [number, number],
  strips: readonly ZoneRect[],
): { object: Group; setTheme(dark: boolean): void; dispose(): void };
```

Each strip is a `PlaneGeometry` with an opaque `MeshBasicMaterial` using the bed's flat flags
(`depthTest: false, depthWrite: false`) and `renderOrder` -3.5, between the fill (-4) and the
minor lines (-3). The front-left corner is `(-w/2, -d/2)` because the front view looks from -Y
(`viewer/views.ts:7`), so X 0 to 25 is on the viewer's left in the front view, as on
the printer. Starting colours are given above; tune them so the strip is visible but quieter
than the major grid lines in both themes.

`createViewer.setBed` gains an optional third parameter
`strips: readonly ZoneRect[] = []`. After `createBed(...)` it builds `createZoneStrips` when
`strips.length > 0` and adds its object to `bed.object`, so `placeBed`, `gridVisible` and
captures apply unchanged. `bed.setTheme` and `bed.dispose` call through to the strips (one line
each in the factory's existing bed handling). `VariantsInspector.tsx:721` keeps two arguments:
variant thumbnails stay plain.

`ViewerCanvas.tsx:100` passes `plate.showZones ? singleZoneStrips(plate.zones) : []`.

### Part

- `PlateFit` (`ModelInspector.tsx:184-272`) takes `strips` and draws each as a `rect` before the
  grid lines, `fill="color-mix(in oklab, var(--muted-foreground) 14%, var(--muted))"`, no stroke.
  SVG Y grows toward the front, so `y = oy + by - offsetMm[1] - footprintMm[1]`.
- The fit card uses `fitPlate`. Its clearance sentence measures against `withinMm`. When
  `describeZoneFit` returns text, its long form follows the existing sentence.
- L32's list rows show the short form in place of "Fits" for the H2D and H2C.
- The status bar and badge use `fitPlate(...).fit.status !== "fits"`, so rotated fits show
  the existing placement warning as well as parts that exceed the bed.

### Bed menu (`BedPicker.tsx`)

When `activeBed(plate).zones` is non-empty:

- A "Show nozzle zones" `Switch` after the pattern control, saving `{ ...plate, showZones }`.
- In the note area (`BedPicker.tsx:182-186`): two legend lines with swatches, "Both nozzles
  300 × 320 × 320 mm" (plain swatch) and "One nozzle only" (tint swatch, hidden when zones are
  off), then the corrected preset note and "Move parts in the slicer; Loom centres the plate
  under the part." Swatches use a `.model-zone-swatch` class in `workspace.module.css` with the
  same colours as `ZONE_TINT` in light and dark; a comment in each place names the other.

### Settings (`SettingsSection.tsx`)

The same switch after the pattern select (`:244-270`), shown when the form's active bed has
zones, saved with "Save settings".

### Mobile

None.

## Agent-facing tools

- Render tool: zone-aware rows in the fit summary (with L32).
- Settings tools: `showZones` read and written like other bed fields.
- Editor tool: captures include the strips when shown. No new editor action; the tint is a
  setting, like the pattern, not a per-view display mode.

## Performance

At most four extra planes, built only when the bed changes. No new subscriptions, no draw loop,
no work per frame. Fit runs at most three extra `fitOnBed` calls per bed.

## Alternatives considered

- **Draw each nozzle's reach as an outline.** Three overlapping rectangles on a gridded plate
  read as clutter, and the useful information is where one nozzle cannot go.
- **A "two materials" toggle that changes the fit answer.** Loom does not know the filaments;
  reporting every level is honest and needs no state.
- **Place the part where the slicer would.** Changes L23's placement, which keeps measurements and
  sections in model coordinates. Out of scope.
- **Use the store page's 325 mm both-nozzle height.** Contradicted by the slicer profile and the
  current spec pages.
- **Change `volumeMm` to the both-nozzle box.** Would mislabel single-nozzle prints as too big
  and change the vendor envelope users recognise.
