# L14 seams

## Extension points created by this packet

Each only if its existence check fails, created exactly as EXTENSION-POINTS.md specifies,
one commit each, before the part that needs it:

- Part A: `ext-web-root`, `ext-keybindings`, `ext-palette`, `ext-settings`.
- Part B: `ext-settings`.
- Part C: `ext-composer`, `ext-keybindings`, `ext-palette`.
- Part D: `ext-core`, `ext-mcp`.
- Part E: `ext-core`, `ext-decide` (EXTENSION-POINTS.md section 18; create if missing,
  exactly as specified there), and part C's `ext-composer`, `ext-keybindings`,
  `ext-palette`, plus `ext-settings`.

Record the commits here when done.

## Packet seams

| File                                       | Marker                    | Sites | Part | Why                                                                                                |
| ------------------------------------------ | ------------------------- | ----- | ---- | -------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/ChatView.tsx`     | `fork: chat-conveniences` | 2     | A    | The fork needs the timeline's list ref and live-follow cancel, which exist only inside `ChatView`. |
| `apps/web/src/components/ChatMarkdown.tsx` | `fork: chat-conveniences` | 2     | B    | Code blocks render in a private `pre` component; no extension point covers Markdown renderers.     |
| `apps/web/package.json` (no marker)        | -                         | 1     | B    | The `mermaid` dependency, approved by Kyle (lazy chunk).                                           |
| `pnpm-lock.yaml` (no marker)               | -                         | -     | B    | The intended lockfile change for `mermaid` only (CONVENTIONS.md, The lockfile rule).               |

Parts C, D and E have no packet seams. Part A's default `mod+F` is a fork listener, so it
adds nothing to `packages/shared/src/keybindings.ts` (no `FORK_DEFAULT_KEYBINDINGS`).

### ChatView.tsx (part A)

Import, next to the ext-panels imports if present (otherwise after the last `../fork/`
or local import block):

```diff
+import { useLoomTimelineHandle } from "../fork/chat-conveniences/find/timelineHandle"; // fork: chat-conveniences
```

After the effect that keeps `cancelTimelineLiveFollowForUserNavigationRef` current
(`ChatView.tsx:5239-5242`), where `routeThreadRef` (1458), `legendListRef` (1750) and
`cancelTimelineLiveFollowForUserNavigation` (5226) are all defined:

```diff
   useEffect(() => {
     cancelTimelineLiveFollowForUserNavigationRef.current =
       cancelTimelineLiveFollowForUserNavigation;
   }, [cancelTimelineLiveFollowForUserNavigation]);
+  // fork: chat-conveniences
+  useLoomTimelineHandle({
+    threadRef: routeThreadRef,
+    listRef: legendListRef,
+    onManualNavigation: cancelTimelineLiveFollowForUserNavigation,
+  });
   const getActiveTimelineTurnMetrics = useCallback(
```

`ChatView` has no early return between these lines and its JSX, so the hook call is
unconditional. The object literal is rebuilt each render; `useLoomTimelineHandle`
depends on its three fields, which are stable (`useMemo`, `useRef`, `useCallback([])`).

Why not an extension point: only this part needs the list ref. If a later packet needs the
timeline too (for example L04 or L07), promote `timelineHandle.ts` to an extension point
(`ext-timeline`) in EXTENSION-POINTS.md and move this seam there.

### ChatMarkdown.tsx (part B)

Import after the last import (line 196):

```diff
 import { PullRequestLinkPreview } from "./pullRequest/PullRequestLinkPreview";
+// fork: chat-conveniences
+import { LoomMermaidBlock, loomMermaidEnabled } from "../fork/chat-conveniences/mermaid/LoomMermaidBlock";
```

In the `pre` renderer (3179), after the language is computed (3186):

```diff
     const language = extractFenceLanguage(codeBlock.className);
+    // fork: chat-conveniences
+    if (language === "mermaid" && !isStreaming && loomMermaidEnabled()) {
+      return (
+        <LoomMermaidBlock
+          code={codeBlock.code}
+          theme={resolvedTheme}
+          fallback={<pre {...props}>{children}</pre>}
+        />
+      );
+    }
     const fenceTitle = extractFenceTitle(extractPreCodeMeta(node));
```

`isStreaming` and `resolvedTheme` are already destructured at 3180. `MarkdownPre` has no
hooks after this point that would change order (`use(...)` at 3180 runs before it).
`LoomMermaidBlock` is imported statically but is small; it loads `mermaid` itself with a
dynamic `import()`.

### apps/web/package.json (part B)

```diff
     "lucide-react": "...",
+    "mermaid": "^11.x.y",
```

Pin to the current 11.x release at implementation time (old Loom used 11.16.0). Insert in
alphabetical order as upstream keeps it; JSON cannot carry a marker, so it is listed here
and in FORK.md.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

`ChatView.tsx` and `ChatMarkdown.tsx` change in most upstream releases; expect occasional
conflicts on these lines. Resolution: take upstream's version, reapply the diffs above at
the quoted anchors. `package.json` conflicts, if any, are in the dependency list; keep both
sides. Record the tag and the result here.

## FORK.md rows

"Packet seams" table:

| File                                       | Packet              | Why                                                     |
| ------------------------------------------ | ------------------- | ------------------------------------------------------- |
| `apps/web/src/components/ChatView.tsx`     | `chat-conveniences` | Hands the timeline list to Find in thread (L14 part A). |
| `apps/web/src/components/ChatMarkdown.tsx` | `chat-conveniences` | Renders `mermaid` code blocks as diagrams (L14 part B). |
| `apps/web/package.json` (no marker)        | `chat-conveniences` | `mermaid` dependency for diagrams (L14 part B).         |
