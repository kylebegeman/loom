# L24 seams

This packet touches upstream files only through extension points.

## Extension points created by this packet

Whichever of these do not exist yet when the packet starts, each in its own commit, byte for
byte as [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) specifies:

| Extension point   | Existence check (EXTENSION-POINTS.md section) | Commit                                                |
| ----------------- | --------------------------------------------- | ----------------------------------------------------- |
| `ext-core`        | 1. Server core                                | `feat(fork): add the server core extension point`     |
| `ext-panels`      | 6. Right panels                               | `feat(fork): add the right panel extension point`     |
| `ext-settings`    | 7. Settings                                   | `feat(fork): add the settings extension point`        |
| `ext-palette`     | 8. Command palette                            | `feat(fork): add the command palette extension point` |
| `ext-web-root`    | 5. Web root                                   | `feat(fork): add the web root extension point`        |
| `ext-keybindings` | 9. Keybindings (needs `ext-web-root`)         | `feat(fork): add the keybindings extension point`     |

Record here which ones this packet actually created, with commit hashes, when it lands.

## Packet seams

None. Registrations happen only inside fork-owned registry files:

| Fork file                                      | Line added                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/fork/index.ts`         | `export * from "./pcb-preview.ts";`                                                                          |
| `packages/contracts/src/fork/rpc.ts`           | `PcbPreviewRpcGroup,` in the `.merge(`; `\| typeof PCB_PREVIEW_WS_METHODS.watch` in `ForkSubscriptionRpcTag` |
| `packages/contracts/src/fork/keybindings.ts`   | `"loom.pcb-preview.toggle",`                                                                                 |
| `packages/client-runtime/src/fork/index.ts`    | `export * from "./pcb-preview.ts";`                                                                          |
| `apps/server/src/fork/features.ts`             | `"pcb-preview"` in `LOOM_SERVER_FEATURES`                                                                    |
| `apps/server/src/fork/ForkRuntime.ts`          | `\| PcbPreviewService` in `ForkServices`                                                                     |
| `apps/server/src/fork/ForkLayer.ts`            | `PcbPreviewService.layer,` in `ForkServicesLive`                                                             |
| `apps/server/src/fork/rpc.ts`                  | `...(yield* makePcbPreviewRpcHandlers(auth)),`                                                               |
| `apps/server/src/fork/rpcAuthorization.ts`     | six scope entries                                                                                            |
| `apps/web/src/fork/panels/registry.ts`         | `pcbPreviewPanel,`                                                                                           |
| `apps/web/src/fork/settings/registry.ts`       | `pcbPreviewSettings,`                                                                                        |
| `apps/web/src/fork/commandPalette/registry.ts` | `pcbPreviewPaletteSource,`                                                                                   |
| `apps/web/src/fork/ForkRoot.tsx`               | `{ id: "pcb-preview-commands", Component: PcbPreviewCommandHost },`                                          |

When `ForkSubscriptionRpcTag` is still `never`, replace `never` with the first tag.

"Send summary to chat" calls upstream's exported `useComposerDraftStore.getState().setPrompt`
(`apps/web/src/composerDraftStore.ts:571,4073`) from fork code, so it adds no seam and does
not need `ext-composer`.

## Merge check

Run on the packet branch before asking for review:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here. With no packet seams, any conflict can only be on
extension point seams, which EXTENSION-POINTS.md owns.

## FORK.md rows

None for packet seams. If this packet created an extension point, add that extension
point's rows to FORK.md's "Extension point seams" table in the same commit that created it.
