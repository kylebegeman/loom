# L68 technical design

## Overview

```text
KiCad      sourceInspection + no-connect points ─┐
           netlist export (pin types, lib ids) ──┼─> reviewModel.ts: ReviewModel
tscircuit  circuit JSON (port flags) ────────────┘          │
                                                            v
project settings (rules, params) ─────────────────> reviewRules.ts: runReview (pure)
reviewData.ts (patterns, regulator table) ──────────────────┘
                                                            │
                                           PcbReviewResult  v  persisted beside ERC and DRC
                                                            │
       Checks "Review" card, status chip, L52 markers (source "review"), loom_pcb_review
```

Three new pure server modules hold everything rule-shaped. `PcbPreviewService.ts` only gets a
`review` method that gathers data and persists, as PCB-FOLLOW-UPS asks for large features.

## Data available today

| Data                                                                        | KiCad                                                                                                                                                                              | tscircuit                                                                                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Parts with reference, value, footprint, pins, schematic and board positions | `PcbInspection` via `sourceInspection` (`PcbPreviewService.ts:1396-1478`)                                                                                                          | `inspectCircuitJson` (`semantics.ts:309`)                                                                                             |
| Nets with members                                                           | Netlist merge (`semantics.ts:275-302`)                                                                                                                                             | Union of `source_trace` (`semantics.ts:336-366`)                                                                                      |
| Pin electrical type                                                         | In the netlist node `pintype`, ignored today by `mergeNetlist`; also the first atom of each library `pin` in the schematic, ignored by `inspectSchematic` (`semantics.ts:254-271`) | `source_port` flags (`is_input`, `is_output`, `provides_power`, `requires_power`, `needs_external_pullup` and others), not read today |
| Part library id and description                                             | Netlist `comp` `libsource` (`lib`, `part`, `description`), not read today                                                                                                          | `source_component.ftype`, `manufacturer_part_number`                                                                                  |
| Unconnected and no-connect pins                                             | Netlist single-node nets `unconnected-(...)` with pintype suffix `+no_connect`; schematic `(no_connect (at x y))` items                                                            | `do_not_connect` port flag                                                                                                            |
| Net roles                                                                   | Net names; power symbols                                                                                                                                                           | `source_net.is_power`, `is_ground`; names                                                                                             |
| Capacitor voltage rating                                                    | Value text such as `10u/16V`, or a `Voltage` field                                                                                                                                 | `simple_capacitor.max_voltage_rating`                                                                                                 |
| Component values                                                            | Value text (`10k`, `4k7`, `100n`)                                                                                                                                                  | `resistance`, `capacitance` numbers                                                                                                   |

Pin types in the netlist: verified against a real KiCad netlist (node
`(node (ref "U10") (pin "3") (pinfunction "Qf") (pintype "output"))`, unconnected pins as
`passive+no_connect` in single-node `unconnected-(J1-Pin_1-Pad1)` nets; see REFERENCES.md). The
twelve type tokens match the KiCad schematic format docs. Whether power symbols (`#PWR`) appear
as nodes was not verified; the parser handles both (step 1 below).

tscircuit flag names come from the circuit-json README (REFERENCES.md). Most tscircuit parts
built from generic `<chip>` elements set few or none of them, so every rule has a name-based
fallback and the model reports which data it lacked.

## Contracts

In `packages/contracts/src/fork/pcb-preview.ts`. New persisted fields have decoding defaults;
rule ids are strings on the wire so a client built before a new rule still decodes results.

```ts
export const PcbReviewLocation = Schema.Struct({
  x: Schema.Number, // mm
  y: Schema.Number, // mm
  sheet: Schema.optional(Schema.String), // schematic sheet id, as in PcbLocation
  layer: Schema.optional(Schema.String), // board only
});
export const PcbReviewFinding = Schema.Struct({
  id: TrimmedNonEmptyString, // "review:<rule>:<hash>", stable across moves
  rule: TrimmedNonEmptyString,
  severity: Schema.Literals(["error", "warning", "info"]),
  message: Schema.String, // one sentence, product voice
  why: Schema.String, // what was seen: parts, pins, nets, values
  fix: Schema.String, // what usually resolves it
  parts: Schema.Array(Schema.String), // references, capped at 20
  nets: Schema.Array(Schema.String), // capped at 10
  schematic: Schema.optional(PcbReviewLocation),
  board: Schema.optional(PcbReviewLocation),
  waived: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  waiverNote: Schema.optional(Schema.String),
});
export const PcbReviewRuleRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: Schema.String,
  enabled: Schema.Boolean,
  /** Why an enabled rule did not run or ran with less data, e.g. "pin types unavailable". */
  limited: Schema.optional(Schema.String),
  findings: NonNegativeInt,
});
export const PcbReviewInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
});
export const PcbReviewResult = Schema.Struct({
  designKind: Schema.Literals(["kicad", "tscircuit"]),
  outcome: Schema.Literals(["clean", "findings", "failed"]),
  sourceHash: TrimmedNonEmptyString,
  /** Hash of rulesVersion, enabled rules and parameters; waivers are applied on read. */
  configHash: TrimmedNonEmptyString,
  rulesVersion: NonNegativeInt,
  counts: Schema.Struct({
    errors: NonNegativeInt,
    warnings: NonNegativeInt,
    info: NonNegativeInt,
    waived: NonNegativeInt,
  }),
  findings: Schema.Array(PcbReviewFinding), // capped at 500, sorted by severity then rule
  truncated: Schema.Boolean,
  rules: Schema.Array(PcbReviewRuleRun),
  notices: Schema.Array(Schema.String), // capped at 20
  log: Schema.String, // netlist export log on failure
  durationMs: NonNegativeInt,
  ranAt: IsoDateTime,
});
export const PcbLatestReviewResult = Schema.NullOr(PcbReviewResult);
```

Methods, added to `PCB_PREVIEW_WS_METHODS` (`pcb-preview.ts:15-43`) and the RPC group:

| Method                          | Payload          | Success                 | Scope                                                     |
| ------------------------------- | ---------------- | ----------------------- | --------------------------------------------------------- |
| `loom.pcb-preview.review`       | `PcbReviewInput` | `PcbReviewResult`       | TerminalOperate (runs `kicad-cli` or the tscircuit build) |
| `loom.pcb-preview.latestReview` | `PcbReviewInput` | `PcbLatestReviewResult` | OrchestrationRead                                         |

Add both to `FORK_RPC_REQUIRED_SCOPES` (`apps/server/src/fork/rpcAuthorization.ts:21-46`) and
`review` to `FORK_CLIENT_GUARDED_RPC_SCOPES`
(`packages/contracts/src/fork/clientRpcPermissions.ts:10-23`).

### Project settings

`PcbProjectSettings` is defined by L58 (TECHNICAL.md, "Project settings"). If L58 has not
landed, create it, the store, the `projectSettings` / `updateProjectSettings` pair and the
`loom_pcb_check_settings` tool exactly as L58 specifies, with only the `review` key. Add:

```ts
const ParamValue = Schema.Union([Schema.Number, Schema.String]);
export const PcbReviewWaiver = Schema.Struct({
  designId: TrimmedNonEmptyString,
  findingId: TrimmedNonEmptyString,
  note: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  at: IsoDateTime,
});
export const PcbReviewSettings = Schema.Struct({
  /** Overrides of each rule's default; unknown ids are kept and ignored. */
  rules: Schema.Record(Schema.String, Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  params: Schema.Record(Schema.String, Schema.Record(Schema.String, ParamValue)).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  waivers: Schema.Array(PcbReviewWaiver).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
// PcbProjectSettings gains:
//   review: PcbReviewSettings.pipe(Schema.withDecodingDefault(Effect.succeed({})))
// PcbUpdateProjectSettingsInput gains:
//   review: Schema.optional(Schema.Struct({
//     rules: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
//     params: Schema.optional(
//       Schema.Record(Schema.String, Schema.Record(Schema.String, ParamValue)),
//     ),
//     waive: Schema.optional(list({ designId, findingId, note? }, 100)),
//     unwaive: Schema.optional(list({ designId, findingId }, 100)),
//   }))
```

Updates merge `rules` and `params` per key and apply `waive` and `unwaive` by
`(designId, findingId)`. The store keeps at most 2,000 waivers per project and drops the oldest.
Parameter values are validated at run time against the rule's parameter definition; an invalid
value falls back to the default and adds a notice ("Decoupling distance must be 1 to 50 mm; using
5 mm.").

With L58 present, `PcbAutoChecks` gains
`review: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false)))` and
`PcbCheckActivity.ranAt` gains optional `review`.

### Finding markers

Review findings become L52's `PcbFinding` on the client with `source: "review"`, `severity`
unchanged, `message`, `sheet` and `pointMm` from `schematic` (schematic surface) or `board`
(board surface, `layer` copied). Waived findings count as excluded.

## Server

### `reviewModel.ts`

```ts
type PinType =
  | "input"
  | "output"
  | "bidirectional"
  | "tri_state"
  | "passive"
  | "free"
  | "unspecified"
  | "power_in"
  | "power_out"
  | "open_collector"
  | "open_emitter"
  | "no_connect"
  | "unknown";
type PartKind =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "ferrite"
  | "led"
  | "diode"
  | "tvs"
  | "ic"
  | "regulator"
  | "connector"
  | "switch"
  | "crystal"
  | "transistor"
  | "module"
  | "other";
type ReviewPin = {
  part: string;
  number: string;
  name: string;
  net: string;
  type: PinType;
  unconnected: boolean;
  noConnectFlag: boolean;
  hints: ReadonlySet<string>;
  schematic?: Loc;
  board?: Loc;
};
type ReviewPart = {
  ref: string;
  value: string;
  libId: string;
  mpn: string;
  kind: PartKind;
  ohms?: number;
  farads?: number;
  ratedVolts?: number;
  pins: ReviewPin[];
  schematic?: Loc;
  board?: Loc;
};
type ReviewNet = {
  name: string;
  pins: ReviewPin[];
  role: "ground" | "power" | "signal";
  volts?: number;
  voltsAssumed: boolean;
};
type ReviewModel = {
  designKind: "kicad" | "tscircuit";
  parts: ReadonlyMap<string, ReviewPart>;
  nets: ReadonlyMap<string, ReviewNet>;
  has: { pinTypes: boolean; libIds: boolean; boardPositions: boolean; noConnects: boolean };
  notices: string[];
};
```

Exports `kicadReviewModel(inspection, netlist, noConnects)` and
`circuitJsonReviewModel(json, inspection)`, both pure and throwing only on malformed input.

KiCad, from `PcbInspection` plus the netlist text:

1. Parse the netlist with `parseSexp` (`semantics.ts:9`). From `components/comp` read `ref`,
   `value`, `libsource` `lib` and `part` (`libId = lib + ":" + part`), and fields named
   `MPN`, `Manufacturer_Part_Number` or `Voltage`. From `nets/net/node` read `ref`, `pin`,
   `pintype`; split `pintype` on `+` and set `unconnected` when the suffix is `no_connect` or
   the net has one node. Nodes whose `ref` starts with `#` are not parts; a `#PWR` or `#FLG`
   node marks its net as power or ground by name and adds no pin.
2. Join with the inspection by reference and pin number for schematic and board positions.
3. Mark `noConnectFlag` on pins whose schematic position is within 0.01 mm of a
   `(no_connect (at x y))` item on the same sheet. `sourceInspection` gains an optional collector
   argument that records these points per sheet as it already walks every sheet
   (`PcbPreviewService.ts:1414-1446`); no file is read twice.
4. If the netlist export failed, build the model from the inspection alone with every pin type
   `unknown` and `has.pinTypes = false`. Rules that need pin types report `limited`.

tscircuit, from the circuit JSON already built by the `asset` path:

1. Parts from `source_component` (`ftype`, `name`, `display_value`, `resistance`,
   `capacitance`, `max_voltage_rating`, `manufacturer_part_number`).
2. Pins from `source_port`: type from flags (`is_input` and not `is_output` gives input,
   both gives bidirectional, `is_output` gives output, `provides_power` gives power_out,
   `requires_power` gives power_in, `is_passive` gives passive, `do_not_connect` gives
   no_connect, otherwise unknown). Hints from `needs_external_pullup`,
   `can_use_internal_pullup`, `should_have_decoupling_capacitor`,
   `recommended_decoupling_capacitor_capacitance`, the i2c, spi and uart role flags, and
   `port_hints`.
3. Nets and positions from the existing `inspectCircuitJson` result; roles from
   `source_net.is_power` and `is_ground`, then names.
4. `has.pinTypes` is true when at least half of the chip ports carry a direction or power flag;
   otherwise rules fall back to names and the notice in PRODUCT.md is added.

Shared helpers in `reviewModel.ts`:

- `classify(part)`: first match wins. tscircuit `ftype` map, then KiCad `libId` patterns, then
  value and MPN patterns (TVS, regulators from the table), then reference prefix. Patterns live
  in `reviewData.ts`.
- `parseValue(text, unit)`: SI values with optional unit and the European form, so `10k`,
  `4k7`, `4.7kΩ`, `100n`, `0.1uF`, `100nF/50V`, `2u2 16V` parse; returns value and optional
  volts. Unknown text gives `undefined`, never a guess.
- `netRole(name, flags)`: ground for `GND`, `AGND`, `DGND`, `PGND`, `GNDA`, `GNDD`, `VSS*`,
  `0V`, or `is_ground`; power for `VCC*`, `VDD*`, `VBUS`, `VBAT`, `VIN`, `VSYS`, `V+`, names that
  parse as a voltage (`+3V3`, `3.3V`, `+5V`, `VCC_1V8`, `+12V`), a power symbol, a `power_out`
  regulator pin, or `is_power`. Otherwise signal.
- `netVolts(name)`: `+3V3` and `3V3` are 3.3, `+5V` is 5, `1V8` is 1.8, `+12V` is 12, `VBUS`
  is 5 with `voltsAssumed`. Others are unknown.
- `throughSeries(net, model)`: the set of nets joined to `net` by two-pin resistors of at most
  100 ohms, ferrite beads and inductors, used by the ESD and LED walks.

### `reviewData.ts`

Data only: name patterns (I2C, reset, GPIO, UART, USB data pins, power and ground names), the
classification tables, and the regulator table below. Each table has a comment with its source.

Regulator table. Every value must be checked against the linked datasheet before the packet
ships; the implementing agent fills `sourceUrl` with the manufacturer datasheet and sets
`checkedOn`. The numbers below are typical datasheet figures from memory, labelled unverified.

| Match (value or MPN, case-insensitive)    | `vinMaxV` | `dropoutV` | Fixed outputs               | `minOutputCapUf` | Status     |
| ----------------------------------------- | --------- | ---------- | --------------------------- | ---------------- | ---------- |
| `AMS1117(-\d\.\d\|-ADJ)?`                 | 15        | 1.3        | 1.5, 1.8, 2.5, 2.85, 3.3, 5 | 22               | Unverified |
| `LM1117`                                  | 15        | 1.2        | 1.8, 2.5, 3.3, 5            | 10               | Unverified |
| `AP2112K?-(1\.8\|2\.5\|2\.6\|3\.0\|3\.3)` | 6         | 0.25       | from suffix                 | 1                | Unverified |
| `MCP1700`                                 | 6         | 0.35       | 1.2 to 5.0 from suffix      | 1                | Unverified |
| `XC6206`                                  | 6         | 0.25       | from suffix                 | 1                | Unverified |
| `(L\|LM\|MC\|UA)78(05\|09\|12\|15)`       | 35        | 2          | 5, 9, 12, 15                | 0.1              | Unverified |

```ts
type RegulatorEntry = {
  id: string;
  match: RegExp;
  vinMaxV: number;
  dropoutV: number;
  fixedOutputs?: readonly number[];
  outputFromSuffix?: boolean;
  minOutputCapUf?: number;
  sourceUrl: string;
  checkedOn: string | null; // null keeps the entry out of rating checks
};
```

An entry with `checkedOn: null` is used only to recognize a regulator and its output voltage,
never for limits, so an unverified number can never produce a finding.

### `reviewRules.ts`

Rules are data plus one matcher each:

```ts
type ReviewRuleDefinition = {
  id: string;
  title: string;
  summary: string;
  defaultSeverity: "error" | "warning" | "info";
  defaultEnabled: boolean;
  needs: ReadonlyArray<"pinTypes" | "libIds" | "boardPositions" | "noConnects">;
  params: Record<
    string,
    {
      default: number | string;
      min?: number;
      max?: number;
      options?: readonly string[];
      label: string;
    }
  >;
  suppress: string; // shown on every finding
};
type Matcher = (model: ReviewModel, params: Params) => RawFinding[];
export const REVIEW_RULES: readonly ReviewRuleDefinition[];
export const REVIEW_RULES_VERSION = 1; // bump when any matcher's output changes
export function runReview(model: ReviewModel, settings: PcbReviewSettings): ReviewOutput;
```

`runReview` runs each enabled rule; a rule whose `needs` are missing runs its fallback when it
has one, otherwise records `limited`. It builds ids, applies the 500 cap after sorting by
severity, rule order and reference, and returns findings plus `rules` and `notices`. Waivers
are applied by the service on read, not here, so waiving never needs a rerun.

Finding id: `review:<rule>:` plus FNV-1a over the rule id, the sorted part references, the
sorted net names and a rule-specific discriminator (such as the pin number). The same
`fnv1a` helper as L52's `findingId` (`kicadReports.ts`); if L52 is absent, add it there.

Every finding's `suppress` text is the rule's: "Turn off this rule for the project in Rules,
or choose Ignore here for this finding.".

### Rules

Summary:

| Id                  | Default                                             | KiCad                                    | tscircuit                                   |
| ------------------- | --------------------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| `i2c-pullup`        | warning, on                                         | Full (names, pin functions)              | Full (role flags or names)                  |
| `decoupling`        | warning, on; board distance info                    | Full with pin types; names otherwise     | Flags or names; distance when placed        |
| `connector-esd`     | warning, on, USB only                               | Lib ids and pin names                    | `standard: "usb_c"` and names               |
| `floating-input`    | warning, on                                         | Full with pin types and no-connect flags | Flags; skipped without them                 |
| `reset-pullup`      | info, on                                            | Pin names                                | Pin names                                   |
| `led-resistor`      | warning, on                                         | Full                                     | Full (`simple_led`)                         |
| `multiple-drivers`  | warning (KiCad, UART names only); error (tscircuit) | UART names                               | Flags and UART names                        |
| `regulator-ratings` | warning, on                                         | Value or MPN in table                    | MPN in table; `simple_power_source` voltage |

#### `i2c-pullup`

- Checks: every I2C clock and data net has a pull-up resistor to a supply.
- How: a net is I2C when its name matches `(^|[_/.-])(I2C\d*_|TWI_)?S(DA|CL)\d*($|[_/.-])`
  (case-insensitive), when an IC pin on it is named `SDA`, `SCL`, `I2C_SDA` or `I2C_SCL`, or
  when a tscircuit port on it is configured for or supports i2c sda or scl. The net passes when
  a resistor (or resistor array pin) has one pin on it and its other pin on a power net. One
  finding per net, anchored at the first IC pin.
- Message: "SDA has no pull-up resistor to a supply." Why: "Net I2C1_SDA connects U1 pin 42
  (SDA) and U4 pin 5 (SDA). No resistor joins it to a supply net." Fix: "Add a pull-up, often
  2.2 k to 10 k, to the bus supply."
- Severity: warning; info when the net also reaches a connector pin ("Pull-ups may be on the
  other board.").
- False positives: pull-ups on a module or another board; pull-ups behind a level shifter; a
  pull-up to a supply net with an unusual name not recognized as power; displays that label a
  3-wire SPI data pin `SDA`.
- Data: net names, pin names, resistor classification. KiCad: available. tscircuit: available.

#### `decoupling`

- Checks: each IC power input has a capacitor to ground on the same net, and on the board the
  nearest such capacitor is close to the pin.
- How: for each part of kind `ic` (not `regulator`, `module` or `connector`) with at least
  three pins, collect power pins: type `power_in` (KiCad), `requires_power` or
  `should_have_decoupling_capacitor` (tscircuit), or, without pin types, names matching
  `VCC`, `VDD`, `AVDD`, `VDDA`, `VDDIO`, `DVDD`, `V+`, `VBAT`. Group them by net; skip ground
  nets. A net passes when a capacitor has one pin on it and the other on a ground net. One
  warning per IC and failing net. If tscircuit gives a recommended capacitance and the sum of
  qualifying capacitors on the net is lower, warning "has less decoupling than recommended".
- Distance: when the IC and the capacitors are placed on the board, measure from each power pin
  pad to the nearest qualifying capacitor pad on that net. Above `maxDistanceMm`, one info
  finding per IC and net: "C12 is 14.2 mm from U3 pin 8 (VDD)." Fix: "Place a capacitor within
  5 mm of the pin." Only capacitors on the same supply net count, so a capacitor near the IC on
  another rail does not hide the problem.
- Params: `maxDistanceMm` default 5, range 1 to 50.
- False positives: power pins fed from an internal regulator (core supply pins typed
  `power_in` that need a specific capacitor are still correct to flag); ICs whose decoupling
  sits on a shared rail at the board edge on purpose; analog references. Modules are skipped,
  which can hide a module that needs bulk capacitance.
- Data: pin types or names, capacitor classification, board pin positions. KiCad: pin types
  from the netlist, positions from the board. tscircuit: flags or names, positions when placed.

#### `connector-esd`

- Checks: signal lines leaving the board through a USB connector (or any connector with
  `scope: "all-connectors"`) have an ESD or TVS part on them.
- How: a connector is USB when its lib id, value or MPN matches `USB` or tscircuit
  `standard: "usb_c"`. Its signal pins are those named `D+`, `D-`, `DP`, `DN`, `CC1`, `CC2`,
  `SBU1`, `SBU2` (USB) or every pin on a signal net (all connectors). For each signal net,
  expand with `throughSeries`, then pass when any part of kind `tvs` has a pin in that set. One
  finding per connector listing unprotected nets.
- Message: "J1 (USB) has no ESD protection on D+, D-." Fix: "Add a low-capacitance ESD array
  such as a USB-rated TVS between the connector and the IC."
- Params: `scope`, options `usb` (default) and `all-connectors`.
- False positives: transceivers with system-level ESD ratings that a designer accepts;
  protection parts not recognized by the TVS patterns; internal-only connectors in
  `all-connectors` scope.
- Data: lib ids or values, pin names. KiCad: available. tscircuit: available when the connector
  sets `standard` or a USB name.

#### `floating-input`

- Checks: input pins that can float.
- How, three cases:
  1. A pin of type `input` with `noConnectFlag` set. ERC accepts a no-connect flag on an input,
     but a CMOS input left open floats. KiCad only; tscircuit ports with `do_not_connect` are
     not inputs.
  2. A net that has an `input` pin, no driving pin (`output`, `bidirectional`, `tri_state`,
     `power_out`, `open_collector`, `open_emitter`), no resistor to a power or ground net, and
     at least one connector or switch pin. It floats when nothing is plugged in or the switch is
     open; ERC treats the passive connector pin as acceptable and stays silent. Bidirectional
     pins named like GPIO (`P[A-K]\d+`, `GPIO\d+`, `IO\d+`, `RA\d`..`RE\d`) on such a net give
     an info finding instead: "unless firmware enables an internal pull-up".
  3. tscircuit: a port with `needs_external_pullup` whose net has no resistor to a supply.
- Unconnected input pins without a flag are left to ERC (`pin_not_connected`) to avoid two
  reports of one problem.
- Message: "U2 pin 5 (EN) can float when SW1 is open." Fix: "Add a pull-up or pull-down
  resistor, or enable an internal one in firmware."
- False positives: inputs with internal pulls that the library does not model; connectors that
  always carry a driven signal from a cable; switches wired to ground on a net that has a pull
  elsewhere through a part Loom does not classify as a resistor.
- Data: pin types and no-connect flags. KiCad: available (netlist plus schematic). tscircuit:
  case 3 always; cases 1 and 2 only with flags, otherwise `limited`.

#### `reset-pullup`

- Checks: reset inputs are held in a defined state.
- How: IC pins named `RESET`, `RST`, `NRST`, `MCLR`, `~{RESET}`, `~{RST}`, `RESETN`, `RESET_N`,
  `RSTN`, or `EN` and `CHIP_PU` on parts whose value matches ESP32 patterns. The net passes when
  it has a resistor to a power or ground net, a capacitor to ground, or a driving pin from
  another part (a supervisor or open-drain output). One finding per pin.
- Message: "U1 reset pin NRST has no pull-up or capacitor." Fix: "Many parts have an internal
  pull-up; check the datasheet. A 10 k pull-up and 100 nF to ground make reset dependable."
- Severity: info, because many MCUs pull reset internally.
- False positives: internal pull-ups (common), active-high resets that want a pull-down (a
  resistor to ground passes), resets driven only from a programming header on purpose.
- Data: pin names, resistor and capacitor classification. Both: available.

#### `led-resistor`

- Checks: each LED has a current-limiting element in its path.
- How: for each part of kind `led` (KiCad lib ids `Device:LED*`, references `D` or `LED` with an
  LED value; tscircuit `simple_led`), follow each pin's net, through other LEDs in a series
  string (nets with exactly two LED pins). Pass when the string touches a resistor, an
  inductor, or an IC pin that is not a power pin and whose part value or name matches LED driver
  patterns (`LED`, `ISET`, `OUT\d+` on parts matching driver names). Fail when every end lands
  on power or ground nets, GPIO-like IC pins, or connectors. Multi-die LEDs (RGB) are checked
  per die pin.
- Message: "D3 has no series resistor." Why: "D3 connects +3V3 to U1 pin 12 (PA5) with nothing
  in between." Fix: "Add a series resistor sized for the LED current."
- False positives: constant-current drivers not matched by the patterns; LEDs on a PWM pin
  driven through a transistor whose base resistor Loom sees but whose collector path it does
  not follow (the transistor end passes, so this is a false negative risk instead).
  Addressable LEDs are not `led` kind (they are ICs).
- Data: classification and nets. Both: available.

#### `multiple-drivers`

- Checks: nets driven from more than one source.
- How: in KiCad, only name-based UART crossings, because ERC's pin matrix already reports
  output-to-output and power-output conflicts: a net with two IC pins from different parts both
  named `TX`, `TXD`, `UART_TX` (or both `RX` variants) gives a warning "TX connects to TX". In
  tscircuit, which has no ERC, also: two or more pins with `is_output` (and not
  `is_bidirectional`) from different parts, or `provides_power` from two different parts on
  one net, give an error.
- Message: "U1 TX and U5 TXD are on the same net." Fix: "Cross the lines: TX goes to RX."
  tscircuit: "Two outputs drive net LED_EN: U1 pin 4 and U2 pin 1."
- False positives: devices labelled from the other side's point of view (some modules name
  pins for the host); open-drain outputs that tscircuit marks only `is_output`.
- Data: pin names (both); output and power flags (tscircuit).

#### `regulator-ratings`

- Checks: input voltage, headroom, output voltage and capacitors around linear regulators.
- How: parts of kind `regulator` (KiCad lib `Regulator_Linear` or `Regulator_Switching`,
  or a table match). Input pin by name (`VIN`, `IN`, `VI`) or type `power_in`; output by
  `VOUT`, `OUT`, `VO` or `power_out`. With a verified table entry:
  - input net volts above `vinMaxV`: warning "+12V is above the AMS1117's 15 V limit" style;
  - input minus output volts below `dropoutV`: warning about headroom;
  - total output capacitance below `minOutputCapUf`: warning.
    Without an entry (or unverified): only these:
  - fixed output from the name suffix (`-3.3`, `-33`, `3V3`, `-5.0`) differs from the output
    net's volts by more than 3 percent: warning "U2 is a 3.3 V regulator on net +5V";
  - no capacitor from input to ground, or from output to ground: warning;
  - a capacitor whose parsed voltage rating is below the net's volts: warning.
    tscircuit `simple_power_source.voltage` supplies input volts where net names do not.
- False positives: net names that do not match the real voltage; `VBUS` assumed 5 V (the
  finding says "assumed"); adjustable regulators (no fixed output check); switching regulators
  where the table has no entry (capacitor checks only).
- Data: values or MPNs, pin names or types, net names. KiCad: available. tscircuit: available
  when parts carry an MPN or name.

### Service method

`PcbPreviewService.ts` gains `review` and `latestReview` (interface `:85-160`, exports
`:2568-2606`, handlers in `rpc.ts`):

1. `resolveDesign`, `sourceSnapshot`. A KiCad design without a schematic fails with
   `unsupported-view` and "This design has no schematic to review.".
2. KiCad: `sourceInspection` with the no-connect collector, then `schematicConnectivity`, which
   now also returns the netlist text it already reads (`PcbPreviewService.ts:1803`). The export
   goes through the existing `run` and `kicadLock`, 60 s timeout. A failed export is not fatal
   (model without pin types). tscircuit: `asset(circuit-json)` and `inspectCircuitJson`, as
   `inspect` does (`:1818-1859`).
3. Build the model, read the project's settings, `runReview`.
4. Persist to `checksDir/hashKey(workspaceKey, design.id, "review").json` under `cacheLock`
   with the same newer-wins rule as checks (`:1139-1150`), then `prune()`. With L58, publish on
   `checkBus`.
5. Return the result with waivers applied: findings whose `(designId, id)` is waived get
   `waived: true` and the note, and `counts.waived` is recomputed.

If a stored result's `sourceHash` and `configHash` both match the current ones, `review` returns
it (with waivers applied) without running anything.

`latestReview` reads the file (4 MiB cap, like `latestChecks` at `:1156-1169`), applies waivers
and returns it, or null.

## Storage

- New: one review result per design in the existing checks directory.
- Project settings: the `review` key in `<stateDir>/fork/pcb-preview/project-settings.json`.
- Client: one preference, `reviewShowWaived`, in `preferences.ts` with a decoding default
  (`false`), since a failed decode resets all preferences (`preferences.ts:23-29`).

## Clients

Web and desktop only.

- `packages/client-runtime/src/fork/pcb-preview.ts`: `latestReview` query family and a
  `review` command whose `onSuccess` refreshes it. With L58, `ranAt.review` from
  `checkEvents` refreshes it too.
- `usePcbPreview.ts`: a review job beside the check job (`:145-172`), with run and cancel; the
  same merge by `ranAt`.
- `Inspector.tsx` `inspectorTabs` (`:114-124`): Checks shows for every design.
- `ChecksView.tsx`: the kind switch gains "Review". tscircuit designs show only Review.
  `onLocate` widens from `PcbCheckKind` to a surface argument so review findings can locate on
  the schematic or the board.
- New `ReviewView.tsx` renders the card: run and cancel, the states in PRODUCT.md, findings
  grouped by rule with message, "Why", parts, "Locate" and "Ignore here" (a popover with an
  optional note), "Show ignored (n)" with "Stop ignoring", and a "Rules" menu with one switch
  per rule plus the two parameters (a number input for the decoupling distance, a select for
  ESD scope). Switches and "Ignore here" use `updateProjectSettings` and are disabled without
  its permission.
- Status bar (`PcbPreviewPanel.tsx:1356-1379`): a "Review 3" or "Review clean" chip, same tones
  and stale rule as ERC and DRC.
- `findings.ts` (L52): `reviewFindings(result, surface, { showExcluded })`; the panel
  concatenates them with ERC and DRC markers so stepping with `.` and `,` covers review too.

No animation.

## Agent-facing tools

- New `loom_pcb_review` in `mcp.ts`: parameters `{ designId }`, success `PcbReviewResult`,
  `actsAsCaller` (it can run tools), title "PCB: review". Description: "Run Loom's schematic
  review rules on saved source: I2C pull-ups, decoupling, connector ESD, floating inputs, reset
  pins, LED resistors, multiple drivers and regulator ratings. Heuristics, not ERC. Each finding
  says why it fired. Turn rules off or ignore a finding with loom_pcb_check_settings.". Returns
  the stored result when nothing changed.
- `loom_pcb_check_settings` (L58) gains the `review` object for rules, params, waive and
  unwaive; its read result includes `review`.
- `loom_pcb_editor` snapshot (L52) lists review markers with the others.
- CLI: `t3 pcb review '{"designId":"..."}'` through `cli.ts:13-15`.

## Performance

- Tool time: one netlist export per KiCad review (the same export `inspect` runs; seconds,
  estimated and unverified) and no tool for a tscircuit design whose circuit JSON is cached.
- Rules: linear in parts plus net members, with per-net indexes built once; within the
  inspection caps (5,000 parts, 10,000 members per net) this is milliseconds.
- Wire: results capped at 500 findings; typical results are a few kilobytes. The stored result
  is reused when nothing changed, so repeated agent calls cost a file read.
- Client: the card renders only when Checks is open on Review; markers reuse L52's layer.

## Alternatives considered

- `loom_pcb_check` with `kind: "review"`. Rejected: `PcbCheckKind`, the violation severity
  union and `PcbLatestChecksResult` would change for every existing client and agent; review
  findings also need `why`, `fix` and two anchors that ERC rows do not have.
- Ask a model to review the schematic. Not deterministic, costs tokens, and cannot be pinned in
  tests. An agent can still do that on top of these findings.
- KiCad custom DRC rules (`.kicad_dru`). They express board geometry, not schematic intent such
  as pull-ups.
- Store waivers in the KiCad schematic as symbol fields. Portable and visible in KiCad, but it
  edits user source and has no tscircuit equivalent; per-project waivers are enough for now.
- User-defined rules in a config file. More flexible, but a matcher is code; data-only rules
  could express only name patterns. Revisit if users ask.
- Run the rules in the browser. The client lacks the netlist and would ship the rule tables to
  every client; agents need the server path anyway.
