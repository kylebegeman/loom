# L46 references

Nothing here is copied into Loom. Algorithms are implemented from the papers and specifications;
licences are listed for anything an implementer might be tempted to port.

## Loom and Fabrication sources

- Fabrication printability plan, `~/Developer/docs/apps/fabrication/SPEC.md:66` (check list,
  including the height to base ratio of 8 used for `TALL_THIN`) and `ARCHITECTURE.md`, `MCP.md`.
  Research only, not a dependency (MODEL-3D-FOLLOW-UPS.md, "Relationship to the Fabrication
  app").
- Viewer frames this packet must match: `apps/web/src/fork/model-preview-3d/viewer/load.ts`
  (3MF unit normalization, glTF rotation and scale at `:156-158`).
- tsdown entry naming: array entries keep their path relative to the lowest common ancestor.
  Verified in the installed build,
  `node_modules/.pnpm/@voidzero-dev+vite-plus-core@1.0.0_*/node_modules/@voidzero-dev/vite-plus-core/dist/tsdown/build-JVmLFaZt-DRlLhpV3.js:4537-4562`.

## Node and Electron

- [Node `worker_threads`](https://nodejs.org/api/worker_threads.html): `new Worker` accepts a
  `file:` or `data:` URL ("When using a `data:` URL, the data is interpreted based on MIME type
  using the ECMAScript module loader"); `resourceLimits` "only affect the JS engine, and no
  external data, including no `ArrayBuffer`s"; `terminate()` returns a Promise for the exit
  code, which is 1 after termination. Verified 2026-10-10 (docs for v26).
- [Node ES modules, `data:` imports](https://nodejs.org/api/esm.html): a `data:` module resolves
  only builtin bare specifiers and absolute specifiers, never relative ones. Verified
  2026-10-10. This is why the worker bundle must be self-contained.
- Node type stripping runs `.ts` files with erasable syntax directly; the repo already requires
  erasable syntax (`tsconfig.base.json:9`) and runs the dev server from source
  (`apps/server/package.json:18`).
- [Electron PR #33216](https://github.com/electron/electron/pull/33216): worker threads can load
  scripts from asar archives (CommonJS). Reports that ES module workers fail inside asar were not
  verified; the `data:` URL approach does not depend on either.
- [Node issue #56077](https://github.com/nodejs/node/issues/56077): worker threads in single
  executable applications have open problems. Loom's executable embeds only `src/bin.ts`
  (`apps/server/vite.config.ts:79-81`), so v1 reports checks as unavailable there.

## File formats

- [3MF Core Specification](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md):
  units (micron, millimeter, centimeter, inch, foot, meter; default millimeter), the 12-number
  row-major transform, objects, components, build items, triangle `v1 v2 v3`, and the start part
  `/3D/3dmodel.model` through `_rels/.rels`. Verified 2026-10-10. Licence: the 3MF Consortium
  publishes the specification for free implementation.
- [3MF Production Extension](https://github.com/3MFConsortium/spec_production/blob/master/3MF%20Production%20Extension.md):
  section 3.1 adds `path` on build items and components in the root model only ("Any consumer of
  a 3MF package that contains path attributes in components in a non-root model file MUST
  generate an error"). Verified 2026-10-10.
- [glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html): right-handed, +Y up,
  metres, GLB container, accessors, `byteStride`, sparse accessors, primitive modes. Verified
  that the page resolves; the coordinate and unit wording is from the spec's "Coordinate System
  and Units" section and matches the viewer's conversion.
- STL: binary layout of an 80-byte header, `uint32` count and 50-byte records is the de facto
  format (3D Systems); no normative public specification. Not separately verified.
- OBJ: Wavefront `v`/`f` records with negative relative indices; de facto format, not verified
  against a normative document.

## Slicer conventions

- [UltiMaker Cura support settings](https://support.ultimaker.com/s/article/1667417606331): a
  smaller overhang angle adds more support; 0 degrees supports all overhangs, 90 none.
- [Cura `fdmprinter.def.json`](https://github.com/Ultimaker/Cura/blob/main/resources/definitions/fdmprinter.def.json):
  `support_angle` "The minimum angle of overhangs for which support is added", base
  `default_value` 50. Verified 2026-10-10. Loom defaults to 45 (PRODUCT.md, Decisions).
- [3D Printerly on Cura supports](https://3dprinterly.com/how-to-get-the-perfect-support-settings-cura/)
  and [Wevolver](https://www.wevolver.com/article/cura-support-settings): 45 degrees as the
  common starting value. Secondary sources.
- Two perimeters (two nozzle widths) as the minimum reliable wall is a widespread slicer
  guideline, used here as `minWall = 2 * nozzle`. Rule of thumb, not verified against one source.

## Algorithms

- Tomas Moller and Ben Trumbore, "Fast, Minimum Storage Ray-Triangle Intersection", Journal of
  Graphics Tools 2(1):21-28, 1997,
  [doi:10.1080/10867651.1997.10487468](https://doi.org/10.1080/10867651.1997.10487468).
- John Amanatides and Andrew Woo, "A Fast Voxel Traversal Algorithm for Ray Tracing",
  Eurographics 1987, pages 3-10,
  [Eurographics Digital Library](https://diglib.eg.org/items/60c72224-00f3-416d-9952-ee41e8c408da),
  [author's PDF](http://www.cse.yorku.ca/~amana/research/grid.pdf). Includes the mailbox idea for
  objects in several cells.
- Square-root barycentric sampling: Osada, Funkhouser, Chazelle and Dobkin, "Shape
  Distributions", ACM TOG 21(4), 2002, section 4.2. Not re-verified.
- Andrew's monotone chain convex hull (1979) and Toussaint's rotating calipers (1983) for the
  footprint width. Standard; not re-verified.
- sfc32 (Chris Doty-Humphrey's Small Fast Counting generator, from PractRand, public domain), as
  catalogued in [bryc's PRNGs.md](https://github.com/bryc/code/blob/master/jshash/PRNGs.md)
  ("best 2^128 state JS PRNG. passes practrand"). Verified 2026-10-10.
- [mulberry32](https://gist.github.com/tommyettinger/46a874533244883189143505d203312c) (CC0) was
  considered; [its author no longer recommends it](https://github.com/bryc/code/discussions/21)
  beyond small sample counts.

## Libraries considered and not used

- [three.js](https://github.com/mrdoob/three.js) `3MFLoader` and `GLTFLoader` (MIT): the viewer's
  loaders and the behaviour the server readers must match. They depend on the DOM (`DOMParser`)
  and three's scene graph, so the server has its own small readers.
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) (MIT): the usual BVH for
  three.js. Not used; the brief rules out a BVH dependency.
- [manifold-3d](https://github.com/elalish/manifold) (Apache-2.0): robust topology and booleans
  in WASM. Not used in v1 (TECHNICAL.md, Alternatives).
- [admesh](https://github.com/admesh/admesh) (GPL-2.0): STL checking and repair CLI. GPL and a
  native binary; not used.
- [trimesh](https://github.com/mikedh/trimesh) (MIT, Python): the Fabrication plan's mesh
  library. Python is not part of Loom's server.
