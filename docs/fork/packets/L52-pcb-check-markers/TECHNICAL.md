# L52 technical design

Line references are against `8676e099e5` on `docs/model-preview-follow-ups`.

## Overview

```
kicad-cli report.json
  -> parseKicadReport (kicadReports.ts)      mm positions, ERC scale fix, uuid, id, sheetId
  -> PcbCheckResult (persisted, RPC, MCP)    unchanged shape plus optional fields
  -> findings.ts (web, pure)                 PcbFinding[] per surface, ordered, stepped
  -> CheckMarkers.tsx                        pins in SvgViewport's overlay <svg>
```

The server owns the meaning of a position: it converts to millimetres, fixes KiCad's ERC scale
bug, maps an ERC sheet path to the drawing's sheet id and gives each finding a stable `id`.
Old persisted results are upgraded by the same function when read. The web turns a check
result into the shared `PcbFinding` list, draws it, and steps through it. Agents reach the same
stepping through two new `loom_pcb_editor` actions.

## The ERC scale bug

Status: fixed in commit `6ddf84c1aa` on the local `fix/preview-defects` branch
(`kicadReports.ts`, tests in `realReports.test.ts`), with the rule below and unit conversion to
millimetres. If that commit is on your base, keep it and skip this part of the work; otherwise
apply it as written.

`kicad-cli sch erc --format json` writes item positions with the PCB unit scale instead of the
schematic one, so every ERC position is 100 times too small (KiCad stores schematic coordinates
in 100 nm units and board coordinates in 1 nm units). KiCad 9.0's `eeschema/erc/erc_report.cpp`
builds `UNITS_PROVIDER unitsProvider( pcbIUScale, m_reportUnits )` in `WriteJsonReport`; the
10.0 branch and master use `schIUScale`. The text report and DRC are correct. The repo's own
fixture shows it: `apps/server/src/fork/pcb-preview/fixtures/erc.json` (KiCad 10.0.6, A4 sheet)
places symbol P101 at `0.4191, 0.3556` mm, and every ERC position fits inside 2.8 by 1.7 mm.
KiCad issue 25582 reports it against 10.0.5 and 10.0.6, and the KiCad 10.0.7 release notes
(2026-10-07) list "Fix ERC JSON report using wrong unit scale. #25582". Sources are in
REFERENCES.md.

Rule: for `kind === "erc"`, multiply positions by 100 when `kicad_version` parses as 9.x, or as
10.0.0 to 10.0.6. Every other version is taken as correct, including development builds
(`10.99.*`), because master uses `schIUScale`; a development build older than the fix will
still place ERC pins wrongly, which is acceptable for nightlies. L24 requires KiCad 9 or newer
(`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:395`), so 8.x never reaches this code.

## Contracts

### `packages/contracts/src/fork/pcb-preview.ts`

All additions are optional, so results persisted before this packet still decode
(`decodeCheck` at `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1143`, `:1165`).

```ts
export const PcbViolationItem = Schema.Struct({
  description: Schema.String,
  x: Schema.optional(Schema.Number), // millimetres when the result has pointsInMm
  y: Schema.optional(Schema.Number),
  uuid: Schema.optional(Schema.String), // KiCad item uuid, kept for identity
});

export const PcbViolation = Schema.Struct({
  // existing fields (pcb-preview.ts:143-151) unchanged
  id: Schema.optional(Schema.String), // stable finding identity, see findingId
  sheetId: Schema.optional(Schema.String), // ERC: drawing sheet id, e.g. "root-ampli.svg"
});

export const PcbCheckResult = Schema.Struct({
  // existing fields (pcb-preview.ts:166-178) unchanged
  pointsInMm: Schema.optional(Schema.Boolean), // set by parseKicadReport and normalizeCheckResult
});
```

`sheet` keeps KiCad's readable path (`/ampli_ht_vertical/`) for the list's "Sheet ..." tag
(`apps/web/src/fork/pcb-preview/ChecksView.tsx:343`); `sheetId` is what the drawing uses.

### `packages/contracts/src/fork/pcb-workspace.ts`

The shared definition from PCB-FOLLOW-UPS.md, written exactly. It lives here, not in
`pcb-preview.ts`, because the editor state below needs it and `pcb-preview.ts` already imports
this file (`pcb-preview.ts:1`).

```ts
export const PcbFindingSource = Schema.Literals(["erc", "drc", "fab", "review"]);
export const PcbFindingSeverity = Schema.Literals(["error", "warning", "info"]);
/** One marker on a drawing. Coordinates are millimetres; display goes through L54's formatter. */
export const PcbFinding = Schema.Struct({
  id: Schema.String,
  source: PcbFindingSource,
  severity: PcbFindingSeverity,
  message: Schema.String,
  sheet: Schema.optional(Schema.String),
  layer: Schema.optional(Schema.String),
  pointMm: PcbPoint,
});
```

Editor additions:

- `PcbEditorAction.action` (`pcb-workspace.ts:301-330`) gains `"finding"` and `"markers"`.
  `finding` reads `name`: `"next"`, `"previous"` or a finding `id`. `markers` reads `enabled`.
  Both reuse existing fields (`:339`, `:343`); no new field.
- `PcbEditorResult.state` (`:362-378`) gains an optional field:

```ts
findings: Schema.optional(
  Schema.Struct({
    visible: Schema.Boolean, // markers shown
    showExcluded: Schema.Boolean,
    active: Schema.NullOr(Schema.String),
    total: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    items: list(PcbFinding, 50), // current surface, ordered; first 50
  }),
),
```

Use the check helpers this file already uses (`Schema.isMaxLength`, `Schema.isBetween`); if the
integer helpers are named differently in the installed Effect, import `NonNegativeInt` from
`../baseSchemas.ts` as `pcb-preview.ts:9` does.

No new RPC method, so `rpcAuthorization.ts` and `clientRpcPermissions.ts` do not change.

## Server

Only `kicadReports.ts` changes in substance; the service gets two call-site edits.

### `apps/server/src/fork/pcb-preview/kicadReports.ts`

- `Item` (`:4-7`) gains `uuid: Schema.optional(Schema.String)`.
- `parseKicadReport(input, kind)` (`:28`) becomes
  `parseKicadReport(input, kind, options: { rootSheet?: string } = {})`.
- New exported pure helpers:
  - `unitScale(units)`: `"mm"` and missing give 1, `"in"` 25.4, `"mils"` 0.0254, anything else
    `null` (positions dropped, finding kept, so a future unit cannot place pins wrongly).
  - `ercScaleFactor(kind, kicadVersion)`: 100 inside the affected range above, else 1. Parse
    `major.minor.patch` with a local regex; `parseKicadVersion` (`tools.ts:3-6`) keeps only the
    major.
  - `ercSheetId(rootSheet, path)`: trim slashes, split on `/`, replace
    `/[/\\:*?"<>|]/g` with `_` in each segment exactly as `sourceInspection` does
    (`PcbPreviewService.ts:1476`), join with `-`, prefix `rootSheet`, add `.svg`. `"/"` gives
    `root.svg`; `"/ampli_ht_vertical/"` gives `root-ampli_ht_vertical.svg`, matching the ids the
    inspection assigns (`PcbPreviewService.ts:1415-1417`, `:1438`) and the render's sheet files.
  - `findingId(kind, group, type, sheetPath, items)`: when every item has a `uuid`, hash
    `[kind, group, type, sheetPath, ...sortedUuids]`; otherwise hash
    `[kind, group, type, sheetPath, ...items.map(description + positions rounded to 0.1 mm)]`.
    FNV-1a 32-bit to 8 hex digits, prefixed with `kind`: `erc-1a2b3c4d`. Repeated ids within one
    report get `-2`, `-3` in report order. L58 and L68 import this function.
- In `add` (`:30-48`): scale `pos` by `unitScale * ercScaleFactor`, keep `uuid`, add `id` and,
  for ERC with a `rootSheet`, `sheetId`. Return `coordinateUnits: "mm"` and `pointsInMm: true`
  (`:80`), so `summary.ts:29` and the list keep printing "mm" correctly.
- `normalizeCheckResult(result, rootSheet?)`: upgrades a stored result without `pointsInMm`
  using its `coordinateUnits` and `kicadVersion`, fills missing `id` (description-based, since
  uuids were not stored) and `sheetId`. Idempotent: returns the input when `pointsInMm` is true.

The existing byte bound (`:63-70`) still applies after the new fields are added, so the payload
cap is unchanged.

### `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`

- `check` (`:1126-1129`): pass `{ rootSheet }`, where `rootSheet` is
  `path.basename(resolved.design.schematicPath, ".kicad_sch")` when the design has a schematic.
- `latestChecks` (`:1165`): map the decoded result through `normalizeCheckResult` with the same
  root name, so reports run before this packet place pins correctly without a re-run.

## Storage

None new. Check results keep their files under `<stateDir>/fork/pcb-preview/checks/`
(`PcbPreviewService.ts:1056-1057`); new fields are written by new runs and old files are
upgraded on read, not rewritten.

The markers preference is device-local, in `apps/web/src/fork/pcb-preview/preferences.ts`:

```ts
checkMarkers: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
```

The decoding default matters: a failed decode resets every PCB preference to defaults
(`preferences.ts:23-29`), which would drop saved design selections and trust.

## Clients

### `apps/web/src/fork/pcb-preview/findings.ts` (new, pure)

- `checkFindings(result, source, { showExcluded })`: one `PcbFinding` per violation with a
  located item. `id` is `violation.id ?? \`${source}-${index}\``; `message`is the
description;`sheet`is`sheetId`for ERC;`layer`is omitted (KiCad DRC items carry no
layer);`pointMm` is the first located item. Also returns, per id, the other located item
  points for the active-finding rings.
- `orderFindings(findings, sheetOrder)`: severity (error, warning, info), then sheet index in
  `sheetOrder`, then `y` rounded to 0.1 mm, then `x`, then `id`.
- `stepFinding(ordered, activeId, direction)`: returns `{ finding, index, wrapped }`; with no
  active id, `.` gives the first and `,` the last.
- `hitFinding(findings, point, unitsPerPixel)`: nearest finding within 8 screen pixels.
- `markerSize(unitsPerPixel)`: radius 5 px, active ring 9 px, stroke 1.5 px, in drawing units.

### `apps/web/src/fork/pcb-preview/CheckMarkers.tsx` (new)

`memo` component with props `findings`, `activeId`, `activePoints`, `stale`. Reads
`useOverlayScale()` and draws inside the existing overlay `<svg>`:

- one `<circle>` per finding, `fill` `var(--color-error)`, `var(--color-warning)` or
  `var(--color-info)`, `stroke` `var(--color-background)`; excluded findings are hollow
  (`fill="none"`, coloured stroke);
- warnings first, then errors, so errors sit on top;
- for the active finding, a ring and a `<polyline>` to each other located item;
- `opacity={stale ? 0.45 : 1}` on the group, `pointerEvents="none"`.

Colours are attributes, so `serializeOverlay` (`SvgViewport.tsx:515-526`) resolves them and
captures include the pins.

### `apps/web/src/fork/pcb-preview/SvgViewport.tsx`

- Export `OverlayScaleContext` (default 1) and `useOverlayScale()`. Provide
  `physical.width / (extent.width * zoom / 100)` around `{overlays}` (`:441`). `zoom` is already
  state updated by `paint` (`:116-124`), so consumers re-render only when the rounded zoom
  percent changes. `DrawingOverlays` does not read the context, so it does not re-render.
- `PcbViewportHandle` (`:38-49`) gains `unitsPerPixel(): number` for hit testing.

### `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`

- State: `activeFinding: string | null` (cleared on design change), `showExcluded: boolean`
  (lifted from `ChecksView.tsx:111`), and `checkMarkers` from `usePcbPreferences`.
- Derived: `surfaceFindings` for the current view (schematic uses `preview.checks.erc`, board
  `preview.checks.drc`), ordered with `preview.good?.result.sheets` ids as sheet order;
  `drawingFindings` filters schematic findings to `preview.display.sheetId`; `markersStale` is
  `result.sourceHash !== preview.display.sourceHash`, the same rule as `ChecksView.tsx:121-122`
  but against the drawing.
- Overlays (`:983-998`): render `<CheckMarkers>` after `<DrawingOverlays>` in a fragment when
  `checkMarkers` is on.
- `goToFinding(finding)`: sets it active, `openTab("Checks")`, and calls
  `focusPoint(view, finding.pointMm, finding.sheet)` (`:190-204`). `focusPoint` already matches
  `s.id === sheet`, so ERC findings now switch sheets; today they never match because
  `PcbViolation.sheet` is KiCad's path, not a sheet id.
- `stepFindings(direction)`: turns markers on if hidden, uses `stepFinding`, shows the notice
  "No findings on this drawing." or "These findings have no position on the drawing." when
  there is nothing to step to.
- Key handler (`:1053-1065`), one line per key, after the existing ones:
  - `else if (key === "escape" && activeFinding) setActiveFinding(null);` placed after the
    tool-cancel line (`:1055`) so Escape clears the finding before closing Checks;
  - `else if (key === "." && drawingTools) stepFindings(1);`
  - `else if (key === "," && drawingTools) stepFindings(-1);`
  - `else if (key === "c" && !blocked) toggleCheckMarkers();`
- Pick (`:250-263`): in Select mode, before the nearest-component search, a `hitFinding` on
  `drawingFindings` with the raw point activates the finding and returns `true`.
- Editor requests (`:386-544`):
  - `case "finding"`: `drawing()`, then `next`/`previous` step, or an id is looked up across
    both reports (switching view if it belongs to the other surface); unknown ids throw
    "No finding with that id. Read the snapshot for current ids.".
  - `case "markers"`: set the preference to `c.enabled ?? !checkMarkers`.
  - Snapshot (`:548-568`): add `findings` with `visible`, `showExcluded`, `active`, `total` and
    the first 50 ordered findings of the current surface.
- `ChecksView` usage (`:1219-1234`): pass the new props; `onLocate` also activates the finding.

### `apps/web/src/fork/pcb-preview/ChecksView.tsx`

- New props: `showExcluded`, `onShowExcluded`, `activeId`, `onActivate(kind, violation)`,
  `markers`, `onMarkers`.
- Remove the local `excluded` state (`:111`); the Excluded stat (`:286-292`) uses the props and
  gets `aria-label="Show excluded"`.
- When `activeId` belongs to the other kind, switch `kind` during render, the same pattern as
  `usePcbPreview.ts:157-158`.
- The group containing the active finding renders open (`Group`'s `defaultOpen` drives
  `<details open>`, `InspectorKit.tsx:87`); its row gets `data-active` and scrolls into view with
  `block: "nearest"` in an effect. The row's tags include a "Stale" badge when `stale`
  (`:124`).
- A `role="status"` line under the stats: "Finding 3 of 12".
- A "Show on drawing" switch (`~/components/ui/switch`) under the stats, bound to `markers`.
- Locate (`:361`): drop the `units === "mm"` condition; positions are millimetres now. Keep
  `onLocate` and also call `onActivate`.

### `apps/web/src/fork/pcb-preview/WorkspaceChrome.tsx`

Add to `SHORTCUTS` (`:252-261`): `["Next, previous finding", ". / ,"]` and
`["Show or hide finding markers", "C"]`.

### Gating

Unchanged: the panel exists only with the `pcb-preview` capability, and Checks only for KiCad
designs (`Inspector.tsx:114-124`). Markers need a report, so tscircuit designs show none until
L68 adds review findings.

## Agent-facing tools

- `loom_pcb_editor` (`apps/server/src/fork/pcb-preview/mcp.ts:25-35`): append to the
  description "step to the next, previous or a named check finding, show or hide finding
  markers; snapshot lists visible findings". The schema change comes from `PcbEditorAction`.
- `loom_pcb_check` and `loom_pcb_latest_checks` (`mcp.ts:110-129`): descriptions gain
  "Positions are millimetres; each finding has a stable id." No schema change beyond the
  contracts.
- CLI parity is automatic (`apps/server/src/fork/pcb-preview/cli.ts:13-15`):
  `t3 pcb editor '{"designId":"board.kicad_pcb","command":{"action":"finding","name":"next"}}'`.

## Performance

- No new RPC, stream or bytes route. The 500-finding and 1 MiB bounds still apply.
- At most 500 pins, three SVG elements each. `CheckMarkers` is memoized and re-renders on a
  zoom percent change, a new report or a new active finding; nothing repaints while idle and
  there is no animation.
- During a wheel zoom the overlay re-renders once per changed percent, at most once per frame
  through the existing `paint` rAF. If a profile of 500 pins shows more than 2 ms per frame,
  quantize the provided scale to 10 percent steps.
- Hit testing is a linear scan of at most 500 points per click.

## Alternatives considered

- Converting units in the client (how L54 frames "Locate works in every unit"): agents and
  summaries read the same results, so the fix belongs where the report is parsed.
- Calibrating the ERC scale from parsed symbol positions matched by uuid: survives unknown
  versions, but needs an inspection pass per check. The version rule is one constant and a
  test; revisit only if a release outside the range misbehaves.
- One marker per item: doubles pins for two-item findings and makes stepping visit the same
  problem twice.
- Fixed millimetre pins like the selection circles (`Overlays.tsx:40`): a 1.4 mm circle is two
  pixels on a fitted A3 sheet.
- Radius through a CSS custom property set in `paint`: avoids re-renders, but captures copy only
  `fill` and `stroke` (`SvgViewport.tsx:521`), so pins would vanish from captures.
- Clickable SVG markers with their own pointer events: they fight the viewport's drag and pick
  handlers; reusing Select-mode pick keeps one input path.
