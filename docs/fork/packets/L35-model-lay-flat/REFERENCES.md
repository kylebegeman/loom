# L35 references

## Prior art

- PrusaSlicer "Place on Face" (key `F`): highlights candidate faces and rotates the object so the
  clicked one rests on the bed. Verified:
  [Prusa help, Place on face tool](https://help.prusa3d.com/article/place-on-face-tool_1781).
  Its gizmo (`GLGizmoFlatten`) only offers faces of the convex hull, dropping tiny ones (OrcaSlicer
  describes the filter as faces under 5 mm², with a side under 1 mm or an inner angle under 1
  degree). Source of that description:
  [OrcaSlicer PR #15073](https://github.com/OrcaSlicer/OrcaSlicer/pull/15073), which moves the
  plane finder into `libslic3r/LayOnFace`. Not verified against PrusaSlicer's current source.
  AGPL-3.0; read for behaviour only, do not copy code.
- Cura: "Lay flat" (automatic) and "Select face to align to the build plate" in the rotate tool.
  Verified behaviour reports:
  [Ultimaker community thread](https://community.ultimaker.com/topic/32783-select-face-to-align-to-the-build-plate-doesnt-quite-align/)
  and [Cura issue #11322](https://github.com/Ultimaker/Cura/issues/11322). The community thread
  notes alignment drifting on tessellated faces, which is why this packet averages a coplanar
  region instead of trusting one triangle. LGPL-3.0; behaviour only.
- Bambu Studio and OrcaSlicer offer the same "Lay on face" tool (PrusaSlicer heritage).

## Libraries (already dependencies)

- three 0.186.0, MIT (`node_modules/.pnpm/three@0.186.0/node_modules/three/package.json`).
  - `Quaternion.setFromUnitVectors`, `Euler.setFromQuaternion`, `Box3.setFromObject(object, precise)`
    (`src/math/Box3.js:155`; `precise = false` uses transformed geometry bounding boxes, which are
    loose after rotation).
  - `examples/jsm/utils/BufferGeometryUtils.js:643`: `mergeVertices(geometry, tolerance = 1e-4)`.
  - `examples/jsm/math/ConvexHull.js`: QuickHull; faces carry `normal` and `area`
    (`ConvexHull.js:1075`, `1092`).

## Facts

- OpenSCAD `rotate([x, y, z])` rotates about X first, then Y, then Z, about fixed axes. Verified:
  [OpenSCAD manual, Transformations](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Transformations).
  The same page documents `multmatrix(m)` with a 4x4 (or 3x4) matrix whose last column is the
  translation.
- three's Euler order `"ZYX"` builds `Rz * Ry * Rx` (the order string names the intrinsic sequence;
  `Matrix4.makeRotationFromEuler` in three r186). Matching that to OpenSCAD is covered by a test
  rather than taken on trust.
- OpenSCAD `--export-format binstl` writes binary STL; Loom already uses it
  (`apps/server/src/fork/model-preview-3d/openscad.ts:54`).
- Whether OpenSCAD keeps per-object colours when importing a 3MF it exported: not verified.
- Assignment scoping inside `multmatrix() { include <...> }` with `-D` overrides: not verified;
  avoided by design.
