# L58 seams

## Extension points created by this packet

None: all existed (L24's `ext-core`, `ext-panels`, `ext-mcp`).

## Packet seams

None. No upstream file changes. No FORK.md or `docs/fork/seams.tsv` row.

The streaming tag list `ForkSubscriptionRpcTag` is fork-owned
(`packages/contracts/src/fork/rpc.ts:56-69`); the upstream client already reads it through the
existing `ext-core` seam in `packages/client-runtime/src/rpc/client.ts`, so adding a member
needs no upstream edit.

## Fork-owned shared files edited

Other PCB follow-up packets edit these too. Keep each change additive and in its own spot.

| File                                                    | Change                                                                                                                                                                                                        | Also edited by                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/contracts/src/fork/pcb-preview.ts`            | `trigger`, `durationMs`, `delta` on results; settings and activity schemas; three methods; `ensureFresh`. `uuid` and `id` only if L52 is absent.                                                              | L52, L54, L64, L68                 |
| `packages/contracts/src/fork/rpc.ts`                    | `checkEvents` in `ForkSubscriptionRpcTag`.                                                                                                                                                                    | Any packet adding a stream         |
| `packages/contracts/src/fork/clientRpcPermissions.ts`   | `updateProjectSettings` guarded by TerminalOperate.                                                                                                                                                           | Any packet adding a guarded method |
| `apps/server/src/fork/rpcAuthorization.ts`              | Three scope rows.                                                                                                                                                                                             | Any packet adding a method         |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts` | `check` split into `runCheck` plus wrapper, delta in the persist block, `checkBus`, `watch` tap and interest, `latestChecks` `ensureFresh`, settings and `checkEvents` methods, interface and export entries. | Most server packets                |
| `apps/server/src/fork/pcb-preview/kicadReports.ts`      | `checkDelta`; `findingId` and uuid only if L52 is absent.                                                                                                                                                     | L52, L54                           |
| `apps/server/src/fork/pcb-preview/rpc.ts`               | Three handlers.                                                                                                                                                                                               | Every packet adding a method       |
| `apps/server/src/fork/pcb-preview/mcp.ts`               | Two descriptions, `ensureFresh`, `loom_pcb_check_settings`.                                                                                                                                                   | Every packet adding tools          |
| `packages/client-runtime/src/fork/pcb-preview.ts`       | Settings query and command, `checkEvents` subscription.                                                                                                                                                       | Most client packets                |
| `apps/web/src/fork/pcb-preview/usePcbPreview.ts`        | Activity subscription and refresh on `ranAt`.                                                                                                                                                                 | L52, L68                           |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`     | Status chip text and tone.                                                                                                                                                                                    | Every UI packet                    |
| `apps/web/src/fork/pcb-preview/ChecksView.tsx`          | Settings row, delta summary, "New" badge, resolved list, paused notice.                                                                                                                                       | L52, L54, L64, L68                 |
| `apps/web/src/fork/pcb-preview/CheckMarkers.tsx`        | Ring for new findings, only if L52 landed.                                                                                                                                                                    | L52                                |
| `docs/fork/user/pcb-preview.md`                         | A short "Check after each save" paragraph.                                                                                                                                                                    | Every packet                       |

New files:

- `apps/server/src/fork/pcb-preview/projectSettings.ts` (shared with L68; first to land creates
  it), `projectSettings.test.ts`.
- `apps/server/src/fork/pcb-preview/autoChecks.ts`, `autoChecks.test.ts`.
- `apps/server/src/fork/pcb-preview/kicadReports.test.ts` (shared with L52; first creates it).

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. Nothing here touches upstream files.

## FORK.md rows

None.
