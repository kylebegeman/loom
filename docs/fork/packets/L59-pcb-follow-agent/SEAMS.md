# L59 seams

## Shared extension point

`ext-changed-files` (EXTENSION-POINTS.md entry 18) is implemented and shared with L41.
`turnFiles.ts` already exists from L41 and is reused. Background tab opening is shared in
`apps/web/src/fork/panels/backgroundSurfaces.ts`.
Commit: `feat(fork): add the changed files card extension point`, containing only the files and
lines below plus the EXTENSION-POINTS.md, FORK.md and `docs/fork/seams.tsv` updates.

L41 specifies a packet seam at this exact spot (`fork: model-follow-agent`, L41 SEAMS.md). L59
is the second packet that needs it, which is EXTENSION-POINTS.md's rule for promoting a spot.

### Seams (`apps/web/src/components/chat/ChangedFilesTree.tsx`, both `fork: ext-changed-files`)

An import after the last import (`:17`):

```diff
 import { MorphIcon } from "~/components/MorphIcon";
+// fork: ext-changed-files
+import { ForkChangedFilesActions } from "~/fork/changedFiles/ForkChangedFilesActions";
```

The first child of the card header's action group (`:67`), before upstream's conditional
"Expand all folders" button:

```diff
         <div className="flex shrink-0 items-center gap-1">
+          {/* fork: ext-changed-files */}
+          <ForkChangedFilesActions runId={runId} files={files} />
           {hasDirectories && (
```

`runId` and `files` are `ChangedFilesCard`'s own props (`:24-32`). Expected marker count: 2.

### Fork-owned files

`apps/web/src/fork/changedFiles/registry.ts`:

```ts
import type { RunId, ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentType } from "react";

import type { TurnDiffFileChange } from "~/types";

export interface ForkChangedFilesActionProps {
  readonly threadRef: ScopedThreadRef;
  readonly runId: RunId;
  readonly files: ReadonlyArray<TurnDiffFileChange>;
}

export interface ForkChangedFilesAction {
  /** The packet slug. */
  readonly id: string;
  /** Renders null when it does not apply (feature missing, nothing relevant, dismissed). */
  readonly Component: ComponentType<ForkChangedFilesActionProps>;
}

/** One line per packet. Order is left-to-right order in the card header. */
export const FORK_CHANGED_FILES_ACTIONS: ReadonlyArray<ForkChangedFilesAction> = [
  pcbFollowAgentAction,
];
```

`apps/web/src/fork/changedFiles/ForkChangedFilesActions.tsx`:

```tsx
type Props = Omit<ForkChangedFilesActionProps, "threadRef">;

/** Fork chips at the start of the changed files card header (fork: ext-changed-files). */
export function ForkChangedFilesActions(props: Props) {
  // Upstream's card tests render without a router; route hooks would throw there.
  return useRouter({ warn: false }) ? <RouteActions {...props} /> : null;
}

function RouteActions(props: Props) {
  const threadRef = useRouteThread()?.threadRef;
  if (!threadRef) return null;
  return (
    <>
      {FORK_CHANGED_FILES_ACTIONS.map(({ id, Component }) => (
        <Component key={id} threadRef={threadRef} {...props} />
      ))}
    </>
  );
}
```

`useRouteThread` (`apps/web/src/fork/routeThread.ts:20`) reads only the route and draft store,
so the card does not re-render on streamed events. It calls TanStack's `useParams`, which needs
router context; `useRouter` returns the context value and warns only when asked
(`@tanstack/react-router` `src/useRouter.tsx`). Upstream's
`apps/web/src/components/chat/ChangedFilesTree.test.tsx:9-10` renders `ChangedFilesCard` with
`renderToStaticMarkup` and no router, so the guard keeps that test passing.
`TurnDiffFileChange` is `apps/web/src/types.ts:118`.

### Existence check

```sh
test -f apps/web/src/fork/changedFiles/registry.ts \
  && test "$(git grep -c 'fork: ext-changed-files' \
    -- apps/web/src/components/chat/ChangedFilesTree.tsx | cut -d: -f2)" = 2
```

### Converting L41's seam

If L41 has landed with its two `fork: model-follow-agent` lines, the extension point commit
replaces them with the lines above and registers `ModelTurnChip` (adapted to take `threadRef`
from props) as `modelFollowAgentAction`, before `pcbFollowAgentAction`. Remove L41's rows from
FORK.md and `seams.tsv` in the same commit.

## Packet seams

None beyond the extension point.

| File   | Marker | Lines | Why |
| ------ | ------ | ----- | --- |
| (none) |        |       |     |

## Fork-owned shared files edited

| File                                                     | Change                                                                       | Also edited by                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| `apps/server/src/fork/turnFiles.ts` (new)                | Turn checkpoints, prefix, stream                                             | L41, L49, L66                      |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`  | `sourceSnapshot` returns `files`; `isPcbSource`; `resolveFound`; two methods | Most PCB packets (call sites only) |
| `apps/server/src/fork/pcb-preview/rpc.ts`                | Two handlers                                                                 | Packets with RPCs                  |
| `apps/server/src/fork/rpcAuthorization.ts`               | Two read scopes                                                              | Packets with RPCs                  |
| `packages/contracts/src/fork/pcb-preview.ts`             | Schemas, methods, RPCs                                                       | Packets with RPCs                  |
| `packages/contracts/src/fork/rpc.ts`                     | One stream tag                                                               | Packets with streams               |
| `packages/client-runtime/src/fork/pcb-preview.ts`        | Three atoms                                                                  | Packets with RPCs                  |
| `apps/web/src/fork/pcb-preview/commands.tsx`             | `pcbSurface` for agent `open`; render the host                               | L63 (focus)                        |
| `apps/web/src/fork/pcb-preview/palette.tsx`              | One item                                                                     | Packets with palette items         |
| `apps/web/src/fork/pcb-preview/preferences.ts`           | `agentDesigns` with a default                                                | L54 if it stores units here        |
| `apps/web/src/fork/pcb-preview/settings.tsx`             | One row                                                                      | L58, L64                           |
| `apps/web/src/fork/panels/` (only if L41 has not landed) | Background tab helper                                                        | L41                                |

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit 0. If `ChangedFilesTree.tsx` conflicts, the conflict must be on the two marked
lines. Upstream last touched the file in `5dcb59ed6c`.

## FORK.md rows

"Extension point seams":

| File                                                | Marker                    | Why                                          |
| --------------------------------------------------- | ------------------------- | -------------------------------------------- |
| `apps/web/src/components/chat/ChangedFilesTree.tsx` | `fork: ext-changed-files` | Fork chips in the changed files card header. |

`docs/fork/seams.tsv`:

```
apps/web/src/components/chat/ChangedFilesTree.tsx	ext-changed-files	2
```
