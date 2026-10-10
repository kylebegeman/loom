# L65 seams

## Extension points created by this packet

None.

## Packet seams

None. Every file this packet touches is fork-owned.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                                                                                      | Change                                                                                      | Also edited by                     |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/contracts/src/fork/pcb-fab.ts`                                                                                  | Package schemas. Created by L64 or, if first, by L65.                                       | L64                                |
| `packages/contracts/src/fork/index.ts`                                                                                    | One export line, only if L65 creates `pcb-fab.ts`.                                          | L64                                |
| `packages/contracts/src/fork/pcb-preview.ts`                                                                              | Four methods and RPC entries.                                                               | Most PCB packets                   |
| `packages/contracts/src/fork/clientRpcPermissions.ts`                                                                     | `fabPackage`, `deleteFabPackage`.                                                           | L57, L64                           |
| `apps/server/src/fork/rpcAuthorization.ts`                                                                                | Four scope entries.                                                                         | L57, L64                           |
| `apps/server/src/fork/pcb-preview/cache.ts`                                                                               | `package.zip` row in `SIGNED_FILE_TYPES` (creates the table if first).                      | L57                                |
| `apps/server/src/fork/pcb-preview/http.ts`                                                                                | Content type by basename (only if L57 has not landed).                                      | L57                                |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`                                                                   | Call sites for four methods; `signCacheFile` and the `fab` exclusion if L57 has not landed. | Most PCB packets                   |
| `apps/server/src/fork/pcb-preview/semantics.ts`                                                                           | Export the `property` reader (`:47-48`).                                                    | L55, L68 (may also export helpers) |
| `apps/server/src/fork/pcb-preview/fabPackage.ts`, `fabOutputs.ts`, `zipWriter.ts`                                         | New.                                                                                        | None                               |
| `apps/server/src/fork/pcb-preview/rpc.ts`, `mcp.ts`                                                                       | Handler lines and three tools.                                                              | Most PCB packets                   |
| `packages/client-runtime/src/fork/pcb-preview.ts`                                                                         | One query atom, three commands.                                                             | L57, L64                           |
| `apps/web/src/fork/pcb-preview/Inspector.tsx`                                                                             | Appends `"Fabrication"` to `INSPECTOR_TABS` and its tab entry.                              | PCB packets adding tabs            |
| `apps/web/src/fork/pcb-preview/WorkspaceChrome.tsx`                                                                       | Menu item.                                                                                  | L57                                |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`                                                                       | Outputs mode state and canvas switch.                                                       | Most PCB packets                   |
| `apps/web/src/fork/pcb-preview/FabricationTab.tsx`, `GerberPreview.tsx`, `gerberPreview.worker.ts`, `fabPackage.logic.ts` | New.                                                                                        | None                               |
| `apps/web/package.json` and the lockfile                                                                                  | `pcb-stackup` 4.2.8, if Kyle approves.                                                      | Any packet adding a web dependency |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. The packet touches no upstream file. The lockfile is shared with
upstream; if the dependency is approved and the merge check reports `pnpm-lock.yaml`, regenerate
it after the merge with `vp i` rather than resolving by hand.

## FORK.md rows

None, unless Kyle wants the new dependency listed; add it wherever FORK.md tracks fork-only
dependencies.
