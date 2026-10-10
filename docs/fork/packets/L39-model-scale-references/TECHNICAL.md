# L39 technical

## Overview

`viewer/references.ts` builds one small `Group` of meshes for the chosen object. The viewer adds
it to the existing `helpers` group (`apps/web/src/fork/model-preview-3d/viewer/createViewer.ts:327`),
which already holds the bed and axes. Everything that must ignore the reference already does,
because it only looks at `model`:

- Picking raycasts `model` only (`createViewer.ts:123`).
- Fit and standard views use `box`, set from `meshStats(model)` in `setModel` (line 513-534).
- Dimensions, triangle count and bed fit come from the same `meshStats` (`viewer/load.ts:46`).
- Section clipping and wireframe traverse `model` only (`applySection` at line 97,
  `applyWireframe` at line 403).

Captures render the whole scene (`capture` at line 572 calls `renderer.render(scene, camera)`),
so the reference appears in captures exactly when it is visible. No capture code changes.

## Contracts

A new file `packages/contracts/src/fork/model-scale.ts` (see the import note below), exported
from `packages/contracts/src/fork/index.ts` beside `model-preview-3d.ts` (line 4):

```ts
/** An everyday object drawn beside the part for scale. */
export const ScaleReference = Schema.Literals([
  "none",
  "card",
  "coin-us",
  "coin-euro",
  "aa-battery",
  "brick-2x4",
  "m3-screw",
  "hand",
]);
export type ScaleReference = typeof ScaleReference.Type;
```

In `packages/contracts/src/fork/model-preview-3d.ts`, `ModelPreviewSettings` (line 240) gains,
after `buildPlate`:

```ts
scaleReference: ScaleReference.pipe(Schema.withDecodingDefault(Effect.succeed("none" as const))),
```

`DEFAULT_MODEL_PREVIEW_SETTINGS` (line 297) gains `scaleReference: "none"`. Saved settings
without the field decode to `"none"`, exactly as `buildPlate.pattern` does at line 237.

`packages/contracts/src/fork/model-editor.ts`: `ModelEditorAction` (line 5) gains
`reference: Schema.optional(ScaleReference)`, used with `action: "display"`. Import
`ScaleReference` from `./model-scale.ts`. It cannot live in `model-preview-3d.ts`, because that
file imports `model-editor.ts` as `Editor` (line 1) and the reverse import would be a cycle.

## Server

No logic change. Settings are stored as JSON and decoded with `ModelPreviewSettings`
(`apps/server/src/fork/model-preview-3d/store.ts`), so the default applies on read. Any server
code that builds a settings literal is caught by the typechecker; add the field there.
`loom_model_preview_3d_settings` and `loom_model_preview_3d_save_settings` expose the field
automatically because their schemas are `ModelPreviewSettings`; the encoded side of a decoding
default is optional, so agents that omit it keep working.

## Storage

One string in the existing settings row. No migration.

## Clients

### Geometry (`viewer/references.ts`)

```ts
export const REFERENCE_GAP_MM = 10;
export type ReferenceSpec = { label: string; size: readonly [number, number, number] };
export const REFERENCE_SPECS: Record<Exclude<ScaleReference, "none">, ReferenceSpec>;
export function createReference(
  kind: ScaleReference,
): { object: Group; size: Vector3; dispose(): void } | null;
/** Position of the reference group's origin so its box sits right of `box`, on its floor. */
export function placeReference(box: Box3, size: Vector3): Vector3;
```

All objects are built in millimetres around their own bounding-box centre on X and Y, resting
on z = 0, long side along Y. One shared `MeshStandardMaterial` (colour `0x8b939c`, roughness
0.8, metalness 0), so a reference never reads as part of a coloured 3MF. Low poly: 32 radial
segments for cylinders, 4 curve segments per rounded corner.

| Kind         | Construction (mm)                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `card`       | Rounded rectangle `Shape` 53.98 × 85.60, corner radius 3.18, `ExtrudeGeometry` depth 0.76, no bevel                             |
| `coin-us`    | `CylinderGeometry` Ø24.26, height 1.75, rotated to stand on Z                                                                   |
| `coin-euro`  | `CylinderGeometry` Ø23.25, height 2.33                                                                                          |
| `aa-battery` | Lying along Y: body Ø14.5 × 49.5, positive button Ø5.5 × 1.0 at +Y; total 50.5                                                  |
| `brick-2x4`  | `BoxGeometry` 15.8 × 31.8 × 9.6 plus 8 studs Ø4.8 × 1.7 on an 8 mm pitch (centres x ±4, y ±4 and ±12)                           |
| `m3-screw`   | Lying along Y: head Ø5.5 × 3.0, shank Ø3.0 × 10.0; no socket or thread                                                          |
| `hand`       | An authored 2D outline (about 40 points, palm down, fingers together, thumb slightly out) scaled to 190 long in Y, extruded 2.0 |

`size` is the object's bounding box size, used by tests and placement.

`placeReference(box, size)`: x = `box.max.x + REFERENCE_GAP_MM + size.x / 2`,
y = `box.getCenter().y`, z = `box.min.z`. The bed sits at `box.min.z` too
(`placeBed`, line 433), so the reference rests on the plate.

### Viewer (`viewer/createViewer.ts`)

Additive:

- State `reference: ReturnType<typeof createReference> = null` and `referenceKind = "none"`.
- `placeReferenceObject()` called at the end of `placeBed()` (line 433), so it follows every
  `setModel` and `setBed`. Without a model, the reference is hidden.
- New method `setReference(kind: ScaleReference)`: no-op when unchanged; otherwise dispose the
  old group, remove it from `helpers`, build the new one, place it, `requestRender()`.
- `dispose()` (line 628) disposes the reference.

The thumbnail viewer (`VariantsInspector.tsx:719`) and PCB board viewer
(`apps/web/src/fork/pcb-preview/Board3D.tsx:89`) never call `setReference`, so they are
unchanged.

### Panel

- `viewer/ViewerCanvas.tsx`: new optional prop `reference?: ScaleReference`, applied in an
  effect like `display` (line 162) and again after load next to the display options (line 126).
  The variants comparison `ViewerCanvas` (`VariantsInspector.tsx:168`) does not pass it.
- `ModelPanel.tsx`: pass `reference={settings.scaleReference}`. The mesh reload key at line 449
  lists only mesh-affecting settings, so changing the reference never reloads the model.
- `BedPicker.tsx`: add `useScaleReference(environmentId, settings)` beside `useBuildPlate`
  (line 44), with the same optimistic pending value, save through `models.updateSettings`,
  settings refresh and error toast ("Scale reference not changed"). Append a labelled `Select`
  "Show for scale" inside the existing `fieldset` (after the pattern `Segmented`, line 173), so
  it is disabled on connections that cannot save. Options come from `REFERENCE_SPECS` labels
  plus "Nothing". Do not reorder existing items.
- `SettingsSection.tsx`: a "Show for scale" `SettingsRow` after "Bed pattern" (line 245) using
  the same `set` helper.
- `ModelPanel.tsx:216` `display` case: if `c.reference !== undefined`, save the setting through
  the same hook's `save` and await it, so the editor result reflects the saved state. Fail with
  "This connection cannot change model settings." when not permitted.

Labels: "Credit card", "US quarter", "1 euro coin", "AA battery", "LEGO 2×4 brick",
"M3×10 screw", "Hand".

## Agent-facing tools

No new tool. `loom_model_preview_3d_editor` with
`{ action: "display", reference: "coin-euro" }` shows a coin, then `capture` includes it.
`reference: "none"` removes it. The current value is readable with
`loom_model_preview_3d_settings`. Extend the editor tool description
(`apps/server/src/fork/model-preview-3d/mcp.ts:16`) with "display can show an everyday object
for scale (`reference`)".

## Performance

- Geometry: at most about 2,000 triangles (the hand outline and the brick's studs), built once
  per choice in under a millisecond, disposed on change.
- One extra draw call or a few (the brick and battery have several meshes) when visible; none
  when "none".
- No animation; one `requestRender` per change.
- Network: one settings RPC per change.

## Alternatives considered

- Bundled STL assets: realistic but adds binary files, licensing questions and download bytes
  for a size cue. Procedural shapes are tiny and exact where it matters.
- Per-model workspace entity: lets each part have its own reference, but the choice is about the
  viewer, and per-model state would need limits, staleness rules and more UI.
- Include the reference in fit: shows the reference fully but makes the part tiny next to a hand
  and changes `F` behaviour whenever a reference is on. See PRODUCT.md.
- Put it on the bed at a fixed corner: stays still, but on a 350 mm bed a coin far from a 20 mm
  part conveys nothing.
- A dimension label on the reference: duplicate information; the object itself is the point.
