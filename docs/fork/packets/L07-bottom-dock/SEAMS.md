# L07 seams

## Extension points created by this packet

Whichever of these do not exist yet when phase 1 starts, each in its own commit, byte for
byte as [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) specifies:

| Extension point                                                            | Section | Commit                                                |
| -------------------------------------------------------------------------- | ------- | ----------------------------------------------------- |
| `ext-core` (for `@t3tools/client-runtime/fork`, imported by `ext-palette`) | 1       | `feat(fork): add the server core extension point`     |
| `ext-web-root`                                                             | 5       | `feat(fork): add the web root extension point`        |
| `ext-keybindings`                                                          | 9       | `feat(fork): add the keybindings extension point`     |
| `ext-palette`                                                              | 8       | `feat(fork): add the command palette extension point` |
| `ext-settings` (phase 5 only, prerequisite of `ext-decide`)                | 7       | `feat(fork): add the settings extension point`        |
| `ext-decide` (phase 5 only)                                                | 18      | `feat(fork): add the decide extension point`          |

Record the ones this packet created, with commit hashes, when the phase lands. Phases 2 to 4
create nothing. Phase 5 runs the `ext-decide` existence check from EXTENSION-POINTS.md
section 18 and creates it if missing, exactly as specified there, in its own commit, after
`ext-core` and `ext-settings` exist (`ext-decide` needs both; create `ext-settings` first if
it is missing, in its own commit).

## Packet seams

| File                                   | Marker              | Lines                                         | Why                                                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/ChatView.tsx` | `fork: bottom-dock` | 3 (1 import, 1 marker comment, 1 JSX element) | The dock must sit in the chat column directly above upstream's terminal drawer list. No extension point covers the area under the chat: `ext-panels` is the right panel, `ext-composer` is inside the composer, `ext-web-root` mounts outside the layout. |

Only phase 1 adds this seam. Phases 2 to 5 touch no upstream file: phase 5's server code
registers only through `ext-core` and `ext-decide` fork-owned registries.

### Fork-owned registration lines (phase 5, not seams)

| Fork file                                   | Line added                                         |
| ------------------------------------------- | -------------------------------------------------- |
| `packages/contracts/src/fork/index.ts`      | `export * from "./bottom-dock.ts";`                |
| `packages/contracts/src/fork/rpc.ts`        | `BottomDockRpcGroup,` in `.merge(`                 |
| `packages/client-runtime/src/fork/index.ts` | `export * from "./bottom-dock.ts";`                |
| `apps/server/src/fork/features.ts`          | `"bottom-dock"`                                    |
| `apps/server/src/fork/ForkRuntime.ts`       | `\| ApprovalRiskService`                           |
| `apps/server/src/fork/ForkLayer.ts`         | `ApprovalRiskService.layer,`                       |
| `apps/server/src/fork/rpc.ts`               | `...(yield* makeBottomDockRpcHandlers(auth)),`     |
| `apps/server/src/fork/rpcAuthorization.ts`  | `approvalRisk`: `orchestration:read`               |
| `apps/server/src/fork/decide/registry.ts`   | `APPROVAL_RISK_FEATURE,` in `FORK_DECIDE_FEATURES` |

### Diff (phase 1)

Import, on its own line after the last import in the file (currently
`} from "./chat/composerPromptHistory";` at line 520):

```diff
 } from "./chat/composerPromptHistory";
+import { ForkBottomDock } from "../fork/bottom-dock/ForkBottomDock"; // fork: bottom-dock
```

The dock, directly above the drawer list (line 9849), after the
`{/* end horizontal flex container */}` comment:

```diff
         {/* end horizontal flex container */}

+        {/* fork: bottom-dock */}
+        <ForkBottomDock threadRef={activeThreadRef} />
         {mountedTerminalThreadRefs.map(({ key: mountedThreadKey, threadRef: mountedThreadRef }) => (
           <PersistentThreadTerminalDrawer
```

`activeThreadRef` is the memo declared at `ChatView.tsx:1943` (`ScopedThreadRef | null`).
The upstream lines around the insertion are not edited or re-indented. The marker sits on its
own line above the element, so `vp fmt` cannot separate them.

If `ext-panels` already added `fork: ext-panels` imports to ChatView, place this import
after them; the two markers are independent.

### Why not other placements

- Inside `PersistentThreadTerminalDrawer` (`ChatView.tsx:879`): the strip would be mounted
  per hidden thread (up to 10) and would need edits inside upstream's component.
- Inside `ThreadTerminalDrawer.tsx`: the drawer is also used as the right panel terminal
  (`mode="panel"`), so the dock would leak there, and the file is 1,700+ lines of upstream
  terminal code.
- Wrapping the drawer list: re-indents 17 upstream lines (TECHNICAL.md, Alternatives).

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: clean, or a conflict in `apps/web/src/components/ChatView.tsx` only on the two
marked hunks (ChatView changes in most upstream releases; see EXTENSION-POINTS.md, Risks).
Record the tag and result here.

After an upstream merge, check that the seam is still directly above the drawer list and
inside the chat column wrapper: `git grep -n "fork: bottom-dock" -- apps/web/src/components/ChatView.tsx`
must print 2 lines, and the line after the marker comment must be the `<ForkBottomDock`
element followed by the `mountedTerminalThreadRefs.map(` line. If upstream moves the drawer,
move the two lines with it.

## FORK.md rows

Add to the "Packet seams" table (create it if missing, per CONVENTIONS.md):

| File                                   | Packet            | Why                                                             |
| -------------------------------------- | ----------------- | --------------------------------------------------------------- |
| `apps/web/src/components/ChatView.tsx` | `L07-bottom-dock` | Mounts the bottom dock directly above the terminal drawer list. |
