# L53 testing

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                                                                        | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/pcb-pin-map.test.ts` (new)                                                                     | Family detection by override, symbol, value and pin names, and the `pins` default; `parseGpio` for `GPIO26_ADC0`, `GP15`, `IO4`, `SENSOR_VP`, `TXD0` on classic ESP32, S3 and C3 (null plus warning), `PA0-WKUP`, `PC14-OSC32_IN`, `PB5` on ATmega328P with `D13` and on ATmega2560 without an Arduino number, a name with no number; STM32 falls back to `baseName`; row kinds for `power_in`, `+no_connect`, `unconnected-(U1-PA3-Pad12)`, empty net, GND variants; `sanitizeIdentifier` for `/Sensors/I2C_SDA`, `Net-(U1-PA5)`, `~{RESET}`, `3V3_EN`, `int`, `HIGH`, two GND pins, a 90-character net; `validateIdentifier` rejects invalid, keyword and duplicate names; `included` follows the toggles; `others` excludes the part itself and caps at 64 with the total; each format renders a known small part to an exact snapshot string (one per format, as plain string equality), unavailable formats carry reasons; unknown reference returns null. |
| `apps/server/src/fork/pcb-preview/workbench.test.ts` (update; it already covers `mergeNetlist` and `inspectBoard`)          | `mergeNetlist` reads `pintype`, `libsource` and `libparts` from a hand-written kicadsexpr netlist string; sets `baseName` only when names differ; a netlist without `libparts` still merges; `inspectBoard` reads pad `pintype`; `inspectCircuitJson` sets `symbol`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (update)                                                       | `pinMap` returns the map for the fixture design; unknown reference is `invalid-parameters`; mismatched `expectedSourceHash` is `conflict`; save writes the file in a temp workspace and the next `inspect` keeps the same source hash; existing file without `overwrite` is `conflict`, with `overwrite` replaces; `../x.h`, a wrong extension, a missing parent folder and `markdown` are rejected; a path through a symlink outside the workspace is `path-outside-workspace`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/server/src/fork/pcb-preview/mcp.test.ts` (update)                                                                     | `.handle("loom_pcb_pin_map", ...)` decodes defaults (format markdown, toggles off) and returns the service result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/server/src/fork/pcb-preview/realTools.test.ts` (update, runs only with KiCad installed)                               | On the bundled demo, a pin map for an IC has rows with `type` filled from the netlist and identifiers that are all valid C identifiers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/fork/rpcAuthorization.test.ts` and `packages/client-runtime/src/state/commandPermissions.test.ts` (update) | `pinMap` needs the orchestration operate scope on server and client.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

No markup tests for the dialog; its logic is the generator, tested directly.

## Commands

```sh
vp test run packages/contracts/src/fork/pcb-pin-map.test.ts \
  apps/server/src/fork/pcb-preview/workbench.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts \
  apps/server/src/fork/pcb-preview/realTools.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  packages/client-runtime/src/state/commandPermissions.test.ts
vp lint packages/contracts/src/fork apps/server/src/fork/pcb-preview \
  apps/server/src/fork/rpcAuthorization.ts apps/web/src/fork/pcb-preview \
  packages/client-runtime/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`:

1. Open a KiCad board with an RP2040 (or the closest real MCU design). Select U1, press
   "Pin map". GPIO numbers match the schematic labels; power and ground are hidden until toggled.
2. Rename a constant to `int`: the cell is marked and Save is disabled. Rename it to `LED`.
3. Save as C header next to the design. Open the file in the editor: header comment, defines,
   limits. Save again: "Replace" appears. The panel does not reload.
4. Select a connector (J1) on the drawing, open Inspect from the status chip, press "Pin map":
   pin numbers only, identifiers prefixed `J1_`, MicroPython disabled with its reason.
5. Open an STM32 design with an alternate assigned to a pin; confirm the base name hint and the
   GPIO column.
6. "Add to draft": the draft gets the Markdown table.
7. Over a remote connection without the orchestration grant: the table works; Save is disabled
   with "This connection cannot write files."
8. Ask an agent "make pins.h for U1": it calls `loom_pcb_pin_map` with `format: "c"` and
   `save.path`, and the file matches the dialog's preview.
9. Edit the schematic while the dialog is open: the table recomputes and keeps edited names.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
