# L38 references

## Verified facts

- three.js `EdgesGeometry(geometry, thresholdAngle)`: an edge is kept when the angle between
  the adjacent face normals exceeds `thresholdAngle` degrees; the default is 1. This packet uses
  the same test with 20 degrees.
  [three.js docs](https://threejs.org/docs/pages/EdgesGeometry.html).
- OpenSCAD fragment count when `$fn` is 0: `ceil(max(min(360 / $fa, r * 2π / $fs), 5))`, with
  defaults `$fa = 12` and `$fs = 2`, and never fewer than 5 fragments. So a 3.4 mm hole
  (r = 1.7) gets 6 sides, and any radius at or above about 9.55 mm gets 30.
  [OpenSCAD manual, Other Language Features](https://files.openscad.org/documentation/manual/Other_Language_Features.html).
  This is why the fit requires at least 5 vertices and why across flats matters.
- Across flats of a regular n-gon with circumscribed diameter d is `d · cos(π / n)`; for a
  hexagon that is `0.866 d`. Standard geometry (apothem of a regular polygon).
- Kåsa algebraic circle fit: minimise the sum of `(x² + y² + Dx + Ey + F)²`, a linear least
  squares problem with a closed-form solution. It is biased toward small radii on short arcs;
  Pratt, Taubin and Hyper fits reduce that bias. On full closed loops the bias is negligible.
  [Chernov and Lesort, Least squares fitting of circles and lines](https://arxiv.org/abs/cs/0301001),
  [Al-Sharadqah and Chernov, Error analysis for circle fitting algorithms](https://arxiv.org/abs/0907.0421).
  Original: I. Kåsa, "A curve fitting procedure and its error analysis", IEEE Trans. Instrum.
  Meas. 25 (1976) 8 to 14 (not read directly).
- Newell's method for a polygon normal: sums cross terms of consecutive vertices and is robust
  for slightly non-planar loops. Standard computer graphics technique (Sutherland, Sproull and
  Schumacker, 1974; not read directly).

## In-repo sources

- Raycast pick and section filter: `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts:112`.
- Picking disables orbit: `createViewer.ts:454`.
- STL loads as a non-indexed `BufferGeometry` through `STLLoader`: `viewer/load.ts`
  (`loadModel` at line 163).
- Worker bundling precedent: `apps/web/src/components/DiffWorkerPoolProvider.tsx:3`.
- Measurement entity: `packages/contracts/src/fork/model-workspace.ts:31`.
- Decoding default pattern: `packages/contracts/src/fork/model-preview-3d.ts:237`.

## Prior art

- Fusion 360, Onshape and FreeCAD measure tools snap to vertices, edge midpoints and edges, and
  report a circle's diameter and centre from one edge click. They work on B-rep, where circles
  are exact; we recover them from mesh loops.
- PrusaSlicer's measure tool (2.6 and later) works on meshes and detects circles and planes
  from the clicked feature, showing diameter and centre. Closest prior art for a mesh viewer.
  (Behaviour from the PrusaSlicer 2.6 release notes; not re-verified for this packet.)
- `three-mesh-bvh` (MIT) would make hover and occlusion checks cheap; excluded by Kyle for now.

## Licences

No code is copied. three.js is MIT and already a dependency. The algorithms (Kåsa, Newell,
union-find, CSR adjacency) are textbook methods with no licence constraints.
