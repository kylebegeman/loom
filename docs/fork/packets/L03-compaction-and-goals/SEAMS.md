# L03 seams

Every upstream file this packet touches. Extension point seams are listed only if this packet
creates the extension point.

## Extension points

Used: `ext-core` (with persistence and a reactor), `ext-web-root`, `ext-keybindings`,
`ext-palette`, and `ext-turn-input` (section 16). Run each existence check from
EXTENSION-POINTS.md; create missing ones exactly as specified, one commit each, before any
packet code. Record which ones this packet created and their commits here.

Registrations (fork-owned files only):

| Registry                                               | Entry                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/index.ts`                 | `export * from "./compaction-and-goals.ts";`                                       |
| `packages/contracts/src/fork/rpc.ts` `.merge(`         | `CompactionAndGoalsRpcGroup,`                                                      |
| `packages/contracts/src/fork/keybindings.ts`           | `"loom.compaction-and-goals.compact"`, `"loom.compaction-and-goals.goal"`          |
| `packages/client-runtime/src/fork/index.ts`            | `export * from "./compaction-and-goals.ts";`                                       |
| `apps/server/src/fork/features.ts`                     | `"compaction-and-goals"`                                                           |
| `apps/server/src/fork/ForkRuntime.ts` `ForkServices`   | `\| ThreadGoalStore \| ThreadGoalService`                                          |
| `apps/server/src/fork/ForkLayer.ts` `ForkServicesLive` | store, service, cleanup reactor                                                    |
| `apps/server/src/fork/persistence/migrations.ts`       | `CompactionAndGoalsMigrations`                                                     |
| `apps/server/src/fork/rpcAuthorization.ts`             | four scopes                                                                        |
| `apps/server/src/fork/rpc.ts`                          | `...(yield* makeCompactionAndGoalsRpcHandlers(auth)),`                             |
| `apps/server/src/fork/turnInput/registry.ts`           | registered at runtime by `ThreadGoalService` (id `compaction-and-goals`, order 20) |
| `apps/web/src/fork/ForkRoot.tsx`                       | `{ id: "compaction-and-goals", Component: GoalCommandsHost }`                      |
| `apps/web/src/fork/commandPalette/registry.ts`         | `compactionAndGoalsPaletteSource,`                                                 |

## `ext-turn-input`

Specified in
[EXTENSION-POINTS.md, section 16](../EXTENSION-POINTS.md#16-provider-turn-input-ext-turn-input),
which reconciles this packet's proposal with L22's. This packet registers a contributor with id `compaction-and-goals` and order 20; the seam in
`ProviderService.ts` belongs to the extension point, not to this packet.

## Packet seams

| File                                   | Marker                       | Lines | Why                                                |
| -------------------------------------- | ---------------------------- | ----- | -------------------------------------------------- |
| `apps/web/src/components/ChatView.tsx` | `fork: compaction-and-goals` | 4     | Mount the goal chip at the top of the chat column. |

### Why no extension point covers the chip

`ext-panels` puts content in the right panel, `ext-composer` in or above the composer, and
`ext-web-root` outside the chat layout; a shared chat overlay point was considered and
declined (EXTENSION-POINTS.md, "Shared points considered and declined"). Kyle asked for a
goal chip pinned above the timeline; the only stable place is the banner overlay that
already hosts the provider status and thread error banners. The chip is one component taking
`threadRef`; everything else is fork-owned.

### Diffs (`apps/web/src/components/ChatView.tsx`)

Import, near the other chat imports (for example after
`import { useComposerHandleContext } from "../composerHandleContext";`, line 470):

```diff
 import { useComposerHandleContext } from "../composerHandleContext";
+// fork: compaction-and-goals
+import { ThreadGoalChip } from "../fork/compaction-and-goals/ThreadGoalChip";
```

First child of the banner overlay (line 9424; `activeThreadRef` is declared at 1943 and
`isServerThread` at 1877):

```diff
             <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col">
+              {/* fork: compaction-and-goals */}
+              <ThreadGoalChip threadRef={isServerThread ? activeThreadRef : null} />
               <ProviderStatusBanner
```

Check after `vp fmt`:
`git grep -c 'fork: compaction-and-goals' -- apps/web/src/components/ChatView.tsx` prints 2.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here. `ChatView.tsx` and `ProviderService.ts` change often
upstream; conflicts are acceptable only on the marked lines.

## FORK.md rows

"Packet seams":

| File                                   | Packet                 | Why                                                                                         |
| -------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| `apps/web/src/components/ChatView.tsx` | `compaction-and-goals` | Goal chip in the timeline banner overlay. See `docs/fork/packets/L03-compaction-and-goals`. |

"Extension point seams" (if this packet creates `ext-turn-input`):

| File                                                 | Marker                 | Why                                                                     |
| ---------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `apps/server/src/provider/Layers/ProviderService.ts` | `fork: ext-turn-input` | Fork contributors prepend standing text to every provider turn's input. |
