# L53: Pin map

Status: Ready to build.

Approved by Kyle on 2026-10-10.

Writing firmware for a board means copying pin assignments out of the schematic by hand, and
getting one wrong costs a respin or an afternoon with a scope. This packet adds a "Pin map" for
any selected MCU or connector: a table of pin number, pad, pin name, net and the other parts on
that net. The user can copy it as Markdown, add it to the thread draft, or save a generated
constants file into the workspace for C, Rust, MicroPython, CircuitPython or Arduino. GPIO
numbers are worked out from the symbol's pin names for RP2040 and RP2350, ESP32, STM32 and
ATmega parts, and the dialog says plainly when it could not work one out. Agents get the same
table as JSON from `loom_pcb_pin_map`, so "write the LED driver for this board" starts from the
real pin numbers.

## Scope

- In:
  - `packages/contracts/src/fork/pcb-pin-map.ts` (new): schemas plus the pure generator
    (`buildPinMap`, `renderPinMap`, family detection, GPIO parsing, identifier sanitizing),
    shared by the web dialog and the server.
  - Optional `type` and `baseName` on `PcbPin` and optional `symbol` on `PcbComponent`, read from
    the KiCad netlist and board pads, so power and no-connect pins and STM32 base names are
    known.
  - `apps/web/src/fork/pcb-preview/PinMapDialog.tsx` (new), opened from a "Pin map" button in
    the Inspect hero card.
  - One RPC, `loom.pcb-preview.pinMap`, and service method `pinMap`, used by the dialog to save
    and by the agent tool to read or save.
  - Agent tool `loom_pcb_pin_map` (`t3 pcb pin_map`).
- Out:
  - Peripheral assignment (which pins are SPI, I2C or UART) and alternate function tables.
    Only the pin name the schematic uses is shown.
  - Board support package generation, device tree, Zephyr overlays, HAL init code.
  - Families beyond the four listed. Other parts and connectors get pin numbers only.
  - Editing the schematic from the table.
  - Remembering edited constant names across sessions (see PRODUCT.md, Decisions).
  - Mobile UI.

## Surfaces

- Web and desktop: Inspect tab, KiCad and tscircuit designs.
- Mobile: no PCB panel.
- Remote: the table is computed in the client from the inspection it already holds. Saving sends
  options and edited names (a few kilobytes at most); the server regenerates the text and writes
  the file. No file bytes cross the WebSocket in either direction.
- Agents: `loom_pcb_pin_map` through MCP and `t3 pcb pin_map`.

## Extension points used

None new. Reuses L24's `ext-panels` (Inspect), `ext-rpc` (`loom.pcb-preview.*`) and `ext-mcp`
(`loom_pcb_*` tools).

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L55 (board stats) also edits `InspectTab.tsx`, in the Board section; this packet edits the hero
  card head. L55's inspection cache makes `loom_pcb_pin_map` cheap on repeat calls; without it
  each call reruns the netlist export (see TECHNICAL.md, Performance).
- L69 (change requests) can attach a pin map row as an anchor; nothing here depends on it.
- L68 (review checks) may reuse `isPowerNet` and `isGroundNet` from the shared module.
- No new keyboard keys.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): KiCad netlist, MCU pin naming and firmware API facts.
