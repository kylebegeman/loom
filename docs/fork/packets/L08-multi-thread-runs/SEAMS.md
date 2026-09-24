# L08 seams

Every upstream file this packet touches. Extension point seams are listed only if this packet
creates the extension point.

## Extension points

Used: `ext-core` (with persistence and a reactor), `ext-mcp`, `ext-panels`, `ext-settings`,
`ext-web-root`, `ext-keybindings`, `ext-palette`, `ext-decide`. Run each existence check from
EXTENSION-POINTS.md in that order (`ext-mcp` and `ext-decide` need `ext-core`;
`ext-keybindings` needs `ext-web-root`; `ext-decide` is section 18); create missing ones exactly as specified, one commit each, before any packet
code. `ext-settings` also regenerates `apps/web/src/routeTree.gen.ts` (see its section).
Record which ones this packet created, with commits:

| Extension point | Created by this packet | Commit |
| --------------- | ---------------------- | ------ |
| `ext-core`      | yes / no               | `...`  |

Registrations (fork-owned files only):

| Registry                                               | Entry                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `packages/contracts/src/fork/index.ts`                 | `export * from "./multi-thread-runs.ts";`                                      |
| `packages/contracts/src/fork/rpc.ts` `.merge(`         | `MultiThreadRunsRpcGroup,`                                                     |
| `packages/contracts/src/fork/keybindings.ts`           | `"loom.multi-thread-runs.compare"`, `"loom.multi-thread-runs.runs"`            |
| `packages/client-runtime/src/fork/index.ts`            | `export * from "./multi-thread-runs.ts";`                                      |
| `apps/server/src/fork/features.ts`                     | `"multi-thread-runs"`                                                          |
| `apps/server/src/fork/ForkRuntime.ts` `ForkServices`   | `\| RunStore \| ThreadStarter \| RunService`                                   |
| `apps/server/src/fork/ForkLayer.ts` `ForkServicesLive` | store, starter, service, cleanup reactor                                       |
| `apps/server/src/fork/persistence/migrations.ts`       | `MultiThreadRunsMigrations`                                                    |
| `apps/server/src/fork/rpcAuthorization.ts`             | eight scopes                                                                   |
| `apps/server/src/fork/rpc.ts`                          | `...(yield* makeMultiThreadRunsRpcHandlers(auth)),`                            |
| `apps/server/src/fork/mcp/index.ts`                    | `MultiThreadRunsToolkitRegistrationLive,`                                      |
| `apps/web/src/fork/ForkRoot.tsx`                       | `{ id: "multi-thread-runs-compare", Component: CompareDialogHost }`            |
| `apps/web/src/fork/panels/registry.ts`                 | `runsPanel,`                                                                   |
| `apps/web/src/fork/settings/registry.ts`               | `runsSettingsSection,`                                                         |
| `apps/web/src/fork/commandPalette/registry.ts`         | `multiThreadRunsPaletteSource,`                                                |
| `apps/server/src/fork/decide/registry.ts`              | `DELEGATE_ROUTING_FEATURE,`, `COMPARE_RANK_FEATURE,` in `FORK_DECIDE_FEATURES` |

## Packet seams

None. Every upstream touch is an extension point seam.

Why none is needed: threads are created with existing commands from a fork service
(EXTENSION-POINTS.md, Orchestration rule 3); the tools register on T3's existing MCP server
through `ext-mcp`, so no adapter changes; the Runs view is a right panel; settings live in
the Loom settings page; the compare dialog is mounted by `ext-web-root`; Jev calls go through
`ext-decide`, and the diff for ranking comes from upstream's `CheckpointDiffQuery` service,
which `ForkLayer` can already use.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here. With no packet seams, conflicts may only appear in
extension point seam files on their marked lines (and in `routeTree.gen.ts`, which is
regenerated, never hand-merged).

## FORK.md rows

None for packet seams. Add "Extension point seams" rows only for extension points this
packet created.
