# L67 references

Checked on 2026-10-10 unless marked otherwise.

## KiCad

- `kicad-cli pcb export glb` options, including `--no-dnp`, `--no-components`,
  `--board-only`, `--include-tracks`, `--include-pads`, `--include-silkscreen`,
  `--include-soldermask` and `--min-distance` (default 0.01 mm):
  [KiCad 9.0 CLI reference](https://docs.kicad.org/9.0/en/cli/cli.html). L24 passes the four
  `--include-*` flags and not `--no-dnp` (`PcbPreviewService.ts:1650-1662`), so DNP parts appear
  in the reference GLB. The GLB origin is not documented there (only VRML says "board center"),
  which is why L67 fits the frame from parts rather than assuming one.
- KiCad 10 is required for GLB export in Loom (`PcbPreviewService.ts:1643-1647`).
- Mounting hole footprints in the official library:
  - [`MountingHole_3.2mm_M3_Pad.kicad_mod`](https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/MountingHole.pretty/MountingHole_3.2mm_M3_Pad.kicad_mod):
    `(pad "1" thru_hole circle ... (size 6.4 6.4) (drill 3.2) ...)`, a plated pad. Today's
    inspection skips it (`semantics.ts:147`).
  - [`MountingHole_3.2mm_M3.kicad_mod`](https://gitlab.com/kicad/libraries/kicad-footprints/-/raw/master/MountingHole.pretty/MountingHole_3.2mm_M3.kicad_mod):
    `(pad "" np_thru_hole circle ... (drill 3.2) ...)`, which inspection already finds.
  - The library is licensed CC-BY-SA 4.0 with a design exception (per the KiCad libraries
    repository; not re-checked today). L67 copies no footprint; test fixtures are hand-written
    boards that use these names and pad types.
- KiCad's board material name `board` and component instance naming in the GLB: see
  [L61's references](../L61-pcb-3d-tools/REFERENCES.md), which cite `step_pcb_model.cpp` on the
  10.0 branch. L67 relies on the same facts.

## tscircuit

- `pcb_board` in circuit-json has `center` (required), optional `width`, `height`,
  `thickness` (default 1.4) and `outline` (an array of points):
  [`src/pcb/pcb_board.ts`](https://raw.githubusercontent.com/tscircuit/circuit-json/main/src/pcb/pcb_board.ts).
  Loom falls back to 1.6 mm when `thickness` is absent (`semantics.ts:440`), which differs from
  the schema default of 1.4 mm.
- circuit-json is ISC per its npm metadata (`npm view circuit-json license`); GitHub reports no
  licence file. L67 reads the format and copies no code.
- tscircuit GLB axis convention (`toGltfTranslation` returning `[-x, y, z]`) and part node
  names: from L61's references (circuit-json-to-gltf `dist/index.js`), not re-checked here.

## glTF

- Every `POSITION` accessor must define `min` and `max`, which is what lets L67 and L55 bound
  meshes without reading vertex data:
  [glTF 2.0 specification, accessors](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#accessors)
  (as cited by L55; not re-checked today).
- glTF is metres with +Y up; Loom converts to millimetres and +Z up at
  `apps/web/src/fork/model-preview-3d/viewer/load.ts:156-158`.

## OpenSCAD

- `offset(r = ...)` rounds, `offset(delta = ...)` keeps sharp or angled corners, `chamfer`
  defaults to false, negative values inset:
  [OpenSCAD User Manual, Transformations](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Transformations#offset).
- Customizer syntax: `/* [Tab] */` groups, `/* [Hidden] */` hides the following assignments,
  `// [min:max]` and `// [min:step:max]` sliders, `// [a, b, c]` dropdowns for strings; only
  plain literals qualify, and OpenSCAD stops collecting at the first `{`:
  [OpenSCAD User Manual, Customizer](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Customizer).
  Loom's own parser stops at the first `module` or `function` line
  (`apps/server/src/fork/model-preview-3d/customizer.ts:83`). The generated file puts every
  parameter before any module and any brace, so both readers agree.
- OpenSCAD is GPL-2.0 (GitHub reports `NOASSERTION`; the project states GPL-2.0 in its
  repository). Loom runs it as a host tool and generates source for it; nothing is linked.

## build123d

- Algebra mode objects and operations used by the Python starter:
  - `Polygon` (`pts`, `rotation`, `align` default `(Align.NONE, Align.NONE)`).
  - `Box` and `Cylinder`, whose `align` defaults to centre on every axis, so the starter passes
    `Align.MIN` for Z.
  - `offset(objects, amount, kind=Kind.ARC, ...)`, `extrude(to_extrude, amount, ...)` and
    `Pos(...) * shape`.
  - Sources: [objects](https://build123d.readthedocs.io/en/latest/objects.html),
    [operations](https://build123d.readthedocs.io/en/latest/operations.html),
    [direct API (Location, Pos)](https://build123d.readthedocs.io/en/latest/direct_api_reference.html).

  The docs render signatures as `(*args, **kwargs)`, so whether `Polygon` takes points as
  varargs or one list is not settled by the page. The starter passes one list, which the
  `VectorLike | Iterable[VectorLike]` type allows; the opt-in Python test confirms it against
  L50's pinned 0.13.0. Unverified until that test runs.

- build123d is Apache-2.0 (GitHub licence API). Generated files import it; Loom ships none of it.

## Algorithms

- Ray traversal of a uniform grid: Amanatides and Woo, "A Fast Voxel Traversal Algorithm for
  Ray Tracing", Eurographics 1987. Ray-triangle test: Moller and Trumbore, "Fast, Minimum
  Storage Ray/Triangle Intersection", 1997. Both are what L46's `grid.ts` implements; L67 adds
  only a nearest-hit query.
- Inside-solid detection from the first hit's facing relies on consistent outward winding,
  which L46 checks per part.

## Rules of thumb (not verified standards)

- Pilot hole of hole diameter minus 0.6 mm and boss diameter of hole diameter plus 3 mm for
  self-tapping screws into printed plastic. These are starting values only; screw makers publish
  their own tables per material. The starter exposes both as customizer parameters.
- Default gaps (0.5 mm walls, 1 mm lid and floor, 0.5 mm connector margin, 0.2 mm standoff
  tolerance) are typical FDM allowances, not a standard. They are all editable per assembly.

## Prior art

- Parametric PCB enclosure generators in OpenSCAD, such as the "Ultimate Box Maker" and
  "YAPP" (Yet Another Parametric Projectbox) projects, take board size, standoff and cut-out
  lists by hand. L67 fills those values from the board. Their licences vary (YAPP is MIT per
  its repository, not re-checked); L67 copies no code from them.
- KiCad's StepUp workflow in FreeCAD checks board fit by hand in a CAD tool. L67 automates the
  four common checks inside the assembly view.
