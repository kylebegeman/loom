# L64 seams

## Extension points created by this packet

None.

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                                                                      | Change                                                                                                                                                | Also edited by                                   |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `packages/contracts/src/fork/pcb-fab.ts`                                                                  | New; the shared fab capability definition and the fab check schemas.                                                                                  | L65 (reads)                                      |
| `packages/contracts/src/fork/index.ts`                                                                    | One export line for `pcb-fab.ts`.                                                                                                                     | Any packet adding a contracts file               |
| `packages/contracts/src/fork/pcb-preview.ts`                                                              | Four methods in `PCB_PREVIEW_WS_METHODS` and the RPC group.                                                                                           | Most PCB packets                                 |
| `packages/contracts/src/fork/clientRpcPermissions.ts`                                                     | `updateFabCapabilities`, `fabCheck`.                                                                                                                  | L57, L65                                         |
| `apps/server/src/fork/rpcAuthorization.ts`                                                                | Four scope entries.                                                                                                                                   | L57, L65                                         |
| `apps/server/src/fork/pcb-preview/fabData.ts`                                                             | New; built-ins, cost rules, lenient decoder.                                                                                                          | L65 (reads)                                      |
| `apps/server/src/fork/pcb-preview/fabCheck.ts`                                                            | New.                                                                                                                                                  | L65 (reads `latestFabCheck` through the service) |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`                                                   | `isPlainHttpUrl` extracted from `updateLibrary`; `fabFile`, four methods as call sites, `of` entries.                                                 | Most PCB packets                                 |
| `apps/server/src/fork/pcb-preview/rpc.ts`                                                                 | Four handler lines.                                                                                                                                   | Most PCB packets                                 |
| `apps/server/src/fork/pcb-preview/mcp.ts`                                                                 | Four tools.                                                                                                                                           | Most PCB packets                                 |
| `packages/client-runtime/src/fork/pcb-preview.ts`                                                         | Two query atoms, two commands.                                                                                                                        | L57, L65                                         |
| `apps/web/src/fork/pcb-preview/ChecksView.tsx`                                                            | Third card and the Fab body switch.                                                                                                                   | L52, L54, L58, L68                               |
| `apps/web/src/fork/pcb-preview/FabCheckView.tsx`, `FabCapabilitiesDialog.tsx`, `fabCapabilities.logic.ts` | New.                                                                                                                                                  | None                                             |
| `apps/web/src/fork/pcb-preview/settings.tsx`                                                              | "Fab" row.                                                                                                                                            | L54, L58                                         |
| `apps/web/src/fork/pcb-preview/findings.ts` (L52)                                                         | Only if needed: widen `checkFindings`'s parameter to `{ violations }`.                                                                                | L52, L58, L68                                    |
| `docs/fork/packets/PCB-FOLLOW-UPS.md`                                                                     | If Kyle approves: add `minEdgeClearanceMm` and `minHoleToHoleMm` to the shared definition. Kyle or the coordinator edits it, not this packet's agent. | None                                             |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
