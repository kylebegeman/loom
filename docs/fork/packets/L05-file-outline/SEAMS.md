# L05 seams

## Existing extension points

The packet reuses `ext-web-root`, `ext-palette`, `ext-keybindings` and the client helper
provided by `ext-core`. It creates no extension point, server capability, RPC or migration.

## File surface insertions

Only `apps/web/src/components/files/FilePreviewPanel.tsx` is upstream-owned. It has exactly
three `fork: file-outline` markers:

1. The import of the two fork slot components.
2. The header toggle, immediately before the file explorer toggle.
3. The outline column, immediately before the file explorer aside.

The slots receive `requestedPath`, preserving the right-panel identity for absolute workspace
links, while upstream resolves `relativePath` for reads. Directories and attachments are
excluded. The column also receives the existing reveal request ID and file-load error.

```diff
+// fork: file-outline
+import {
+  LoomFileOutlineColumn,
+  LoomFileOutlineToggle,
+} from "../../fork/file-outline/FileOutlineSlots";
```

```diff
+          {/* fork: file-outline */}
+          <LoomFileOutlineToggle
+            threadRef={threadRef}
+            relativePath={isDirectory ? null : requestedPath}
+            contents={!isMedia && !isPdf ? (file.data?.contents ?? null) : null}
+            truncated={file.data?.truncated ?? false}
+          />
```

```diff
+        {/* fork: file-outline */}
+        <LoomFileOutlineColumn
+          threadRef={threadRef}
+          relativePath={attachment === undefined && !isDirectory ? requestedPath : null}
+          contents={
+            attachment === undefined && !isMedia && !isPdf ? (file.data?.contents ?? null) : null
+          }
+          truncated={file.data?.truncated ?? false}
+          revealLine={revealLine}
+          revealRequestId={revealRequestId}
+          error={file.error}
+        />
```

## Why there is no generic slot

`ext-panels` adds a separate surface, which would hide the source. No existing extension point
reaches inside the file viewer. Promote these insertions into a shared extension point only
when a second packet needs the same location.

The file and three markers are registered in `FORK.md` and `docs/fork/seams.tsv`.
Keep the toggle before the explorer toggle and the column before the explorer aside when
upstream moves surrounding layout.

## Merge safety

The complete implementation passes `git merge-tree --write-tree --name-only --no-messages`
against `v0.0.46-nightly.20261004.2657` (`efecd3cf8b`). Exit status 0, no conflicts.
The preview produced tree `b7ca6595631f4fc3b5a35bb56a97ad7a3d2989b0`.

The focused seam manifest check also passes. Full installation/integration remains Kyle's
step from a clean, synced `main`.
