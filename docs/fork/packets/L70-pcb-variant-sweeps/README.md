# L70: tscircuit variant sweeps

Status: Ready to build.

Approved by Kyle on 2026-10-10.

L24's Parameters tab can save named sets of tscircuit values, but a variant is just a chip: the
user cannot see what it looks like without applying it to the source and waiting for the preview.
With this packet the Variants section becomes a workbench like the 3D panel's. The user picks one
or two declared parameters, gives a range or a list of choices, and gets up to eight candidates.
Each is built on the environment host without touching the circuit source and gets a board
thumbnail, its size, part count and build issues. The batch shows progress and can be cancelled.
Two candidates open side by side or overlaid with the same modes as Compare. The chosen one goes
through the existing review and apply step, which checks the source has not changed. Favourites
stay as saved variants, and an agent can propose variants for the user to build and compare.

## Scope

- In:
  - Sweeps over one or two declared parameters: number ranges (from, to, count), choice lists,
    booleans, and comma-separated strings. Up to 8 candidates per sweep, 24 kept.
  - A candidate build on the host from the current source with the variant's values applied in a
    staged copy. The user's files are never written by a build.
  - A thumbnail per candidate, rasterized in the client from the candidate's board SVG.
  - Per-candidate size, component count and Circuit JSON error and warning counts; L55's board
    stats when L55 is present. Grid and table views, sortable by these columns.
  - Sequential batch rendering with progress and cancel, matching L23.
  - Compare two candidates: side by side, overlay, A only, B only and difference, aligned on the
    board's physical coordinates, with parameter and stat differences listed.
  - Promote: load the values into the parameter list and open the existing review diff; **Apply
    to source** keeps the source hash check.
  - `loom_pcb_propose_variants` and an editor `render-variants` action for agents.
  - The tscircuit trust gate: nothing builds until the user allows circuit code.
- Out:
  - KiCad designs. KiCad has no declared parameter model in L24.
  - 3D thumbnails. The board SVG is the useful picture for layout; 3D stays one click away after
    applying. Kept as a possible follow-up in TECHNICAL.md.
  - KiCad DRC on candidates. tscircuit designs have no KiCad board to check.
  - More than two sweep axes, or optimisation ("find the smallest board").
  - Simulation of candidates. Simulate keeps its own ngspice sweeps.

## Surfaces

- Web and desktop: supported, in the Parameters tab of the PCB panel.
- Mobile: not supported. Mobile has no PCB panel. Contract changes decode on mobile without UI.
- Remote: works on every connection mode. Builds run on the environment host; the candidate SVG
  is read through the existing `readSheet` RPC, the same path the main drawing uses, and the
  thumbnail is made in the client.

## Extension points used

None new. Reuses L24's registrations: `ext-panels` (the panel), `ext-mcp` (the `loom_pcb_*`
toolkit and the PCB editor command), `ext-cli` (`t3 pcb`) and the `pcb-preview` capability over
`ext-core`. The two new RPC methods go in the fork's own scope table.

## Packet seams

None. Every file touched is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L55 (board stats): when `boardStats.ts` exists, each candidate's stats include L55's values and
  the table gains those columns. Without it, candidates show width, height, area, component count
  and issue counts computed from the candidate's inspection.
- L69 (change requests): independent. Both extend the PCB workspace with decoding defaults and
  use L23's `thumbnail` with the same optional `limit` argument; whichever lands first adds it.
- L54 (units): sizes use L54's formatter when present, otherwise millimetres with one decimal.
- L62 (capture export): candidate comparisons are not captures; L62 does not apply.
- L64 (fab check): a later packet could run the fab check per candidate. Not part of this one.
- L23 (3D variants): mirrors its workbench, limits and agent tool. Shares the `thumbnail` helper;
  no other 3D code is imported.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
