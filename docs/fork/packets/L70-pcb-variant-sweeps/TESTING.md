# L70 testing

## Completed focused verification

| Coverage                                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing host rendering after `commitRender` extraction | All 49 existing PCB service tests passed at the refactor milestone.                                                                                                                                                                                                                                                                                                                                                          |
| Candidate service                                       | 4 focused tests passed: staged source isolation, cache and readable sheets, invalid/stale values, export failure, cancellation without partial cache, source edits during export, atomic proposals, limits and workspace publication. The other 49 service cases were deliberately skipped in this final focused run.                                                                                                        |
| Contracts, helper logic, tool routing and authorization | 43 tests passed across the contract, variant helper, MCP, client permission and server authorization files.                                                                                                                                                                                                                                                                                                                  |
| Client helper and interaction logic                     | 18 tests passed across sweep, SVG alignment, batch and variant interaction files. Includes range snapping/deduplication, bounded products, sorting, sequential builds, failure/conflict behavior, trust/terminal/write refusal, cancel/unmount/source changes, late-result discard, deleted/edited candidates, single request consumption, immediate sweep rendering, comparison teardown and review's original source hash. |
| Static verification                                     | Contracts, server, client-runtime and web typechecks passed. Scoped lint passed for changed backend and client files.                                                                                                                                                                                                                                                                                                        |

Client interactions run in jsdom with mocked RPC and thumbnail boundaries, using the actual
workbench and parameter editor. They prove the state and command flow, not browser image
rasterization or real CAD output. L69 already added and verified the shared thumbnail limit;
L70 reuses it unchanged.

## Repeat the focused checks

From the repository root, using the installed Vite+ binary:

```sh
./node_modules/.bin/vp test run packages/contracts/src/fork/pcb-workspace.test.ts \
  apps/server/src/fork/pcb-preview/variants.test.ts \
  apps/server/src/fork/pcb-preview/mcp.test.ts \
  packages/client-runtime/src/fork/pcb-preview.permissions.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts

./node_modules/.bin/vp test run apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts \
  -t 'isolated variants|variant build failures|proposes validated agent variants|source changes during the build'

./node_modules/.bin/vp test run apps/web/src/fork/pcb-preview/sweep.test.ts \
  apps/web/src/fork/pcb-preview/variantImages.test.ts \
  apps/web/src/fork/pcb-preview/variantBatch.test.ts \
  apps/web/src/fork/pcb-preview/variants.interactions.test.tsx

./node_modules/.bin/vp run --filter @t3tools/contracts typecheck
./node_modules/.bin/vp run --filter @t3tools/client-runtime typecheck
./node_modules/.bin/vp run --filter t3 typecheck
./node_modules/.bin/vp run --filter @t3tools/web typecheck
```

Run lint on the specific changed files. No repo-wide checks, browser, dev server or dependency
installation were run for this packet. The full upstream integration rehearsal remains a
maintainer release check from a clean checkout.

## Pending real-client and CAD verification

`tsci` is not installed. The optional build-time measurement and real-tool exports did not run;
8 candidates per sweep and 24 saved remain unchanged. No browser or computer use was authorized.

With a declared tscircuit fixture and isolated development state, verify:

1. Before allowing circuit code, saved variants remain visible and render controls are disabled.
2. Create a numeric sweep and a two-axis sweep. Confirm physical thumbnails, statistics and
   progress, and that the circuit source stays unchanged.
3. Cancel mid-batch and leave the tab while rendering. Completed previews persist and later
   candidates stay queued. Revoke permissions or edit a source dependency during a build.
4. Compare two boards of different sizes in every mode and check their physical alignment,
   opacity, image decoding, and cache-eviction rebuild behavior. Close during an evicted rebuild.
5. Promote a candidate, review the diff and apply. Edit the source after review and confirm the
   conflict prevents writing.
6. Propose and render through agent tools, reload saved results, and check propagation from a
   second client over a remote connection. Inspect the responsive layout.

## Merge safety

All edits are fork-owned. Old variants decode through defaulted fields. Older clients that
rewrite workspace variants can drop the new metadata until the next render. No upstream wire
schemas or persisted events changed. See [SEAMS.md](./SEAMS.md).

A local merge preview against `v0.0.46-nightly.20261011.2980` reported three inherited
conflicts: `apps/web/src/components/chat/ProviderModelPicker.tsx`,
`apps/web/src/routes/__root.tsx` and `packages/client-runtime/src/state/runtime.ts`.
The pre-L70 commit produced the same conflict file list. No L70 file conflicted. Resolving
those existing seams and the full clean-checkout integration remain release work.
