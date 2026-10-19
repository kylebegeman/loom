# L72 seams

## Extension points created by this packet

None: all existed. The mobile screen uses packet seams like other mobile features, because
the optional `ext-mobile-settings` point
([EXTENSION-POINTS.md, section 14](../EXTENSION-POINTS.md#14-mobile-ext-mobile-settings-optional))
was never created.

## Packet seams

Every marker is `fork: preview-links`. Lines are the counts `docs/fork/seams.tsv` expects.

| File                                                                     | Lines | Why                                                                                                                                                                            |
| ------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/browser/browserTargetResolver.ts`                          | 5     | Exports `reachesEnvironmentLoopback`, leaves discovered loopback URLs unmapped for environments that advertise links, and points the unreachable error at Settings > Previews. |
| `apps/web/src/browser/browserTargetResolver.test.ts`                     | 15    | Mocks the advertised check, updates the error text and adds the loopback case.                                                                                                 |
| `apps/web/src/browser/openFileInPreview.ts`                              | 4     | `openUrlInPreview` (chat links) resolves through `navigablePreviewUrlFor` and stops when it returns null.                                                                      |
| `apps/web/src/components/preview/openPreviewSession.ts`                  | 5     | Opening a preview session with a URL resolves it through `navigablePreviewUrlFor`.                                                                                             |
| `apps/web/src/components/preview/openTerminalLinkInPreview.ts`           | 5     | Terminal links resolve through `navigablePreviewUrlFor`.                                                                                                                       |
| `apps/web/src/components/preview/PreviewView.tsx`                        | 11    | Server and desktop navigation, and "Open in browser", resolve first, so a link or loopback address gets a fresh entry.                                                         |
| `apps/web/src/components/preview/PreviewLocalServerCard.tsx`             | 3     | Wraps the server row in `PreviewLinkCardActions` for **Copy preview link** and **Open in browser**.                                                                            |
| `apps/mobile/src/Stack.tsx`                                              | 2     | Import and the `PreviewLinks` settings screen (`linking: "previews"`, title "Previews").                                                                                       |
| `apps/mobile/src/features/settings/components/settings-sheet-targets.ts` | 1     | The `"PreviewLinks"` target.                                                                                                                                                   |
| `apps/mobile/src/features/settings/SettingsRouteScreen.tsx`              | 1     | The "Previews" row after Maintenance.                                                                                                                                          |
| `apps/mobile/src/lib/openExternalUrl.ts`                                 | 2     | Import and one line in `tryOpenExternalUrl` that swaps a preview link for a fresh entry link before it leaves the app.                                                         |

Why seams and not extension points: web preview navigation has no extension point, and each
navigation path had to resolve a URL before loading it. The seams are one call to
`navigablePreviewUrlFor` plus a null check, so the logic stays in
`apps/web/src/fork/preview-links/navigation.ts`. Mobile has no settings or external-link
extension point.

## Registrations (fork-owned files only)

Contracts and shared client code, committed in `64487ea714`:

| File                                                  | Entry                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/contracts/src/fork/rpc.ts`                  | `PreviewLinksRpcGroup` in `ForkRpcGroup`; `watch` in `ForkSubscriptionRpcTag`. |
| `packages/contracts/src/fork/index.ts`                | `export * from "./preview-links.ts"`.                                          |
| `packages/contracts/src/fork/clientRpcPermissions.ts` | Client guards for the eight mutations.                                         |
| `packages/client-runtime/src/fork/index.ts`           | `export * from "./preview-links.ts"`.                                          |
| `apps/server/src/fork/rpcAuthorization.ts`            | Scopes for all nine tags.                                                      |
| `apps/server/src/fork/features.ts`                    | `"preview-links"` in `LOOM_SERVER_FEATURES`.                                   |

Server and clients, uncommitted on `feat/preview-links`:

| File                                           | Entry                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/server/src/fork/ForkLayer.ts`            | `PreviewLinks.layer`, given `ProjectLifecycle.layer` over `ProjectStore.layer`. |
| `apps/server/src/fork/ForkRuntime.ts`          | `PreviewLinksService` in `ForkServices`.                                        |
| `apps/server/src/fork/rpc.ts`                  | `makePreviewLinksRpcHandlers(auth, session)` under `withForkRuntime`.           |
| `apps/server/src/fork/mcp/index.ts`            | `PreviewLinksToolkit` entry in `FORK_MCP_TOOLKITS`.                             |
| `apps/web/src/fork/settings/registry.ts`       | `{ id: "preview-links", title: "Previews" }` in `FORK_SETTINGS_SECTIONS`.       |
| `apps/web/src/fork/ForkRoot.tsx`               | `{ id: "preview-links-host", Component: PreviewLinksHost }`.                    |
| `apps/web/src/fork/commandPalette/registry.ts` | `previewLinksPaletteSource` in `FORK_COMMAND_PALETTE_SOURCES`.                  |

## Merge check

Not run yet for this packet. Before landing:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Conflicts must fall only on the lines above. `check_seams` passes with the rows in
`docs/fork/seams.tsv`.

## FORK.md rows

One paragraph in "Packet seams" (FORK.md uses prose there), listing the eleven files with
their marker counts and linking here and to the user guide. No "Extension point seams" rows.
