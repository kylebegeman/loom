# L04 seams

Every upstream file this packet touches. Extension point seams are listed only if this packet
creates the extension point.

## Extension points

Used: `ext-core` (prerequisite only), `ext-panels`, `ext-web-root`, `ext-keybindings`,
`ext-palette`. Run each existence check from EXTENSION-POINTS.md; create missing ones
exactly as specified, one commit each, before packet code, and record them here with their
commits.

Registrations (fork-owned files only):

| Registry                                       | Entry                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/contracts/src/fork/keybindings.ts`   | `"loom.thread-inspector.toggle"`, `"loom.thread-inspector.card"`        |
| `apps/web/src/fork/panels/registry.ts`         | `threadInspectorPanel,`                                                 |
| `apps/web/src/fork/ForkRoot.tsx`               | `{ id: "thread-inspector-commands", Component: InspectorCommandsHost }` |
| `apps/web/src/fork/commandPalette/registry.ts` | `threadInspectorPaletteSource,`                                         |

No `ext-core` registration: the packet has no server part and no `loomFeatures` entry.

## Packet seams

| File                                          | Marker                   | Lines | Why                                                  |
| --------------------------------------------- | ------------------------ | ----- | ---------------------------------------------------- |
| `apps/web/src/components/chat/ChatHeader.tsx` | `fork: thread-inspector` | 4     | The inspector eye button in the chat header actions. |

### Why no extension point covers it

Kyle asked for a card shown from the header. None of the extension points reaches the chat
header: `ext-panels` adds right panel tabs, `ext-composer` adds composer controls and
`ext-web-root` mounts outside the chat layout. The button component takes only the thread
ref and renders the card through a portal, so no other header or `ChatView` change is
needed. A shared chat header actions point was considered and declined while this is the only
consumer (EXTENSION-POINTS.md, "Shared points considered and declined").

### Diffs (`apps/web/src/components/chat/ChatHeader.tsx`)

Import, after `import { OpenInPicker } from "./OpenInPicker";` (line 34):

```diff
 import { OpenInPicker } from "./OpenInPicker";
+// fork: thread-inspector
+import { ThreadInspectorHeaderButton } from "~/fork/thread-inspector/ThreadInspectorHeaderButton";
```

First child of the header actions container (`data-chat-header-actions`, line 405; the
children start at line 412). `activeThreadRef` is declared at line 172 and `isServerThread`
is a prop (line 126):

```diff
       >
+        {/* fork: thread-inspector */}
+        <ThreadInspectorHeaderButton threadRef={isServerThread ? activeThreadRef : null} />
         {activeProjectScripts && (
```

The button renders `null` for drafts (`threadRef === null`). The container already manages
its own gap and right padding, so no class changes are needed.

Check after `vp fmt`:
`git grep -c 'fork: thread-inspector' -- apps/web/src/components/chat/ChatHeader.tsx` prints 2.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here. Conflicts are acceptable only on the marked lines.

## FORK.md rows

"Packet seams":

| File                                          | Packet             | Why                                                                                     |
| --------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `apps/web/src/components/chat/ChatHeader.tsx` | `thread-inspector` | Eye button for the thread inspector card. See `docs/fork/packets/L04-thread-inspector`. |

Add extension point rows too if this packet created any.
