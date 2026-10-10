# L48 references

Nothing here is copied into Loom. Algorithms are implemented from the papers; licences are listed
for anything an implementer might be tempted to port.

## Loom sources

- PCB reference export, the GLB and metadata this packet places:
  `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:2392-2468` (writes
  `.loom/pcb-references/<design>-<hash>.glb` and `.json` with bounds, thickness, mounting holes
  and component positions in millimetres; the GLB is in metres).
- Workspace entity keys (why an assembly is a file, not an entity):
  `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:794-799`.
- SCAD render job keys and last-used parameters: `ModelPreviewService.ts:567`, `:587-622`.
- Viewer frames: `apps/web/src/fork/model-preview-3d/viewer/load.ts` (3MF units, glTF rotation
  and scale at `:156-158`); bed placement under the lowest point, `viewer/createViewer.ts:431-440`.
- L46 packet for the readers, grid, worker and pins:
  [L46 TECHNICAL.md](../L46-model-print-check/TECHNICAL.md).
- Fabrication plans, `~/Developer/docs/apps/fabrication/` (SPEC.md, ARCHITECTURE.md): research
  only, as MODEL-3D-FOLLOW-UPS.md "Relationship to the Fabrication app" requires.

## Formats and conventions

- [glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html): "Relative paths are
  relative to the current glTF asset." The assembly's part paths follow the same rule relative to
  the assembly file. Verified 2026-10-10.
- [three.js `Euler`](https://threejs.org/docs/pages/Euler.html): rotation order strings such as
  `'XYZ'`; `Matrix4.makeRotationFromEuler` builds the `'XYZ'` matrix in
  [`src/math/Matrix4.js`](https://github.com/mrdoob/three.js/blob/dev/src/math/Matrix4.js).
  Verified 2026-10-10. The file stores degrees; the viewer converts to radians.
- [3MF Core Specification](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md):
  build items with transforms, the slicer-native way to place several objects. Considered as the
  file format and rejected (TECHNICAL.md, Alternatives). Verified for L46 on 2026-10-10.

## Algorithms

- Philippe Guigue and Olivier Devillers, "Fast and Robust Triangle-Triangle Overlap Test Using
  Orientation Predicates", Journal of Graphics Tools 8(1):25-32, 2003,
  [doi:10.1080/10867651.2003.10487580](https://www.tandfonline.com/doi/abs/10.1080/10867651.2003.10487580),
  [dblp](https://dblp.uni-trier.de/rec/journals/jgtools/GuigueD03.html). Uses only the signs of
  determinants, with no intermediate constructions. Verified 2026-10-10 (publisher page and dblp
  agree on pages 25-32).
- Tomas Moller, "A Fast Triangle-Triangle Intersection Test", Journal of Graphics Tools
  2(2):25-30, 1997, doi:10.1080/10867651.1997.10487472. Verified through the Crossref record on
  2026-10-10 (the doi.org redirect refused automated requests). The interval test that Guigue and
  Devillers improve on.
- Christer Ericson, Real-Time Collision Detection, Morgan Kaufmann, 2005, ISBN 9781558607323,
  section 5.1.11 "Closest Points of Two Triangles" (and 5.1.9 for segments), per the
  [publisher's preview table of contents](https://api.pageplace.de/preview/DT0400.9780080474144_A23516482/preview-9780080474144_A23516482.pdf)
  ([Routledge](https://www.routledge.com/Real-Time-Collision-Detection/Ericson/p/book/9781558607323)).
  Section numbers checked 2026-10-10. The book's code is copyrighted; implement from the text.
- Moller and Trumbore ray-triangle test and Amanatides and Woo grid traversal, as cited in
  [L46 REFERENCES.md](../L46-model-print-check/REFERENCES.md), for containment rays.

## Libraries considered and not used

- [three.js](https://github.com/mrdoob/three.js) (MIT,
  [LICENSE](https://github.com/mrdoob/three.js/blob/dev/LICENSE)) `TransformControls`
  ([docs](https://threejs.org/docs/pages/TransformControls.html),
  [source](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/controls/TransformControls.js)):
  the free move and rotate gizmo, already installed with `three`. Deferred (PRODUCT.md,
  decision 2). Verified 2026-10-10.
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) (MIT): has mesh-to-mesh
  intersection and distance queries. Not used: a new dependency where L46's grid suffices.
- [manifold-3d](https://github.com/elalish/manifold) (Apache-2.0): exact boolean intersection
  volume between parts. Not used in v1; a candidate if interference volume is ever wanted.
