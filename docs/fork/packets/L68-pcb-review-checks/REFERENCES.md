# L68 references

Sources for this packet. Treat external repositories as references, not code to copy.

## Old Loom

No predecessor. L24's Checks view and inspection model are the starting point.

## Current Loom source

- Inspection contract: `packages/contracts/src/fork/pcb-workspace.ts:16-57`.
- Schematic parsing and pins (electrical type ignored):
  `apps/server/src/fork/pcb-preview/semantics.ts:198-274`; S-expression helpers `:9-41`.
- Netlist merge (reads only ref, pin, pinfunction): `semantics.ts:275-302`.
- Circuit JSON inspection: `semantics.ts:309-400`.
- Board and schematic merge across sheets: `PcbPreviewService.ts:1396-1478`.
- Netlist export: `PcbPreviewService.ts:1788-1817` (netlist text read at `:1803`).
- tscircuit inspect path: `PcbPreviewService.ts:1818-1859`.
- Check persistence and latest checks: `PcbPreviewService.ts:1056-1169`.
- Inspector tabs: `apps/web/src/fork/pcb-preview/Inspector.tsx:39-50`, `:114-124`.
- Checks view: `apps/web/src/fork/pcb-preview/ChecksView.tsx:83-130`, permission notice `:191`.
- Status chips: `PcbPreviewPanel.tsx:1356-1379`.
- Opt-in real tool test: `apps/server/src/fork/pcb-preview/realTools.test.ts:20-35`.
- Shared "Finding markers" definition: [PCB-FOLLOW-UPS.md](../PCB-FOLLOW-UPS.md) and
  [L52 TECHNICAL.md](../L52-pcb-check-markers/TECHNICAL.md).
- Shared project settings: [L58 TECHNICAL.md](../L58-pcb-auto-checks/TECHNICAL.md).

## External

- KiCad S-expression format, pin syntax `(pin PIN_ELECTRICAL_TYPE PIN_GRAPHIC_STYLE ...)` and the
  twelve electrical types: <https://dev-docs.kicad.org/en/file-formats/sexpr-intro/index.html>.
  Verified by reading the page.
- Real KiCad netlist with `pinfunction` and `pintype` nodes, `+no_connect` suffix and
  `unconnected-(...)` nets, posted in a forum thread:
  <https://www.circuitsonline.net/forum/view/165866>. Verified by search summary; confirm
  against the real fixture in IMPLEMENTATION step 1.
- KiCad `COMPONENT_NET(pinName, netName, pinFunction, pinType)`:
  <https://docs.kicad.org/doxygen/classCOMPONENT__NET.html>.
- kicad-tools PRs on `pintype` and `+no_connect` behavior:
  <https://github.com/rjwalters/kicad-tools/pull/6000>,
  <https://github.com/rjwalters/kicad-tools/pull/6049>. Licence not checked; behavior notes only.
- tscircuit circuit-json, `source_component` ftypes and `source_port` / `source_net` flags:
  <https://github.com/tscircuit/circuit-json>. Field names verified from the README in the
  previous research pass. Licence believed MIT, unverified. Exact ftype names for switches,
  crystals and transistors must be confirmed against the package's types during step 3.
- Prior art, behavior only:
  - kicad-happy (MIT): deterministic Python analyzers over KiCad netlists with I2C pull-up and
    decoupling checks; its decoupling-distance findings pair only capacitors on the IC's own
    supply net, which this packet copies as a rule:
    <https://github.com/aklofas/kicad-happy>. Verified licence and features from the README.
  - Traceformer, a hosted datasheet-aware schematic checker that flags missing I2C pull-ups:
    <https://traceformer.io/kicad-schematic-checker>. Commercial; not used.
  - BV Circuits lists missing decoupling and missing pull-ups on open-drain outputs among its
    checks: <https://bvcircuits.com/>. Commercial; not used.
  - Circuit Weaver's review checklist (regulator limits, decoupling, pull-ups, ESD):
    <https://circuit-weaver.com/kicad-ai-schematic-review/>.
- Regulator ratings: every row in the TECHNICAL.md table is unverified until the implementing
  agent checks the manufacturer datasheet (IMPLEMENTATION step 4). Unverified rows can only
  recognize a part, never produce a limit finding.
- Typical values in messages (2.2 k to 10 k I2C pull-ups, 100 nF decoupling, 10 k and 100 nF on
  reset) are common practice, not quoted from a single source.
