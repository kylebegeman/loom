# L68 seams

## Extension points created by this packet

None: all existed (L24's `ext-core`, `ext-panels`, `ext-mcp`).

## Packet seams

None. No upstream file changes. No FORK.md or `docs/fork/seams.tsv` row.

## Fork-owned shared files edited

Other PCB follow-up packets edit these too. Keep each change additive and in its own spot.

| File                                                    | Change                                                                                                                                            | Also edited by                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `packages/contracts/src/fork/pcb-preview.ts`            | Review schemas, two methods, the `review` settings key (and the settings record itself if L58 is absent).                                         | L52, L54, L58, L64                  |
| `packages/contracts/src/fork/clientRpcPermissions.ts`   | `review` guarded by TerminalOperate.                                                                                                              | Any packet adding a guarded method  |
| `apps/server/src/fork/rpcAuthorization.ts`              | Two scope rows.                                                                                                                                   | Any packet adding a method          |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts` | `review` and `latestReview`, no-connect collector on `sourceInspection`, netlist text from `schematicConnectivity`, interface and export entries. | Most server packets                 |
| `apps/server/src/fork/pcb-preview/projectSettings.ts`   | `review` merge (or the file, if L58 is absent).                                                                                                   | L58                                 |
| `apps/server/src/fork/pcb-preview/autoChecks.ts`        | `review` as a third kind, only if L58 landed.                                                                                                     | L58                                 |
| `apps/server/src/fork/pcb-preview/kicadReports.ts`      | `fnv1a` export, only if L52 and L58 are absent.                                                                                                   | L52, L58                            |
| `apps/server/src/fork/pcb-preview/rpc.ts`               | Two handlers.                                                                                                                                     | Every packet adding a method        |
| `apps/server/src/fork/pcb-preview/mcp.ts`               | `loom_pcb_review`; `review` on `loom_pcb_check_settings`.                                                                                         | Every packet adding tools           |
| `packages/client-runtime/src/fork/pcb-preview.ts`       | `latestReview` query, `review` command.                                                                                                           | Most client packets                 |
| `apps/web/src/fork/pcb-preview/usePcbPreview.ts`        | Review job.                                                                                                                                       | L52, L58                            |
| `apps/web/src/fork/pcb-preview/Inspector.tsx`           | Checks tab for every design.                                                                                                                      | Packets changing tab rules          |
| `apps/web/src/fork/pcb-preview/ChecksView.tsx`          | "Review" in the kind switch, widened `onLocate`.                                                                                                  | L52, L54, L58, L64                  |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`     | Review chip, review markers in the overlay list, locate by surface.                                                                               | Every UI packet                     |
| `apps/web/src/fork/pcb-preview/findings.ts`             | `reviewFindings`, only if L52 landed.                                                                                                             | L52, L64                            |
| `apps/web/src/fork/pcb-preview/preferences.ts`          | `reviewShowWaived` with a decoding default.                                                                                                       | Any packet with a device preference |
| `docs/fork/user/pcb-preview.md`                         | A "Review" paragraph in Checks.                                                                                                                   | Every packet                        |

New files:

- `apps/server/src/fork/pcb-preview/reviewModel.ts`, `reviewRules.ts`, `reviewData.ts`, and
  `reviewModel.test.ts`, `reviewRules.test.ts`.
- `apps/server/src/fork/pcb-preview/fixtures/review/` (fixtures listed in TESTING.md).
- `apps/web/src/fork/pcb-preview/ReviewView.tsx`.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. Nothing here touches upstream files.

## FORK.md rows

None.
