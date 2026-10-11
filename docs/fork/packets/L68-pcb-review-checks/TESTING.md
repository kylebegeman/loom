# L68 testing

Local automated verification exercises hand-authored netlists and circuit flags, all eight matchers, reuse/configuration/waivers, failed-export fallback, marker anchors and protected commands. Real-client and opt-in CAD checks are pending. KiCad is unavailable on this host, so `complex_hierarchy.net` generation is pending; existing real ERC/DRC fixtures remain unchanged.

Focused tests, no repo-wide checks, no sleeps. Rules are pure, so almost everything is proven
with fixtures and no tools.

## Fixtures

In `apps/server/src/fork/pcb-preview/fixtures/review/`. Hand-written files are minimal: only
the parts and nets the rule needs. KiCad fixtures are pairs of a `.net` netlist and a matching
`PcbInspection` JSON (positions for the distance and no-connect cases). tscircuit fixtures are
circuit JSON arrays.

| Fixture                                       | Contents                                                                                             | Expected                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `i2c-missing.net`                             | MCU and sensor on `I2C_SDA`, `I2C_SCL`, no resistors                                                 | 2 warnings                                                                                                |
| `i2c-ok.net`                                  | Same with 4k7 to `+3V3` on both                                                                      | none                                                                                                      |
| `i2c-offboard.net`                            | No pull-ups, nets reach `J2`                                                                         | 2 info                                                                                                    |
| `decoupling-missing.net` + `.inspection.json` | IC with VDD `power_in` on `+3V3`, no capacitor                                                       | 1 warning                                                                                                 |
| `decoupling-far.net` + `.inspection.json`     | 100n on `+3V3` placed 14 mm from the pin, a 100n on another rail next to it                          | 1 info citing the far capacitor                                                                           |
| `decoupling-ok.net` + `.inspection.json`      | 100n within 2 mm                                                                                     | none                                                                                                      |
| `usb-no-esd.net`                              | `USB_C_Receptacle` with D+, D-, CC1, CC2 to the MCU                                                  | 1 warning listing four nets                                                                               |
| `usb-esd-series.net`                          | Same with USBLC6 behind 22 ohm series resistors                                                      | none                                                                                                      |
| `button-floating.net`                         | Input pin to `SW1` to ground, no resistor                                                            | 1 warning                                                                                                 |
| `button-gpio.net`                             | Bidirectional `PA0` to `SW1`, no resistor                                                            | 1 info                                                                                                    |
| `nc-input.net` + `.inspection.json`           | Input pin with a no-connect flag at its position                                                     | 1 warning                                                                                                 |
| `reset-bare.net`                              | `NRST` to a header only                                                                              | 1 info                                                                                                    |
| `reset-ok.net`                                | `NRST` with 10k to `+3V3` and 100n to `GND`                                                          | none                                                                                                      |
| `led-direct.net`                              | LED from `+3V3` to a GPIO                                                                            | 1 warning                                                                                                 |
| `led-string-ok.net`                           | Two LEDs in series with a resistor                                                                   | none                                                                                                      |
| `uart-crossed.net`                            | `U1 TX` and `U5 TXD` on one net                                                                      | 1 warning                                                                                                 |
| `regulator.net`                               | AMS1117-3.3 from `+12V` to `+5V` with no output capacitor                                            | output mismatch and missing capacitor warnings; the limit finding only if the entry is verified           |
| `complex_hierarchy.net` (real, KiCad 10)      | KiCad demo                                                                                           | parses; counts of parts, nets and pin types match the netlist; snapshot of findings reviewed by hand once |
| `tscircuit-flags.json`                        | Chip with `needs_external_pullup`, two `is_output` ports on one net, `simple_led` without a resistor | floating, multiple drivers (error) and LED findings                                                       |
| `tscircuit-bare.json`                         | Chips with no flags                                                                                  | name fallback findings and the "pin roles" notice                                                         |

## Automated tests

| File                                                                     | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/pcb-preview/reviewModel.test.ts` (new)             | Netlist parsing of `pintype` with and without `+no_connect`, missing `pinfunction`, `#PWR` nodes; `classify` for each kind and tie-break order; `parseValue` for `10k`, `4k7`, `4.7kΩ`, `100n`, `0.1uF`, `100nF/50V`, `2u2 16V` and junk; `netRole` and `netVolts` including `VBUS` assumed; `throughSeries` stops above 100 ohms; tscircuit flag mapping and the half-of-chips rule for `has.pinTypes`; inspection-only fallback when the netlist is missing. |
| `apps/server/src/fork/pcb-preview/reviewRules.test.ts` (new)             | Each fixture's expected findings; messages contain the parts and nets; ids are stable when part positions change and differ when parts change; disabled rules do not run; `limited` when data is missing; parameter validation fallback with a notice; the 500 cap with `truncated`; sorting; unverified regulator entries never produce limit findings.                                                                                                       |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (extend)    | With the fake runner returning a fixture netlist: `review` persists and `latestReview` returns it; a second `review` with unchanged hashes does not call the runner; a rule change reruns; a waiver set through `updateProjectSettings` marks the finding waived on read without a rerun; a failed netlist export still returns a result with `limited` rules; a design without a schematic fails with the PRODUCT.md message.                                 |
| `apps/server/src/fork/pcb-preview/mcp.test.ts` (update)                  | `loom_pcb_review` is listed and calls the service; `loom_pcb_check_settings` accepts `review` with `waive`.                                                                                                                                                                                                                                                                                                                                                    |
| `apps/server/src/fork/pcb-preview/realTools.test.ts` (extend, opt-in)    | With `LOOM_TEST_PCB_FIXTURES`, a real KiCad review of the fixture project returns a result with `has.pinTypes` true.                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/src/fork/pcb-preview/findings.test.ts` (extend, if L52 landed) | `reviewFindings` picks the schematic or board anchor by surface and treats waived as excluded.                                                                                                                                                                                                                                                                                                                                                                 |

No markup tests for `ReviewView`.

## Commands

```sh
vp test run apps/server/src/fork/pcb-preview/reviewModel.test.ts \
  apps/server/src/fork/pcb-preview/reviewRules.test.ts \
  apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts \
  apps/web/src/fork/pcb-preview/findings.test.ts
vp lint packages/contracts/src/fork apps/server/src/fork packages/client-runtime/src/fork \
  apps/web/src/fork/pcb-preview
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
```

Drop `findings.test.ts` from the first command if L52 has not landed.

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, on a host with KiCad 10:

1. Open a KiCad project with an MCU, an I2C sensor, a USB connector and an LED. Checks, Review,
   "Run review". Findings match what is on the schematic; "Locate" lands on the right symbol on
   the right sheet.
2. Add pull-ups in KiCad and save; the result turns "out of date"; run again; the I2C findings
   are gone.
3. "Ignore here" on a finding with a note; it moves to "Show ignored"; reload; it stays ignored.
   "Stop ignoring" restores it.
4. Turn `led-resistor` off in "Rules"; run; no LED findings and "1 is off for this project".
5. Set the decoupling distance to 2 mm on a placed board; info findings appear for capacitors
   farther away. Switch to the board view; markers show on pads (with L52).
6. Open a tscircuit design: Checks shows only Review; run it.
7. Ask the agent to review the schematic and fix one finding; it calls `loom_pcb_review`, edits,
   and the next call shows the finding gone.
8. On a connection without terminal permission: results readable, "Run review" and rule
   switches disabled with the notice.
9. Repeat 1 over Tailscale or T3 Connect, light and dark themes.

Upstream server: no PCB panel.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect a clean merge since no
upstream file changes. After merge to `main`, Kyle runs
`scripts/fork/loom.sh integrate nightly --dry-run`.
