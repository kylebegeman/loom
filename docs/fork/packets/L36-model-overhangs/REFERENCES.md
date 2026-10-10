# L36 references

## Prior art

- Cura: "Support overhang angle", measured from vertical. 0° supports everything, 90° supports
  nothing, and the default is 45°. Verified:
  [UltiMaker support article](https://support.ultimaker.com/s/article/1667417606331). Cura also
  shades overhangs red in the prepare view. LGPL-3.0; behaviour only.
- Bambu Studio: the support "Threshold angle" is measured from horizontal; faces flatter than it
  get support. Default 30° from horizontal, which is 60° from vertical. Verified:
  [Bambu forum explanation](https://forum.bambulab.com/t/supports-threshold-angles-working-counter-intuitively/220975/3)
  and [Bambu wiki on overhangs](https://wiki.bambulab.com/en/filament-acc/filament/print-quality/overhang).
  AGPL-3.0; behaviour only.
- PrusaSlicer: the support "Overhang threshold" is also a slope from horizontal (0 means automatic
  detection). Not re-verified for this packet; the user guide should say "slicers that measure
  from horizontal" rather than naming defaults.
- The 45° rule of thumb for unsupported FDM overhangs is common guidance (the Cura default and the
  Bambu wiki page above); real limits depend on material, cooling and layer height.

## Libraries (already dependencies)

- three 0.186.0, MIT.
  - `Material.onBeforeCompile` and `Material.customProgramCacheKey` for shader patches.
  - Fragment chunk order in `src/renderers/shaders/ShaderLib/meshphysical.glsl.js` (clipping at
    line 169, `normal_fragment_maps` at 183) and `meshphong.glsl.js` (92, 105); vertex
    `project_vertex` at `meshphysical.glsl.js:44` and `meshphong.glsl.js:39`.
  - `src/renderers/shaders/ShaderChunk/common.glsl.js:69`: `transformNormalByInverseViewMatrix`
    (the r185 replacement for the deprecated `inverseTransformDirection`, line 67). Not needed by
    this design, which derives world normals from screen derivatives, but relevant if someone
    switches to interpolated normals.
  - WebGL 1 support was removed in r163, so `dFdx`/`dFdy` are core GLSL ES 3.0 functions.

## Facts

- Binary STL layout: 80-byte header, `uint32` little-endian triangle count, then per triangle
  12 `float32` (normal and three vertices) and a `uint16` attribute, 50 bytes total. Widely
  documented; see [STL (file format), binary STL](<https://en.wikipedia.org/wiki/STL_(file_format)#Binary>).
- OpenSCAD `--export-format binstl` is already used by Loom
  (`apps/server/src/fork/model-preview-3d/openscad.ts:54`).
- OpenSCAD PNG export colours geometry by `color()` (preview) and cannot shade by normal.
  Whether colour survives for imported meshes in `--render` with the Manifold backend: not
  verified.
- Accessible palettes: orange and blue are a commonly recommended pair for colour vision
  deficiencies; the hatch is what guarantees legibility. Not separately verified.
