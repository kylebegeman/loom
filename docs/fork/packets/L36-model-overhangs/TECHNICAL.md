# L36 technical

## Overview

Two independent pieces share one definition of an overhang:

- The viewer patches each lit model material once, at load, with a few lines of GLSL that tint
  and hatch overhang fragments. One shared uniform object turns the effect on and off and sets
  the angle, bed height and colours, so changes cost one `requestRender`, never a recompile.
- A pure helper, `overhangStats`, walks triangle positions and returns areas and regions. The web
  client uses it for the chip's empty state and tooltip; the server uses it for the render tool;
  L46 reuses it.

Definition. Let `n` be the unit face normal in world space and `up = (0, 0, 1)`. A face is an
overhang when it faces down and its tilt from vertical exceeds the threshold `t`:
`-n.z > sin(t)`. A vertical wall (`n.z = 0`) is 0° and a flat ceiling (`n.z = -1`) is 90°. Faces
whose height is within `BED_BAND_MM = 0.2` of the part's lowest point are excluded: they print on
the plate. A future L35 orientation integration must update bed height and invalidate the
viewer's cached world-space positions; the host helper already accepts the oriented up vector.

## Contracts

`packages/contracts/src/fork/model-preview-3d.ts`, `ModelPreviewSettings`
(`model-preview-3d.ts:240-262`):

```ts
/** Overhang shading threshold, degrees from vertical. */
overhangAngleDegrees: Schema.Int.check(Schema.isBetween({ minimum: 30, maximum: 70 })).pipe(
  Schema.withDecodingDefault(Effect.succeed(45)),
),
```

This is an environment-wide setting beside `displayUnits` and `scaleReference`, not a bed
field. `DEFAULT_MODEL_PREVIEW_SETTINGS` has `overhangAngleDegrees: 45`. Settings saved before
this packet load as 45.

`packages/contracts/src/fork/model-workspace.ts`, `ModelCamera` (`model-workspace.ts:11-21`):

```ts
overhangs: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
```

Saved views and annotation cameras recorded before this packet recall with overhangs off.
`ModelCamera` is also the editor `camera` input (`model-editor.ts:46`), so agents may omit it.

`packages/contracts/src/fork/model-editor.ts`, `ModelEditorAction` (`model-editor.ts:5-53`):
`overhangs: Schema.optional(Schema.Boolean)`, next to `wireframe`, `grid` and `axes`.

`packages/contracts/src/fork/model-overhangs.ts` (new, exported from `fork/index.ts`):

```ts
export const OVERHANG_ANGLE = { minimum: 30, maximum: 70, default: 45 } as const;
export const BED_BAND_MM = 0.2;
const area = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
export const OverhangRegion = Schema.Struct({
  areaMm2: area,
  /** Area-weighted centre in model (file) coordinates. */
  centre: ModelPoint,
  /** Height above the part's lowest point, in the current orientation. */
  heightMm: Schema.Tuple([area, area]),
});
export const OverhangStats = Schema.Struct({
  thresholdDegrees: Schema.Int.check(Schema.isBetween(OVERHANG_ANGLE)),
  totalAreaMm2: area,
  overhangAreaMm2: area,
  overhangPercent: Schema.Number.check(
    Schema.isFinite(),
    Schema.isBetween({ minimum: 0, maximum: 100 }),
  ),
  facets: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** The largest regions, at most ten. */
  regions: Schema.Array(OverhangRegion).check(Schema.isMaxLength(10)),
  oriented: Schema.Boolean,
});
export function overhangStats(
  positions: Float32Array, // non-indexed triangles, model space
  options: { thresholdDegrees: number; up?: readonly [number, number, number] },
): OverhangStats;
```

`up` is the world "up" expressed in model space: `R^T * (0, 0, 1)` for an L35 orientation `R`,
`(0, 0, 1)` otherwise. Computing in model space this way avoids rotating every vertex and gives
region centres in file coordinates, which is what an agent editing the source needs (and matches
L35's model-space anchors). Regions: overhang triangles are joined when they share a vertex,
after quantising positions to 1 µm, with a union-find; the ten largest by area are returned. The
helper is pure arithmetic over a `Float32Array`. It rejects incomplete triangles, nonfinite
positions, invalid angles and a zero or nonfinite up vector. Faces crossing the bed band are
clipped to that band before their area and centres are measured, matching fragment shading.
Schemas reject nonfinite or negative areas and percentages outside 0 to 100.

## Server

- `apps/server/src/fork/features.ts:2-11`: append `"model-overhangs"`.
- Render tool (`apps/server/src/fork/model-preview-3d/mcp.ts:181-201`): parameters gain
  `overhangs: Schema.optional(Schema.Boolean)` and
  `overhangAngle: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 30, maximum: 70 })))`
  (default: the setting). Success gains `overhangs: Schema.optional(OverhangStats)`. Description
  gains: "Set overhangs to also return overhang statistics: area beyond the angle from vertical,
  and the largest regions with their centres in model coordinates." `renderModelTool`
  (`mcp.ts:212-227`) passes both through.
- `ModelPreviewService.renderImages` (`ModelPreviewService.ts:1104`) options object (L35 creates
  it; create it here if L35 has not landed) gains `overhangs?: { angle?: number }`. An omitted angle uses the environment setting. When set:
  1. Get a binary STL of the part in model space. SCAD: export once with the same overrides,
     backend and timeout using `meshArgs` (`openscad.ts`, created by L35; create it here
     otherwise), `--export-format binstl` as `renderArgs` does (`openscad.ts:54`). STL, OBJ and
     3MF: export the existing import wrapper (`ModelPreviewService.ts:1156-1162`) the same way, so
     ASCII STL, OBJ and 3MF units all arrive as one binary format. If L35's SCAD path already
     exported a mesh this run, reuse it.
  2. Parse it with `parseBinaryStl(bytes): Float32Array` (new, `overhangMesh.ts`): 80-byte
     header, `uint32` count, then 50 bytes per triangle (normal, three vertices, attribute).
     Reject a size that does not match `84 + 50 * count`.
  3. Call `overhangStats` on those vertices with the requested or saved threshold. L35 has not
     landed in this batch, so host statistics use the file's original up direction. The pure
     helper already accepts `up` for the future orientation integration.
  4. Delete the temporary STL with the existing finalizer pattern.
     Run the export inside the same scoped render job, so cancellation, the render slot and the
     timeout apply as they do for PNGs.
- Shaded images: not produced. See "Alternatives considered".

## Storage

No new storage. The angle is persisted in the existing model-preview settings JSON in
SQLite; the toggle is carried by saved cameras in the existing workspace JSON.

## Clients

### Shader patch (`viewer/overhangs.ts`, new)

```ts
export function createOverhangShading(): {
  uniforms: OverhangUniforms; // shared by every patched material
  patch(material: Material): boolean; // false when the material cannot be shaded
  setEnabled(value: boolean): void;
  setAngle(degrees: number): void;
  setBedZ(z: number): void;
  setTheme(dark: boolean): void;
  setPixelRatio(ratio: number): void;
};
```

`patch` accepts `MeshStandardMaterial`, `MeshPhysicalMaterial`, `MeshPhongMaterial` and
`MeshLambertMaterial`, which cover the STL material (`viewer/load.ts:85`), OBJLoader's Phong
materials and ThreeMFLoader's materials. It records patched materials in a `WeakSet`, chains any
existing `onBeforeCompile`, and appends `loom-overhangs-v1` to the original custom program
cache key. This preserves distinct prior material patches instead of making their programs
collide. In three r186 these fragment shaders run
`#include <clipping_planes_fragment>`, then the colour chunks, then
`#include <normal_fragment_maps>` before lighting (for example
`src/renderers/shaders/ShaderLib/meshphysical.glsl.js:169` and `:183`,
`meshphong.glsl.js:92` and `:105`), so a tint applied to `diffuseColor` right after
`normal_fragment_maps` is lit like the rest of the surface.

Vertex shader, after `#include <project_vertex>`:

```glsl
vec4 loomOverhangPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  loomOverhangPosition = batchingMatrix * loomOverhangPosition;
#endif
#ifdef USE_INSTANCING
  loomOverhangPosition = instanceMatrix * loomOverhangPosition;
#endif
vLoomOverhangWorld = ( modelMatrix * loomOverhangPosition ).xyz;
```

Fragment shader, after `#include <normal_fragment_maps>`:

```glsl
if ( loomOverhangEnabled ) {
  vec3 faceNormal = cross( dFdx( vLoomOverhangWorld ), dFdy( vLoomOverhangWorld ) );
  if ( dot( faceNormal, faceNormal ) > 1e-20 ) {
    faceNormal = normalize( faceNormal ) * ( gl_FrontFacing ? 1.0 : - 1.0 );
    if ( - faceNormal.z > loomOverhangSin
        && vLoomOverhangWorld.z > loomOverhangBedZ + loomOverhangBand ) {
      float stripe = step( 0.5, fract( ( gl_FragCoord.x + gl_FragCoord.y ) / loomOverhangHatch ) );
      vec3 tint = loomOverhangColor * mix( 1.0, loomOverhangStripe, stripe );
      diffuseColor.rgb = mix( diffuseColor.rgb, tint, 0.75 );
    }
  }
}
```

- The derivative normal is the true flat facet normal in world space, independent of smoothed
  vertex normals and of `flatShading`. The degenerate check skips wireframe lines.
- `loomOverhangSin = sin(angle)`; `loomOverhangBedZ` is the world box minimum Z, set on
  `setModel` and (with L35) `setOrientation`; `loomOverhangBand = BED_BAND_MM`.
- `loomOverhangHatch = 8 * renderer.getPixelRatio()` device pixels; `loomOverhangStripe = 0.72`.
- Colours: dark theme `0xff8a4c`, light theme `0xd9531e`, set from the existing theme observer
  (`viewer/createViewer.ts:379-390`). Neither collides with the annotation amber `0xf3ab48` or
  `MARK_BLUE`.
- WebGL 2 has `dFdx`/`dFdy` built in; three r186 requires WebGL 2, so no extension is needed.

### Viewer wiring (`viewer/createViewer.ts`)

- Create one `createOverhangShading()` per viewer. `setModel` (`createViewer.ts:513-534`) patches
  every mesh material after `meshStats` and records whether any were skipped. New methods
  `setOverhangs(enabled)`, `setOverhangAngle(degrees)` call the uniform setters and
  `requestRender`. `snapshot` (`createViewer.ts:441-451`) and `restore` (`createViewer.ts:493-512`)
  carry `overhangs`.
- `capture` (`createViewer.ts:572-627`) renders the scene, so captures include the shading with
  no change.
- `overhangInput()` caches non-indexed world-space positions for the chip's CPU pass, including
  nested transforms, indices and instances. Mirrored transforms reverse vertex winding so
  the CPU pass preserves the same outward facets that Three renders. Host STL statistics stay
  in model coordinates.
- Wireframe disables the shader effect while keeping the mode selected; turning solid faces
  back on restores it. Unsupported materials are reported by the legend.

### Panel

- `ModelPanel.tsx:134`: `display` gains `overhangs: false`; recall at `ModelPanel.tsx:142` reads
  `camera.overhangs`. `ViewerCanvas` applies it alongside wireframe, grid and axes
  (`viewer/ViewerCanvas.tsx:121-131` and its display effect).
- Key line in `ModelPanel.tsx:748-765`:
  `else if (key === "v") setDisplay((value) => ({ ...value, overhangs: !value.overhangs }));`
- `DisplayTools` (`WorkspaceTools.tsx:147-196`) appends a fourth `MenuCheckboxItem`, "Overhangs"
  with `<MenuShortcut>V</MenuShortcut>`. MODEL-3D-FOLLOW-UPS.md names `controls.tsx` for the
  display menu, but it lives in `WorkspaceTools.tsx`. `HELP` (`WorkspaceTools.tsx:197-207`) gains
  `["Overhangs", "V"]`.
- Legend chip: `OverhangLegend.tsx`, rendered by `WorkspaceTools.tsx` while the mode is on,
  wraps the existing `Chip` in a tooltip and popover. The popover holds `Scrub` with unit "°",
  range 30 to 70, step 1, a matching range input, the explanatory line and "Hide overhangs".
  The slider appears only when the host advertises `model-overhangs`, and is disabled without
  the settings permission.
- `overhangSettings.ts` previews drags locally, then commits through `models.updateSettings`
  on pointer/key release or blur. It deduplicates matching commits, preserves the latest other
  settings, refreshes the settings atom after success and restores the saved angle on failure.
- Chip text: "Overhangs over 45°", or "No overhangs over 45°" when the affected area is zero.
  Its tooltip reports the area in mm² or in² and the percentage. The CPU pass runs on model or
  threshold changes through `requestIdleCallback`, with a cancellable timeout fallback, never
  per frame. Stale results are hidden while the new area is pending.
- Palette (`palette.tsx:54-60`, `actions.ts:2`): `"toggle-overhangs"`, titled "3D model: Show
  overhangs" or "3D model: Hide overhangs".
- Editor `display` case (`ModelPanel.tsx:216-224`) spreads `c.overhangs` like the other flags.

## Agent-facing tools

- `loom_model_preview_3d_editor` `{ action: "display", overhangs: true }`; `snapshot` returns
  `camera.overhangs`; `capture` returns a shaded PNG.
- The angle is a setting: agents read it with `loom_model_preview_3d_settings` and change it with
  `loom_model_preview_3d_save_settings`, which already round-trip the whole settings object.
- `loom_model_preview_3d_render` `{ path, overhangs: true, overhangAngle?: 50 }` returns images as
  today plus `overhangs` statistics. Works headless (no panel needed).

## Performance

- No continuous loop. Toggling or dragging the slider updates uniforms and requests one frame.
- When the mode is off the shader evaluates one uniform branch per fragment. When on, a
  cross product, a normalize and a few comparisons: negligible next to PBR lighting.
- No recompile on toggle: the patch is compiled with the model's first draw.
- The chip's CPU pass walks positions once per change, scheduled with `requestIdleCallback`
  and skipped while the mode is off. Large-mesh runtime has not been profiled in this batch.
- Server: one extra OpenSCAD export only when `overhangs` is requested. Importing a mesh is
  fast; a SCAD costs one CSG evaluation. The response grows by under 2 KB.

## Alternatives considered

- Shaded PNGs from OpenSCAD. `--render` PNG export colours by `color()` only, not by normal. A
  spike could split the mesh into overhang and other triangles, write two STLs and render
  `color("orange") import(over); color("silver") import(rest);` with `--preview` (OpenCSG keeps
  colours in preview; whether it does for imports in PNG export, and how the Manifold render path
  treats colour, is unverified). It doubles the mesh I/O for every view. Left as a follow-up for
  Kyle to approve.
- Rendering shaded images with three.js on the server (headless WebGL). Needs a GPU context
  dependency on the host; out of proportion for a statistic.
- Vertex-colour pass on the CPU. Recomputes and uploads colours on every angle or orientation
  change, doubles memory for large meshes, and interpolates across smooth meshes.
- A second overlay mesh with a custom shader. Doubles draw calls and fights depth with the
  model; the in-material patch shares lighting and clipping for free.
- Interpolated vertex normals (`normal` in the shader). Smooth glTF normals blur the threshold
  at edges; slicers judge facets.
- Colour only, no hatch. Fails for some colour vision deficiencies and in greyscale captures.
