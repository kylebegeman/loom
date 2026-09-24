# L10 seams

Every upstream file this packet touches. Extension point seams are listed only if this packet
creates the extension point.

## Extension points created by this packet

Whichever of these do not exist when the work starts (run each existence check in
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md)), created byte for byte as specified there, each
in its own commit before any packet code:

| Extension point   | Existence check               | Upstream files it touches                                                                                                                                                                                                                                                                                                            |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ext-core`        | EXTENSION-POINTS.md section 1 | `packages/contracts/package.json`, `packages/client-runtime/package.json` (no marker), `packages/contracts/src/environment.ts`, `apps/server/src/environment/ServerEnvironment.ts`, `apps/server/src/ws.ts`, `apps/server/src/server.ts`, `packages/client-runtime/src/rpc/protocol.ts`, `packages/client-runtime/src/rpc/client.ts` |
| `ext-panels`      | section 6                     | `apps/web/src/rightPanelStore.ts`, `apps/web/src/components/RightPanelTabs.tsx`, `apps/web/src/components/ChatView.tsx`                                                                                                                                                                                                              |
| `ext-settings`    | section 7                     | `apps/web/src/components/settings/settingsSearch.ts`, `SettingsSidebarNav.tsx`, new `apps/web/src/routes/settings.loom.tsx`, regenerated `routeTree.gen.ts`                                                                                                                                                                          |
| `ext-palette`     | section 8                     | `apps/web/src/components/CommandPalette.tsx`                                                                                                                                                                                                                                                                                         |
| `ext-web-root`    | section 5                     | `apps/web/src/routes/__root.tsx`                                                                                                                                                                                                                                                                                                     |
| `ext-keybindings` | section 9                     | `packages/contracts/src/keybindings.ts`                                                                                                                                                                                                                                                                                              |
| `ext-mcp`         | section 10                    | `apps/server/src/mcp/McpHttpServer.ts`                                                                                                                                                                                                                                                                                               |

Record the commit hash of each one this packet created here when done.

## Packet seams

None.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

Why no seam is needed:

- The panel, settings section, palette entries, keybinding commands and MCP tools all
  register into extension points.
- Opening a launched simulator in the Device panel calls upstream's `DeviceService.open` from
  a fork service; `ForkLayer` can use `DeviceService` because it is provided later in
  `RuntimeCoreDependenciesLive` (`apps/server/src/server.ts:494`). The web client's existing
  auto-open (`apps/web/src/components/ChatView.tsx:4536-4592`) shows it.
- Adding a run summary to the composer uses upstream's public composer draft store and the
  mounted composer handle; nothing in the composer is edited.

Registration lines inside fork-owned files (not seams; listed so reviewers can check them):

| Fork file                                        | Line added                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/index.ts`           | `export * from "./apple-build-tooling.ts";`                                                                                |
| `packages/contracts/src/fork/rpc.ts`             | `AppleBuildToolingRpcGroup,` in `.merge(`; `watchRuns` in `ForkSubscriptionRpcTag`; `tailLog` in `ForkStreamCommandRpcTag` |
| `packages/contracts/src/fork/keybindings.ts`     | four `loom.apple-build-tooling.*` commands                                                                                 |
| `packages/client-runtime/src/fork/index.ts`      | `export * from "./apple-build-tooling.ts";`                                                                                |
| `apps/server/src/fork/features.ts`               | `"apple-build-tooling"`                                                                                                    |
| `apps/server/src/fork/ForkRuntime.ts`            | `\| AppleBuildService`                                                                                                     |
| `apps/server/src/fork/ForkLayer.ts`              | `AppleBuildService.layer,`                                                                                                 |
| `apps/server/src/fork/persistence/migrations.ts` | `AppleBuildToolingMigrations,`                                                                                             |
| `apps/server/src/fork/rpc.ts`                    | `...(yield* makeAppleBuildToolingRpcHandlers(auth)),`                                                                      |
| `apps/server/src/fork/rpcAuthorization.ts`       | one scope per tag                                                                                                          |
| `apps/server/src/fork/mcp/index.ts`              | `AppleBuildToolingToolkitRegistrationLive,`                                                                                |
| `apps/web/src/fork/panels/registry.ts`           | `appleBuildToolingPanel,`                                                                                                  |
| `apps/web/src/fork/settings/registry.ts`         | `appleBuildToolingSettings,`                                                                                               |
| `apps/web/src/fork/commandPalette/registry.ts`   | `appleBuildToolingPaletteSource,`                                                                                          |
| `apps/web/src/fork/ForkRoot.tsx`                 | `{ id: "apple-build-tooling-shortcuts", Component: AppleBuildShortcuts }`                                                  |

## Merge check

Run on the packet branch before asking for review:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here. With no packet seams, any conflict must be on an extension
point seam line listed above.

## FORK.md rows

No "Packet seams" rows. If this packet created extension points, their rows go in FORK.md's
"Extension point seams" table exactly as EXTENSION-POINTS.md lists them, in the same commit as
each extension point.
