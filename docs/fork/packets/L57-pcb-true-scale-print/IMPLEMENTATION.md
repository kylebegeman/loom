# L57 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, PCB-FOLLOW-UPS.md and this
folder. Start the branch from `main`. Check whether L65 landed: if
`apps/server/src/fork/pcb-preview/cache.ts` exports `SIGNED_FILE_TYPES`, step 2 shrinks to one
table row. If `packages/contracts/src/fork/pcb-layer-presets.ts` exists (L56), step 7 adds its
quick picks. Commits use `feat(fork-pcb-true-scale-print): ...`.

## Steps

1. **Contracts.** In `packages/contracts/src/fork/pcb-print.ts` add `PcbPrintSide`,
   `PcbPrintPaper`, `PcbPrintInput` and `PcbPrintResult` as in TECHNICAL.md. In
   `packages/contracts/src/fork/pcb-preview.ts` add `print` to `PCB_PREVIEW_WS_METHODS` and an
   `Rpc.make(PCB_PREVIEW_WS_METHODS.print, { payload: PcbPrintInput, success: PcbPrintResult,
error: errors })` to `PcbPreviewRpcGroup`. Add `print` to
   `FORK_CLIENT_GUARDED_RPC_SCOPES` and to `FORK_RPC_REQUIRED_SCOPES`
   (`apps/server/src/fork/rpcAuthorization.ts`) as `AuthTerminalOperateScope`. Add a
   decoding test.
2. **Signed files.** In `cache.ts` add `SIGNED_FILE_TYPES` (`board.glb`, `print.pdf`). In
   `PcbPreviewService.ts` rename `signBoard` to `signCacheFile` and build the URL from
   `path.basename(file)`; update its callers. Change `resolveSignedRequest` to look the
   basename up in the table and check its `maxBytes`. In `http.ts` set `Content-Type` from the
   table. Extend `http.test.ts`: a PDF token returns `application/pdf`, an unknown basename
   in the cache is refused, a GLB still returns `model/gltf-binary`.
3. **Source scan.** In `sourceSnapshot` (`PcbPreviewService.ts:529-531`) skip `<root>/fab` beside
   `.loom/pcb-references`. Test that a tscircuit design's hash ignores `fab/print/x.pdf` and
   `fab/a/b.csv`.
4. **Print helpers.** Create `apps/server/src/fork/pcb-preview/trueScalePrint.ts` with
   `defaultPrintLayers`, `validatePrintLayers`, `rewritePaper`, `scaleSheet`, `printFileName`,
   `pageWarnings` and `printArgs(kicadMajor, options)`. Pure; unit-test each in
   `trueScalePrint.test.ts`.
5. **Service method.** Construct `makeTrueScalePrint(deps)` to `trueScalePrint.ts` following TECHNICAL.md
   "Procedure", and `print` to the service interface (`PcbPreviewService.ts:83-148`), the
   implementation (one call into `runPrint` with the closure's helpers) and
   `PcbPreviewService.of` (`:2568-2606`). Wire `rpc.ts`. Add service tests with a fake `run`
   that writes a small PDF: cache hit skips the run; KiCad 9 omits `--scale` and
   `--check-zones` and warns; `save` writes `fab/print/...pdf` atomically; a missing board
   fails; the temporary directory is gone after a failure and after interruption.
6. **MCP.** Add `loom_pcb_print` to `mcp.ts` with `save` defaulting to true. Extend
   `mcp.test.ts`. Confirm `t3 pcb print` resolves (no `cli.ts` change expected).
7. **Client runtime and web.** Add the `print` command to
   `packages/client-runtime/src/fork/pcb-preview.ts`. Create `TrueScalePrintDialog.tsx` with the form,
   running and result states from TECHNICAL.md, and a small pure `trueScalePrint.logic.ts`
   (`initialPrintOptions(side, boardLayers)`, `isPrintStale(result, sourceHash)`). Add the menu
   item to `WorkspaceMenu` and the open state to `PcbPreviewPanel.tsx`. With L56 present, add
   the Assembly front and back presets as quick picks.
8. **Docs.** In `docs/user/`, in the PCB preview section, add two sentences: how to print at 1:1
   and to check the 50 mm bar with a ruler. Nothing in `docs/internals/`.

## Done when

- `Print at 1:1…` produces a PDF for a KiCad board on KiCad 9 and 10, top and mirrored bottom,
  and a tscircuit board when trusted and KiCad is present.
- The scale bar measures 50 mm on paper printed at 100%, and the board outline matches the
  printed size.
- Download works from a remote browser; Save writes `fab/print/` and does not change the
  design's source hash; Open and Reveal appear only when the host supports them.
- `loom_pcb_print` and `t3 pcb print` return the saved path.
- The focused tests, lint and typechecks in TESTING.md pass, and the merge check is clean.
