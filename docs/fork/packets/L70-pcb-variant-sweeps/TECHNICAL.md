# L70 technical design

## Overview

Variants stay where L24 put them, in `PcbWorkspace.variants` (`pcb-workspace.ts:111-128`), with
new fields that default on decode. A candidate build is a new host operation, `renderVariant`. It
takes the current circuit source, applies the variant's values with the existing
`applyCircuitParameters` (`apps/server/src/fork/pcb-preview/authoring.ts:11-40`) into a staged
copy of the package, builds Circuit JSON and a board SVG with `tsci`, and stores the result in
the existing render cache. The user's source file is never written. The client reads the SVG
with the existing `readSheet`, turns it into a small thumbnail, and saves it on the variant.

The client drives a batch one candidate at a time, as L23's `VariantsInspector.tsx:640-790` does,
with a generation token for cancel and a `cancelVariant` RPC to stop the host build. Comparison
reuses `RevisionCompare.tsx`'s `ComparisonImages` (`:295-331`). Promotion is the existing
`applyParameters` review and apply (`PcbPreviewService.ts:2217-2247`), which checks
`expectedSourceHash` before writing.

## Build time and the sweep limit

No published tscircuit build times were found (see REFERENCES.md). From L24's code path, a
candidate costs one TSX evaluation to Circuit JSON (Bun start, module load, layout and
autorouting) plus one JSON-to-SVG conversion with no evaluation. L24 gives the first 120 s and
runs every `tsci` call through one permit (`tsciLock`, `PcbPreviewService.ts:223-224`, used at
`:314`), so candidates build strictly in sequence. Estimate, unverified: 5 to 30 s per candidate
for small and medium boards. At 8 candidates that is under a minute to about four minutes; at
L23's 12 it reaches six. Decision: `SWEEP_LIMIT = 8`, `VARIANT_LIMIT = 24` (L23's kept limit).
Step 1 of IMPLEMENTATION.md measures the L24 circuit fixture and raises the sweep limit to 12 if
the median is under 8 s. The constant is the only change.

## Contracts

`packages/contracts/src/fork/pcb-workspace.ts`, using the file's `text`, `list` and `finite`
(`:5-8`):

```ts
const nullable = <S extends Schema.Top>(s: S) =>
  Schema.NullOr(s).pipe(Schema.withDecodingDefault(Effect.succeed(null)));

export const PcbVariantStats = Schema.Struct({
  widthMm: finite,
  heightMm: finite,
  components: Schema.Int,
  errors: Schema.Int, // Circuit JSON elements whose type ends in "_error"
  warnings: Schema.Int, // ... in "_warning"
  // L55 values by stat name when boardStats exists, e.g. { minTrackMm: 0.15 }.
  board: Schema.Record(text(60), finite)
    .check(Schema.isMaxProperties(40))
    .pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type PcbVariantStats = typeof PcbVariantStats.Type;
```

`PcbVariant` gains, after `sourceHash`:

```ts
origin: Schema.Literals(["user", "agent"]).pipe(
  Schema.withDecodingDefault(Effect.succeed("user" as const)),
),
thumbnail: nullable(Schema.String.check(Schema.isMaxLength(24000))), // data URL
renderedRevision: nullable(text()), // display source fingerprint the thumbnail was built from
render: nullable(Schema.Struct({ renderKey: text(), sheetId: text(240) })),
stats: nullable(PcbVariantStats),
error: nullable(text(2000)), // last build failure, cleared on success
```

`sourceHash` keeps its L24 meaning: the parameters' content hash when the variant was saved.

`packages/contracts/src/fork/pcb-preview.ts`:

```ts
export const PcbRenderVariantInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
  variantId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  values: W.PcbVariant.fields.values,
  expectedSourceHash: TrimmedNonEmptyString, // PcbParameters.sourceHash
});
export const PcbRenderVariantResult = Schema.Struct({
  variantId: Schema.String,
  outcome: Schema.Literals(["ok", "failed", "timed-out", "cancelled"]),
  renderKey: TrimmedNonEmptyString,
  sheet: Schema.NullOr(PcbSheet), // the normalized board SVG, readable with readSheet
  sourceHash: TrimmedNonEmptyString, // display fingerprint, as PcbRenderResult.sourceHash
  stats: Schema.NullOr(W.PcbVariantStats),
  log: Schema.String, // last 40 lines, 8 KiB, as PcbRenderResult.log
  cached: Schema.Boolean,
});
export const PcbCancelVariantInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
  variantId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});
```

- `PCB_PREVIEW_WS_METHODS` (`:15`) gains `renderVariant` and `cancelVariant`.
- `PcbPreviewRpcGroup` (`:225`) gains both; `cancelVariant` succeeds with `Schema.Void`.
- `packages/contracts/src/fork/clientRpcPermissions.ts:10` gains both with
  `AuthTerminalOperateScope`, the grant `render` uses.

`PcbEditorAction` (`pcb-workspace.ts:300-345`): add `"render-variants"` to the action literals and
an optional `ids: list(text(), 24)`; omitted means every variant without a current thumbnail.

## Server

New file `apps/server/src/fork/pcb-preview/variants.ts`:

- `circuitIssues(json: unknown)`: pure. Counts array elements whose `type` ends in `_error` or
  `_warning`.
- `variantStats(inspection, json, board?)`: pure. Width and height from `inspection.bounds`,
  component count, issues, and `board` from L55 when given.
- `validateVariantValues(parameters, source, values)`: pure. Runs `applyCircuitParameters` and
  returns its message on failure, so proposals and renders reject the same values.
- `makeVariantBuilds(deps)`: built inside `PcbPreviewService.make` with `resolveDesign`,
  `parameters`, `sourceSnapshot`, `requiredTool`, `run`, `temporaryCircuitCwd`,
  `inspectCircuitJson`, `normalizeCircuitSvg`, `cacheDir`, `cacheLock`, `prune` and a
  `commitRender` helper. Returns:
  - `renderVariant(input)`:
    1. Resolve the design; tscircuit only, else `unsupported-view` "Variants need a tscircuit
       design."
    2. Read `parameters(input)`; if its `sourceHash` differs from `expectedSourceHash`, fail
       `conflict` "The circuit source changed. Reload parameters before rendering variants."
    3. `applied = applyCircuitParameters(source, parameters, { ...values })`.
    4. Key: `renderKey(workspaceKey, designId, snapshot.sourceHash, "tscircuit", "pcb",
"variant:" + hashKey(applied), version + ":physical-v3")` from `cache.ts:9-17`, the same
       slots `runRender` fills (`PcbPreviewService.ts:719-727`). A cached manifest returns
       immediately with `cached: true`.
    5. Stage with `temporaryCircuitCwd` (`:1486-1514`); replace the staged design file, which is
       a symlink, with a regular file holding `applied`.
    6. `tsci export <staged> -f circuit-json` (120 s), decode, `inspectCircuitJson`, then
       `tsci export <json> -f pcb-svg` (60 s), then `normalizeCircuitSvg(svg, inspection, "pcb")`
       (`svg.ts:16`), as `runRender` does at `:828-923`.
    7. Write `sheets/1.svg`, the `workspace` marker and a `PcbRenderResult` manifest through
       `commitRender`, so `readSheet` (`:997`) serves it unchanged, then `prune()`.
    8. Run the work forked in the service scope, registered in a `Map` under
       `workspaceKey + designId + variantId` and joined; on interruption return
       `outcome: "cancelled"`. The `tsci` processes stop with the fiber, as for renders.
  - `cancelVariant(input)`: interrupts the registered fiber if any. Idempotent.
  - `proposeVariants(input, variants)`: reads parameters, validates each entry, appends variants
    with `origin: "agent"`, `sourceHash` of the current parameters and null render fields, and
    writes through the same storage permit and `workspaceBus` publish as `updateWorkspace`.
    Fails with "This design already has 24 variants. Ask the user to delete some." when full.

`PcbPreviewService.ts` call sites:

- Extract the cache commit block at `:961-974` into `commitRender(temporary, target, value,
workspaceKey)` and call it from `runRender`. This is a move, not a behavior change.
- `const variants = makeVariantBuilds({...})`; expose `renderVariant`, `cancelVariant` and
  `proposeVariants` on the public object (`:2568-2606`).
- `apps/server/src/fork/pcb-preview/rpc.ts`: two handlers.
- If L55 exists, `makeVariantBuilds` calls its pure stats function with the candidate's parsed
  Circuit JSON and inspection. L55's shared definition names `boardStats(design)`; if that only
  reads the working tree, L55 needs a pure entry over parsed data (see the final report).

Trust: the server has no trust state; trust is a per-device panel preference
(`apps/web/src/fork/pcb-preview/preferences.ts:13-64`). As today for `render`, the server builds
when asked. The panel never asks until the design is trusted, and the agent path goes through the
panel.

## Storage

Variant fields live in the per-design workspace JSON under the 4 MiB limit
(`PcbPreviewService.ts:183`). Worst case: 24 thumbnails of 24,000 characters is about 0.58 MB.
Candidate builds live in the render cache (100 entries, 200 MiB, `cache.ts:6`) and are pruned
with everything else; an evicted build is rebuilt on demand, and `variant.render` is then
refreshed.

## Clients

Web and desktop only; files in `apps/web/src/fork/pcb-preview/` unless noted.

- `sweep.ts` (new, pure): `SWEEP_LIMIT`, `VARIANT_LIMIT`;
  `sweepValues(parameter, input)` for number ranges (`{ from, to, count }`, 2 to 8 steps,
  inclusive, snapped to `step`, clamped to `min`/`max`, de-duplicated), choice subsets, booleans
  (`[false, true]`) and comma strings; `generateCandidates(base, axes)` as L23's
  `generateVariants` (`apps/web/src/fork/model-preview-3d/variants.ts:23-46`) but typed values and
  the PCB limit; `candidateName` ("width 40 / connector usb-c"); `sortVariants(variants, key,
direction)` with unrendered last.
- `variantImages.ts` (new): `alignSvgPair(a, b)` rewrites both root `viewBox`, `width` and `height`
  to the union of their millimetre view boxes, mirroring the server's `cropPhysicalSvg`
  (`apps/server/src/fork/pcb-preview/svg.ts:6-14`); `svgThumbnail(svg)` draws the SVG through an
  `Image` and canvas to a PNG blob and calls L23's `thumbnail(blob, 24000)`
  (`apps/web/src/fork/model-preview-3d/viewer/captureSheet.ts:3-24`, with the optional `limit`
  argument shared with L69).
- `VariantWorkbench.tsx` (new): replaces the chip row and save form in `ParameterEditor.tsx`
  (`:149-213`). It holds the grid and table, sort, selection bar (Compare, Render, Delete, Clear),
  the progress row (`Rendering 2 of 6`, `<progress>`, **Cancel**), the card menu (Use these
  values, Render again, Rename, Duplicate, Delete) and an agent marker on proposed cards. Props:
  `schema`, `data`, `canSave`, `canRender` (`executionAllowed` and the `renderVariant` permission),
  `mutate`, `onUse(values)`.
- `SweepDialog` in the same file: one or two axis rows (parameter select plus the input that fits
  its type), a live "Makes N variants" count, and **Make N variants**, disabled above the limit.
- `VariantCompare.tsx` (new): a dialog with the mode `Segmented` (Side by side, Overlay, A, B,
  Difference), the opacity `Range`, aligned images, and a facts list of parameter and stat
  differences. Overlay, A, B and Difference render through `ComparisonImages`, exported from
  `RevisionCompare.tsx` with optional `beforeLabel` and `afterLabel` alt texts. SVGs come from
  `readSheet` for each `variant.render`, rebuilding either one if the cache was evicted.
- Batch loop in `VariantWorkbench.tsx`, after L23's `render(ids)`: for each id, `runPcbCommand(
pcb.renderVariant, ...)` with the variant's values and the schema's `sourceHash`; on `ok`,
  `runPcbCommand(pcb.readSheet, ...)`, `svgThumbnail`, then `mutate` the variant with
  `thumbnail`, `render`, `stats`, `renderedRevision` and `error: null`, only if its values did not
  change meanwhile. On failure save `error` and continue. A `conflict` stops the batch. **Cancel**
  bumps the generation and calls `pcb.cancelVariant` for the running id. Leaving the tab or the
  panel cancels the same way.
- `ParameterEditor.tsx`: render `VariantWorkbench`; `onUse(values)` calls the existing `edit` and
  then `apply(true)` so the diff opens; **Apply to source** is unchanged.
- `Inspector.tsx`: `Parameters` stays out of `NEEDS_EXECUTION` (`:111`) because reading
  parameters runs no code. The workbench disables rendering itself with the trust message.
- `PcbPreviewPanel.tsx`: the editor switch (`:386-544`) gains `render-variants`. It opens the
  Parameters tab, refuses with "Allow circuit code from the drawing to render variants." when
  `executionAllowed` is false, otherwise starts the batch and completes the editor action at once
  with "Rendering N variants in the panel." The bridge waits at most 30 s
  (`apps/server/src/fork/editorBridge.ts:88`), so the action never waits for the batch.
- `packages/client-runtime/src/fork/pcb-preview.ts`: `renderVariant` and `cancelVariant`
  commands next to `render` (`:159-165`).
- `palette.tsx`: "Sweep circuit parameters" opens Parameters and the dialog for tscircuit designs.

## Agent-facing tools

In `apps/server/src/fork/pcb-preview/mcp.ts`, beside `loom_pcb_apply_parameters` (`:207`):

- `loom_pcb_propose_variants` (`actsAsCaller`): `{ designId, variants: [{ name <= 100, values }]
1..8 }` where `values` is `W.PcbVariant.fields.values`. Returns `PcbWorkspace`. Description:
  "Propose up to 8 named tscircuit parameter variants into the user's variant workbench. Does not
  build, edit source or apply values. Values must match the declared parameters."
- `loom_pcb_editor` accepts `render-variants` with optional `ids`. It needs the panel open and
  respects the panel's trust setting.
- Agents read thumbnails' metadata (`stats`, `error`, `renderedRevision`) through the existing
  `loom_pcb_workspace`, and promote through the existing `loom_pcb_apply_parameters`.

`t3 pcb propose_variants` follows automatically from `cli.ts`.

## Performance

- No animation loops. The progress bar is a native `<progress>` updated per stage; cards repaint
  only when their variant changes.
- One `tsci` build at a time on the host, through L24's permit; a batch never starves the main
  preview for longer than one candidate, because each candidate is a separate RPC and the
  preview's render queues on the same permit between them.
- Each candidate's SVG crosses the wire once, through `readSheet`, capped at 4 MiB
  (`cache.ts:4`), then is dropped after the thumbnail is made. Comparison fetches two again on
  demand. Saved state carries only the 24,000-character thumbnail.
- Thumbnail rasterizing is one off-screen canvas per candidate, released immediately.
- Remote: build bytes stay on the host; only the SVG and small JSON cross.

## Alternatives considered

- Applying values to the real source and rendering, as the user does by hand. Rejected: it edits
  the user's file and races with their editor and the agent.
- Server-side raster thumbnails. Rejected: needs an image library, a new dependency.
- Thumbnails as files over signed HTTP. Reasonable if limits grow; at 24 thumbnails the workspace
  stream is simpler. The signed route serves only GLB today (`http.ts:24-30`).
- 3D thumbnails through the GLB export. Possible follow-up: slower, and the board view shows
  what sweeps change.
- A host-only `loom_pcb_render_variant` agent tool. Rejected: thumbnails are made in the client,
  and routing through the panel keeps the trust setting meaningful.
- A new Variants tab. Rejected: variants already live in Parameters and the user guide says so.
