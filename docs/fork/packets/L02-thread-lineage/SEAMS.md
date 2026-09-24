# L02 seams

Every upstream file this packet touches. Extension point seams are listed only if this packet
creates the extension point.

## Extension points

Used: `ext-core` (with persistence and a reactor), `ext-web-root`, `ext-panels`,
`ext-palette`, `ext-keybindings`. Run each existence check from EXTENSION-POINTS.md; create
the missing ones exactly as specified there, one commit each, before any packet code. Record
here which ones this packet created and the commit hashes, for example:

| Extension point | Created by this packet | Commit |
| --------------- | ---------------------- | ------ |
| `ext-core`      | yes / no               | `...`  |

Registrations (no further upstream edits):

| Registry                                               | Entry                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `packages/contracts/src/fork/index.ts`                 | `export * from "./thread-lineage.ts";`                       |
| `packages/contracts/src/fork/rpc.ts` `.merge(`         | `ThreadLineageRpcGroup,`                                     |
| `packages/contracts/src/fork/keybindings.ts`           | three `loom.thread-lineage.*` commands                       |
| `packages/client-runtime/src/fork/index.ts`            | `export * from "./thread-lineage.ts";`                       |
| `apps/server/src/fork/features.ts`                     | `"thread-lineage"`                                           |
| `apps/server/src/fork/ForkRuntime.ts` `ForkServices`   | `\| ThreadLineageStore \| ThreadLineageService`              |
| `apps/server/src/fork/ForkLayer.ts` `ForkServicesLive` | store, service and cleanup reactor layers                    |
| `apps/server/src/fork/persistence/migrations.ts`       | `ThreadLineageMigrations`                                    |
| `apps/server/src/fork/rpcAuthorization.ts`             | five scopes                                                  |
| `apps/server/src/fork/rpc.ts`                          | `...(yield* makeThreadLineageRpcHandlers(auth)),`            |
| `apps/web/src/fork/ForkRoot.tsx`                       | `{ id: "thread-lineage-dialog", Component: ForkDialogHost }` |
| `apps/web/src/fork/panels/registry.ts`                 | `threadLineagePanel, threadPanePanel,`                       |
| `apps/web/src/fork/commandPalette/registry.ts`         | `threadLineagePaletteSource,`                                |

## Packet seams

| File                                                | Marker                 | Lines | Why                                                              |
| --------------------------------------------------- | ---------------------- | ----- | ---------------------------------------------------------------- |
| `apps/web/src/components/chat/MessagesTimeline.tsx` | `fork: thread-lineage` | 6     | "Fork from here" on user and assistant messages (import, 2 JSX). |

### Why no extension point covers it

No extension point reaches individual timeline rows. `MessagesTimeline` has no per-message
action registry and no message context menu (the only `onContextMenu` in chat content is for
file links in `ChatMarkdown.tsx`); the user action bar and the assistant meta row are fixed
JSX. The alternatives (a palette-only "fork from message" picker, or forking only from the
latest message) do not meet "fork from any message". The seam is one component per row
type, and the component reads everything it needs from its props and the fork store, so a
future `ext-message-actions` extension point could replace these three lines with one.

### Diffs

Import, after `import { MessageCopyButton } from "./MessageCopyButton";`
(`MessagesTimeline.tsx:157`). The code is longer than 90 characters with a trailing
marker, so the marker sits on its own line:

```diff
 import { MessageCopyButton } from "./MessageCopyButton";
+// fork: thread-lineage
+import { ForkFromMessageButton } from "~/fork/thread-lineage/ForkFromMessageButton";
```

User message action bar, as the first child of the button group in `UserTimelineRow`
(`MessagesTimeline.tsx:1959`; `ctx` is `use(TimelineRowCtx)` at 1679 and carries
`threadRef`, declared at 263):

```diff
           <div className="flex items-center gap-0.5">
+            {/* fork: thread-lineage */}
+            <ForkFromMessageButton threadRef={ctx.threadRef} message={row.message} />
             {typeof revertTurnCount === "number" && (
```

Assistant meta row, before `<AssistantCopyButton` in `AssistantMessageMeta`
(`MessagesTimeline.tsx:2151`; `ctx` is read at 2139):

```diff
     >
+      {/* fork: thread-lineage */}
+      <ForkFromMessageButton threadRef={ctx.threadRef} message={message} />
       <AssistantCopyButton
```

Check after `vp fmt`: `git grep -c 'fork: thread-lineage' -- apps/web/src/components/chat/MessagesTimeline.tsx`
prints 3, and each marker is directly above its seam line.

If upstream has moved these blocks, place the button next to the user row's revert button
and next to the assistant copy button, and update the line numbers here.

## Merge check

Run on the packet branch before asking for review:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and the result here. Conflicts are acceptable only in
`MessagesTimeline.tsx` on the marked lines, and in extension point seam files on their
marked lines.

## FORK.md rows

Add to the "Packet seams" table (create it if missing, columns `File`, `Packet`, `Why`):

| File                                                | Packet           | Why                                                                                          |
| --------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| `apps/web/src/components/chat/MessagesTimeline.tsx` | `thread-lineage` | "Fork from here" on user and assistant messages. See `docs/fork/packets/L02-thread-lineage`. |

Add the extension point rows too if this packet created any extension point.
