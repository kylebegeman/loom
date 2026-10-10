# L70 implementation

Each step compiles and keeps existing tests green. Commit per step with
`feat(fork-pcb-preview): ...` or `refactor(fork-pcb-preview): ...`.

1. **Measure.** With the L24 tscircuit fixture used by `realTools.test.ts`, time `tsci export
-f circuit-json` and the JSON-to-`pcb-svg` export five times on Kyle's machine. Record the
   median in the step's commit message. Set `SWEEP_LIMIT` to 12 if the median total is under 8 s,
   otherwise 8. Nothing else depends on the number.
2. **Contracts.** Add `PcbVariantStats` and the defaulted `PcbVariant` fields, the two RPCs and
   inputs, the scope rows, and `render-variants` with `ids` on `PcbEditorAction`. Add a decode
   test that an L24 variant (no new fields) decodes with `origin: "user"` and nulls.
3. **Extract `commitRender`.** Move `PcbPreviewService.ts:961-974` into a local helper and call it
   from `runRender`. No behavior change; the existing render tests stay green.
4. **Pure variant helpers.** `apps/server/src/fork/pcb-preview/variants.ts` with `circuitIssues`,
   `variantStats` and `validateVariantValues`, with tests.
5. **Host build.** `makeVariantBuilds` with `renderVariant` and `cancelVariant`, wired into the
   service, `rpc.ts` and the client-runtime commands. Service tests with a fake `tsci` cover the
   staged file, the hash conflict, the cache hit, a failed export and cancel.
6. **Agent proposals.** `proposeVariants` on the service and `loom_pcb_propose_variants` in
   `mcp.ts`, with tests for validation, the 24 limit, the `agent` origin and the workspace bus
   publish.
7. **Thumbnail limit.** Add the optional `limit` argument to `thumbnail` in `captureSheet.ts`
   unless L69 already did. The default stays 50,000 characters; PCB passes 24,000.
8. **Client pure helpers.** `sweep.ts` and `variantImages.ts` (`alignSvgPair` only; the canvas
   function is exercised in the browser), with tests.
9. **Workbench.** `VariantWorkbench.tsx` with the grid, table, sort, selection bar, card menu,
   empty and full states, and `SweepDialog`. Replace the Variants section in `ParameterEditor.tsx`.
   `onUse` loads values and opens the review diff.
10. **Batch.** Sequential render loop with progress, cancel on button, tab change and unmount,
    conflict stop, per-card errors and **View log**.
11. **Compare.** Export `ComparisonImages` from `RevisionCompare.tsx`; add `VariantCompare.tsx`
    with the side by side mode and the facts list.
12. **Agent rendering and palette.** The `render-variants` editor case in `PcbPreviewPanel.tsx`
    with the trust refusal, and the palette entry.
13. **L55 columns.** If `boardStats` exists with a pure entry over parsed Circuit JSON, pass its
    values into `variantStats` and add its columns to the table. Skip if L55 has not landed.
14. **User guide.** Update the parameters paragraph of `docs/fork/user/pcb-preview.md`
    (around line 62): sweeps, rendering needs allowed circuit code, and **Use these values** goes
    through review.

## Done when

- A sweep of one or two parameters makes up to the limit of variants, each renders to a thumbnail
  with size, parts and issue counts, and the user's circuit file is unchanged throughout.
- Cancel stops the host build within a second and leaves completed thumbnails in place.
- Two variants compare in every mode, aligned on board coordinates.
- **Use these values** opens the review diff; applying after an outside source edit fails with the
  existing conflict.
- An agent proposes variants that appear marked and unrendered, and `render-variants` refuses
  until circuit code is allowed.
- All tests in TESTING.md pass, with lint and the four typechecks clean.
