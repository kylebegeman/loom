# L26 seams

## Extension points created by this packet

`ext-diff-header`, in its own commit `13fa404a42`, exactly as
[EXTENSION-POINTS.md, section 17](../EXTENSION-POINTS.md#17-diff-panel-header-ext-diff-header)
specifies:

| File                                                     | Change                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/DiffPanel.tsx`                  | Two `fork: ext-diff-header` seams: the `ForkDiffHeaderActions` import, and `<ForkDiffHeaderActions threadRef={routeThreadRef} files={codeViewFiles} scopeLabel={selectedScopeLabel} selection={diffSelection} />` first in the header's action group. |
| `apps/web/src/fork/diffHeader/registry.ts`               | `ForkDiffHeaderActionProps`, `ForkDiffHeaderAction`, `FORK_DIFF_HEADER_ACTIONS`.                                                                                                                                                                      |
| `apps/web/src/fork/diffHeader/ForkDiffHeaderActions.tsx` | Renders every registered action.                                                                                                                                                                                                                      |
| `apps/web/src/fork/diffHeader/registry.test.ts`          | Unique action ids.                                                                                                                                                                                                                                    |
| `docs/fork/seams.tsv`                                    | Row expecting two `ext-diff-header` markers in `DiffPanel.tsx`.                                                                                                                                                                                       |
| `FORK.md`                                                | "Extension point seams" row for `DiffPanel.tsx`.                                                                                                                                                                                                      |

The other extension points this packet uses (`ext-core`, `ext-panels`, `ext-mcp`,
`ext-settings`, `ext-palette`, `ext-web-root`) already existed.

## Packet seams

None. `git diff main...HEAD` adds `fork:` markers to upstream files only in `DiffPanel.tsx`
(the two `ext-diff-header` lines above). The `fork: panel-picker` markers in
`RightPanelTabs.tsx` on this branch belong to L12.

## Registrations (fork-owned files only)

Server, in `b188786e4b`:

| File                                                  | Entry                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/contracts/src/fork/rpc.ts`                  | `CodeGraphRpcGroup` in `ForkRpcGroup`; `subscribeStatus` in `ForkSubscriptionRpcTag`.      |
| `packages/contracts/src/fork/index.ts`                | `export * from "./code-graph.ts"`.                                                         |
| `packages/contracts/src/fork/clientRpcPermissions.ts` | Client guards for `build`, `cancel`, `delete`, `setAgentTool`, `updateSettings`.           |
| `apps/server/src/fork/rpcAuthorization.ts`            | Scopes for all 14 tags (`updateSettings` takes `terminal:operate`).                        |
| `apps/server/src/fork/rpc.ts`                         | `makeCodeGraphRpcHandlers(auth)` under `withForkRuntime`.                                  |
| `apps/server/src/fork/ForkLayer.ts`                   | `CodeGraphReactorLive` over `CodeGraph.layer`, given `ProjectionStore` and `ProjectStore`. |
| `apps/server/src/fork/ForkRuntime.ts`                 | `CodeGraphService` in `ForkServices`.                                                      |
| `apps/server/src/fork/features.ts`                    | `"code-graph"` in `LOOM_SERVER_FEATURES`.                                                  |
| `apps/server/src/fork/persistence/migrations.ts`      | `CodeGraphMigrations` in `FORK_MIGRATION_SETS`.                                            |
| `apps/server/src/fork/mcp/index.ts`                   | `CodeGraphToolkit` entry in `FORK_MCP_TOOLKITS`.                                           |

Clients, in `ee70a90584`:

| File                                           | Entry                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/client-runtime/src/fork/index.ts`    | `export * from "./code-graph.ts"`.                                       |
| `apps/web/src/fork/panels/registry.ts`         | `codeGraphPanel` in `FORK_PANELS` (id `code-graph`, letter `Y`).         |
| `apps/web/src/fork/diffHeader/registry.ts`     | `codeGraphDiffHeaderAction` in `FORK_DIFF_HEADER_ACTIONS`.               |
| `apps/web/src/fork/commandPalette/registry.ts` | `codeGraphPaletteSource` in `FORK_COMMAND_PALETTE_SOURCES`.              |
| `apps/web/src/fork/settings/registry.ts`       | `{ id: "code-graph", title: "Code graph" }` in `FORK_SETTINGS_SECTIONS`. |
| `apps/web/src/fork/ForkRoot.tsx`               | `{ id: "code-graph-open-watcher", Component: CodeGraphOpenWatcher }`.    |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Result on 2026-10-09 against the newest local tag `v0.0.46-nightly.20261009.2886` (without
a fresh fetch): `DiffPanel.tsx` and every L26 file merge cleanly. The preview exits 1 on
the same three files that conflict on `main` (`DesktopAppIdentity.test.ts`,
`CodexProvider.ts`, `packages/shared/package.json`), none touched by L26.

On a conflict in `DiffPanel.tsx`, keep upstream's surrounding code and reapply the two marked
lines; `docs/fork/seams.tsv` expects exactly two.

## FORK.md rows

No "Packet seams" rows. "Extension point seams" (added in `13fa404a42`):

| File                                    | Marker            | Why                                                                            |
| --------------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `apps/web/src/components/DiffPanel.tsx` | `ext-diff-header` | Fork buttons in the diff panel header, such as the code graph's Impact button. |
