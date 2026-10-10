# L64 technical design

## Overview

Three parts, each small:

1. **Capabilities.** The shared fab capability entry in a new contracts file, built-in entries as
   data in `fabData.ts`, and user entries stored environment-wide with an optimistic version,
   exactly like the hardware library.
2. **Check.** `fabCheck` copies the board, its project and its rules file into a temporary
   directory, clears the board's own minimums, appends `loom_fab_*` rules with the fab's
   limits, runs `kicad-cli pcb drc` and keeps the fab-relevant violations. It never writes the
   user's files.
3. **Facts and cost drivers.** Pure functions read the board text (or L55's `boardStats`) for
   the facts DRC does not cover, compare them with the entry, and apply per-fab cost rules.

```
ChecksView Fab card / loom_pcb_fab_check / t3 pcb fab_check
  -> loom.pcb-preview.fabCheck (AuthTerminalOperateScope)
  -> PcbPreviewService.fabCheck -> fabCheck.ts runFabCheck(deps, input)
       resolveDesign, sourceSnapshot, requiredTool            (PcbPreviewService.ts:500, :518, :669)
       capability = built-in or user entry
       temp dir in checksDir: <stem>.kicad_pcb, <stem>.kicad_pro (minimums cleared),
                              <stem>.kicad_dru (user rules + loom_fab_* rules)
       run(kicad, pcb drc --format json ...)                  (PcbPreviewService.ts:302-353)
       parseKicadReport -> classify -> facts -> boardFindings -> costDrivers
       persist checksDir/<hashKey(workspaceKey, designId, "fab", fabId)>.json
  <- PcbFabCheckResult
```

## Contracts

### New file `packages/contracts/src/fork/pcb-fab.ts`

Exported from `packages/contracts/src/fork/index.ts` with one line. It imports only `effect/Schema`
and `../baseSchemas.ts`, so `pcb-preview.ts` can import it for the RPC group without a cycle.
That is why the violation item is declared here rather than reusing `PcbViolationItem` from
`pcb-preview.ts:137-141`: the shapes are identical.

```ts
import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, ThreadId } from "../baseSchemas.ts";

const text = (max = 200) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const list = <S extends Schema.Top>(item: S, max: number) =>
  Schema.Array(item).check(Schema.isMaxLength(max));
/** A length in millimetres: positive and below 10 mm, so a mil or inch slip is refused. */
const lengthMm = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThan(10));
const optionalLength = Schema.NullOr(lengthMm).pipe(Schema.withDecodingDefault(() => null));

export const PcbFabTier = Schema.Literals(["standard", "advanced"]);
export const PcbFabId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,47}$/));

/** The shared fab capability entry (PCB-FOLLOW-UPS.md). All lengths in millimetres. */
export const PcbFabCapability = Schema.Struct({
  id: PcbFabId,
  name: text(80),
  tier: PcbFabTier,
  minTrackMm: lengthMm,
  minSpaceMm: lengthMm,
  minDrillMm: lengthMm,
  minAnnularRingMm: lengthMm,
  minViaMm: lengthMm, // smallest via pad diameter
  layerCounts: list(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })), 64),
  thicknessesMm: list(Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 10 })), 32),
  finishes: list(text(60), 16),
  notes: Schema.String.check(Schema.isMaxLength(2_000)),
  sourceUrl: Schema.String.check(Schema.isMaxLength(500)), // "" for none
  checkedOn: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  // Pending Kyle's decision (PRODUCT.md). Null means "not published"; the rule is skipped.
  minEdgeClearanceMm: optionalLength,
  minHoleToHoleMm: optionalLength,
});
export type PcbFabCapability = typeof PcbFabCapability.Type;

/** Stored user entries. Built-ins are not stored. */
export const PcbFabCapabilities = Schema.Struct({
  version: Schema.Int.pipe(Schema.withDecodingDefault(() => 0)),
  entries: list(PcbFabCapability, 24).pipe(Schema.withDecodingDefault(() => [])),
  defaultId: Schema.NullOr(PcbFabId).pipe(Schema.withDecodingDefault(() => null)),
});
export type PcbFabCapabilities = typeof PcbFabCapabilities.Type;

/** What clients and agents read: built-ins, user entries, and the resolved default. */
export const PcbFabCatalog = Schema.Struct({
  version: Schema.Int,
  builtIns: list(PcbFabCapability, 24),
  entries: list(PcbFabCapability, 24),
  defaultId: PcbFabId, // falls back to "jlcpcb-standard"
  skipped: list(text(200), 24), // stored entries that no longer decode, by id or index
});
export type PcbFabCatalog = typeof PcbFabCatalog.Type;

export const PcbFabCapabilitiesUpdate = Schema.Struct({
  expectedVersion: Schema.Int,
  entries: list(PcbFabCapability, 24),
  defaultId: Schema.NullOr(PcbFabId).pipe(Schema.withDecodingDefault(() => null)),
});
export type PcbFabCapabilitiesUpdate = typeof PcbFabCapabilitiesUpdate.Type;

export const PcbFabCheckInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1_024),
  fabId: Schema.optional(PcbFabId), // missing means the default
});
export type PcbFabCheckInput = typeof PcbFabCheckInput.Type;

export const PcbLatestFabCheckInput = PcbFabCheckInput;

export const PcbFabRule = Schema.Literals([
  "track",
  "space",
  "drill",
  "annular-ring",
  "via",
  "edge-clearance",
  "hole-to-hole",
]);

export const PcbFabViolationItem = Schema.Struct({
  description: Schema.String,
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
});
/** Same fields as PcbViolation, so L52's checkFindings accepts it, plus the fab rule. */
export const PcbFabViolation = Schema.Struct({
  type: Schema.String,
  description: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
  excluded: Schema.Boolean,
  group: Schema.Literals(["violation", "unconnected", "parity"]),
  items: Schema.Array(PcbFabViolationItem),
  rule: PcbFabRule,
  limitMm: Schema.optional(Schema.Number),
  measuredMm: Schema.optional(Schema.Number),
});

export const PcbFabBoardFinding = Schema.Struct({
  id: Schema.Literals(["layers", "thickness", "finish"]),
  severity: Schema.Literals(["error", "warning"]),
  message: text(400),
});

export const PcbFabFacts = Schema.Struct({
  copperLayers: NonNegativeInt,
  sizeMm: Schema.NullOr(Schema.Struct({ width: Schema.Number, height: Schema.Number })),
  areaMm2: Schema.NullOr(Schema.Number),
  thicknessMm: Schema.NullOr(Schema.Number),
  finish: Schema.NullOr(Schema.String),
  castellatedPads: NonNegativeInt,
  viaInPad: NonNegativeInt,
  /** Distinct via sizes, largest count first. */
  viaSizes: list(
    Schema.Struct({ drillMm: Schema.Number, diameterMm: Schema.Number, count: NonNegativeInt }),
    32,
  ),
  smallestPadDrillMm: Schema.NullOr(Schema.Number),
});

export const PcbFabCostDriver = Schema.Struct({
  id: text(64),
  title: text(200),
  detail: text(1_000),
  count: Schema.optional(NonNegativeInt),
  sourceUrl: Schema.optional(text(500)),
});

export const PcbFabCheckResult = Schema.Struct({
  fabId: PcbFabId,
  capability: PcbFabCapability, // the entry as checked, so later edits show as stale
  sourceHash: text(200),
  outcome: Schema.Literals(["clean", "violations", "failed", "timed-out"]),
  counts: Schema.Struct({
    errors: NonNegativeInt,
    warnings: NonNegativeInt,
    excluded: NonNegativeInt,
  }),
  violations: list(PcbFabViolation, 500), // sorted errors first, then rule
  truncated: Schema.Boolean,
  boardFindings: list(PcbFabBoardFinding, 8),
  notChecked: list(PcbFabRule, 8), // rules skipped because the value is null
  alsoInDrc: NonNegativeInt, // non-fab violations seen in the same run
  facts: Schema.NullOr(PcbFabFacts),
  costDrivers: list(PcbFabCostDriver, 24),
  zonesRefilled: Schema.Boolean,
  kicadVersion: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Int),
  log: Schema.String,
  ranAt: IsoDateTime,
});
export type PcbFabCheckResult = typeof PcbFabCheckResult.Type;

export const DEFAULT_FAB_ID = "jlcpcb-standard";
```

Every field that older saved state might lack has a decoding default. Saved results that fail to
decode are treated as "no result", the same as `latestChecks` (`PcbPreviewService.ts:1156-1169`).

### RPC methods

In `packages/contracts/src/fork/pcb-preview.ts`, add to `PCB_PREVIEW_WS_METHODS` (`:15-43`) and
`PcbPreviewRpcGroup` (`:225-357`), all with `error: errors`:

| Method                                   | Payload                    | Success                            | Server scope                    | Client guarded |
| ---------------------------------------- | -------------------------- | ---------------------------------- | ------------------------------- | -------------- |
| `loom.pcb-preview.fabCapabilities`       | `{}`                       | `PcbFabCatalog`                    | `AuthOrchestrationReadScope`    | no             |
| `loom.pcb-preview.updateFabCapabilities` | `PcbFabCapabilitiesUpdate` | `PcbFabCatalog`                    | `AuthOrchestrationOperateScope` | yes            |
| `loom.pcb-preview.fabCheck`              | `PcbFabCheckInput`         | `PcbFabCheckResult`                | `AuthTerminalOperateScope`      | yes            |
| `loom.pcb-preview.latestFabCheck`        | `PcbLatestFabCheckInput`   | `Schema.NullOr(PcbFabCheckResult)` | `AuthOrchestrationReadScope`    | no             |

Server scopes go in `FORK_RPC_REQUIRED_SCOPES` (`apps/server/src/fork/rpcAuthorization.ts:21-46`);
guarded ones also in `FORK_CLIENT_GUARDED_RPC_SCOPES`
(`packages/contracts/src/fork/clientRpcPermissions.ts:10-60`). This mirrors `library`,
`updateLibrary`, `check` and `latestChecks`.

Errors reuse `PcbPreviewError` reasons (`pcb-preview.ts:190-213`): `design-not-found`,
`unsupported-view` (no board, or a tscircuit design), `tool-missing`, `tool-too-old`,
`invalid-report`, `invalid-parameters` (unknown fab id, bad update), `conflict` (stale version)
and `io-failed`.

## Built-in data

New `apps/server/src/fork/pcb-preview/fabData.ts` exports `BUILT_IN_FABS:
readonly PcbFabCapability[]` and `BUILT_IN_COST_RULES` (below). All checked on 2026-10-10; the
`notes` field carries the caveats shown in the UI. Values a fab does not publish are null.

| id                | Name             | Tier     | Track / space   | Drill | Annular | Via pad | Edge | Hole to hole |
| ----------------- | ---------------- | -------- | --------------- | ----- | ------- | ------- | ---- | ------------ |
| `jlcpcb-standard` | JLCPCB standard  | standard | 0.10 / 0.10     | 0.20  | 0.25    | 0.45    | 0.20 | 0.20         |
| `jlcpcb-advanced` | JLCPCB advanced  | advanced | 0.10 / 0.10     | 0.15  | 0.18    | 0.25    | 0.20 | 0.20         |
| `pcbway-standard` | PCBWay standard  | standard | 0.10 / 0.10     | 0.20  | 0.15    | 0.50    | 0.25 | 0.28         |
| `oshpark-2-layer` | OSH Park 2-layer | standard | 0.1524 / 0.1524 | 0.254 | 0.127   | 0.508   | null | 0.127        |
| `oshpark-4-layer` | OSH Park 4-layer | standard | 0.127 / 0.127   | 0.254 | 0.1016  | 0.4572  | null | 0.127        |

Board options:

| id                | Layer counts                 | Thicknesses (mm)                  | Finishes                                                                                      |
| ----------------- | ---------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `jlcpcb-*`        | 1, 2, then even counts to 32 | 0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0 | HASL, Lead-free HASL, ENIG, OSP                                                               |
| `pcbway-standard` | 1, 2, 4, 6, 8, 10, 12, 14    | 0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0 | HASL, Lead-free HASL, Immersion gold, OSP, Hard gold, Immersion silver, Immersion tin, ENEPIG |
| `oshpark-2-layer` | 2                            | 1.6                               | ENIG                                                                                          |
| `oshpark-4-layer` | 4                            | 1.6                               | ENIG                                                                                          |

Notes carried in the data (and the reasons for each number) are in REFERENCES.md. In short:
JLCPCB standard uses the no-surcharge via (0.2 mm hole with a 0.45 mm pad) and the recommended
2-layer annular ring; advanced uses the smallest standard-process via (0.15 / 0.25) and the
2-layer absolute annular ring, with the looser multilayer values (0.09 mm track, 0.15 mm ring)
in the notes. PCBWay's via pad is derived (0.2 + 2 x 0.15) and marked so. OSH Park publishes no
edge clearance, so that rule is not checked for it. Thickness lists for JLCPCB and PCBWay are
the common FR4 values; both pages list more, and the notes say so.

`BUILT_IN_FABS` is validated at module load in a test (decodes with `PcbFabCapability`, ids
unique, every `sourceUrl` https).

## Server

### Capabilities storage

In `PcbPreviewService.ts`, beside `libraryFile` (`:1319-1321`), using the existing `readState`
and `writeState` (`:1241-1270`) and `storageLock`:

```ts
const fabFile = path.join(workbenchDir, "fab-capabilities.json");
const storedFabs = () =>
  readState(fabFile, decodeFabJson, () => ({ version: 0, entries: [], defaultId: null }));
```

`readState` (`:1241-1259`) decodes the whole file and fails on any bad entry. To keep one bad
entry from hiding the rest, `decodeFabCapabilitiesLenient(source)` in `fabData.ts` is passed as
the decoder: it parses the JSON, decodes `version` and `defaultId`, then each entry on its own,
collecting failures into `skipped`. Only malformed JSON fails, with `readState`'s message.
`fabCapabilities()` returns `toCatalog(stored, skipped)`: built-ins, entries, and
`defaultId ?? DEFAULT_FAB_ID`, falling back when the stored id no longer exists.

`updateFabCapabilities(input)` under `storageLock`, following `updateLibrary` (`:1322-1383`):

1. Version mismatch: `conflict` "Fab capabilities changed on another client. Reload them before
   saving."
2. Ids unique, and none equal to a built-in id: `invalid-parameters`.
3. `sourceUrl` empty or HTTP(S) without credentials. Extract the URL test in `updateLibrary`
   (`:1347-1360`) to a module function `isPlainHttpUrl(link)` and use it in both places.
4. `defaultId` null, a built-in id, or one of the entries.
5. `minSpaceMm` and `minTrackMm` at least 0.05; `minViaMm` greater than `minDrillMm`.
6. Write with `version + 1`, return the catalog.

### `apps/server/src/fork/pcb-preview/fabCheck.ts` (new)

Pure functions, unit-tested without KiCad:

- `fabRules(capability)`: the rule lines and the `notChecked` list. Values are written with four
  decimals and an `mm` suffix:

  ```
  (rule "loom_fab_track" (constraint track_width (min 0.1000mm)))
  (rule "loom_fab_space" (constraint clearance (min 0.1000mm)))
  (rule "loom_fab_drill" (constraint hole_size (min 0.2000mm)))
  (rule "loom_fab_via" (condition "A.Type == 'Via'") (constraint via_diameter (min 0.4500mm)))
  (rule "loom_fab_annular_ring" (condition "A.Type == 'Pad'")
    (constraint annular_width (min 0.2500mm)))
  (rule "loom_fab_edge_clearance" (constraint edge_clearance (min 0.2000mm)))
  (rule "loom_fab_hole_to_hole" (constraint hole_to_hole (min 0.2000mm)))
  ```

  The annular rule is limited to pads because fab via rules are expressed as hole plus pad
  diameter; a JLCPCB 0.15 / 0.25 via has a 0.05 mm ring and is fine. Null values skip their
  rule.

- `rulesFile(userRules: string | null, capability)`: the user's `.kicad_dru` text unchanged (or
  `(version 1)` when there is none), a blank line, the comment
  `# Added by Loom for the fab check. Later rules take precedence.`, then `fabRules`. KiCad
  gives precedence to rules later in the file, so the fab rules override the user's rules and
  net classes for these constraint types.
- `clearBoardMinimums(projectJson: string)`: parses the `.kicad_pro` JSON and sets these keys
  under `board.design_settings.rules` to `0` when present: `min_clearance`, `min_track_width`,
  `min_through_hole_diameter`, `min_via_diameter`, `min_via_annular_width`,
  `min_hole_clearance`, `min_hole_to_hole`, `min_copper_edge_clearance`,
  `min_microvia_diameter`, `min_microvia_drill`. Board setup minimums are absolute in KiCad and
  cannot be loosened by rules, so a stricter board minimum would otherwise report non-fab
  problems as fab ones. Invalid JSON returns `null` and the check runs without the project.
- `FAB_RULE_TYPES`: the DRC violation `type` values each rule produces, used to classify:
  `track_width` to track, `clearance` to space, `drill_out_of_range` to drill, `via_diameter`
  to via, `annular_width` to annular ring, `copper_edge_clearance` to edge clearance,
  `hole_to_hole` to hole to hole. These names come from KiCad's DRC item keys and must be
  confirmed against a real report (REFERENCES.md); the fixture test pins them.
- `classifyViolations(parsed, capability)`: for each `PcbViolation` from `parseKicadReport`
  (`kicadReports.ts`), a type in `FAB_RULE_TYPES` becomes a `PcbFabViolation` with its rule;
  everything else increments `alsoInDrc`. Because the fab rules override every other source for
  these types, any violation of these types in this run is below a fab limit.
  `limitMm` is the capability value for the rule. `measuredMm` is parsed from the description
  with `/actual (\d+(?:\.\d+)?) ?mm/` when present; KiCad's descriptions read like
  `(rule 'loom_fab_track' min width 0.1000 mm; actual 0.0800 mm)`, which is unverified, so the
  field is optional. Unrelated library types (`lib_footprint_issues`,
  `lib_footprint_mismatch`) are dropped, since the copy has no library tables.
- `boardFacts(boardText, stats?)`: with L55's `PcbBoardStats`, take `copperLayers`, `size`,
  `areaMm2`; otherwise use `inspectBoard` (`semantics.ts:66-197`) for bounds and layers. Then read
  from the S-expression (`parseSexp`, `children`, `child`, `atom` in `semantics.ts`):
  - thickness: `(general (thickness t))`, as `inspectBoard` already does;
  - finish: `(setup (stackup ... (copper_finish "ENIG")))`, null when absent;
  - via sizes: top-level `(via (at x y) (size d) (drill h) ...)`, grouped by `(h, d)`;
  - smallest pad drill: footprint `pad` nodes with `(drill d)` or `(drill oval w h)`;
  - castellated pads: pads with `(property pad_prop_castellated)`;
  - via-in-pad: vias whose centre lies within half the larger pad dimension of an SMD pad's
    absolute position on the same copper side. Pad positions add the footprint `(at x y r)`
    rotated offset, as `inspectBoard` computes component positions. A heuristic, counted only.
- `boardFindings(facts, capability)`: copper layers not in `layerCounts` is an error; thickness
  not in `thicknessesMm` (to 0.05 mm) and a finish not in `finishes` (case-insensitive, `HAL`
  and `HASL` treated alike) are warnings, since both are order options rather than design facts.
  Missing thickness or finish produce nothing.
- `costDrivers(facts, capability)`: when `BUILT_IN_COST_RULES[capability.id]` exists, apply
  those rules; for user entries, apply the generic ones only.

### Cost rules

`BUILT_IN_COST_RULES: Record<string, readonly CostRule[]>` in `fabData.ts`, where
`CostRule = { id, applies(facts): { count?: number } | null, title, detail, sourceUrl }`.
Marked "verified" when the fab states it, "general" when it is common pricing behaviour.

| Fab          | Driver                                                            | Applies when                                             | Basis                                                                   |
| ------------ | ----------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| JLCPCB       | `small-via`                                                       | any via with drill < 0.2, or drill < 0.3 with pad < 0.45 | verified                                                                |
| JLCPCB       | `board-size`                                                      | width or height > 100 mm                                 | verified (low-price offer covers up to 100 x 100 mm, 2 layers)          |
| JLCPCB       | `layers`                                                          | copper layers > 2                                        | general                                                                 |
| JLCPCB       | `via-in-pad`                                                      | via-in-pad > 0 and layers < 6                            | verified (filled and capped vias are standard from 6 layers)            |
| JLCPCB       | `castellated`                                                     | castellated pads > 0                                     | general; also lists the 0.5 mm hole and 10 x 10 mm board minimums       |
| JLCPCB       | `finish`                                                          | finish is ENIG                                           | general                                                                 |
| JLCPCB       | `thickness`                                                       | thickness known and not 1.6                              | general                                                                 |
| PCBWay       | `drill-range`                                                     | smallest drill < 0.2 or any drill > 6.0                  | verified                                                                |
| PCBWay       | `layers`, `castellated`, `via-in-pad`                             | as above                                                 | general                                                                 |
| OSH Park     | `area-price`                                                      | always, when area is known                               | verified rate: 2-layer $5 per square inch for three boards, 4-layer $10 |
| User entries | `layers`, `castellated`, `via-in-pad`, `board-size` (> 100 x 100) | as above                                                 | general                                                                 |

The OSH Park detail reads "About $27.90 for three boards (5.58 sq in at $5 per sq in), from OSH
Park's published rate checked 2026-10-10." The area is the outline bounding rectangle, which is
how OSH Park describes its pricing to the best of current knowledge (unverified); the text says
"about".

### Procedure: `runFabCheck(deps, input)`

`deps` is `{ resolveDesign, sourceSnapshot, requiredTool, safePath, run, catalog, checksDir,
fs, path, timestamp, cacheLock, prune, workspaceKey }`, all existing service members.

1. `resolveDesign(input)`. A tscircuit design or a design without `boardPath` fails with
   `unsupported-view` "Fab checks need a KiCad board."
2. Resolve the capability: `input.fabId ?? catalog.defaultId`, from built-ins then entries;
   unknown is `invalid-parameters` "Unknown fab. Reload the fab list."
3. `requiredTool(resolved)`; read the KiCad major version with `parseKicadVersion`.
4. `sourceSnapshot(resolved)` for the hash.
5. In `Effect.scoped`, `fs.makeTempDirectoryScoped({ directory: checksDir, prefix:
"pending-fab-" })`, as `check` does (`PcbPreviewService.ts:1073-1076`). Copy into it, by
   `safePath` from the design's board path:
   - `<stem>.kicad_pcb` (read and written, not linked);
   - `<stem>.kicad_pro`, passed through `clearBoardMinimums` (skipped when absent);
   - `<stem>.kicad_dru` from `rulesFile(userRulesOrNull, capability)`.
     Nothing else is copied. Footprint and symbol library tables are not needed for these rules.
6. Run, with a 180 s timeout like `check`:

   ```
   kicad-cli pcb drc --format json --severity-all --units mm --exit-code-violations
     --output <tmp>/report.json [--refill-zones] <tmp>/<stem>.kicad_pcb
   ```

   `--refill-zones` only on KiCad 10 and newer; `--save-board` is never passed, and the board is
   a copy regardless. `--schematic-parity` is not passed: parity is DRC's job.

7. Exit codes as `check`: 0 or 5 parse the report (16 MiB cap); a timeout is `timed-out`; any
   other code is `failed` with the bounded log.
8. `parseKicadReport(raw, "drc")`, `classifyViolations`, then read the original board text once
   more for `boardFacts` (with `inspection.stats` when L55 is present), `boardFindings` and
   `costDrivers`. Sort violations errors first, then by rule, cap at 500 with `truncated`.
9. Outcome: `violations` when any non-excluded fab violation or any error board finding exists,
   else `clean`.
10. Persist under `cacheLock` with `writeFileStringAtomically` to
    `checksDir/hashKey(workspaceKey, designId, "fab", fabId).json`, keeping the newer `ranAt`
    as `check` does (`:1139-1150`), then `prune()`. Checks share `CHECK_LIMITS` (`cache.ts`).
11. Re-read `sourceSnapshot`; if the hash changed during the run, return the result with the
    old hash so the client shows it as out of date. (The existing `check` does not do this;
    see "Defects" in the final report.)

`latestFabCheck(input)` reads that file (4 MiB cap, decode failure is null), for
`input.fabId ?? catalog.defaultId`.

## Storage

- `<stateDir>/fork/pcb-preview/workspaces/fab-capabilities.json`: user entries, default id,
  version. Environment-wide, not per project, like `hardware-library.json`. Recommended because
  fab limits are a property of the user's suppliers, not one design, and every thread and agent
  on the environment should agree.
- `<stateDir>/fork/pcb-preview/checks/<hash>.json`: the latest fab result per design and fab.
- Nothing in the workspace. The temporary copy lives under `checksDir` and is removed by the
  scope, including on interruption.

## Clients

### Client runtime (`packages/client-runtime/src/fork/pcb-preview.ts`)

- `fabCapabilities` and `latestFabCheck` query atom families, `staleTimeMs: 0`, beside
  `latestChecks` and `library` (`:28-45`).
- `updateFabCapabilities` command, `onSuccess` refreshes `fabCapabilities`, as
  `updateLibrary` does (`:135-142`).
- `fabCheck` command, `onSuccess` refreshes `latestFabCheck` for that design and fab, as `check`
  does (`:165-179`). Its result atom cancels the run when the card unmounts.

### Web (`apps/web/src/fork/pcb-preview/`)

- `ChecksView.tsx`: the card list at `:165` becomes `["erc", "drc", "fab"]`, with `KINDS.fab =
{ name: "Fab", surface: "Board", rules: "Fab limits and cost" }`. Selecting it renders
  `FabCheckView` in place of the ERC and DRC body. `available("fab")` is
  `design.kind === "kicad" && !!design.boardPath`. The card status uses a `fabStatus` beside
  `status` (`:60-80`), adding "limits changed" staleness.
- `FabCheckView.tsx` (new):
  - Header row: fab picker (a `Select` of built-ins then user entries, each with its tier),
    "Run fab check" or Cancel, and "Fab capabilities…".
  - Verdict: "Fits JLCPCB standard" or counts, with the stale lines from PRODUCT.md.
  - "Limits" disclosure: the six limits with the source link and "Checked 2026-10-10"; with
    L55, the board's measured minimum beside each.
  - Board findings, then violations grouped by rule, each row with measured, limit and Locate,
    reusing the violation row from `ChecksView` (extract `ViolationRow` if it is inline). With
    L52, markers through `checkFindings({ violations }, "fab", ...)`; if L52's function takes a
    whole `PcbCheckResult`, widen its parameter to `{ violations: readonly PcbViolation[] }`.
  - "Not checked" line for skipped rules; "Also in DRC: 4 other findings" with a button that
    selects the DRC card.
  - Cost drivers as a list with the source link per item.
  - "Copy summary" and "Add to draft", like the DRC summary actions, built by a pure
    `fabSummaryText(result)`.
- `FabCapabilitiesDialog.tsx` (new): the list (built-ins locked with "Duplicate"; user entries
  with "Edit", "Duplicate", "Delete", "Set as default"); an edit form with name, tier, the length
  fields (millimetres, or L54's unit), layer counts and thicknesses as comma lists, finishes,
  notes, source URL and checked date (default today). Save sends the whole list with
  `expectedVersion`; on `conflict` it shows "Fab capabilities changed elsewhere. Reload" and
  keeps the edits in the form. Pure helpers in `fabCapabilities.logic.ts`:
  `duplicateCapability(entry, existingIds)` (id `<id>-copy`, `-copy-2`...), `parseLengthList`,
  `capabilityErrors(entry)`, `removeCapability(state, id)` (clears a default that pointed to it).
- PCB settings section (`settings.tsx`): a "Fab" row with the default fab select and "Manage…"
  opening the same dialog.
- Palette: none. The check needs the panel's design context, and the Checks tab is one click.

### Desktop and mobile

Desktop: no code. Mobile: none; mobile has no PCB panel.

## Agent-facing tools

In `apps/server/src/fork/pcb-preview/mcp.ts`, following `loom_pcb_check` (`:110-119`, `:349-356`)
and the library tools (`:234-257`, `:443-458`):

| Tool                             | Access              | Parameters                                | Notes                                                                                                                      |
| -------------------------------- | ------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `loom_pcb_fab_capabilities`      | `readsAsCaller`     | none                                      | Title "PCB: fab capabilities". Description names the default and says built-ins carry a checked date.                      |
| `loom_pcb_save_fab_capabilities` | `writesEnvironment` | `expectedVersion`, `entries`, `defaultId` | Title "PCB: save fab capabilities". "Built-in fabs cannot be changed; duplicate one with a new id."                        |
| `loom_pcb_fab_check`             | `actsAsCaller`      | `designId`, `fabId?`                      | Title "PCB: fab check", `Readonly` false. "Runs DRC with the fab's limits on a temporary copy; the design is not changed." |
| `loom_pcb_latest_fab_check`      | `readsAsCaller`     | `designId`, `fabId?`                      | Title "PCB: latest fab check".                                                                                             |

`t3 pcb fab_check '{"designId":"board/main.kicad_pcb","fabId":"oshpark-4-layer"}'` works through
`cli.ts`'s generic mapping. The editor command `open-tools` with `name: "Checks"` already opens
the tab; no new editor action.

## Performance

One extra DRC run per check, on demand, holding `kicadLock` like DRC. The facts pass is one
S-expression parse of the board (already done by inspect; L55 avoids it). Results are capped at
500 violations and travel as JSON. No polling, no watchers, nothing at idle.

## Alternatives considered

- **Compare L55's measured minimums with the limits, no DRC.** Fast, but misses clearances
  (the most common failure) and cannot locate anything. Kept as the display beside each limit.
- **Write rules into the user's `.kicad_dru`.** Gives KiCad users the rules in the editor, but
  writes their files and mixes fabs. A later "Export rules for KiCad" action could write
  `fab/<fab>.kicad_dru` on request.
- **Load fab presets from KiCad's own DRC rule templates** (`.kicad_dru` files shared by fabs
  and the community): formats vary and licences are unclear. Built-in data with sources is
  clearer.
- **Per-project storage** (`fab/capabilities.json` in the repo): shareable with collaborators,
  but every project would need its own copy. Could be added as an import later.
- **Per-layer-count limits in the schema** (JLCPCB's multilayer values): accurate, but changes
  the shared definition further. Conservative values plus notes cover it.
- **Fetching capability pages at runtime**: network access and scraping; ruled out by
  PCB-FOLLOW-UPS.md.
