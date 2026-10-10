# L48: Assemblies

Status: Needs decision: the assembly file format and the v1 placement tools.

Approved by Kyle on 2026-10-10.

An assembly puts several parts in one 3D view: a case, its lid and the PCB exported from the
board view, each where it belongs. It is a small `*.loom-assembly.json` file in the repository,
next to the parts it lists, so it travels with the branch, shows up in diffs and is easy for an
agent to write. The panel lists the parts with visibility, colour and isolate, moves and rotates
them with exact numbers and quarter turns, and pulls them apart with an exploded view (`E`).
A fit check finds where parts intersect and measures the gap between chosen pairs against a
required clearance, with pins on the problem areas. Every part reloads on its own when its file
changes, SCAD parts render with their own parameters, and captures work as for single parts.
Agents create and edit assemblies, place parts relative to each other and run the same fit check
through MCP tools.

## Scope

- In:
  - The `*.loom-assembly.json` format (version 1): parts with path, position, rotation, colour,
    visibility, SCAD parameters and an optional explode direction; named clearance pairs.
  - Server: read, validate and write assemblies atomically with an expected revision; ordered
    operations (add, update, move, remove, align, clearances); list assemblies beside models.
  - The panel opens an assembly like a model: Parts, Fit, Markup and Views tabs; part list with
    eye, colour, isolate and select; numeric position and rotation with snapping; quarter turns;
    drop to bed; align to another part; exploded view slider and `E`.
  - Fit check: triangle-triangle interference with an AABB broad phase and uniform grid, flush
    contact reported as touching, containment, and minimum clearance per chosen pair, run in
    L46's worker with a timeout and cancellation.
  - Per-part live reload; SCAD parts rendered with their own parameters; captures, saved views
    and Markup keyed by the assembly path.
  - Agent tools `loom_model_preview_3d_assembly_update` and
    `loom_model_preview_3d_assembly_check`; editor actions `explode`, `isolate`, `select-part`.
- Out:
  - A free move or rotate gizmo (PRODUCT.md, decision 2).
  - Nested assemblies (an assembly as a part), constraints and mates, motion.
  - Rendering assemblies through `loom_model_preview_3d_render` (OpenSCAD cannot import GLB);
    agents capture through the editor tool, which opens the panel.
  - Exporting a combined mesh or 3MF build plate.
  - Snapping to PCB mounting holes from the reference metadata (a natural follow-up).

## Surfaces

- Web and desktop: supported.
- Mobile: not supported. Mobile has no 3D panel.
- Remote: works over LAN, Tailscale and T3 Connect. Parts download through the existing signed
  file URLs, one request each; the fit check runs on the host and returns a small report.
- Upstream T3 server: the 3D panel is already hidden there (L23).

## Extension points used

None new. Reuses L23's `ext-core` (service and fork RPC group), `ext-mcp` (the tools join
`ModelPreview3dToolkit`), `ext-panels` (the 3D panel opens assemblies) and the existing fork
command palette registry.

## Packet seams

None of its own. The fit check runs in L46's worker, whose bundle needs L46's one seam in
`apps/server/vite.config.ts`. If L48 lands before L46, it adds that seam exactly as L46's
SEAMS.md describes. Details in [SEAMS.md](./SEAMS.md).

## New dependencies

None. Triangle tests, the grid and the readers are L46's or written here. The free gizmo, if
Kyle later wants it, would use `TransformControls` from the `three` package Loom already ships.

## Relationship to other follow-up packets

- L46 (print check): required building blocks. L48 reuses its mesh readers, `grid.ts`, worker
  host, `check-*` pins, `setFindings` and `frame`. Land L46 first; otherwise L48 builds those
  pieces exactly as L46 specifies them.
- L35 (lay flat): assemblies ignore each part's saved orientation; a part's rotation in the
  assembly is explicit. The assembly itself has no orientation entity.
- L32 (bed fit): the assembly's overall size uses the same fit helpers on the Fit tab.
- L40 (units): numbers go through one local formatter that becomes `formatLength`.
- L41 (follow agent) and L44 (capture export): work unchanged on the assembly path.
- L24 (PCB): `loom_pcb_export_reference` writes the GLB parts this packet places
  (`.loom/pcb-references/`, `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:2392-2468`).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the file format, server, viewer, checks and limits.
- [SEAMS.md](./SEAMS.md): upstream touches (none) and fork-owned shared files.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
