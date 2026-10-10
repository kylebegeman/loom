# L40 references

## Old Loom

No old Loom equivalent. L23 shipped millimetres only and the "1 in grid" pattern
(`apps/web/src/fork/model-preview-3d/buildPlate.ts:41-49`).

## Loom source this packet builds on

- `packages/contracts/src/fork/model-preview-3d.ts:240-262`, `:297-306`: settings and defaults.
- `apps/server/src/fork/model-preview-3d/store.ts:46-58`: settings stored as decoded JSON.
- `apps/server/src/fork/model-preview-3d/mcp.ts:15-16`, `:133-150`: tool descriptions.
- `apps/web/src/fork/model-preview-3d/BedPicker.tsx:44-69`: optimistic settings save copied by
  `useDisplayUnitsSetting`.
- `apps/web/src/fork/model-preview-3d/controls.tsx:242-374`, `scrub.ts`: the `Scrub` field.
- `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts:260`, `:278`: measurement labels
  and capture painting.
- `apps/web/src/fork/model-preview-3d/actions.ts`, `palette.tsx`: panel actions from the
  palette.
- The inventory in TECHNICAL.md lists every display site with its line.

## External

- The inch is defined as exactly 25.4 mm (international yard and pound agreement, 1959; NIST
  SP 811, Appendix B, https://www.nist.gov/pml/special-publication-811). Not fetched; standard
  fact.
- Slicers and CAD tools (Bambu Studio, PrusaSlicer, Fusion) offer a millimetre or inch display
  preference that leaves stored data in millimetres. Background for the "display only" choice;
  not verified against current versions.
- No code or assets are reused, so no licence applies.
