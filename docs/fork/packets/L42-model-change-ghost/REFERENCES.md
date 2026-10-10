# L42 references

## Prior art

- Code diffs: the mental model. Show what was there and what is there now, in place.
- Onion skinning in animation tools: the previous frame drawn translucently under the current
  one. The ghost is a one-frame onion skin.
- CAD "compare" tools (Onshape's Compare, Fusion 360's compare between versions) highlight
  added and removed geometry between versions. They work on B-rep and history; the ghost gives
  most of the value with none of that machinery. (Feature names from vendor docs as commonly
  described; not re-verified for this packet.)
- Mesh deviation colouring (CloudCompare cloud-to-mesh distance, MeshLab Hausdorff distance):
  the basis of the phase 2 tint. Both compute nearest-surface distances with spatial
  subdivision. CloudCompare is GPL-2.0 and MeshLab is GPL-3.0; nothing is copied, only the
  well-known approach.

## Facts relied on

- three.js renders transparent objects after opaque ones and sorts them by distance, and a
  material with `depthTest: true, depthWrite: false` is hidden behind nearer opaque surfaces
  without hiding what is behind itself. [three.js Material docs](https://threejs.org/docs/#api/en/materials/Material).
- Per-material `clippingPlanes` apply when `renderer.localClippingEnabled` is true, which the
  viewer already sets (`apps/web/src/fork/model-preview-3d/viewer/createViewer.ts:60`).
  [three.js WebGLRenderer.localClippingEnabled](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.localClippingEnabled).
- Memory estimate: a non-indexed triangle has 3 positions and 3 normals of 3 float32 values,
  72 bytes; 1,000,000 triangles is about 72 MB before GPU copies. Arithmetic, not measured.

## In-repo sources

- Model replacement and disposal: `viewer/createViewer.ts:513-534`, `viewer/load.ts:20`.
- Live reload trigger: `ModelPanel.tsx:445-463`.
- Hidden release: `ModelPanel.tsx:470-479`.
- Mesh revision for files: `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:97`;
  for SCAD renders, the render key at line 579.

## Licences

No code is copied. three.js is MIT and already a dependency.
