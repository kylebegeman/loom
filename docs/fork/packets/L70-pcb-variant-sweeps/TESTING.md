# L70 testing

## Focused tests

| File                                                                      | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/pcb-workspace.test.ts` (new)                 | An L24 `PcbVariant` without the new fields decodes with `origin: "user"` and null render fields; a thumbnail over 24,000 characters and stats with more than 40 board values are rejected; `render-variants` decodes with and without `ids`.                                                                                                                                                                                                                                                                                                                                      |
| `apps/server/src/fork/pcb-preview/variants.test.ts` (new)                 | `circuitIssues` counts `_error` and `_warning` elements and ignores others. `variantStats` reads bounds and component count, and merges board values. `validateVariantValues` accepts declared values and returns the `applyCircuitParameters` message for an unknown key, an out-of-range number and a choice not in the list.                                                                                                                                                                                                                                                   |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (extend)     | With a fake `tsci`: `renderVariant` stages the applied source and leaves the real file byte-for-byte unchanged; a stale `expectedSourceHash` fails with `conflict`; a second call with the same values is `cached`; a failing export returns `failed` with the log; `cancelVariant` during the export returns `cancelled` and leaves no cache entry; `readSheet` serves the result. `proposeVariants` appends with `origin: "agent"`, rejects invalid values, refuses past 24 and publishes on the workspace bus. Existing render tests still pass after the `commitRender` move. |
| `apps/server/src/fork/pcb-preview/mcp.test.ts` (extend)                   | `loom_pcb_propose_variants` reaches the service and returns the workspace; more than 8 entries fail decode; `loom_pcb_editor` accepts `render-variants`.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/src/fork/pcb-preview/sweep.test.ts` (new)                       | Number ranges are inclusive, snapped to `step`, clamped and de-duplicated; choices and booleans; two-axis products; counts above the limit are refused; names; sort order with unrendered last.                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/src/fork/pcb-preview/variantImages.test.ts` (new)               | `alignSvgPair` gives both SVGs the union millimetre view box and leaves content untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/src/fork/pcb-preview/workspace.interactions.test.tsx` (extend)  | With mocked commands: a sweep of 3 renders cards in order with progress; **Cancel** stops after the current candidate and calls `cancelVariant`; a `conflict` stops the batch with the source message; a failed candidate shows **Build failed** and the batch continues; render buttons are disabled with the trust message until circuit code is allowed; **Use these values** opens the review diff.                                                                                                                                                                           |
| `apps/web/src/fork/model-preview-3d/viewer/captureSheet.test.ts` (extend) | The `limit` argument is respected and the default is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Commands

From `packages/contracts`:

```sh
pnpm exec vp test run src/fork/pcb-workspace.test.ts
```

From `apps/server`:

```sh
pnpm exec vp test run src/fork/pcb-preview/variants.test.ts \
  src/fork/pcb-preview/PcbPreviewService.test.ts src/fork/pcb-preview/mcp.test.ts \
  src/fork/rpcAuthorization.test.ts src/fork/cli/callTool.test.ts
```

From `apps/web`:

```sh
pnpm exec vp test run src/fork/pcb-preview/sweep.test.ts \
  src/fork/pcb-preview/variantImages.test.ts \
  src/fork/pcb-preview/workspace.interactions.test.tsx \
  src/fork/model-preview-3d/viewer/captureSheet.test.ts
```

From `packages/client-runtime`, the permission test walks every fork scope:

```sh
pnpm exec vp test run src/state/commandPermissions.test.ts
```

Lint and typecheck from the repository root:

```sh
vp lint packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/server/src/fork/pcb-preview apps/web/src/fork/pcb-preview \
  apps/web/src/fork/model-preview-3d/viewer/captureSheet.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
```

`realTools.test.ts` builds real `tsci` output and is slow; run it once after step 5 if `tsci` is
installed, and otherwise leave it to CI.

## Manual checks for Kyle

Use a tscircuit design with declared parameters, in a dev server with copied data.

1. Before allowing circuit code, open Parameters: saved variants show, render buttons are
   disabled with the trust message.
2. Allow circuit code. **Sweep** one number parameter over 4 values. Cards fill in one at a time
   with "Rendering 2 of 4". Confirm `git status` shows no change to the circuit file.
3. Sweep two parameters for 6 candidates and **Cancel** at the third. The running build stops,
   finished thumbnails stay, the rest show **Queued** with **Render** available.
4. Switch to **Table**, sort by width and by issues.
5. Select two and **Compare**. Try every mode and the opacity slider; boards of different sizes
   line up on their real coordinates.
6. **Use these values** on one card. The diff opens; **Apply to source** updates the preview.
7. Edit the source in an editor during a batch. The batch stops with the source changed message;
   thumbnails show **Out of date**.
8. Ask the agent to propose three variants and then render them. They appear marked as proposed;
   rendering works only while circuit code is allowed and reports progress in the panel.
9. Reload the page; thumbnails, stats and favourites persist. Delete one and confirm it stays
   gone.
10. Open the same thread from a second client over the tailnet; the sweep's results appear there
    and **Compare** works from that client.
11. If L55 landed, its columns appear in **Table** and sort correctly.

## Merge safety

- Contracts: only defaulted fields and new methods. Saved L24 workspaces and older clients decode;
  older clients that rewrite variants drop the new fields until the next render, which is
  harmless.
- Shared files: see [SEAMS.md](./SEAMS.md). The `commitRender` move in `PcbPreviewService.ts` and
  the Variants section in `ParameterEditor.tsx` are the likeliest conflicts; land the move as its
  own commit.
- Upstream: no upstream files. Before an upstream integration, confirm with
  `git merge-tree --write-tree --name-only --no-messages HEAD "$tag"` that no L70 file appears.
