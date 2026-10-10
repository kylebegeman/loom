# L40 technical design

Cited lines are from `feat/model-bed-picker` at `8676e099e5`.

## Overview

One setting, one module. `displayUnits` joins `ModelPreviewSettings` with a decoding default.
`units.ts` converts and formats; a React context carries the current unit (with an optimistic
pending value) from the model panel and the settings form to every component below them. Each
length site in the inventory swaps its `toFixed(...) mm` for `formatLength`. Inputs convert at
their edges, so everything stored, sent or returned stays in millimetres.

## Contracts

In `packages/contracts/src/fork/model-preview-3d.ts`:

```ts
export const DisplayUnits = Schema.Literals(["mm", "in"]);
export type DisplayUnits = typeof DisplayUnits.Type;
// in ModelPreviewSettings (:240-262)
/** Units for lengths shown in the 3D panel. Display only: data and tools stay in mm. */
displayUnits: DisplayUnits.pipe(Schema.withDecodingDefault(Effect.succeed("mm"))),
```

`DEFAULT_MODEL_PREVIEW_SETTINGS` (`:297-306`) gains `displayUnits: "mm"`. If L33 has landed,
`ModelPreviewSettingsUpdate` gets `displayUnits: Schema.optionalKey(DisplayUnits)`; if L33
lands later, it adds that line. Without L33, a client that predates this packet saves the full
settings without the field, which decodes back to `"mm"`. That only happens with a mismatched
client and server and is harmless.

No other contract changes. Tool inputs and outputs keep their millimetre fields.

## Server

- No service code. The setting is stored in the existing JSON settings row and decoded with the
  default (`apps/server/src/fork/model-preview-3d/store.ts:46-58`).
- `loom_model_preview_3d_save_settings` description (`mcp.ts:143`) becomes: "Update 3D preview
  settings, including build volume, OpenSCAD path and display units. displayUnits only changes
  what the user sees; every tool reads and writes millimetres."
- The editor tool description (`mcp.ts:15-16`) appends: "Lengths are in millimetres."

## Clients

### `apps/web/src/fork/model-preview-3d/units.ts` (new)

```ts
export const MM_PER_INCH = 25.4;
export const fromMm = (mm: number, units: DisplayUnits) => (units === "in" ? mm / MM_PER_INCH : mm);
export const toMm = (value: number, units: DisplayUnits) =>
  units === "in" ? value * MM_PER_INCH : value;
export type LengthOptions = {
  /** Decimals in millimetres (default 1). Inches get one more. */
  digits?: number;
  /** Drop trailing zeros, for bed sizes ("11 × 8.5 in"). */
  trim?: boolean;
  /** Append " mm" or " in" (default true). */
  unit?: boolean;
};
export function formatLength(mm: number, units: DisplayUnits, options?: LengthOptions): string;
/** Several lengths with one unit suffix: "350 × 320 × 325 mm". Nulls are skipped. */
export function formatLengths(
  values: readonly (number | null)[],
  units: DisplayUnits,
  options?: LengthOptions,
): string;
export const unitSuffix = (units: DisplayUnits) => units; // "mm" or "in"
export const unitName = (units: DisplayUnits) => (units === "in" ? "inches" : "millimetres");
```

`formatLength` rounds with `toFixed`, turns `-0` into `0`, and with `trim` strips trailing zeros
and a bare point. The shared definition in MODEL-3D-FOLLOW-UPS.md lists only `digits`; `trim`
and `unit` are additive options, and the shared definition is updated to list them.

Inches get one more decimal because 0.01 in (0.254 mm) is the closest step to 0.1 mm that reads
naturally; `digits: 0` (whole millimetres) becomes one decimal inch (2.54 mm).

The hook and its provider:

```ts
type DisplayUnitsControl = {
  readonly units: DisplayUnits;
  readonly setUnits: (units: DisplayUnits) => void;
  readonly canSave: boolean;
};
const DisplayUnitsContext = createContext<DisplayUnitsControl>({
  units: "mm",
  setUnits: () => {},
  canSave: false,
});
export const DisplayUnitsProvider = DisplayUnitsContext.Provider;
/** The unit to show lengths in. Millimetres outside a provider. */
export const useDisplayUnits = () => useContext(DisplayUnitsContext).units;
export const useDisplayUnitsControl = () => useContext(DisplayUnitsContext);
/** Optimistic save of displayUnits, as useBuildPlate does for the bed. */
export function useDisplayUnitsSetting(
  environmentId: EnvironmentId,
  settings: ModelPreviewSettings,
): DisplayUnitsControl;
```

`useDisplayUnitsSetting` copies `useBuildPlate`'s pattern (`BedPicker.tsx:44-69`): a pending
value shown at once, `runModelCommand(models.updateSettings, ...)` with
`{ ...settings, displayUnits }`, a settings refresh, and a "Units not changed" toast that
reverts on failure. It uses the same permission check as `useBuildPlate` for `canSave`.

Providers:

- `ModelFile` in `ModelPanel.tsx` (`:90-100`, which receives `settings`) calls
  `useDisplayUnitsSetting` and wraps its tree in `DisplayUnitsProvider`, so the pending value
  updates the whole panel at once.
- `SettingsSection.tsx` wraps its form in a provider whose value is the form's
  `settings.displayUnits` with `setUnits = (units) => set("displayUnits", units)`, so the
  custom bed fields convert as soon as the select changes, before "Save settings".

`displayUnits` must not join the mesh reload key (`ModelPanel.tsx:448-455`): it is a display
setting, like the bed.

### Inventory of length sites

Every place the 3D panel shows or accepts a length, found with
`rg -n "toFixed|\bmm\b|formatVolume|unit=" apps/web/src/fork/model-preview-3d`.

| Site                                 | Today                                                                                                    | After                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ModelPanel.tsx:1138`                | Status bar size, `toFixed(1)` joined with " × ", " mm".                                                  | `formatLengths(stats.size, units)`.                                                     |
| `ModelPanel.tsx:1139`                | "Dimensions in millimetres" before load.                                                                 | `` `Dimensions in ${unitName(units)}` ``.                                               |
| `ModelInspector.tsx:381-382`         | Part dimension values, `toFixed(1)` and `<small>mm</small>`.                                             | `formatLength(value, units, { unit: false })` and `<small>{units}</small>`.             |
| `ModelInspector.tsx:406`             | Clearance, `toFixed(0)` " mm of clearance".                                                              | `formatLength(clearance, units, { digits: 0 })`.                                        |
| `ModelInspector.tsx:412`             | Overage, `toFixed(1)` " mm too wide".                                                                    | `formatLength(value, units)`; with L32 this is the `format` passed to `describeFit`.    |
| `ModelInspector.tsx:211`             | Plate diagram label, "`bx` by `by` mm plate".                                                            | `formatLength` for each side, joined with " by ".                                       |
| `ModelInspector.tsx:239`             | Plate diagram text, "`bx` × `by` mm".                                                                    | `formatLengths([bx, by], units, { trim: true })`.                                       |
| `ModelInspector.tsx:246`             | Height gauge label, "Height `size` of `bz` mm".                                                          | `formatLength` for both.                                                                |
| `ModelInspector.tsx:317`             | Printer menu volumes, `formatVolume` without a unit.                                                     | `formatLengths(volume, units, { trim: true })`.                                         |
| `BedPicker.tsx:157`                  | Bed menu volumes, `formatVolume`.                                                                        | As above.                                                                               |
| `BedPicker.tsx:181`                  | Active bed volume plus " mm" and "no height limit".                                                      | `formatLengths(volume, units, { trim: true })`.                                         |
| `BedPicker.tsx:74-113`               | Custom size inputs in mm, labels "Custom bed width in mm" (`:94`).                                       | Inputs in the display unit (see "Inputs"); labels say the unit.                         |
| `SettingsSection.tsx:206`            | Bed select volumes plus " mm".                                                                           | As for menus.                                                                           |
| `SettingsSection.tsx:217-236`        | Custom size inputs, labels "`axis` mm" (`:221`).                                                         | Inputs in the form's unit; labels "`axis` `units`".                                     |
| `viewer/createViewer.ts:260`         | Measurement label in the viewport and in captures (painted by `paintMarks`, `:278`), `toFixed(1)` " mm". | The viewer's length formatter (see "Viewer").                                           |
| `MarkupSection.tsx:481`              | Measurement deltas, `toFixed(1)`, no unit.                                                               | `formatLength(Math.abs(value), units, { unit: false })`.                                |
| `MarkupSection.tsx:485`              | Measurement distance, `toFixed(2)` " mm".                                                                | `formatLength(distance, units, { digits: 2 })`.                                         |
| `MarkupSection.tsx:491`              | "Copy value", `toFixed(2)`.                                                                              | `formatLength(distance, units, { digits: 2, unit: false })`.                            |
| `ViewsSection.tsx:230`               | Saved view section offset, `toFixed(1)` " mm".                                                           | `formatLength(section.offset, units)`.                                                  |
| `WorkspaceTools.tsx:432`, `:455-463` | Section offset `Scrub`, range in whole mm, step 0.5, `unit="mm"`.                                        | Scrub in the display unit (see "Inputs"). The native range input beside it stays in mm. |
| `VariantsInspector.tsx:327`          | Variant size, `toFixed(0)` " mm".                                                                        | `formatLengths(dimensions, units, { digits: 0 })`.                                      |
| `VariantsInspector.tsx:942`          | Variant comparison "a → b mm (+d)".                                                                      | Each number with `formatLength(..., { unit: false })`, then the suffix once.            |

Not converted, on purpose:

| Site                                                                       | Why                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------- |
| `buildPlate.ts:41-49` pattern labels ("10 mm", "1 in")                     | Names of the grid patterns, not lengths of the part.    |
| `packages/contracts/src/fork/model-preview-3d.ts:159`, `:165` preset notes | Vendor text. L34's legend is computed and does convert. |
| `MarkupSection.tsx:146` placeholder "add a 20 mm cable notch"              | Example request text for an agent, which works in mm.   |
| `useModelEditing.ts:179` "Region (mm)"                                     | Agent-facing request text; stays mm.                    |
| `controls.tsx:448`, `:462` customizer parameter `Scrub`s                   | The parameter's unit comes from the SCAD source.        |
| `ModelInspector.tsx:443`, `VariantsInspector.tsx:734`                      | Seconds and megabytes, not lengths.                     |
| `viewer/load.ts:90-156`                                                    | Import unit normalisation to mm; unrelated to display.  |

`formatVolume` (`buildPlate.ts:19-20`) is replaced by `formatLengths` and removed.

### Inputs

- **Custom bed size** (`BedPicker.tsx` `CustomSize`, `SettingsSection.tsx:217-236`, and L33's
  Manage beds rows). The field shows `fromMm(value, units)` rounded to 2 decimals in inches,
  0 in mm as today. On commit, `Math.round(toMm(typed, units) * 10) / 10`. Validation stays
  10 to 2000 mm, checked after conversion; the invalid hint gives the range in the display unit.
  Field `step` is 0.01 in inches and unchanged in millimetres.
- **Section offset** (`WorkspaceTools.tsx:455-463`). `Scrub` gets `value={fromMm(offset)}`,
  `range={{ min: floor2(fromMm(bounds.min)), max: ceil2(fromMm(bounds.max)), step: 0.02 }}` in
  inches (0.5 mm, unchanged, in mm), `unit={units}`, and `onChange={(v) => onChange({
...section, offset: toMm(v, units) })}`. `Scrub` itself (`controls.tsx:242-374`) is unchanged.
- **Copy value** copies what the row shows, without the unit.

### Viewer

`createViewer` gains `setLengthFormat(format: (mm: number) => string)`. The default formats as
today (`${mm.toFixed(1)} mm`). The label at `createViewer.ts:260` calls the stored formatter;
`setLengthFormat` stores it and calls `requestRender()`, so overlays and the next capture use
it. `ViewerCanvas.tsx` reads `useDisplayUnits()` and sets it in an effect next to the bed effect
(`:99-101`).

### Controls

- **Loom settings** (`SettingsSection.tsx`): a "Units" select ("Millimetres", "Inches") placed
  before the Bed row, saved with "Save settings".
- **Bed menu** (`BedPicker.tsx`): a `Segmented` "Units" control with "mm" and "in", after the
  pattern control, bound to `useDisplayUnitsControl()`. Disabled without permission.
- **Palette** (`palette.tsx`): `"toggle-units"` joins the `ModelAction` union
  (`actions.ts:2`) and the action list, titled "3D model: Switch units". `ModelFile`'s
  `onModelAction` handler (`ModelPanel.tsx:653-654`) calls `setUnits` with the other unit and
  shows a toast "Lengths in inches" or "Lengths in millimetres".

### Mobile

None.

## Agent-facing tools

No new tool. `loom_model_preview_3d_settings` returns `displayUnits`, and the save tool sets it.
Every other tool stays in millimetres, and the descriptions above say so. Captures may carry
inch labels, always with " in" written out.

## Performance

Formatting replaces `toFixed` calls one for one. The context value changes only when the unit
changes, so components do not re-render more than today. The viewer re-renders once on a unit
change and has no draw loop.

## Alternatives considered

- **A client-local preference.** Kyle asked for per environment, and agents and every client see
  the same panel that way.
- **Couple the grid to the units.** Mixes two choices; some people want inch labels over a
  10 mm grid while printing. The controls sit together instead.
- **Convert data at the boundary (store inches).** Breaks agents, slicers and saved views.
- **A Number formatter via `Intl.NumberFormat` with `unit`.** Gives localised unit names
  ("in", "″") that vary by locale; the panel's copy is English and fixed. `toFixed` is enough.
- **Convert customizer parameters.** Loom cannot know a parameter's unit.
