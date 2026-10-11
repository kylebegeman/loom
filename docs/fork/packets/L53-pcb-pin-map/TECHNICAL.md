# L53 technical design

Cited lines are from `docs/model-preview-follow-ups` at `8676e099e5`.

## Overview

A pin map is a pure function of one `PcbInspection` and a component reference. The inspection
already carries each component's pins with number, name and net
(`packages/contracts/src/fork/pcb-workspace.ts:16-31`) and every net's members (`:38-44`), for
KiCad (`apps/server/src/fork/pcb-preview/semantics.ts:66-89`, merged with the schematic netlist
at `:275-302`) and for tscircuit (`semantics.ts:309-405`). Two small additions make the map
honest: the pin's electrical type (to recognize power and no-connect pins) and, for KiCad, the
symbol's base pin name and library part (to recognize STM32 pins with an alternate assigned and
to detect the family).

The generator lives in one contracts module so the web dialog previews instantly from the
inspection it holds, and the server produces byte-identical text for the agent tool and for
saving. The only new RPC is `pinMap`, which the dialog calls to save.

```text
PcbInspection ──buildPinMap(reference, options)──▶ PcbPinMap ──renderPinMap(format)──▶ text
      ▲                                                  │
  inspect (existing)                     dialog table, MCP JSON, saved file
```

## Contracts

### Additions to `packages/contracts/src/fork/pcb-workspace.ts`

```ts
export const PcbPin = Schema.Struct({
  number: text(),
  name: Schema.String,
  net: Schema.String,
  /** KiCad pin type: "power_in", "passive", "bidirectional", ... plus "+no_connect". */
  type: Schema.optional(text(64)),
  /** Symbol library pin name when the reported name differs (an alternate is assigned). */
  baseName: Schema.optional(text(200)),
  pcb: Schema.optional(PcbLocation),
  schematic: Schema.optional(PcbLocation),
});
export const PcbComponent = Schema.Struct({
  // existing fields unchanged
  /** Library part, "lib:part", from the netlist libsource or Circuit JSON ftype. */
  symbol: Schema.optional(text(400)),
});
```

All optional: older servers omit them, older clients drop them on decode (Effect structs ignore
unknown keys). `PcbInspection` is never persisted, so no stored data needs a default. No
`PcbWorkspace` field is added; that struct (`pcb-workspace.ts:120-128`) has no decoding defaults,
which only matters to packets that add workspace fields.

### New `packages/contracts/src/fork/pcb-pin-map.ts`

Re-exported from `packages/contracts/src/fork/index.ts`.

```ts
export const PcbPinMapFormat = Schema.Literals([
  "markdown",
  "c",
  "rust",
  "micropython",
  "circuitpython",
  "arduino",
]);
export const PcbPinFamily = Schema.Literals(["rp2", "esp32", "esp32s3", "stm32", "avr", "pins"]);
export const PcbPinRowKind = Schema.Literals([
  "signal",
  "power",
  "ground",
  "no-connect",
  "unconnected",
]);

export const PcbPinMapRow = Schema.Struct({
  pin: text(),
  pad: Schema.NullOr(text()), // null: no board pad carries this pin
  name: Schema.String,
  baseName: Schema.optional(Schema.String),
  net: Schema.String,
  kind: PcbPinRowKind,
  gpio: Schema.NullOr(
    Schema.Struct({
      label: text(32), // "25", "PA5", "PB5 (D13)"
      port: Schema.NullOr(text(2)), // "A" for STM32 and AVR, null otherwise
      number: Schema.Number, // GPIO number, or bit within the port
      arduino: Schema.optional(text(8)), // "D13", "A0", "PA5", "25"
    }),
  ),
  identifier: Schema.String, // constant name used in generated files
  included: Schema.Boolean, // after the power and not-connected toggles
  others: list(Schema.Struct({ reference: text(), pin: text() }), 64),
  othersTotal: Schema.Number,
});
export const PcbPinMap = Schema.Struct({
  reference: text(),
  value: Schema.String,
  symbol: Schema.optional(Schema.String),
  family: PcbPinFamily,
  detectedFrom: Schema.Literals(["override", "symbol", "value", "pin-names", "default"]),
  formats: list(
    Schema.Struct({
      format: PcbPinMapFormat,
      available: Schema.Boolean,
      reason: Schema.optional(Schema.String),
    }),
    6,
  ),
  rows: list(PcbPinMapRow, 2048),
  warnings: list(Schema.String, 50),
});

export const PcbPinMapInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  reference: text(),
  family: Schema.optional(PcbPinFamily),
  format: PcbPinMapFormat.pipe(Schema.withDecodingDefault(Effect.succeed("markdown"))),
  /** Constant name overrides keyed by pin number. */
  names: Schema.optional(Schema.Record(text(), identifierText)),
  includePower: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  includeNoConnect: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  save: Schema.optional(
    Schema.Struct({
      path: text(1024),
      overwrite: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
    }),
  ),
  expectedSourceHash: Schema.optional(text()),
});
export const PcbPinMapResult = Schema.Struct({
  sourceHash: text(),
  map: PcbPinMap,
  format: PcbPinMapFormat,
  text: Schema.String.check(Schema.isMaxLength(512 * 1024)),
  saved: Schema.NullOr(Schema.Struct({ path: text(1024), bytes: Schema.Number })),
});
```

`identifierText` is `^[A-Za-z_][A-Za-z0-9_]{0,63}$`. Decoding defaults follow
`packages/contracts/src/fork/model-preview-3d.ts:237`. The `names` record is capped by `rows`
(2048) in the service, which rejects more keys than pins.

Pure functions in the same file:

```ts
export function detectFamily(component: PcbComponent): {
  family: PcbPinFamily;
  detectedFrom: PcbPinMap["detectedFrom"];
  variant?: string;
};
export function parseGpio(
  family: PcbPinFamily,
  name: string,
  variant?: string,
): PcbPinMapRow["gpio"];
export function pinKind(pin: PcbPin): PcbPinRowKind;
export const isGroundNet: (net: string) => boolean;
export const isPowerNet: (net: string) => boolean;
export function sanitizeIdentifier(raw: string, taken: Set<string>): string;
export function validateIdentifier(name: string, format: PcbPinMapFormat): string | null;
export function buildPinMap(
  inspection: PcbInspection,
  reference: string,
  options: {
    family?: PcbPinFamily;
    names?: Record<string, string>;
    includePower: boolean;
    includeNoConnect: boolean;
    netIndex?: ReadonlyMap<string, readonly { reference: string; pin: string }[]>;
  },
): PcbPinMap | null; // null when the reference is not in the inspection
export function renderPinMap(
  map: PcbPinMap,
  format: PcbPinMapFormat,
  context: { designId: string; sourceHash: string },
): string;
export function pinMapFileName(format: PcbPinMapFormat): "pins.h" | "pins.rs" | "pins.py" | null;
```

#### Family detection

In order, first match wins: `options.family`; `component.symbol` (part after `:`); `value`;
pin names (four or more pins match one family's pattern, the most matches wins); otherwise
`pins`.

| Family    | Symbol or value test                                            | Pin-name pattern                                                         |
| --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `rp2`     | `/RP2040\|RP2350\|RP235[04]/i`                                  | `^GPIO(\d{1,2})(?:_ADC\d)?$`, `^GP(\d{1,2})$`                            |
| `esp32s3` | `/ESP32-?S3/i`                                                  | as `esp32`                                                               |
| `esp32`   | `/ESP32/i` (variant kept: classic, C3, C6, S2, H2)              | `^(?:IO\|GPIO)(\d{1,2})$`, `SENSOR_VP` 36, `SENSOR_VN` 39, `TXD0`/`RXD0` |
| `stm32`   | `/^STM32/i`                                                     | `^P([A-K])(\d{1,2})(?:[-_/].*)?$`                                        |
| `avr`     | `/^AT(?:mega\|tiny)/i` (variant kept, for example `ATmega328P`) | `^P([A-H])([0-7])(?:[-_/].*)?$`                                          |

`TXD0` and `RXD0` map to 1 and 3 for classic ESP32 and to 43 and 44 for ESP32-S3; for other
variants `gpio` is null and a warning names the pin. `SENSOR_VP` and `SENSOR_VN` apply to classic
ESP32 only. For `stm32`, when `name` does not parse and `baseName` does, `baseName` is used.

#### Row kinds

- `no-connect`: `type` ends with `no_connect` (`"no_connect"` or `"...+no_connect"`), or the net
  starts with `unconnected-(` (KiCad's name for a pin with no wire).
- `unconnected`: empty net.
- `ground`: `isGroundNet(net)`, `/^(?:[ADP]?GND\w*\|VSS\w*\|0V)$/i` on the last net segment, or a
  `power_in` pin whose name matches the same test.
- `power`: `type` is `power_in` or `power_out`, or `isPowerNet(net)` (the `POWER` test from
  `InspectTab.tsx:46` minus the ground names).
- `signal`: everything else.

`included` is true for `signal`, for `power` and `ground` when `includePower`, and for
`no-connect` and `unconnected` when `includeNoConnect`.

#### Identifiers

`sanitizeIdentifier`: take the net's last `/` segment; when the net is empty, starts with `Net-(`
or `unconnected-(`, use the pin name, then `PIN_<number>`; replace `~{X}` with `X_N`; uppercase;
replace runs of characters outside `[A-Z0-9_]` with `_`; trim `_`; prefix `PIN_` when it starts
with a digit; append `_PIN` for a keyword in any output language (C, Rust and Python keyword
lists in the module, plus Arduino's `HIGH`, `LOW`, `INPUT`, `OUTPUT`, `LED_BUILTIN`); cut to 64
characters; on collision append `_2`, `_3`. Two pins on the same net (for example two GND pins)
get suffixes too. User names from `names` replace the default after `validateIdentifier`, which
also rejects duplicates.

#### Rendering

Every file starts with a comment naming the design id, reference, value, family, source hash and
the limits from PRODUCT.md. Only `included` rows with an identifier are emitted. Rows with no GPIO
emit their pin number with a "connector pin, not a GPIO" comment for `pins` family parts and are
skipped with a comment line for MCU families.

| Format          | rp2, esp32                                                       | stm32                                                                       | avr                                                                    | pins                            |
| --------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| `markdown`      | Table of all rows (included ones) with every column              | same                                                                        | same                                                                   | same                            |
| `c`             | `#define LED_PIN 25`                                             | `#define LED_PORT GPIOA` and `#define LED_PIN GPIO_PIN_5` (STM32 HAL names) | `#define LED_PORT PORTB`, `LED_DDR DDRB`, `LED_PINR PINB`, `LED_BIT 5` | `#define J1_SDA 3`              |
| `rust`          | `pub const LED: u8 = 25;`                                        | `pub const LED_PORT: char = 'A'; pub const LED_PIN: u8 = 5;`                | same shape as STM32                                                    | `pub const J1_SDA: u8 = 3;`     |
| `micropython`   | `LED = 25`                                                       | `from machine import Pin` then `LED = Pin.cpu.A5`                           | not available                                                          | not available                   |
| `circuitpython` | `import microcontroller` then `LED = microcontroller.pin.GPIO25` | not available                                                               | not available                                                          | not available                   |
| `arduino`       | `constexpr uint8_t LED = 25;`                                    | `constexpr uint32_t LED = PA5;`                                             | `constexpr uint8_t LED = 13;` (ATmega328P, 168 only)                   | `constexpr uint8_t J1_SDA = 3;` |

For `pins` family the identifiers get the reference as a prefix (`J1_SDA`), because connector
pin numbers are meaningless without it. CircuitPython for STM32 is off because the CPU pin naming
is unverified (REFERENCES.md); it can be enabled later without a contract change. `formats` in the
map carries each format's availability and reason so the dialog and the agent see the same rules.

## Server

### Netlist and board additions (`apps/server/src/fork/pcb-preview/semantics.ts`)

- `inspectBoard` pins (`:82-89`): add `type: atom(child(p, "pintype"))` when non-empty. KiCad
  writes `pinfunction` and `pintype` on pads when the board is updated from the schematic.
- `mergeNetlist` (`:275-302`): read `(pintype ...)` from each node alongside `pinfunction`; read
  `(components (comp (ref) (libsource (lib) (part))))` into `symbol`; read
  `(libparts (libpart (lib) (part) (pins (pin (num) (name) (type)))))` and set `baseName` when the
  libpart pin name for that number differs from the reported `pinfunction`. Missing sections are
  ignored, so older netlists still merge. Empty strings are not written (the schema requires
  length 1 for `type`).
- `inspectCircuitJson` (`:368-405`): set `symbol` from `source_component.ftype` when present. No
  pin type exists in Circuit JSON (REFERENCES.md); tscircuit rows use the net tests only.

### Service (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts`)

New interface member beside `applyParameters` (`:108`) and implementation beside it (`:2217`),
in a new file `apps/server/src/fork/pcb-preview/pinMap.ts` that exports `makePinMap(deps)` so
the service file only gains the wiring line in its returned object (`:2591`).

```ts
const pinMap = Effect.fn("PcbPreview.pinMap")(function* (input: PcbPinMapInput) {
  const inspection = yield* inspect({ threadId: input.threadId, designId: input.designId });
  if (input.expectedSourceHash && input.expectedSourceHash !== inspection.sourceHash)
    return yield* failure("conflict", "The design changed. Review the pin map again.");
  const map = buildPinMap(inspection, input.reference, input);
  if (!map) return yield* failure("invalid-parameters", `No part ${input.reference} here.`);
  // names: validate each, reject unknown pin numbers and more keys than rows
  // format: reject when map.formats marks it unavailable, with its reason
  const text = renderPinMap(map, input.format, { designId, sourceHash });
  const saved = input.save ? yield* save(input.save, input.format, text) : null;
  return { sourceHash: inspection.sourceHash, map, format: input.format, text, saved };
});
```

`save`:

1. Reject `markdown` ("Copy the Markdown instead of saving it.") and a path whose extension does
   not match the format (`.h` for `c` and `arduino`, `.rs`, `.py`) with `invalid-parameters`.
2. Resolve the parent directory with `safePath(resolved.root, dirname)`
   (`PcbPreviewService.ts:231-250`); `safePath` resolves real paths, so it cannot be given a file
   that does not exist yet. Join the base name, rejecting `..`, separators and names starting
   with `.`. The parent must already exist ("Create the folder first."), which keeps the tool from
   creating directory trees.
3. If the file exists and `overwrite` is false, fail with `conflict` ("A file already exists at
   hw/pins.h."). If it exists and is a directory or symlink, fail with `invalid-parameters`.
4. Exclusive creation for a new file; sibling temporary contents and rename for confirmed replacement. The shared atomic helper follows symlinks, so pin-map exports use a rename that replaces the entry itself.

Saving does not change the design's source hash: generated `.h`, `.rs` and `.py` files are not
design sources for either kind (`PcbPreviewService.ts:557-564`), so the panel does not reload.

Errors use existing `PcbPreviewError` reasons only (`packages/contracts/src/fork/pcb-preview.ts:
190-213`): `conflict`, `invalid-parameters`, `path-outside-workspace`, `design-not-found`.

### RPC

- `PCB_PREVIEW_WS_METHODS.pinMap = "loom.pcb-preview.pinMap"`
  (`packages/contracts/src/fork/pcb-preview.ts:24-40`) and an `Rpc.make` with
  `PcbPinMapInput` and `PcbPinMapResult` after `applyParameters` (`:300-304`).
- Handler in `apps/server/src/fork/pcb-preview/rpc.ts` beside `:26-27`.
- Scope `AuthOrchestrationOperateScope` in both `FORK_CLIENT_GUARDED_RPC_SCOPES`
  (`packages/contracts/src/fork/clientRpcPermissions.ts:18`) and `FORK_RPC_REQUIRED_SCOPES`
  (`apps/server/src/fork/rpcAuthorization.ts:30`), the same as `applyParameters`, because the
  method can write a workspace file. Reading needs no RPC: the client has the inspection.
- Client command `pinMap` in `packages/client-runtime/src/fork/pcb-preview.ts` beside `:105-110`.
- Extend the permission behavior tests for the new method.

## Storage

None. Generated files are ordinary workspace files. Edited names are dialog state. Nothing is
added to `PcbWorkspace` or to device preferences.

## Clients

### Inspect card (`apps/web/src/fork/pcb-preview/InspectTab.tsx`)

Add a `ToolButton` labelled "Pin map" (`ListOrderedIcon`) in the hero head before "Center in
drawing" (`:146-148`), calling a new `onPinMap(reference)` prop. `Inspector.tsx` passes it
through; `PcbPreviewPanel.tsx` owns `pinMapFor: string | null` and renders the dialog.

### `apps/web/src/fork/pcb-preview/PinMapDialog.tsx` (new)

Built from `components/ui` `Dialog`, `DialogPopup`, `DialogHeader`, `DialogPanel` and
`DialogFooter`, as `ExportDialog` does (`WorkspaceChrome.tsx:312-342`); no restyled UI
components.

- State: `family` (`undefined` = Auto), `format`, `includePower`, `includeNoConnect`, `names`
  (record by pin number), `path`, `saving`, `error`, `saved`.
- `map = useMemo(() => buildPinMap(inspection, reference, {...}), [...])`, with a `netIndex`
  memoized once per inspection (`Map` from net name to members), so typing a name does not walk
  every net. `text = useMemo(() => renderPinMap(map, format, ...))`.
- Header: reference, value, "STM32, from symbol MCU_ST_STM32F1:STM32F103C8Tx", the Family menu
  and the two toggles.
- Table: the columns from PRODUCT.md. Rows not `included` are hidden. The Constant cell is an
  `Input`; `validateIdentifier` runs per keystroke and marks the cell with `aria-invalid` and the
  message as its description.
- Preview: a read-only monospace block with `text`, capped at 400 lines on screen with
  "Showing 400 of n lines" (the copy and save use the full text).
- Footer: Format select, "Copy Markdown" (`useCopyToClipboard`, as `ChecksView.tsx:115-118`),
  "Add to draft" (`useComposerDraftStore.getState().setPrompt(threadRef,
appendSummary(prev, markdown))`, as `ChecksView.tsx:150-157`), the path `Input` prefilled with
  `dirname(designId)/pinMapFileName(format)`, and "Save file". Save calls `pcb.pinMap` with
  `save`, `names`, the toggles, `family` and `expectedSourceHash: inspection.sourceHash` through
  `runPcbCommand`. A `conflict` for an existing file turns the button into "Replace" (sends
  `overwrite: true`); a `conflict` for a changed design shows the message and recomputes.
- Permission: the command's `permissionAtom` gates "Save file".
- When the inspection changes, `names` keeps entries whose pin number still exists; when the
  reference disappears the dialog shows "U1 is no longer in this design." and only Close.

### Mobile

None. No PCB panel.

## Agent-facing tools

`loom_pcb_pin_map` in `apps/server/src/fork/pcb-preview/mcp.ts`, defined like
`loom_pcb_apply_parameters` (`:207-222`) and handled with `McpToolAccess.actsAsCaller` like
`:423-431`:

- Description: "Pin table for one part (MCU or connector): pin, pad, name, GPIO number worked
  out from pin names for RP2040/RP2350, ESP32, STM32 and ATmega, net, and other parts on the
  net. Returns JSON plus generated text in format (markdown, c, rust, micropython,
  circuitpython, arduino). Power, ground and not connected pins are excluded unless
  includePower or includeNoConnect. Pass save.path to write the file in the workspace; it fails
  if the file exists unless save.overwrite."
- `Tool.Readonly` false, `Tool.Destructive` false (overwrite is opt-in).
- CLI: `t3 pcb pin_map '{"designId":"hw/main.kicad_pro","reference":"U1","format":"c"}'`
  (`apps/server/src/fork/pcb-preview/cli.ts:11-14` maps the suffix).
- The `loom_pcb_inspect` description gains one sentence: "For firmware pin constants use
  loom_pcb_pin_map."

## Performance

- Client: `buildPinMap` is linear in the part's pins plus the members of its nets, using the
  memoized net index. A 2048-pin part renders the table with plain rows; the preview is capped at
  400 lines. No new requests until Save.
- Server: `pinMap` calls the existing `inspect`. For KiCad designs with a schematic, `inspect`
  reruns the `kicad-cli sch export netlist` export on every call today
  (`PcbPreviewService.ts:1837-1851`). L55 adds an inspection cache keyed by source hash; until it
  lands, each agent call costs one netlist export, the same as `loom_pcb_inspect`.
- Wire: the save request is options plus at most 2048 short names; the result echoes the map and
  text (at most 512 KiB, usually a few KiB). The dialog ignores the echoed map.
- Netlist parsing reads two more sections it already receives; no extra tool run.

## Alternatives considered

- Server-only generation with an RPC for every preview change. Rejected: each change would rerun
  `inspect` (a netlist export without L55's cache) and feel slow over a tunnel.
- Client-only generation with the client sending file text to a generic "write file" RPC.
  Rejected: it would add a general write path for arbitrary text; regenerating on the server keeps
  the write bounded to pin maps.
- A new `packages/shared/pcbPinMap` subpath. Rejected for now: `packages/shared/package.json`
  lists subpaths explicitly, so it is an upstream seam (PRODUCT.md, Decisions needed).
- Persisting edited names in the design workspace. Rejected: needs a new `PcbWorkspace` field and
  a write grant to view a table; the saved file is the record.
- Reading GPIO numbers from vendor pin databases (STM32 CubeMX XML, Espressif pin lists).
  Rejected: new data dependencies and licences for a gain the pin-name rules mostly cover.
