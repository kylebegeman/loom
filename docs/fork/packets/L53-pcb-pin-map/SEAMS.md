# L53 seams

## Extension points created by this packet

None.

## Packet seams

None. Every file this packet touches is fork-owned. The shared generator goes in
`packages/contracts/src/fork/`, which is fork-owned; putting it in `packages/shared` instead
would add an upstream seam in `packages/shared/package.json` (see PRODUCT.md, Decisions needed).

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

| File                                                                 | Change                                                                                   | Also edited by                             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| `packages/contracts/src/fork/pcb-pin-map.ts`                         | New; schemas and the pure generator.                                                     | L68 (may import `isPowerNet`)              |
| `packages/contracts/src/fork/index.ts`                               | One `export *` line.                                                                     | L56 and any packet adding a contracts file |
| `packages/contracts/src/fork/pcb-workspace.ts`                       | Optional `type`, `baseName` on `PcbPin`; optional `symbol` on `PcbComponent`.            | L55, L56, L60, L66, L69                    |
| `packages/contracts/src/fork/pcb-preview.ts`                         | `pinMap` method name and `Rpc.make`.                                                     | Packets adding PCB RPCs                    |
| `packages/contracts/src/fork/clientRpcPermissions.ts`                | `pinMap` scope.                                                                          | Packets adding PCB RPCs                    |
| `apps/server/src/fork/rpcAuthorization.ts`                           | `pinMap` scope.                                                                          | Packets adding PCB RPCs                    |
| `packages/client-runtime/src/fork/pcb-preview.ts`                    | `pinMap` command.                                                                        | Packets adding PCB RPCs                    |
| `apps/server/src/fork/pcb-preview/semantics.ts`                      | Pin type on board pads; netlist pin type, libsource and libparts; Circuit JSON `symbol`. | L55, L60, L66                              |
| `apps/server/src/fork/pcb-preview/pinMap.ts`                         | New; service method body.                                                                | None                                       |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`              | Interface member and one wiring line.                                                    | Most PCB packets (call sites only)         |
| `apps/server/src/fork/pcb-preview/rpc.ts`                            | One handler.                                                                             | Packets adding PCB RPCs                    |
| `apps/server/src/fork/pcb-preview/mcp.ts`                            | `loom_pcb_pin_map` tool and handler; one sentence in `loom_pcb_inspect`.                 | Most PCB packets                           |
| `apps/web/src/fork/pcb-preview/PinMapDialog.tsx`                     | New.                                                                                     | None                                       |
| `apps/web/src/fork/pcb-preview/InspectTab.tsx`                       | "Pin map" button in the hero head.                                                       | L54, L55                                   |
| `apps/web/src/fork/pcb-preview/Inspector.tsx`, `PcbPreviewPanel.tsx` | `onPinMap` prop and dialog state.                                                        | Most PCB packets                           |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file.

## FORK.md rows

None.
