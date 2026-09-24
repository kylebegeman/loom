# L05 seams

## Extension points created by this packet

None are specific to this packet. It uses `ext-palette`, `ext-keybindings`, `ext-web-root`
(the keybinding prerequisite) and `ext-core` (the prerequisite of `ext-palette`; nothing
registered). Run each existence check in
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md); create any missing one exactly as specified,
in its own commit, and list it here with the commit hash when this packet creates it.

## Packet seams

| File                                                 | Marker               | Lines                    | Why                                                                                                          |
| ---------------------------------------------------- | -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/components/files/FilePreviewPanel.tsx` | `fork: file-outline` | 3 seams (about 20 lines) | The outline must render beside the source inside the Files panel and read the text the panel already loaded. |

### Why no extension point covers it

`ext-panels` adds a separate right-panel tab, and the right panel shows one surface at a time,
so the outline would hide the file it outlines (see TECHNICAL, "Why not a separate panel").
No extension point reaches inside `FilePreviewPanel`, and adding a generic "file surface
slot" extension point for one consumer is not justified. If a second packet later needs a
slot in the file header or beside the source, promote these seams into an extension point
then (propose it in EXTENSION-POINTS.md first).

### Seam 1: import (after `} from "./projectFilesQueryState";`, line 92)

```diff
 } from "./projectFilesQueryState";
+// fork: file-outline
+import { LoomFileOutlineColumn, LoomFileOutlineToggle } from "../../fork/file-outline/FileOutlineSlots";
```

The marker sits on its own line because the import is longer than 90 characters and the
formatter may wrap it.

### Seam 2: header toggle (before `{!isHostFile ? (`, line 1148)

Placed before the explorer toggle so the file explorer button stays last, matching the order
of the two columns.

```diff
           {canOpenInBrowser ? (
             <FileSurfaceAction label="Open file in preview browser" onPress={handleOpenInBrowser}>
               <Globe2 className="size-3.5" />
             </FileSurfaceAction>
           ) : null}
+          {/* fork: file-outline */}
+          <LoomFileOutlineToggle
+            threadRef={threadRef}
+            relativePath={relativePath}
+            contents={!isMedia && !isPdf ? (file.data?.contents ?? null) : null}
+            truncated={file.data?.truncated ?? false}
+          />
           {!isHostFile ? (
```

This block is already inside `{relativePath && attachment === undefined ? (`, so
`relativePath` is a string and attachments never reach it.

### Seam 3: outline column (before `{showExplorer ? (`, line 1278)

```diff
           ) : null}
         </div>
+        {/* fork: file-outline */}
+        <LoomFileOutlineColumn
+          threadRef={threadRef}
+          relativePath={attachment === undefined ? relativePath : null}
+          contents={attachment === undefined && !isMedia && !isPdf ? (file.data?.contents ?? null) : null}
+          truncated={file.data?.truncated ?? false}
+          revealLine={revealLine}
+        />
         {showExplorer ? (
```

Run `vp fmt` on the file afterwards; every multi-line seam starts with its own marker line,
so wrapping cannot separate a seam from its marker.

Expected marker count: `git grep -c 'fork: file-outline' -- apps/web/src/components/files/FilePreviewPanel.tsx`
prints 3.

## Merge check

Run while on the packet branch:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and the result here. `FilePreviewPanel.tsx` changes in many upstream releases;
a conflict is expected occasionally and must only touch the three marked seams. When the
header block moves, keep the toggle immediately before the explorer toggle; when the body
layout moves, keep the column immediately before the explorer aside.

## FORK.md rows

Add to the "Packet seams" table (create the table with columns `File`, `Packet`, `Why` if it
does not exist yet):

| File                                                 | Packet         | Why                                                                                                               |
| ---------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/files/FilePreviewPanel.tsx` | `file-outline` | Outline toggle in the file header and outline column beside the source. See `docs/fork/packets/L05-file-outline`. |
