# L65 technical design

## Overview

`fabPackage` builds a package folder on the environment host in a pending directory inside the
workspace's `fab/`, then renames it into place:

```
Fabrication tab / loom_pcb_fab_package / t3 pcb fab_package
  -> loom.pcb-preview.fabPackage (AuthTerminalOperateScope)
  -> PcbPreviewService.fabPackage -> fabPackage.ts runFabPackage(deps, input)
       resolveDesign, sourceSnapshot, requiredTool
       fab/.pending-<random>/
         KiCad: gerbers, drill, pos, bom, assembly pdfs   (kicad-cli, kicadLock)
                check(drc), check(erc), fabCheck (L64)    (existing service methods)
         tscircuit: tsci export gerbers, circuit-json, assembly-svg (tsciLock)
         jlcpcb/ files (profile), zip, checklist, manifest
       rename to fab/<stem>-<rev>-<date>[-n]/
       copy the zip into the cache and sign it
  <- PcbFabPackageResult { checklist, outputs, zip: SignedFile, ... }

Preview: client fetches the signed zip -> gerberPreview.worker.ts (jszip + pcb-stackup)
         -> SVG strings -> SvgViewport in the canvas "Outputs" mode
```

The output preview runs in a web worker so Gerber parsing never blocks the T3 server or the UI
thread. Without the approved renderer, it falls back to the existing `render` RPC with
`layerNames` set to the packaged layers.

## Contracts

Add to `packages/contracts/src/fork/pcb-fab.ts` (created by L64, or by L65 if it lands first;
L65 then creates the file with only these schemas and the shared helpers, and L64 adds the
capability schemas). The file imports `SignedFile` from `./model-preview-3d.ts`, which does not
import any PCB contract, so there is no cycle.

```ts
export const PcbFabProfile = Schema.Literals(["generic", "jlcpcb"]);

export const PcbFabPackageInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1_024),
  profile: PcbFabProfile.pipe(Schema.withDecodingDefault(() => "generic" as const)),
  fabId: Schema.optional(PcbFabId), // L64; ignored when L64 is absent
  assembly: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)), // BOM, CPL, drawings
  force: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)), // rebuild identical input
});

export const PcbFabOutputKind = Schema.Literals([
  "gerber",
  "drill",
  "zip",
  "bom",
  "positions",
  "cpl",
  "assembly",
  "report",
  "checklist",
  "manifest",
]);
export const PcbFabOutput = Schema.Struct({
  path: text(300), // relative to the package folder, "/" separated
  kind: PcbFabOutputKind,
  layer: Schema.optional(text(64)), // KiCad layer name for gerbers, "PTH" or "NPTH" for drill
  bytes: NonNegativeInt,
});

export const PcbFabChecklistId = Schema.Literals([
  "outline",
  "copper-layers",
  "drill",
  "drc",
  "erc",
  "zones",
  "fab-check",
  "bom-cpl",
  "lcsc",
  "rotations",
  "polarity",
]);
export const PcbFabChecklistItem = Schema.Struct({
  id: PcbFabChecklistId,
  status: Schema.Literals(["pass", "fail", "warning", "manual", "skipped"]),
  title: text(120),
  detail: Schema.String.check(Schema.isMaxLength(2_000)),
});

export const PcbFabVerdict = Schema.Literals(["ready", "needs-review", "not-ready"]);

export const PcbFabPackageSummary = Schema.Struct({
  id: text(200), // folder name under fab/
  workspacePath: text(4_096), // "fab/<id>"
  designId: text(1_024),
  sourceHash: text(200),
  profile: PcbFabProfile,
  fabId: Schema.NullOr(PcbFabId),
  verdict: PcbFabVerdict,
  createdAt: IsoDateTime,
});

export const PcbFabPackageResult = Schema.Struct({
  ...PcbFabPackageSummary.fields,
  path: text(4_096), // absolute host path
  outputs: list(PcbFabOutput, 200),
  checklist: list(PcbFabChecklistItem, 16),
  zip: SignedFile,
  previewLayers: list(
    Schema.Struct({
      path: text(300),
      layer: text(64),
      side: Schema.Literals(["top", "bottom", "inner", "all"]),
      type: Schema.Literals([
        "copper",
        "soldermask",
        "silkscreen",
        "solderpaste",
        "drill",
        "outline",
      ]),
    }),
    64,
  ),
  reused: Schema.Boolean, // an identical package already existed
  warnings: list(text(400), 16),
  toolVersion: Schema.optional(text(100)),
  log: Schema.String.check(Schema.isMaxLength(64_000)),
});

export const PcbFabPackagesInput = Schema.Struct({ threadId: ThreadId, designId: text(1_024) });
export const PcbFabPackageRef = Schema.Struct({
  threadId: ThreadId,
  designId: text(1_024),
  packageId: text(200),
});
export const PcbFabPackageZip = Schema.Struct({
  zip: SignedFile,
  previewLayers: PcbFabPackageResult.fields.previewLayers,
});
```

`loom-fab-package.json` in each folder is `PcbFabPackageResult` without `zip`, `path` and
`reused`, so listing a package never needs a tool run. It decodes with defaults; a folder whose
manifest does not decode is listed as "Unreadable package" with only Delete.

### RPC methods

Added to `PCB_PREVIEW_WS_METHODS` (`packages/contracts/src/fork/pcb-preview.ts:15-43`) and the
RPC group (`:225-357`):

| Method                              | Payload               | Success                          | Server scope                    | Client guarded |
| ----------------------------------- | --------------------- | -------------------------------- | ------------------------------- | -------------- |
| `loom.pcb-preview.fabPackage`       | `PcbFabPackageInput`  | `PcbFabPackageResult`            | `AuthTerminalOperateScope`      | yes            |
| `loom.pcb-preview.fabPackages`      | `PcbFabPackagesInput` | `list(PcbFabPackageSummary, 50)` | `AuthOrchestrationReadScope`    | no             |
| `loom.pcb-preview.fabPackageZip`    | `PcbFabPackageRef`    | `PcbFabPackageZip`               | `AuthOrchestrationReadScope`    | no             |
| `loom.pcb-preview.deleteFabPackage` | `PcbFabPackageRef`    | `Schema.Void`                    | `AuthOrchestrationOperateScope` | yes            |

`fabPackageZip` signs an existing package's zip for download and preview; it copies the zip into
the cache (see "Signed files") but runs no tool, so it is a read like `readSheet`.

Errors reuse `PcbPreviewError` (`pcb-preview.ts:190-213`): `design-not-found`,
`unsupported-view` (no board), `tool-missing`, `tool-too-old`, `path-outside-workspace`,
`invalid-report`, `source-limit` (outputs over the size cap) and `io-failed`. A failed or
timed-out step is `io-failed` with `exitCode`, `timedOut` and a message naming the step and
ending with the last 2,000 characters of its log.

## Server

### Files

- `apps/server/src/fork/pcb-preview/fabPackage.ts` (new): `runFabPackage`, the step runners and
  pure helpers below.
- `apps/server/src/fork/pcb-preview/fabOutputs.ts` (new, pure): BOM and CPL builders, rotation
  rules, checklist evaluation, Gerber inspection. No I/O, fully unit-tested.
- `apps/server/src/fork/pcb-preview/zipWriter.ts` (new): `writeZip(entries, destination)`.
- `PcbPreviewService.ts`: four call sites, the signed file change, the `fab` exclusion.

### Folder layout

```
fab/
  rotations.csv                       optional, user or agent maintained
  <stem>-<rev>-<YYYY-MM-DD>[-n]/
    <stem>-gerbers.zip                Gerbers and drill files, flat
    gerbers/                          the same files, unzipped, for inspection
    assembly/bom.csv                  KiCad BOM (assembly only)
    assembly/positions.csv            KiCad positions, both sides (assembly only)
    assembly/assembly-top.pdf         F.Fab and Edge.Cuts (assembly only)
    assembly/assembly-bottom.pdf      B.Fab and Edge.Cuts, mirrored, when parts are on the back
    jlcpcb/bom.csv                    JLCPCB profile with assembly
    jlcpcb/cpl.csv                    JLCPCB profile with assembly
    reports/drc.json                  KiCad DRC report
    reports/erc.json                  KiCad ERC report, when there is a schematic
    reports/fab-check.json            L64 result, when a fab was chosen
    CHECKLIST.md                      the checklist as text, for humans and agents
    loom-fab-package.json             manifest
```

`<rev>` is the board title block revision (`(title_block (rev "1.2"))`) sanitised to
`[A-Za-z0-9._-]`, or `h` plus the first 8 hex characters of the source hash. The date is the
host's local date. When the folder exists, the service reads its manifest: same source hash,
profile, fab and assembly flag returns it with `reused: true` unless `force`; otherwise the next
free suffix `-2`, `-3`... is used. Package folders are never overwritten.

### Procedure: `runFabPackage(deps, input)`

`deps` is `{ resolveDesign, sourceSnapshot, requiredTool, safePath, run, check, fabCheck?,
inspect, runAsset, temporaryCircuitCwd, ensureWorkspaceDirectory, entries, signCacheFile,
cacheDir, fs, path, timestamp }`, all existing service members (`fabCheck` only with L64).

1. Resolve the design. No `boardPath` (KiCad) or no board (tscircuit) is `unsupported-view` "A
   fab package needs a board." `requiredTool`, KiCad major version from `parseKicadVersion`.
2. `snapshot = sourceSnapshot(resolved)`; read the board text through `safePath`.
3. `fabRoot = ensureWorkspaceDirectory(root, "fab")` (`PcbPreviewService.ts:258-275`); compute
   the folder name; reuse check as above.
4. `Effect.scoped`: `fs.makeTempDirectoryScoped({ directory: fabRoot, prefix: ".pending-" })`.
   Building inside `fab/` keeps the final rename on one file system, so the package appears
   whole or not at all. Interruption or failure removes it.
5. KiCad steps, in order, each through `run(tool, args, resolved.cwd, timeout)` under
   `kicadLock` (`PcbPreviewService.ts:302-353`), source paths absolute:

   **Gerbers** (120 s):

   ```
   kicad-cli pcb export gerbers --output <pending>/gerbers/
     --layers <copper>,F.Mask,B.Mask,F.Silkscreen,B.Silkscreen,F.Paste,B.Paste,Edge.Cuts
     [--check-zones]                  KiCad 10 and newer
     <board>
   ```

   `<copper>` is `F.Cu`, the board's `In1.Cu`... in order, then `B.Cu`, from
   `inspection.layers`. Protel extensions, X2 attributes and netlist attributes stay at their
   defaults (on); `--use-drill-file-origin` is not passed, so Gerbers and drill files share the
   absolute origin. Paste layers are included even without assembly: stencil orders need them
   and they cost nothing. A layer missing from the board is dropped from the list.

   **Drill** (60 s):

   ```
   kicad-cli pcb export drill --output <pending>/gerbers/ --format excellon
     --drill-origin absolute --excellon-zeros-format decimal --excellon-oval-format alternate
     -u mm --excellon-separate-th <board>
   ```

   No map file: the assembly drawing and L57's print cover paper needs.

   **Positions** (assembly, 60 s):

   ```
   kicad-cli pcb export pos --output <pending>/assembly/positions.csv --side both
     --format csv --units mm --exclude-dnp <board>
   ```

   `--units mm` is explicit because the default is inches. Whether `--side both` with CSV writes
   one file with a side column is unverified; if KiCad writes two files, the step merges them
   (`<name>-top.pos`/`-bottom.pos` patterns are checked in the fixture test).

   **BOM** (assembly, 60 s), when the design has a schematic:

   ```
   kicad-cli sch export bom --output <pending>/assembly/bom.csv
     --fields 'Reference,Value,Footprint,${QUANTITY},${DNP}[,<lcsc>]'
     --labels 'Reference,Value,Footprint,Qty,DNP[,LCSC]'
     --group-by 'Value,Footprint[,<lcsc>]' --ref-range-delimiter ''
     --field-delimiter ',' --string-delimiter '"' --exclude-dnp <schematic>
   ```

   `<lcsc>` is the first field name present on any symbol from `LCSC_FIELDS` (below), found by
   reading symbol properties with `parseSexp`. `--string-delimiter '"'` quotes values so a
   designator list such as `R1,R2` stays one field (the default is no quoting). An empty
   `--ref-range-delimiter` writes `R1,R2,R3` instead of `R1-R3`, which JLCPCB requires. Without a
   schematic, `bomFromFootprints` (pure, below) writes the same columns from board footprint
   properties, skipping footprints marked "exclude from BOM" or DNP.

   **Assembly drawings** (assembly, 60 s each):

   ```
   kicad-cli pcb export pdf --output <pending>/assembly/assembly-top.pdf --mode-single
     --layers F.Fab,Edge.Cuts --include-border-title --black-and-white <board>
   kicad-cli pcb export pdf --output <pending>/assembly/assembly-bottom.pdf --mode-single
     --layers B.Fab,Edge.Cuts --include-border-title --black-and-white --mirror <board>
   ```

   The bottom page is skipped when no footprint is on the back.

   **Checks.** Call the service's own `check({ threadId, designId, kind: "drc" })` and, with a
   schematic, `check({ ..., kind: "erc" })` (`PcbPreviewService.ts:1058-1155`), so the Checks
   tab updates too, and write each result to `reports/`. With L64 and `fabId`, call `fabCheck`
   and write `reports/fab-check.json`. Note that DRC here does not refill zones (its existing
   behaviour); the Gerbers do on KiCad 10 through `--check-zones`.

6. tscircuit steps, under `tsciLock` in `temporaryCircuitCwd` (`PcbPreviewService.ts:1486-1515`),
   with the argument shape of `runAsset` (`:1680-1700`):
   - `tsci export <entry> -f gerbers -o <pending>/<stem>-gerbers.zip`. The zip is opened with
     `openZipArchive` (`apps/server/src/zipArchive.ts`), each entry checked for traversal and
     size, and extracted into `gerbers/`. Its contents are unverified; the checklist reports
     what it finds.
   - With assembly: the Circuit JSON from the existing `circuit-json` asset (cached), then
     `bomFromCircuitJson` and `positionsFromCircuitJson` (pure, below), and
     `tsci export <entry> -f assembly-svg -o <pending>/assembly/assembly.svg`.
   - DRC and ERC are not available; the checklist marks them skipped with the reason.
7. Profile `jlcpcb` with assembly: `jlcpcbBom(bomRows, lcscField)` and
   `jlcpcbCpl(positions, rotationRules)` write `jlcpcb/bom.csv` and `jlcpcb/cpl.csv`.
8. Zip: for KiCad, `writeZip` with every file in `gerbers/`, flat, to `<stem>-gerbers.zip`.
   For tscircuit, the exported zip is kept as is.
9. Facts for the checklist from the produced files (`inspectGerbers`, below), the board
   (`boardStats` with L55, else `inspectBoard` and a drill count), the reports and the CSVs.
   `evaluateChecklist` returns items and the verdict. Write `CHECKLIST.md` and the manifest.
10. Size cap: the pending folder over 256 MiB fails with `source-limit` before the rename.
11. `fs.rename(pending, final)`, then `entries.refresh(root)` as `exportReference` does
    (`PcbPreviewService.ts:2461`).
12. Copy the zip into the cache and sign it (below). Return the result.

Total time on a small board is a few seconds per step; the RPC holds no lock between steps, so a
preview render can interleave.

### Pure helpers in `fabOutputs.ts`

- `LCSC_FIELDS`: `LCSC Part #`, `LCSC Part`, `LCSC PN`, `LCSC P/N`, `LCSC Part No.`,
  `LCSC Part Number`, `JLCPCB Part #`, `JLCPCB Part`, `JLC Part #`, `LCSC`, `JLC`, matched
  case-insensitively in that order (after Fabrication Toolkit's list, without its MPN fallback,
  which is a manufacturer number rather than an LCSC one).
- `ROTATION_FIELDS`: `JLCPCB Rotation Offset`, `FT Rotation Offset`, `Rotation Offset`,
  `RotOffset`.
- `parseRotationsCsv(text)`: lines `pattern,degrees` with `#` comments; `pattern` is a regular
  expression matched against the footprint name without its library prefix. Invalid lines are
  reported as warnings with their line number; regexes are compiled with a 200-character limit.
- `footprintParts(boardText)`: per footprint, reference, value, footprint name, side, DNP and
  "exclude from BOM/position" attributes, and its properties, using `parseSexp`, `children` and
  the `property` reader in `semantics.ts:47-48` (exported for this).
- `bomFromFootprints(parts, lcscField)` and `bomFromCircuitJson(elements)`: rows of `{ value,
footprint, references[], lcsc? }` grouped by value, footprint and LCSC, references sorted
  naturally (`R2` before `R10`). Circuit JSON reads `source_component` (`name`, display value,
  `supplier_part_numbers.jlcpcb[0]`) and `pcb_component` (`center`, `rotation`, `layer`); exact
  field names are verified against a real export in the fixture test.
- `parseKicadPositions(csv)`: KiCad CSV columns `Ref,Val,Package,PosX,PosY,Rot,Side`.
- `positionsFromCircuitJson(elements)`: the same rows.
- `jlcpcbBom(rows, lcscField)`: header `Comment,Designator,Footprint,LCSC Part #`; Comment is the
  value, Designator the comma-joined references, Footprint the footprint name without library;
  every field quoted, quotes doubled.
- `jlcpcbCpl(positions, parts, rules)`: header `Designator,Mid X,Mid Y,Layer,Rotation`; Layer is
  `Top` or `Bottom`; Mid X and Mid Y with four decimals in mm; Rotation is
  `normalise(rot + offset)` into `[0, 360)`, where `offset` is the part's rotation field, else
  the first matching `fab/rotations.csv` rule, else 0. No other bottom-side transform is applied:
  JLCPCB's KiCad 10 guide uses KiCad's values directly. Rows record whether an offset applied,
  for the checklist.
- `inspectGerbers(files)`: for each Gerber, the X2 `%TF.FileFunction,...*%` attribute (copper
  with layer number and side, soldermask, legend, paste, profile); for each Excellon file,
  plated or non-plated from `%TF.FileFunction` or `; #@! TF.FileFunction` comments, and the tool
  count. Returns layer types for `previewLayers` and facts for the checklist.
- `evaluateChecklist(facts)`: one item per id:

  | Id              | Pass                                                                                                 | Fail                                              | Otherwise                                                                                   |
  | --------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
  | `outline`       | an Edge.Cuts (profile) Gerber with content, and no outline violation in DRC                          | missing or empty profile, or an outline violation |                                                                                             |
  | `copper-layers` | copper Gerbers equal the board's copper layer count                                                  | they differ                                       |                                                                                             |
  | `drill`         | a plated drill file when the board has plated holes or vias, a non-plated one when it has NPTH holes | a needed file missing                             |                                                                                             |
  | `drc`           | clean                                                                                                | unexcluded errors                                 | warning: only warnings; skipped: tscircuit                                                  |
  | `erc`           | clean                                                                                                |                                                   | warning: errors or warnings (ERC never blocks); skipped: no schematic                       |
  | `zones`         | KiCad 10: "Zones refilled for the outputs"                                                           |                                                   | manual on KiCad 9: "Refill zones (B) and save before packaging"; skipped: no zones          |
  | `fab-check`     | L64 clean                                                                                            | L64 violations                                    | skipped: no fab chosen or L64 absent                                                        |
  | `bom-cpl`       | BOM and CPL references match                                                                         |                                                   | warning: lists up to 10 differences                                                         |
  | `lcsc`          | every BOM row has an LCSC number (JLCPCB)                                                            |                                                   | warning: "8 parts have no LCSC number" with references; skipped: generic profile            |
  | `rotations`     |                                                                                                      |                                                   | manual (JLCPCB): "Check rotations in JLCPCB's placement preview. 3 parts have corrections." |
  | `polarity`      |                                                                                                      |                                                   | manual: "Check polarity and pin 1 for diodes, LEDs, ICs and polarised capacitors."          |

  Verdict: any `fail` is `not-ready`; else any `warning` is `needs-review`; else `ready`. Manual
  items never change the verdict and are always listed.

### `zipWriter.ts`

`writeZip(entries: { name: string; bytes: Uint8Array }[], mtime: Date)`: returns the archive
bytes. Per entry: deflate with `zlib.deflateRawSync` (store when deflate is not smaller), CRC with
`zlib.crc32` (Node 22.2 and newer; the server's engines field requires 22.16 or newer), local file
header, then the central directory and end record. Names are validated (no `/` prefix, no `..`,
UTF-8 flag set). Limits: 1,000 entries and 128 MiB total, so ZIP64 is never needed. The DOS
timestamp is the package's creation time, so equal inputs give equal archives. Tests round-trip
through the existing `openZipArchive` (yauzl) reader.

### Signed files

Uses the table L57 introduces (`SIGNED_FILE_TYPES` in `cache.ts`, content type by basename in
`http.ts`, `signCacheFile` replacing `signBoard`; see L57 TECHNICAL.md). L65 adds
`"package.zip": { contentType: "application/zip", maxBytes: 128 MiB }`. If L65 lands first, it
creates the table with `board.glb` and `package.zip`.

The signed route only serves files inside `cacheDir` (`PcbPreviewService.ts:1533-1556`), so the
zip is copied to `<cacheDir>/<hashKey(workspaceKey, designId, packageId, zipSha256)>/package.zip`
with a `manifest.json` (`{ kind: "fab-package", sourceHash, log: "" }`), then signed. `prune`
evicts it like any render; `fabPackageZip` recreates it on demand.

### `fabPackages`, `fabPackageZip`, `deleteFabPackage`

- `fabPackages`: list `fab/` directories (not `.pending-*`), read each `loom-fab-package.json`
  (256 KiB cap), keep those whose `designId` matches, newest first, at most 50.
- `fabPackageZip`: validate `packageId` as a single path segment, `safePath(root,
"fab/<id>/<stem>-gerbers.zip")`, copy to the cache, sign, return with `previewLayers` from the
  manifest.
- `deleteFabPackage`: validate the id, require a manifest in the folder (so only package folders
  can be removed), `fs.remove(folder, { recursive: true })`, `entries.refresh`.

### Source scan

`sourceSnapshot` skips `<root>/fab` (shared with L57). Without it, a tscircuit design's hash would
change on every package because tscircuit hashes `.csv`, `.json` and `.svg` files.

## Storage

- Workspace: `fab/<package>/` as above; `fab/rotations.csv` when the user or agent creates it.
  Loom does not edit `.gitignore`; the recommended line is `/fab/*/`.
- Cache: one copied zip per signed package, pruned with renders (`CACHE_LIMITS`).
- No settings, no database state.

## Clients

### Client runtime

`packages/client-runtime/src/fork/pcb-preview.ts`: `fabPackages` query atom family
(`staleTimeMs: 0`); `fabPackage` command with `onSuccess` refreshing `fabPackages` and
`latestChecks`; `fabPackageZip` and `deleteFabPackage` commands, the latter refreshing
`fabPackages`.

### Web (`apps/web/src/fork/pcb-preview/`)

- `Inspector.tsx`: append `"Fabrication"` to `INSPECTOR_TABS` (`:40`), after the last tab, with
  an icon and a description in the tab table (`:104` pattern). It is not in `NEEDS_EXECUTION`
  (`:111`) because KiCad designs need no trust; for tscircuit the create button is disabled until
  trusted, using `executionAllowed`. The tab name doubles as the `open-tools` name, so
  `{"action":"open-tools","name":"Fabrication"}` works for agents with no editor change.
- `FabricationTab.tsx` (new):
  - Create form: profile (Generic, JLCPCB), fab picker with L64 (none by default unless L64 has a
    default fab set, then that), "Include assembly files", "Create package".
  - Running: `OperationStatus` with Cancel.
  - Package list: rows with name, date, profile, verdict badge, stale marker. The newest is
    expanded: checklist items with status icons, outputs grouped by folder with sizes, and
    actions "Preview outputs", "Download zip", "Show in folder" (only when
    `serverConfig.availableEditors.includes("file-manager")`, as in
    `apps/web/src/fileContextMenu.ts:115-160`), "Copy checklist", "Delete" with a confirm.
  - Download: `fabPackageZip`, fetch `modelUrl(environmentId, zip.relativeUrl)`
    (`apps/web/src/fork/model-preview-3d/state.ts:17-21`), Blob, `<a download>`, as in
    `apps/web/src/fork/apple-build-tooling/state.ts:124-134`.
- `WorkspaceChrome.tsx`: "Create fab package…" in `WorkspaceMenu` (`:199-245`), opening the tab.
- Canvas "Outputs" mode in `PcbPreviewPanel.tsx`: a state `outputs: { packageId } | null`. When
  set, the canvas renders `GerberPreview` instead of the design viewport, with a header "Outputs
  of <package>" and "Back to design" (Escape also returns). Surface keys `1`-`3` leave it.
- `GerberPreview.tsx` (new): fetches the zip once (`fabPackageZip`), posts the bytes to the
  worker, and shows Top, Bottom and a layer list (`previewLayers`) as a segmented control plus
  per-layer toggles for the single-layer view. Each SVG goes to `SvgViewport` (`svg`, `label`,
  `busy`, `kind`) with no pick or measure handlers. Results are kept per package in component
  state only and dropped on close.
- `gerberPreview.worker.ts` (new), imported with Vite's `?worker` suffix as
  `apps/web/src/components/DiffWorkerPoolProvider.tsx:3` does: unzips with `jszip` (already an
  `apps/web` dependency), passes each file with its known `type` and `side` from `previewLayers`
  to `pcb-stackup` (so file-name guessing is not used), and returns `{ top, bottom, layers: {
path, svg }[] }`. Inputs over 32 MiB unzipped are refused with "Too large to preview here". The
  worker is created per preview and terminated on close.
- Fallback without `pcb-stackup`: `GerberPreview` calls the existing `render` with `view: "pcb"`
  and `layerNames` set to the packaged KiCad layers, and labels the view "Board plot of the
  packaged layers". For tscircuit it shows "Preview needs the Gerber renderer".
- Pure helpers in `fabPackage.logic.ts`: `checklistTone(items)`, `groupOutputs(outputs)`,
  `isPackageStale(summary, sourceHash)`, `checklistText(result)`.

### Desktop and mobile

Desktop: no code; downloads use Electron's default handling, and "Show in folder" uses the
existing shell bridge. Mobile: none; mobile has no PCB panel.

## Agent-facing tools

In `apps/server/src/fork/pcb-preview/mcp.ts`, following `loom_pcb_check` (`:110-119`,
`:349-356`):

| Tool                          | Access          | Parameters                                              | Notes                                                                                                                                                                                                                            |
| ----------------------------- | --------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loom_pcb_fab_package`        | `actsAsCaller`  | `designId`, `profile?`, `fabId?`, `assembly?`, `force?` | Title "PCB: fab package", `Readonly` false. Description: "Creates Gerbers, drill, BOM, placement and assembly drawings under fab/, runs DRC and returns a checklist. Never uploads or orders." Returns the result without `zip`. |
| `loom_pcb_fab_packages`       | `readsAsCaller` | `designId`                                              | Title "PCB: fab packages".                                                                                                                                                                                                       |
| `loom_pcb_delete_fab_package` | `actsAsCaller`  | `designId`, `packageId`                                 | Title "PCB: delete fab package", `Destructive` true.                                                                                                                                                                             |

`t3 pcb fab_package '{"designId":"board/main.kicad_pcb","profile":"jlcpcb"}'` works through
`cli.ts`. Agents read `CHECKLIST.md` and the CSVs from the returned path.

## Performance

- Server: tool runs are subprocesses; the service holds `kicadLock` per step, not for the whole
  package. The in-process work is CSV building and zipping a few megabytes, well under a second.
  No Gerber parsing on the server.
- Network: the RPC result is small JSON (outputs list, checklist). The zip crosses once, over
  signed HTTP, only when the user downloads or previews.
- Client: Gerber rendering runs in a worker; the main thread receives SVG strings. Large SVGs are
  displayed through the existing `SvgViewport`. No polling, no animation.

## Alternatives considered

- **Preview on the server with `pcb-stackup`** into a cache render entry, reusing `readSheet`.
  Rejected: Gerber parsing is synchronous JavaScript and would stall the T3 server's event loop
  for seconds on a large board. A worker on the client keeps the server responsive.
- **Preview with `kicad-cli`**: kicad-cli has no Gerber viewer command (`fp`, `jobset`, `pcb`,
  `sch`, `sym`, `version`); `pcb export svg` plots the design, not the outputs. Kept as the
  fallback.
- **Server-side SVG from `circuit-json-to-gerber` or a WASM renderer**: no maintained,
  widely used option found; tracespace is the reference implementation.
- **KiCad jobsets** (`kicad-cli jobset run`): one file drives all outputs, but jobsets are
  KiCad 9 and newer project files that Loom would have to write, and the outputs still need the
  JLCPCB conversion and checklist. Plain commands are easier to test and to report per step.
- **A zip dependency (`archiver`, `yazl`)**: a new production dependency for 120 lines.
- **Uploading to the fab**: ruled out.
