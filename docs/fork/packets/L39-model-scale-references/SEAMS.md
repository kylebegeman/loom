# L39 seams

## Upstream files touched

None. Every edit is in fork-owned files.

## Fork-owned shared files edited

These are on the shared touch points list in
[MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md). Keep each change additive.

| File                                                         | Change                                             | Likely to meet                                      |
| ------------------------------------------------------------ | -------------------------------------------------- | --------------------------------------------------- |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`  | `setReference`, one call in `placeBed`, disposal   | Every viewer packet; L32 to L34 touch bed placement |
| `apps/web/src/fork/model-preview-3d/BedPicker.tsx`           | `useScaleReference` hook and one appended `Select` | L32, L33, L34, L51                                  |
| `apps/web/src/fork/model-preview-3d/SettingsSection.tsx`     | One `SettingsRow` after "Bed pattern"              | L33, L40, L51                                       |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`          | `reference` prop, `display` editor case            | Every packet with a key or editor case              |
| `apps/web/src/fork/model-preview-3d/viewer/ViewerCanvas.tsx` | `reference` prop and effect                        | L31, L36, L42                                       |
| `packages/contracts/src/fork/model-preview-3d.ts`            | `scaleReference` setting with decoding default     | L33, L40, L51                                       |
| `packages/contracts/src/fork/model-editor.ts`                | `reference` on `ModelEditorAction`                 | Every packet adding an editor field                 |
| `packages/contracts/src/fork/index.ts`                       | One `export *` line for `model-scale.ts`           | Any packet adding a contracts file                  |
| `apps/server/src/fork/model-preview-3d/mcp.ts`               | One phrase in the editor tool description          | Any packet extending the editor command             |

New files owned by this packet: `viewer/references.ts`, `viewer/references.test.ts`,
`packages/contracts/src/fork/model-scale.ts`.

## Keyboard

None. The reference is a menu choice; no key is allocated.
