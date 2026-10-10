# L37 references

## Prior art

- three.js `webgl_clipping_stencil` example (r186): per plane, a back-face mesh incrementing and a
  front-face mesh decrementing the stencil (colour, depth write and depth test off), then a plane
  mesh drawn where the stencil is not zero with `ReplaceStencilOp`, clearing the stencil in
  `onAfterRender`. Source:
  [examples/webgl_clipping_stencil.html at r186](https://github.com/mrdoob/three.js/blob/r186/examples/webgl_clipping_stencil.html).
  MIT (three's licence; the file has no separate header). This packet reuses the technique and
  material settings, not the example's code structure.
- CAD section views (Fusion, Onshape, SolidWorks) fill and hatch cut faces; slicers show layer
  previews instead. Behaviour reference only.

## Libraries (already dependencies)

- three 0.186.0, MIT.
  - `WebGLRenderer` option `stencil`, default `false`
    (`node_modules/.pnpm/three@0.186.0/node_modules/three/src/renderers/WebGLRenderer.js:76`).
  - Stencil material properties (`stencilWrite`, `stencilFunc`, `stencilRef`, `stencilFail`,
    `stencilZFail`, `stencilZPass`) and constants (`AlwaysStencilFunc`, `NotEqualStencilFunc`,
    `IncrementWrapStencilOp`, `DecrementWrapStencilOp`, `ReplaceStencilOp`).
  - `Ray.intersectPlane`, `Plane.coplanarPoint`, `Object3D.matrixWorldAutoUpdate`.

## Facts

- The renderer's `stencil` default changed from `true` to `false` in r163. Verified:
  [three.js migration guide, r162 to r163](https://github.com/mrdoob/three.js/wiki/Migration-Guide#r162--r163),
  [r163 release notes](https://github.com/mrdoob/three.js/releases/tag/r163), and a forum report
  of caps breaking after upgrading:
  [Stencil buffer not working in 163](https://discourse.threejs.org/t/stencil-buffer-not-working-in-163/63752).
- Stencil counting needs a closed (watertight) surface: an open surface leaves the count unbalanced
  and the cap fills air or leaves gaps. This is the general principle of stencil capping, also
  noted in the example's use of closed geometry. Not separately sourced.
- The minimum chord through a point in a straight wall equals the wall's width in that plane
  (the perpendicular chord is the shortest segment between two parallel lines). Elementary
  geometry; the slanted-wall factor `1 / cos(a)` follows from the same construction and is
  covered by a test.
- Whether the default framebuffer allocates stencil packed with depth (24/8) is driver dependent;
  not verified.
