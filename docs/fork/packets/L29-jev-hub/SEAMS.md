# L29 seams

## Extension points created by this packet

Each one only if its existence check fails when implementation starts, created exactly as
EXTENSION-POINTS.md specifies, each in its own commit before any packet code:

| Extension point   | Marker                  | Upstream files it touches                                                                                                                                                         |
| ----------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ext-core`        | `fork: ext-core`        | `packages/contracts/package.json`, `packages/client-runtime/package.json` (no marker), `environment.ts`, `ServerEnvironment.ts`, `ws.ts`, `server.ts`, `protocol.ts`, `client.ts` |
| `ext-settings`    | `fork: ext-settings`    | `settingsSearch.ts`, `SettingsSidebarNav.tsx`, new route `routes/settings.loom.tsx`, regenerated `routeTree.gen.ts`                                                               |
| `ext-decide`      | none                    | None (fork-owned files and registrations only)                                                                                                                                    |
| `ext-panels`      | `fork: ext-panels`      | `rightPanelStore.ts`, `RightPanelTabs.tsx`, `ChatView.tsx`                                                                                                                        |
| `ext-web-root`    | `fork: ext-web-root`    | `routes/__root.tsx`                                                                                                                                                               |
| `ext-keybindings` | `fork: ext-keybindings` | `packages/contracts/src/keybindings.ts`                                                                                                                                           |
| `ext-palette`     | `fork: ext-palette`     | `components/CommandPalette.tsx`                                                                                                                                                   |
| `ext-mcp`         | `fork: ext-mcp`         | `apps/server/src/mcp/McpHttpServer.ts`                                                                                                                                            |

Order: `ext-core`, then `ext-settings`, then `ext-decide` (it needs both), then the rest.
Record the commit hash of each one this packet created here when done.

`ext-decide` is created like any other extension point: the `feat(fork): add the decide
extension point` commit contains only what EXTENSION-POINTS.md section 18 specifies (empty
`FORK_DECIDE_FEATURES`, no L29 code). If L07, L08, L14, L15 or L20 lands first, it creates it
and this packet only registers.

## Packet seams

None. All packet code is in fork-owned paths:

- `packages/contracts/src/fork/jev-hub.ts`
- `packages/client-runtime/src/fork/jev-hub.ts`, `jev-hub-lint.ts`, `jev-hub-cost.ts` (+ tests)
- `apps/server/src/fork/jev-hub/*`
- `apps/web/src/fork/jev-hub/*`
- `docs/fork/user/jev-hub.md`

Registration lines go into fork-owned registry files: `fork/rpc.ts` and `fork/index.ts`
(contracts), `client-runtime/src/fork/index.ts`, `ForkLayer.ts`, `ForkRuntime.ts`,
`features.ts`, `persistence/migrations.ts`, `fork/rpcAuthorization.ts`,
`fork/decide/registry.ts`, `fork/mcp/index.ts` (server), `fork/panels/registry.ts`,
`fork/ForkRoot.tsx`, `fork/commandPalette/registry.ts` (web), `fork/keybindings.ts`
(contracts). Those are not seams.

Everything the packet needs without a seam:

| Need                                     | How                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Calling Jev, the key, modes, the log     | `ext-decide` (`LoomDecide`, `DecisionLog`)                                                                          |
| Thread, turn, diff, approval, file reads | Upstream services available to `ForkLayer`: `ProjectionSnapshotQuery`, `CheckpointDiffQuery`, `WorkspaceFileSystem` |
| Filling the composer for drafting        | Upstream's exported `useComposerDraftStore` (`getComposerDraft`, `setPrompt`), as `PullRequestDetailPanel.tsx` does |
| Opening the panel from other packets     | `forkPanelSurface("jev-hub", "decision:<id>")` from `ext-panels`                                                    |
| Navigating to a thread from a decision   | Upstream's `buildThreadRouteParams` (`apps/web/src/threadRoutes.ts:42`) with the `/$environmentId/$threadId` route  |
| Agents                                   | `ext-mcp` tools                                                                                                     |

## Merge check

Run on the packet branch before asking for review:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit 0, or conflicts only in the extension point files above, on `fork: ext-*`
lines (and `routeTree.gen.ts`, regenerated as EXTENSION-POINTS.md, Settings, describes).
Record the tag and the result here.

## FORK.md rows

No "Packet seams" rows. Extension points this packet created add their rows to the
"Extension point seams" table in their own commits (CONVENTIONS.md, Updating FORK.md);
`ext-decide` adds none (no upstream file).
