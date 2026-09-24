# L23 seams

Every upstream file this packet touches. Extension point seams are listed only if this packet
creates the extension point.

## Extension points created by this packet

Created exactly as [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) specifies when missing, each in
its own commit before packet code: `ext-core` (section 1, which includes HTTP routes and
persistence), `ext-panels` (6), `ext-settings` (7), `ext-palette` (8), `ext-web-root` (5),
`ext-keybindings` (9), `ext-mcp` (10). Record the commits here.

## Packet seams

None.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

Why none are needed:

- Model bytes are served by a fork route in `ForkRoutesLayer` under `/api/loom/`, not by
  widening upstream's asset allowlist (`apps/server/src/assets/AssetAccess.ts:71-81,341`).
- Opening a file in the panel uses the generic `openSurface` from `ext-panels` with a
  `resourceId` per file; no upstream file tree or chat link is changed. Opening a 3D file from
  upstream's file tree or from file links in chat would need seams in upstream components and is
  deliberately left out (see PRODUCT.md, entry points).
- Captures reach the composer through upstream's public draft store.

`package.json` changes for the new dependencies (`three` and `@types/three`, approved by Kyle
on 2026-09-24) in `apps/web/package.json` are dependency additions, not seams, but they touch an
upstream file and the lockfile. Commit only the intended
lockfile change (CONVENTIONS.md, "The lockfile rule"), and mention them in FORK.md under a
"Dependencies added by packets" note if FORK.md has one by then.

## Fork-owned registration lines (not seams)

| Fork file                                            | Line added                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/index.ts`               | `export * from "./model-preview-3d.ts";`                                                           |
| `packages/contracts/src/fork/rpc.ts`                 | `ModelPreview3dRpcGroup,`; `watch` in `ForkSubscriptionRpcTag`                                     |
| `packages/contracts/src/fork/keybindings.ts`         | `loom.model-preview-3d.open`, `loom.model-preview-3d.capture`                                      |
| `packages/client-runtime/src/fork/index.ts`          | `export * from "./model-preview-3d.ts";`                                                           |
| `apps/server/src/fork/features.ts`                   | `"model-preview-3d"`                                                                               |
| `apps/server/src/fork/ForkRuntime.ts`                | `\| ModelPreviewService`                                                                           |
| `apps/server/src/fork/ForkLayer.ts`                  | `ModelPreviewService.layer,` in `ForkServicesLive`; `ModelPreviewHttpRoutes,` in `ForkRoutesLayer` |
| `apps/server/src/fork/persistence/migrations.ts`     | `ModelPreview3dMigrations,`                                                                        |
| `apps/server/src/fork/rpc.ts`, `rpcAuthorization.ts` | handlers and scopes                                                                                |
| `apps/server/src/fork/mcp/index.ts`                  | `ModelPreview3dToolkitRegistrationLive,`                                                           |
| `apps/web/src/fork/panels/registry.ts`               | `modelPreview3dPanel,`                                                                             |
| `apps/web/src/fork/settings/registry.ts`             | `modelPreview3dSettings,`                                                                          |
| `apps/web/src/fork/commandPalette/registry.ts`       | `modelPreview3dPaletteSource,`                                                                     |
| `apps/web/src/fork/ForkRoot.tsx`                     | `{ id: "model-preview-3d-shortcuts", Component: ModelPreview3dShortcuts }`                         |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result. Allowed conflicts: extension point seams this packet created, and
`apps/web/package.json` / `pnpm-lock.yaml` if upstream changed nearby dependency lines.

## FORK.md rows

No "Packet seams" rows. "Extension point seams" rows for any extension point this packet created.
