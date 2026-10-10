# L31 references

## Prior art

- PrusaSlicer: `K` switches between perspective and orthographic; the preference
  "Use perspective camera" sets the default. Verified:
  [Perspective/orthographic camera](https://help.prusa3d.com/article/perspective-orthographic-camera_1760),
  [Keyboard shortcuts](https://help.prusa3d.com/article/keyboard-shortcuts_1764). Loom uses `P`,
  the key allocated in MODEL-3D-FOLLOW-UPS.md.
- PrusaSlicer users asked for the toggle in the View menu because the key alone was easy to miss
  ([issue #8326](https://github.com/prusa3d/PrusaSlicer/issues/8326)). Hence the Display menu
  checkbox as well as the key.
- Bambu Studio and OrcaSlicer offer a similar "Use perspective view" preference (not verified).

## Libraries and facts

- three 0.186.0 (MIT), already a dependency:
  - `OrthographicCamera` projection uses `left/right/top/bottom` divided by `zoom`
    (`apps/web/node_modules/three/src/cameras/OrthographicCamera.js:195-198`). Verified in
    source.
  - `Raycaster.setFromCamera` handles orthographic cameras
    (`three/src/core/Raycaster.js:127`). Verified in source.
  - Sprites with `sizeAttenuation: false` scale by view depth only under a perspective matrix
    (`three/src/renderers/shaders/ShaderLib/sprite.glsl.js:21-23`, `isPerspectiveMatrix` in
    `ShaderChunk/common.glsl.js:85`). Verified in source. This is why dot sizes need
    `markerScale`.
  - OrbitControls perspective pan scales by `targetDistance * tan(fov / 2)`
    (`examples/jsm/controls/OrbitControls.js:994-1010`). Verified in source.
  - Docs: [OrthographicCamera](https://threejs.org/docs/#api/en/cameras/OrthographicCamera),
    [OrbitControls](https://threejs.org/docs/#examples/en/controls/OrbitControls).
- OpenSCAD CLI (GPL-2.0, run as an external program, not linked):
  `--projection=[o|ortho|p|perspective]` for PNG export, used with `--camera`, `--viewall`,
  `--autocenter` and `--imgsize`. Verified:
  [Using OpenSCAD in a command line environment](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment).
  Whether `--viewall` frames ortho output as tightly as perspective is not verified; the real
  OpenSCAD test in TESTING.md checks it produces an image.
- Effect `Schema.withDecodingDefault` makes the key optional when encoded and fills the default
  when decoded (`.repos/effect-smol/packages/effect/src/Schema.ts:5905`). Verified in source;
  used the same way at `packages/contracts/src/fork/model-preview-3d.ts:237`.
