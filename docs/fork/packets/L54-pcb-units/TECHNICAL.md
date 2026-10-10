# L54 technical design

Cited lines are from `docs/model-preview-follow-ups` at `8676e099e5`.

## Overview

One per-device preference, one pure module, one hook. `length.ts` converts and formats;
`useLengthUnit()` reads the preference from the existing zustand store; each length site in the
inventory swaps its `toFixed(...) mm` for `formatLength`. Check reports are normalized to
millimetres where they are parsed, so the client only ever handles millimetres plus a fallback
for reports that predate this packet.

## Contracts

No schema change in `packages/contracts`. The unit is a web preference, not wire data.

`PcbCheckResult.coordinateUnits` (`packages/contracts/src/fork/pcb-preview.ts:173`) keeps its
type. After this packet the server always writes `"mm"` there for new results.

## Server

### Report normalization (`apps/server/src/fork/pcb-preview/kicadReports.ts`)

`parseKicadReport` copies `pos` as-is (`kicadReports.ts:45`) and the report's
`coordinate_units` (`:80`). Two facts make that wrong today:

- KiCad ERC JSON reports `pos` 100 times too small in every version before 10.0.7 (KiCad issue
  25582; see REFERENCES.md). The fixture shows it: `fixtures/erc.json:28` has `x: 0.4191`
  ("mm"), a 1650 mil grid point. "Locate" on an ERC finding therefore jumps near the sheet
  origin today.
- `--units mm` is always passed (`PcbPreviewService.ts:1078-1090`), so the unit is mm, but a
  report in `in` or `mils` would still be shown and located as if it were mm elsewhere.

Commit `6ddf84c1aa` on the local `fix/preview-defects` branch already does this (scale for
8.x, 9.x and 10.0.0 to 10.0.6, `in`/`mils`/`mil` converted, unknown units dropped). If it is on
your base, keep it and only add `coordinateUnits: "mm"` if missing; otherwise add, in
`kicadReports.ts`:

```ts
/** KiCad < 10.0.7 wrote ERC JSON positions with the PCB scale (issue 25582). */
export function ercScale(kicadVersion: string): number | null;
// "8.0.x" | "9.0.x" | "10.0.0".."10.0.6" -> 100; "10.0.7"+ and "11"+ -> 1; unparsable -> null
const MM_PER = { mm: 1, in: 25.4, mils: 0.0254, mil: 0.0254 } as const;
```

`parseKicadReport` multiplies each `pos` by `MM_PER[coordinate_units] * (erc ? scale : 1)` and
writes `coordinateUnits: "mm"`. When the ERC scale is `null` (a development build such as
"10.99.0") it drops `x` and `y` from items rather than guess, and when the unit is not one of
the four it leaves the values and the unit untouched. Check results persisted before this
packet keep their old numbers; the client fallback below handles their units, and their ERC
positions stay wrong until the check is run again (they are replaced on the next run).

### Tool descriptions (`apps/server/src/fork/pcb-preview/mcp.ts`)

- `loom_pcb_inspect` (`mcp.ts:70-73`) appends "Lengths and coordinates are in millimetres."
- `loom_pcb_editor` (`mcp.ts:25-27`) appends "Points, pan offsets and lengths are in
  millimetres."
- `loom_pcb_check` and `loom_pcb_latest_checks` append "Item coordinates are in millimetres."

No tool gains a units field: the unit is per device, so an environment tool has no single
answer, and agents keep one canonical unit.

## Storage

`apps/web/src/fork/pcb-preview/preferences.ts` stores PCB preferences in device storage under
`loom:pcb-preview:preferences:v1` (`:16`). Its schema (`:11-15`) has no decoding defaults, so
adding a required field would make every saved value fail to decode and fall back to defaults
(`:22-30`), silently dropping trusted tscircuit designs and remembered views. Step 1 fixes that
for every field:

```ts
const Preferences = Schema.Struct({
  selections: Schema.Record(Schema.String, Selection).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  trusted: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  electronicsUrl: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /** Display unit for lengths in the PCB panel. Data and tools stay in millimetres. */
  lengthUnit: PcbLengthUnit.pipe(Schema.withDecodingDefault(Effect.succeed("mm"))),
});
```

`PcbLengthUnit = Schema.Literals(["mm", "mil", "in"])` lives in `length.ts` and is exported for
the schema. The store gains `setLengthUnit(unit)`, written like `setElectronicsUrl`. The
`withDecodingDefault` pattern matches `packages/contracts/src/fork/model-preview-3d.ts:237`.
The key stays `v1`: the change only adds tolerance.

Why per device: see PRODUCT.md, "Decisions". Per environment would need a new server settings
store (PCB has none; `settings.tsx:46-133` only shows detected tools and the per-device
Electronics URL), an RPC with a write grant to change a display preference, and would make one
viewer's choice change everyone's view.

## Clients

### `apps/web/src/fork/pcb-preview/length.ts` (new)

```ts
export const PcbLengthUnit = Schema.Literals(["mm", "mil", "in"]);
export type PcbLengthUnit = typeof PcbLengthUnit.Type;
export const MM_PER_INCH = 25.4;
export const MM_PER_MIL = 0.0254;
export const toMm = (value: number, unit: PcbLengthUnit) => ...;
export const fromMm = (mm: number, unit: PcbLengthUnit) => ...;
/** Maps a KiCad report unit ("mm", "in", "mils") to ours, or null when unknown. */
export function reportUnit(raw: string | undefined): PcbLengthUnit | null;
export type LengthOptions = {
  /** Decimals in millimetres (default 2). Mils get one fewer (min 0), inches one more. */
  digits?: number;
  /** Append " mm", " mil" or " in" (default true). */
  unit?: boolean;
  /** Drop trailing zeros ("50 × 30 mm"). */
  trim?: boolean;
};
export function formatLength(mm: number, unit: PcbLengthUnit, options?: LengthOptions): string;
/** "50.00 × 30.00 mm": one unit suffix; nulls skipped. */
export function formatLengths(values: readonly (number | null)[], unit: PcbLengthUnit,
  options?: LengthOptions): string;
/** mm² for mm; in² for mil and in. */
export function formatArea(mm2: number, unit: PcbLengthUnit, digits?: number): string;
/** "12.7", "0.5in", "500 mil", "12.7 mm", '0.5"' -> millimetres, or null. Bare numbers use unit. */
export function parseLength(text: string, unit: PcbLengthUnit): number | null;
export const unitName = (unit: PcbLengthUnit) => ({ mm: "millimetres", mil: "mils",
  in: "inches" })[unit];
/** The current display unit. */
export const useLengthUnit = () => usePcbPreferences((s) => s.lengthUnit);
```

`formatLength` rounds with `toFixed`, turns `-0` into `0`, and with `trim` strips trailing zeros
and a bare point. The names and option meanings match L40's `formatLength`
(`docs/fork/packets/L40-model-units/TECHNICAL.md`), except the default `digits` is 2 because
every PCB site prints two decimals today, and the unit set includes mils. Electrical values
keep using `units.ts` (`parseEng`, `formatEng`); the two modules do not import each other.

### Status bar menu (`PcbPreviewPanel.tsx`)

Insert before the tool version item (`PcbPreviewPanel.tsx:1378`) a `Menu` whose trigger is a
`statusChip` button showing the unit ("mm") with `aria-label` "Length units: millimetres",
and three `MenuItem`s with a check on the current one, matching the shelf menu pattern at
`:884-915`. It calls `usePcbPreferences.getState().setLengthUnit`. Rendering is on demand; no
timers.

### Settings (`settings.tsx`)

Add a `SettingsRow` after "Electronics app URL" (`settings.tsx:94-132`): title "Length units",
description "Drawing coordinates, marks and board sizes. Saved on this device. Agents always
use millimetres.", with a `Select` of "Millimetres (mm)", "Mils (mil)", "Inches (in)". It saves
immediately (no Save button), like a toggle.

### Inventory of length sites

Found with `rg -n 'mm|toFixed|millimet' apps/web/src/fork/pcb-preview`. Each row becomes the
change shown. `u` is `useLengthUnit()` read in the nearest component.

| Site                                      | Today                                               | After                                                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry.ts:25`                          | Angle value `toFixed(1)°`.                          | Unchanged; angles are unitless.                                                                                                                           |
| `geometry.ts:26`                          | "Vertex x, y" `toFixed(2)`, no unit.                | `` `Vertex ${formatLengths([b.x, b.y], u, ...)}` `` joined with ", ".                                                                                     |
| `geometry.ts:31`                          | Distance `toFixed(2)` " mm".                        | `formatLength(distance, u)`.                                                                                                                              |
| `geometry.ts:32`                          | "Δx Δy" `toFixed(2)`, no unit.                      | `formatLength(dx, u, { unit: false })` each.                                                                                                              |
| `geometry.ts:35-37`                       | `measurementLabel(m)`.                              | `measurementLabel(m, u)`; `measurementParts(m, u)` gains the parameter.                                                                                   |
| `Overlays.tsx:63`                         | Label drawn on the board, also in PNG captures.     | `measurementLabel(m, unit)`; `Overlays` gets a `unit` prop from the panel.                                                                                |
| `MarksTab.tsx:51` (shown `:179-183`)      | Measurement rows.                                   | `measurementParts(m, u)`.                                                                                                                                 |
| `InspectTab.tsx:20`, `:247-248`           | Board size `millimetres()` and " mm".               | `formatLengths([w, h], u, { digits: 1, trim: true })`; helper removed. With L55 this moves into the Board stats card.                                     |
| `InspectTab.tsx:258-259`                  | Thickness `toFixed(1)` " mm".                       | `formatLength(thickness, u, { digits: 1 })`.                                                                                                              |
| `ChecksView.tsx:159`                      | `units = coordinateUnits ?? "mm"`.                  | `from = reportUnit(result?.coordinateUnits ?? "mm")`.                                                                                                     |
| `ChecksView.tsx:356`                      | `toFixed(2)` plus report unit.                      | Convert with `toMm(v, from)`, then `formatLengths([x, y], u)`; when `from` is null show raw numbers plus the raw unit.                                    |
| `ChecksView.tsx:361`                      | Locate only when `units === "mm"`.                  | Locate whenever `from` is not null, with the point in mm.                                                                                                 |
| `summary.ts:29`                           | Draft summary in report units.                      | Converted to mm with the same helper; stays mm (agent input).                                                                                             |
| `HardwareLibrary.tsx:104`                 | Size `${w} × ${h} mm`.                              | `formatLengths([w, h], u, { trim: true })`.                                                                                                               |
| `HardwareLibrary.tsx:173`                 | Draft context "Size ... mm".                        | Unchanged (agent input, mm).                                                                                                                              |
| `HardwareLibrary.tsx:468-480`, `:637-638` | Width and height inputs in mm, labels "Width (mm)". | Input shows `fromMm(value, u)`, writes `toMm(value, u)`; label "Width (mil)" and so on; `step` 0.01 mm, 1 mil, 0.001 in; `aria-label` uses `unitName(u)`. |

Not lengths, left alone: zoom and scale percentages (`SvgViewport.tsx:122,487`,
`ViewsTab.tsx:99`), opacity (`LayersTab.tsx:209`), sheet byte size
(`PcbPreviewPanel.tsx:816`), plot coordinates (`Plot.tsx:81-82`), simulation values
(`units.ts`). There is no live cursor coordinate readout today, so none to convert. Pad snapping
keeps its 1 mm radius (`PcbPreviewPanel.tsx:240-319`): it is drawing space, not display.

Captures: mark labels are part of the drawing overlay, so a PNG captured for an agent shows the
user's unit. That is intentional (it is what the user sees); the capture context text
(`PcbPreviewPanel.tsx:344`) carries no lengths.

## Agent-facing tools

- MCP: description sentences only (Server, above). No new tool, no new field.
- Editor command: none. The unit is the user's reading preference, not editor state an agent
  should drive. The snapshot state (`PcbPreviewPanel.tsx:545-569`) does not report it.
- `t3 pcb`: unchanged; it calls the same tools (`cli.ts`).

## Performance

Formatting is a few arithmetic operations per visible label. The zustand selector re-renders
only components that read the unit, and only when it changes. No animation, no timers, nothing
over the WebSocket.

## Alternatives considered

- Per-environment setting beside L40's `displayUnits`. Rejected for PCB: needs a new server
  store and a write grant for a display choice (see Storage).
- Reusing `apps/web/src/fork/model-preview-3d/units.ts`. Rejected: L40 has no mils and is
  per environment. Matching names keep a later merge cheap.
- Converting check coordinates only in the client. Rejected as the only fix: the ERC scale bug
  is a KiCad adapter quirk and belongs at the adapter boundary, where L52's `pointMm` also
  reads it. The client keeps a fallback for already persisted results.
- A units field on tool outputs. Rejected; see PRODUCT.md.
