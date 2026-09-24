# L12 seams

## Extension points created by this packet

Each only if its existence check fails, created exactly as EXTENSION-POINTS.md specifies,
in its own commit before any packet code: `ext-panels` (required, and first: this packet's
seams sit next to its seams), `ext-settings`, `ext-web-root`, `ext-keybindings`,
`ext-palette`. Record the commits here when done.

## Packet seams

| File                                         | Marker               | Lines                   | Why                                                                                     |
| -------------------------------------------- | -------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `apps/web/src/components/RightPanelTabs.tsx` | `fork: panel-picker` | 6 sites, about 22 lines | Render upstream's two surface lists through the picker; no extension point replaces UI. |

Why no extension point covers it: `ext-panels` adds fork entries to upstream's lists but
leaves their presentation to upstream. Replacing the presentation needs the list arrays,
which are local variables inside `RightPanelEmptyState` and `RightPanelTabs`. Only this
packet needs that, so a dedicated extension point would be machinery for one user.

All citations below are before `ext-panels` is applied; with it, lines shift down by its
marked lines. Match on the quoted code.

### 1. Import (after line 76 and after the `ext-panels` import if present)

```diff
 import { resolvePullRequestState } from "./pullRequest/pullRequestPresentation";
 // fork: ext-panels
 import { ForkSurfaceIcon, forkSurfaceTitle, type ForkSurfaceAction } from "~/fork/panels/surface";
+// fork: panel-picker
+import { LoomPanelPickerButton, LoomPanelPickerLauncher, useLoomPanelPicker } from "~/fork/panel-picker/PanelPicker";
```

### 2. Empty-state launcher (in `RightPanelEmptyState`, after `focusOnMount`, line 473)

Placed after the last hook of the component, so hook order never changes. Upstream's
letter-shortcut listener (registered above) keeps working.

```diff
   const focusOnMount = useCallback((node: HTMLDivElement | null) => {
     node?.focus();
   }, []);
+  const loomPanelPicker = useLoomPanelPicker(); // fork: panel-picker
+  // fork: panel-picker
+  if (loomPanelPicker.enabled) {
+    return (
+      <LoomPanelPickerLauncher
+        actions={actions}
+        browserProfiles={props.browserProfiles}
+        onAddBrowserInProfile={props.onAddBrowserInProfile}
+      />
+    );
+  }

   const isHighlighted = (action: SurfaceAction) =>
```

(Count: the hook line and the `if` statement are two seam sites; the `if` block is one
multi-line seam under its marker.)

### 3. Picker flag in `RightPanelTabs` (after line 825)

```diff
   const [addSurfaceMenuOpen, setAddSurfaceMenuOpen] = useState(false);
+  const loomPanelPicker = useLoomPanelPicker(); // fork: panel-picker
```

### 4. "+" button (before line 1245) and 5. upstream menu condition (line 1245)

```diff
             })}
+            {/* fork: panel-picker */}
+            {props.surfaces.length > 0 && loomPanelPicker.enabled ? (
+              <LoomPanelPickerButton
+                actions={addSurfaceActions}
+                browserProfiles={browserProfiles}
+                onAddBrowserInProfile={props.onAddBrowserInProfile}
+              />
+            ) : null}
+            {/* fork: panel-picker: upstream menu only when the picker is off */}
-            {props.surfaces.length > 0 ? (
+            {props.surfaces.length > 0 && !loomPanelPicker.enabled ? (
               <Menu open={addSurfaceMenuOpen} onOpenChange={setAddSurfaceMenuOpen}>
```

Seam 5 is the only edited upstream line; everything else is inserted. After `vp fmt`,
check that each marker is still directly above its statement or at the end of its line.

Marker count after the change: `git grep -c 'fork: panel-picker' -- apps/web/src/components/RightPanelTabs.tsx`
prints 6 (import marker, launcher hook, launcher `if`, `RightPanelTabs` hook, button,
menu condition).

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit 0, or a conflict only in `RightPanelTabs.tsx` (or the ext-panels files) on
marked lines. `RightPanelTabs.tsx` changes often upstream (new surfaces add rows to both
arrays); those edits land inside the arrays, away from these seams, and flow into the
picker automatically. Record the tag and the result here.

On a conflict: keep upstream's version of the surrounding code, reapply the diffs above,
and confirm the launcher early return is still after the component's last hook.

## FORK.md rows

"Packet seams" table:

| File                                         | Packet         | Why                                                                           |
| -------------------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| `apps/web/src/components/RightPanelTabs.tsx` | `panel-picker` | Empty-state launcher and "+" menu render through the Loom panel picker (L12). |
