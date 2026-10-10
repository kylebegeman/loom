# L52: Check markers on the drawing

Status: Ready to build

Approved by Kyle on 2026-10-10.

ERC and DRC findings appear where they are, not only in a list. Each finding becomes a small
severity pin on the schematic sheet or board it belongs to: red for errors, amber for warnings.
Press `.` and `,` to step to the next and previous finding; the drawing centres on it and the
Checks section opens on its detail. `C` shows or hides the pins. Excluded findings stay hidden
unless "Show excluded" is on, and pins from a report older than the saved files are dimmed and
labelled "Stale". The server now reports every finding position in millimetres and corrects a
KiCad bug that shrinks ERC positions a hundredfold, so Locate lands on the right part for every
report. Agents step through findings and read the visible markers with the PCB editor command.

## Scope

- In:
  - `CheckMarkers.tsx`, a drawing overlay that draws any list of findings (the shared "Finding
    markers" definition in [PCB-FOLLOW-UPS.md](../PCB-FOLLOW-UPS.md#shared-definitions)).
  - ERC markers on the matching schematic sheet, DRC markers on the board drawing.
  - One marker per finding at its first located item. The other item positions of the active
    finding show as small rings with a connecting line.
  - `.` and `,` to step, `C` to toggle markers, clicking a marker in Select mode.
  - "Show excluded" shared by the list and the markers; "Stale" dimming.
  - Server-side normalization: item `uuid` kept, positions converted from `in` or `mils` to mm,
    the ERC scale bug corrected, ERC sheet paths mapped to drawing sheet ids, a stable `id` per
    finding.
  - Editor actions `finding` and `markers`, and visible markers in the editor snapshot.
- Out:
  - Markers in 3D. The 3D board has no finding layer; stepping is a 2D action.
  - Live markers from an unsaved editor session. Checks run on saved files (L24).
  - Display units. L54 formats positions; this packet only stores millimetres.
  - Running checks automatically. That is L58.
  - Mobile. It has no PCB panel.

## Surfaces

- Web and desktop: supported, in the PCB panel's 2D drawing.
- Mobile: not supported. Mobile has no PCB panel, so nothing changes there.
- Remote: works over LAN, Tailscale and T3 Connect. Markers come from the check results the
  panel already loads over the WebSocket (bounded at 500 findings and 1 MiB,
  `apps/server/src/fork/pcb-preview/kicadReports.ts:63-70`); no new bytes route.
- Upstream T3 server: no PCB panel, so nothing to show.

## Extension points used

L24's existing points only: `ext-core` (contracts and RPCs), `ext-panels` (the PCB panel),
`ext-mcp` (the `loom_pcb_editor` tool and its `t3 pcb editor` CLI action). No new extension
point.

## Packet seams

None. Every change is in L24's fork-owned files. [SEAMS.md](./SEAMS.md) lists the shared fork
files other PCB packets also edit.

## New dependencies

None.

## Relationship to other follow-up packets

- L54 (units): L54 promises "Locate works in every unit". This packet does the conversion on
  the server, so after it lands every stored position is millimetres and L54 only formats. If
  L54 lands first with a client-side conversion, this packet moves that conversion into
  `kicadReports.ts` and deletes the client copy. Until L54 lands, positions show as
  `12.34, 56.78 mm` as today.
- L58 (auto checks): uses the finding `id` from this packet for its new and resolved counts,
  and its fresh results update the markers live. Without L58, markers change when you run a
  check.
- L64 (fab check) and L68 (review checks): produce findings with source `"fab"` and `"review"`
  and pass them to the same `CheckMarkers` and stepping helpers. Without them, only `"erc"` and
  `"drc"` exist.
- L60 (change highlights) and L69 (change requests): draw their own overlays beside this one in
  `SvgViewport`'s overlay layer. No shared state.
- L63 (viewport access): may announce "Finding 3 of 12" through its live region; this packet
  gives each marker step an accessible status line that L63 can reuse.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
