# L53 references

Checked on 2026-10-10. "Verified" means read in the linked source or this repository;
"unverified" means from memory or secondary sources and must be checked during step 3 or in a
code comment before relying on it.

## KiCad netlist and board

1. **kicadsexpr netlist structure.** Verified. `libparts` holds `(libpart (lib) (part) ...
(pins (pin (num 1) (name ~) (type passive))))`; nets hold `(node (ref) (pin))`. KiCad's
   `COMPONENT_NET` stores pin name, net name, pin function and pin type for each node and writes
   them out. Sources:
   [KICAD_NETLIST_PARSER](https://docs.kicad.org/doxygen/classKICAD__NETLIST__PARSER.html),
   [COMPONENT_NET](https://docs.kicad.org/doxygen/classCOMPONENT__NET.html),
   [kicad-doc, custom netlists](https://github.com/KiCad/kicad-doc/blob/master/src/eeschema/eeschema_creating_customized_netlists_and_bom_files.adoc)
   (CC-BY 3.0 or GPL 3, documentation). KiCad itself is GPL 3; this packet reads its output only.
2. **Node fields in KiCad 6 and later.** Partly verified. `pinfunction` and `pintype` exist on
   nodes (`COMPONENT_NET` above), and this repo already reads `pinfunction`
   (`apps/server/src/fork/pcb-preview/semantics.ts:283`). The exact quoted form
   `(node (ref "U1") (pin "5") (pinfunction "SDA") (pintype "bidirectional"))` and the
   `+no_connect` suffix on unconnected pins are from secondary sources
   ([kicad-tools PR 6000](https://github.com/rjwalters/kicad-tools/pull/6000)) and memory.
   Unconnected nets named `unconnected-(REF-PIN-PadN)` are from memory. Unverified.
3. **Alternate pin functions.** Unverified: whether `pinfunction` reports the alternate name when
   one is assigned. The packet handles both cases by comparing with the `libparts` pin name.
   Step 3 records the answer here.
4. **Pads carry `pinfunction` and `pintype`** when the board is updated from the schematic.
   Verified for `pinfunction` (this repo reads it, `semantics.ts:86`); `pintype` from the
   kicad-tools PR above.
5. **Pad number equals symbol pin number.** KiCad associates symbol pins with footprint pads by
   number, and the netlist has no pin-swap mapping. From memory; unverified in this pass, which
   is why the Pad column is computed from the board's pads rather than assumed.
6. **`kicad-cli sch export netlist --format kicadsexpr`** is the default format and is what the
   service runs (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1797`). Verified.

## Circuit JSON (tscircuit)

7. `source_component.ftype`, `source_port.name` and `source_port.pin_number` are what
   `inspectCircuitJson` already reads (`semantics.ts:375`, `:394`). Verified in this repo.
   No electrical pin type exists on `source_port`. Unverified (not in the fields this repo reads;
   check the circuit-json README, MIT licence, <https://github.com/tscircuit/circuit-json>).
   tscircuit pin labels for Pico style parts (`GP15`) are from memory.

## MCU pin naming

8. **RP2040 KiCad symbol** (`MCU_RaspberryPi:RP2040`): pins `GPIO0` to `GPIO25` and
   `GPIO26_ADC0` to `GPIO29_ADC3`. Verified in the KiCad symbol library
   ([kicad-symbols](https://gitlab.com/kicad/libraries/kicad-symbols), CC-BY-SA 4.0 with the
   KiCad library exception). RP2350 symbol names unverified; the pattern is the same family.
9. **ESP32 modules** use `IOn` pin names, with `SENSOR_VP` (GPIO36) and `SENSOR_VN` (GPIO39) on
   classic ESP32, and `TXD0`/`RXD0` as GPIO1/GPIO3 (classic) or GPIO43/GPIO44 (ESP32-S3).
   Checked against Espressif module datasheets during research
   (<https://www.espressif.com/en/support/documents/technical-documents>); recheck the exact
   module datasheet for any other variant.
10. **STM32 KiCad symbols** name pins `PA0`, with extra functions after a separator, and list
    alternates such as `RCC_OSC_IN`, `SWDIO`, `SWCLK` as `(alternate ...)` entries. Verified in
    kicad-symbols `MCU_ST_*` libraries. Third-party libraries use `PA0_WKUP` style names.
11. **ATmega328P Arduino mapping**: D0 to D7 are PD0 to PD7, D8 to D13 are PB0 to PB5, A0 to A5
    are PC0 to PC5. From memory of the Arduino Uno schematic; the fetch of the Arduino pin
    mapping page returned nothing. Unverified; check the Uno Rev3 schematic
    (<https://docs.arduino.cc/hardware/uno-rev3/>, CC-BY-SA) before shipping.

## Firmware APIs

12. **MicroPython `machine.Pin(id)`**: `id` may be an int, string or tuple, and accepted forms
    are port specific. Verified:
    [machine.Pin](https://docs.micropython.org/en/latest/library/machine.Pin.html) (MIT).
13. **MicroPython STM32 names**: a string is looked up as a board pin first, then a CPU pin; CPU
    pin names drop the leading `P`; `Pin.cpu.A5` always means port A pin 5, and board names such
    as `A3` on Nucleo boards can shadow CPU names. Verified:
    [pyb.Pin](https://docs.micropython.org/en/latest/library/pyb.Pin.html),
    [micropython issue 4814](https://github.com/micropython/micropython/issues/4814),
    [discussion 18186](https://github.com/orgs/micropython/discussions/18186). That is why the
    generator writes `Pin.cpu.A5` rather than a string.
14. **CircuitPython** `microcontroller.pin.GPIO25` names for RP2040 and ESP32, and `PA05` style
    STM32 names. Unverified; the generator marks the file "check against your port" and leaves
    STM32 off.
15. **STM32 HAL** `GPIOA` and `GPIO_PIN_5` macros. From memory of STM32Cube HAL headers
    (BSD-3-Clause). Unverified in this pass.
16. **Arduino cores**: Arduino-Pico (Earle Philhower) and Arduino-ESP32 use GPIO numbers as pin
    numbers; STM32duino defines `PA5` style constants. From memory. Unverified; each is named in
    the generated file's header so a wrong assumption is visible.

## Repository facts

17. Pin, component and inspection schemas: `packages/contracts/src/fork/pcb-workspace.ts:16-54`.
18. Write pattern with hash check and preview: `applyParameters`,
    `PcbPreviewService.ts:2217-2245`; atomic write helper imported at `:66`.
19. `safePath` resolves real paths and therefore needs an existing path:
    `PcbPreviewService.ts:231-250`.
20. Generated `.h`, `.rs` and `.py` files are not design sources: `PcbPreviewService.ts:557-564`.
21. Contracts already host fork formatting helpers: `formatRunSummaryForAgent`,
    `packages/contracts/src/fork/apple-build-tooling.ts:484`.
