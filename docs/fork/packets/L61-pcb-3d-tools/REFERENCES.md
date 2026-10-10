# L61 references

## Prior art

- KiCad's 3D viewer offers perspective and orthographic projection, per-layer visibility
  (board body, copper, silkscreen, solder mask, through-hole, SMD and virtual models) and a
  board-only view. L61's toggles follow that grouping, collapsed to what the GLB export
  carries. Not verified against KiCad 10's menus; the grouping is from general use.
- Enclosure clearance tools in MCAD (Fusion, FreeCAD's KiCad StepUp) work on the exported STEP:
  section, measure, and the bounding box of each component. L61 does the same on the GLB the
  panel already has.
- The model panel's tools in this repo: L31, L37 and L38 (links in [README.md](./README.md)).

## Verified facts

- three 0.186.0 is installed in `apps/web/node_modules/three` (package.json `"version"`). MIT
  licence (`"license": "MIT"`).
- `Raycaster` tests `object.layers`, not `visible`, before raycasting each object
  (`three/src/core/Raycaster.js:240-248`). Hidden objects are therefore pickable unless the
  caller filters them.
- `WebGLRenderer` defaults `stencil` to false (`three/src/renderers/WebGLRenderer.js:76`), which
  is why L37 sets it.
- GLTFLoader keeps material names as written (`examples/jsm/loaders/GLTFLoader.js:3736`) and
  sanitizes node names through `createUniqueName`: spaces become underscores, `[ ] . : /` are
  removed, and repeated names get `_1`, `_2` (`GLTFLoader.js:3757-3771`,
  `src/animation/PropertyBinding.js:185-188`).
- KiCad 10 GLB export ([`step_pcb_model.cpp` on the 10.0 branch](https://gitlab.com/kicad/code/kicad/-/blob/10.0/pcbnew/exporters/step/step_pcb_model.cpp),
  downloaded and read on 2026-10-10):
  - Materials are created as `soldermask`, `silkscreen`, `copper`, `pad` and `board`
    (lines 3027-3033).
  - Board shapes are added as `copper`, `pad`, `via` (copper material), `silkscreen` front and
    back, `soldermask` front and back, and `PCB` for the body (lines 3035-3045). Their product
    names are `<pcb name>_<shape name>` with an optional index (lines 2933-2952).
  - Each component instance label is named with its reference designator
    (`TDataStd_Name::Set( llabel, refdes )`, line 1855).
  - `WriteGLTF` uses OCCT's `RWGltf_CafWriter` with Z-up input and a 0.001 length unit
    (lines 3951-3973).
- OCCT's glTF writer names nodes from the instance name, falling back to the product name, by
  default: `myNodeNameFormat(RWMesh_NameFormat_InstanceOrProduct)` in the constructor of
  [`RWGltf_CafWriter.cxx`](https://github.com/Open-Cascade-SAS/OCCT/blob/master/src/DataExchange/TKDEGLTF/RWGltf/RWGltf_CafWriter.cxx)
  (master, read 2026-10-10). So KiCad component nodes carry their reference. Not checked
  against a real exported file; the classification falls back to geometry when names do not
  match.
- L24 exports with `--include-tracks --include-pads --include-silkscreen --include-soldermask`
  (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1650-1661`): no zones, no inner layers
  as separate pieces.
- circuit-json-to-gltf 0.0.148 (the version in L24's tool sandbox,
  `/private/tmp/loom-l24-preview/tools/node_modules/circuit-json-to-gltf`; MIT, "Copyright (c)
  2024 tscircuit Inc.", [repository](https://github.com/tscircuit/circuit-json-to-gltf)):
  - Part boxes are labelled with the source component name (`dist/index.js:18500,18655`) and
    each glTF node is named with that label (`:19046`).
  - Board copper and silkscreen are rendered into the board box's top and bottom textures
    (`:18281-18290`), not separate meshes.
  - Positions map circuit `(x, y)` to glTF translation `(-x, up, y)` (`:18491,18647`,
    `toGltfTranslation` at `:19533`).
  - L24 wraps the scene in a node scaling millimetres to metres
    (`apps/server/src/fork/pcb-preview/glb.ts:6-58`).

## Not verified

- The KiCad GLB board frame's origin and Y sign relative to the drawing frame. The usual STEP
  convention (X right, Y up, origin per export options) is assumed only as a fallback;
  `boardFrame` fits the real mapping from matched parts.
- Whether the tscircuit 3D board appears rotated relative to the 2D drawing on screen. The
  derivation from `toGltfTranslation` and the loader's `rotation.x = π/2`
  (`apps/web/src/fork/model-preview-3d/viewer/load.ts:157`) suggests the 3D top view shows the
  board turned 180 degrees from the 2D board view. Check during the manual pass; if confirmed,
  it is an L24 defect to fix in `normalizeCircuitGlb`, not in L61.
- Whether typical KiCad component models are closed meshes. L37's "partial" state covers the
  case where they are not.

## Licences

Nothing is copied. three.js (MIT) is already a dependency. KiCad (GPL-3.0-or-later) and OCCT
(LGPL-2.1 with exception) are read as references for their output format only.
circuit-json-to-gltf (MIT) runs on the host as part of tscircuit; L61 reads its output.
