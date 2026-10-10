# L53 product

## Problem

Inspect already lists a selected part's pins with their names and nets
(`apps/web/src/fork/pcb-preview/InspectTab.tsx:173-221`), but only as a grid to read. Writing
firmware means retyping that grid into a header, translating `GPIO26_ADC0` or `PA5` into the
number or port the SDK wants, skipping power and ground pins, and inventing constant names from
net names like `/Sensors/I2C_SDA`. Every one of those steps is a place to make a mistake that
only shows up on the bench. Agents have the same problem: `loom_pcb_inspect` returns pins, but
the agent has to do the translation itself and usually guesses the GPIO numbering.

## What the user can do

Select a part, open Inspect, and press "Pin map" in the part's card. The dialog shows:

| Column      | Example     | Notes                                                                            |
| ----------- | ----------- | -------------------------------------------------------------------------------- |
| Pin         | 27          | Symbol pin number.                                                               |
| Pad         | 27          | Board pad carrying that pin; "Not placed" when the board has none.               |
| Name        | GPIO25      | Pin name from the symbol; the base name in a hint when an alternate is assigned. |
| GPIO        | 25          | Worked out from the name (see "GPIO numbers" below), or blank.                   |
| Net         | /LED        | Hierarchical net name as KiCad or tscircuit reports it.                          |
| Also on net | R12.1, D3.2 | Other parts' pins on the net, first eight then "+n more".                        |
| Constant    | LED         | Editable identifier used in generated files.                                     |

- Toggle "Include power and ground" and "Include not connected". Both are off by default, so a
  64-pin MCU shows only the pins firmware cares about.
- Edit any constant name. Invalid or duplicate names are marked in place and block saving.
- Choose a format: Markdown, C header, Rust, MicroPython, CircuitPython or Arduino. A preview
  shows the exact text that will be copied or saved. Formats that do not apply to the detected
  family are disabled with the reason (for example "MicroPython does not run on ATmega328P.").
- "Copy Markdown" copies the table. "Add to draft" appends it to the thread draft. "Save file"
  writes the generated text to a workspace path, prefilled as `pins.h`, `pins.rs` or `pins.py`
  next to the design, and asks before replacing an existing file.
- If the detected family is wrong, pick another from the "Family" menu (Auto, RP2040 or RP2350,
  ESP32, ESP32-S3, STM32, ATmega, Pin numbers only).
- Ask an agent "generate pins.h for U1": `loom_pcb_pin_map` returns the table as JSON and can
  save the file itself.

### GPIO numbers, and their limits

| Family                     | Detected from                                                   | Names understood                                         | Number shown                                       |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| RP2040, RP2350             | Symbol or value containing RP2040, RP2350; or `GPIOn` pin names | `GPIO0`, `GPIO26_ADC0`, `GP15`                           | GPIO number                                        |
| ESP32, ESP32-S3            | Symbol or value containing ESP32; or `IOn` pin names            | `IO4`, `GPIO4`, `SENSOR_VP`, `SENSOR_VN`, `TXD0`, `RXD0` | GPIO number                                        |
| STM32                      | Symbol or value starting STM32; or `Pxn` pin names              | `PA5`, `PA0-WKUP`, `PA0_WKUP`, `PC14-OSC32_IN`           | Port and pin, `PA5`                                |
| ATmega                     | Symbol or value starting ATmega                                 | `PB5`, `PB5/SCK` style names                             | Port and bit; Arduino `D13` for ATmega328P and 168 |
| Connectors and other parts | Reference J, P, CN, or anything else                            | Any                                                      | None; pin numbers only                             |

The dialog says these limits in a footnote, and the generated files repeat them in a header
comment:

- Numbers come from pin names, not from a datasheet. A symbol that names a pin `LED` instead of
  `GPIO25` gets no GPIO number.
- When the schematic assigns an alternate function to an STM32 pin (`TIM2_CH1` on `PA0`), KiCad
  may report the alternate name. The map recovers the base name from the symbol library part in
  the netlist when it can, and otherwise leaves GPIO blank.
- `TXD0` and `RXD0` resolve only on ESP32 and ESP32-S3; on other variants they stay blank with a
  warning.
- Arduino pin numbers depend on the board core. The map uses GPIO numbers for RP2040 (Arduino-Pico
  core) and ESP32 (Arduino-ESP32), `PA5` style names for STM32 (STM32duino), and the Uno mapping
  for ATmega328P and 168. Other AVR parts get no Arduino output.
- CircuitPython names are generated as `microcontroller.pin.GPIO25` style CPU pins and are marked
  "check against your port" in the file.
- Pad and pin are the same number in KiCad, because footprints are matched to symbol pins by
  number. The Pad column exists to show pins with no pad on the board.

## Entry points

| Way in                                                                                                                   | Way out                                                               | Where the state shows                     |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------- |
| "Pin map" button in the Inspect part card (`InspectTab.tsx:146-151`)                                                     | Close button, Escape, or clicking outside                             | The dialog                                |
| Select the part on the drawing, then the status bar chip opens Inspect (`PcbPreviewPanel.tsx:1344-1349`), then "Pin map" | Same                                                                  | Same                                      |
| "Save file"                                                                                                              | Delete or edit the file like any other; saving again offers "Replace" | Inline "Saved to hw/pins.h" with the path |
| "Add to draft"                                                                                                           | Edit the draft                                                        | Composer draft                            |
| `loom_pcb_pin_map`, `t3 pcb pin_map`                                                                                     | Not applicable                                                        | Tool result; saved file in the workspace  |

There is no keyboard key (none is free in the panel's allocation) and no command palette entry:
the palette has no access to the panel's selection (`palette.tsx:5-25`).

## States

- Loading: the button is disabled while Inspect is loading; the table is computed locally and
  appears with the dialog. "Save file" shows "Saving" and disables the dialog's actions.
- Empty: a part with no pins shows "This part has no pins in the design." A part whose pins are
  all power, ground or not connected, with both toggles off, shows "Every pin is power, ground or
  not connected." with a button to include them.
- Error: an unknown reference (the part was removed while the dialog was open), a path outside
  the workspace or a write failure shows the service message inline and keeps the dialog open.
  A schematic-only design without a board shows every pad as "Not placed"; that is not an error.
- Disabled: "Pin map" is disabled for a design with no inspection. "Save file" is disabled
  without the write grant ("This connection cannot write files."), while any constant is
  invalid, or for the Markdown format (use Copy). "Add to draft" needs a thread draft target.
  Formats that do not apply to the family are disabled with a reason.
- Stale: the table follows the current inspection. When the source changes while the dialog is
  open, the table recomputes; edited constant names are kept for pins whose number still exists.
  Saving passes the inspection's `sourceHash`; if the design changed on the host in between, the
  server refuses with "The design changed. Review the pin map again." and the dialog refreshes.

## Surfaces and connection modes

Web and desktop, KiCad and tscircuit. Mobile has no PCB panel. Remote and tunnel clients compute
the table from the inspection they already received; saving sends options and names only, and
the host writes the file. Nothing new crosses the signed HTTP route.

## Decisions

- One shared generator module in contracts, used by the dialog for the live preview and by the
  server for saving and for the agent tool. The server regenerates the text from the design
  rather than accepting text from the client, so a save can only ever write a pin map.
- Power, ground and not connected pins are skipped by default. They are listed when toggled on,
  and still never get a constant in C, Rust or Python outputs unless toggled on.
- Constant names come from the net name's last segment, uppercased, with non-identifier
  characters replaced by `_`. Auto-generated net names (`Net-(U1-PA5)`) fall back to the pin
  name. An overbar (`~{RESET}`) becomes `RESET_N`. Names starting with a digit get a `PIN_`
  prefix; language keywords get a `_PIN` suffix; duplicates get `_2`, `_3`.
- Edited names live in the dialog for its lifetime only. Persisting them would need a new field in
  the design workspace and a write grant just to open a table; the saved file is the durable
  record.
- Files are only written through "Save file", never on open.
- The family is detected, never assumed silently: the dialog names the family and how it was
  detected ("STM32, from symbol MCU_ST_STM32F1:STM32F103C8Tx").

## Decisions needed from Kyle

- Where the shared generator lives. The packet puts it in
  `packages/contracts/src/fork/pcb-pin-map.ts`, because it must run in both the web client and the
  server and `packages/contracts` already holds fork formatting helpers
  (`formatRunSummaryForAgent`, `packages/contracts/src/fork/apple-build-tooling.ts:484`). The
  repo guidance says contracts hold "small derived helpers" and "no heavy runtime logic"; this
  module is about 400 lines of pure string work. The alternatives are a new
  `packages/shared` subpath (an upstream `package.json` exports seam) or server-only generation
  with an RPC round trip for every preview edit (slow when the inspection is not cached).
  Recommendation: contracts, as written. The packet stays buildable either way.
