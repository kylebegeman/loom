# L68: Review checks

Status: Implemented locally

Implemented on `feat/pcb-units-presets-stats-print-capture`. Focused model, rule, service, settings, MCP, marker and permission checks cover both data paths. Real-client, remote and real-KiCad verification remain pending. LM1117 and supported AP2112 variants use checked manufacturer limits; other entries remain recognition-only.

Approved by Kyle on 2026-10-10.

ERC proves that pins are wired legally; it does not know that an I2C bus needs pull-ups or that an
LED needs a resistor. This packet adds a "Review" section to Checks: eight deterministic
schematic heuristics that catch the mistakes a reviewer would circle on a first pass, for both
KiCad and tscircuit designs. Each rule is a data entry with an id, a default severity and
parameters, and can be switched off per project. Each finding says which parts it looked at, why
it fired and how to silence it, and appears on the drawing through L52's finding markers with
source "review". Agents run the same rules with `loom_pcb_review` and get the same findings,
which makes them a cheap self-check after an agent edits a schematic. Nothing here is a
simulation or a guarantee; the copy says "Review" and "may", not "error" and "must".

## Scope

- In:
  - A review model built from data Loom already reads: the inspection (`PcbInspection`), the
    KiCad netlist's pin electrical types and part library ids, schematic no-connect flags, and
    tscircuit's circuit JSON with its port flags.
  - Eight rules, as data plus one matcher each: `i2c-pullup`, `decoupling` (with a board
    distance check), `connector-esd`, `floating-input`, `reset-pullup`, `led-resistor`,
    `multiple-drivers`, `regulator-ratings`.
  - A small regulator ratings table shipped as data, each entry with a source and a checked
    date.
  - Per-project rule switches and parameters, and per-finding waivers, in the shared project
    settings record (L58 or L68 creates it).
  - Server `review` and `latestReview` RPCs, results persisted like checks and keyed by source
    hash and rule configuration.
  - A "Review" card in Checks, the Checks tab for tscircuit designs (Review only), and review
    findings as markers when L52 is present.
  - MCP `loom_pcb_review`; rule switches and waivers through `loom_pcb_check_settings`.
- Out:
  - Simulation, current or thermal analysis, signal integrity, impedance or length matching.
  - Datasheet lookup at run time or any network access. Ratings come from the shipped table.
  - Rules written by users. Rules are data in the source; adding one is a code change.
  - Fixing findings automatically.
  - Board-level DRC-like rules other than the decoupling distance.
  - Mobile. It has no PCB panel.

## Surfaces

- Web and desktop: supported, in the Checks tab.
- Mobile: not supported (no PCB panel). The results persist on the environment.
- Remote: works over LAN, Tailscale and T3 Connect. The rules run on the environment host; a
  result is a few kilobytes and capped at 500 findings.
- Upstream T3 server: no PCB panel.

## Extension points used

L24's existing points only: `ext-core`, `ext-panels`, `ext-mcp`. No new extension point.

## Packet seams

None. Every change is in fork-owned files. [SEAMS.md](./SEAMS.md) lists the shared fork files.

## New dependencies

None. Value parsing, net walking and the rule table are small pure modules.

## Relationship to other follow-up packets

- L52 (check markers): review findings are `PcbFinding` values with `source: "review"`, using
  the shared definition exactly. Without L52, Review lists findings with "Locate" but draws no
  markers.
- L58 (checks after each save): both packets use `PcbProjectSettings` in `projectSettings.ts`
  and the `projectSettings` / `updateProjectSettings` RPC pair and `loom_pcb_check_settings`
  tool. Whichever lands first creates them as specified in L58's TECHNICAL.md; the other adds
  its key. With L58 present, `autoChecks.review` reruns the review after saves; the review is
  cheap (one netlist export) so it fits the same caps.
- L54 (units): distances in messages are formatted with L54's formatter when present, otherwise
  in mm.
- L64 (fab check): same Checks layout pattern; independent rules.
- L69 (change requests): an agent can be asked to fix a review finding; no direct coupling.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design, rule table and algorithm.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): fixtures and how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
