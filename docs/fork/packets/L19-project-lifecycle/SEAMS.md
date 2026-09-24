# L19 seams

This packet inserts three lines (two markers) into one upstream file (the sidebar footer icon), adds
one fork-owned file inside upstream's routes directory (the router only discovers routes
there), and regenerates the route tree. It edits no existing upstream line.

## Extension points used

| Extension point   | Existence check (EXTENSION-POINTS.md)   | Registration                                                                                                     |
| ----------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ext-core`        | section 1, "Existence check"            | contracts group, service layer, migration set, handlers, scopes, `"project-lifecycle"` in `LOOM_SERVER_FEATURES` |
| `ext-settings`    | section 7                               | `projectLifecycleSettings` in `FORK_SETTINGS_SECTIONS`                                                           |
| `ext-palette`     | section 8                               | `projectLifecyclePaletteSource` in `FORK_COMMAND_PALETTE_SOURCES`                                                |
| `ext-web-root`    | section 5 (prerequisite of keybindings) | `{ id: "project-lifecycle-shortcuts", Component: ProjectLifecycleShortcutHost }` in `FORK_ROOT_COMPONENTS`       |
| `ext-keybindings` | section 9                               | `"loom.project-lifecycle.open"` in `FORK_KEYBINDING_COMMANDS`                                                    |

## Extension points created by this packet

Whichever of the above is missing when the packet starts, created exactly as
EXTENSION-POINTS.md specifies, one commit each, before packet code. Record the commit hashes
here when done. If all existed: "None: all existed".

## Packet seams

| File                                                | Marker                     | Lines                   | Why                                                                               |
| --------------------------------------------------- | -------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `apps/web/src/components/sidebar/SidebarChrome.tsx` | `fork: project-lifecycle`  | 3 (marker, import, JSX) | Repositories icon in the sidebar footer next to Pull Requests.                    |
| `apps/web/src/routes/loom.repositories.tsx`         | none (new fork-owned file) | whole file              | TanStack Router discovers routes only in `apps/web/src/routes/` (CONVENTIONS.md). |
| `apps/web/src/routeTree.gen.ts`                     | none (generated)           | generated               | The router plugin regenerates it when a route file is added.                      |

### `SidebarChrome.tsx`

Verified against `137e432394` (2026-09-24). The file already carries the branding seam: the
`LoomWordmark` import with `// fork: brand` at line 14 and the `{/* fork: brand */}` JSX at
line 96. This packet's import goes directly below the brand import. The line is longer than
90 characters, so the marker sits on its own line above it:

```diff
 import { LoomWordmark } from "../LoomWordmark"; // fork: brand
+// fork: project-lifecycle
+import { RepositoriesSidebarItem } from "../../fork/project-lifecycle/SidebarItem";
 import {
   resolveEnvironmentIdentificationPillLabel,
```

The item goes in `SidebarUtilityMenu`, right after the Pull Requests item (lines 199-205) and
before Usage (line 206), because Kyle asked for it next to Pull Requests (the order is
user-visible, so it is not inserted at the start of the list):

```diff
               onClick={handlePullRequestsClick}
             />
           ) : null}
+          <RepositoriesSidebarItem /> {/* fork: project-lifecycle */}
           <SidebarUtilityItem
             icon={<ChartNoAxesColumnIcon />}
             label="Usage"
```

Expected marker count in the file: `fork: brand` 2 (unchanged), `fork: project-lifecycle` 2.
If `vp fmt` moves the trailing JSX comment onto its own line, keep it directly after the
element; both forms keep the seam attached.

The component owns everything else: the capability check, the icon, the tooltip, closing
the mobile sidebar and the navigation (TECHNICAL.md, Clients). It renders nothing on
environments without `project-lifecycle`, so the footer looks exactly like upstream there.
While `/loom/repositories` is open the footer still shows the icon row (upstream shows its
Back button only for the pages it knows, lines 131-143), which is why the page has its own
Back link.

Why no extension point covers it: EXTENSION-POINTS.md has no sidebar footer registry, and
this is the only packet that adds a footer icon. A registry would need the same seam
lines plus a fork file with one entry, so it saves nothing until a second packet needs one.

The route file, verbatim:

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { RepositoriesPage } from "../fork/project-lifecycle/RepositoriesPage";
import { parseRepositoriesSearch } from "../fork/project-lifecycle/repositoriesSearch";

export const Route = createFileRoute("/loom/repositories")({
  validateSearch: parseRepositoriesSearch,
  component: RepositoriesPage,
});
```

`/loom/repositories` is a top-level route like upstream's `/usage`
(`apps/web/src/routes/usage.tsx:5-7`); the sidebar renders around it and shows its Back
button only for the pages it knows (`apps/web/src/components/sidebar/SidebarChrome.tsx:128-143`),
so the Repositories page carries its own "Back" affordance in its header (a link to `/`).

`routeTree.gen.ts`: run `vp run --filter @t3tools/web build` (or the web dev server once)
after adding the route file and commit the regenerated file. On a merge conflict in it, take
upstream's version and regenerate the same way (EXTENSION-POINTS.md, Settings).

Why no extension point covers the route: EXTENSION-POINTS.md has settings pages and right
panels but no generic full-page route registry. A page registry would still need one route
file per path, so it would save nothing.

Deferred seam (PRODUCT.md, Out of scope): a "Park" item in the sidebar project menu
(`apps/web/src/components/LegacySidebar.tsx`, 33 upstream commits since June and likely to be
replaced). Not in v1; revisit when upstream's new sidebar settles.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: no conflicts from this packet, except possibly `apps/web/src/routeTree.gen.ts`
when upstream also adds a route, and `SidebarChrome.tsx` when upstream edits the lines around
the two marked insertions (28 upstream commits touched the file since June). Resolve by
taking upstream's version and reinserting the three lines (the marker line and the import
next to the brand import, the JSX line after the Pull Requests item). Record the tag and
result here.

## FORK.md rows

"Packet seams" table:

| File                                                | Packet              | Why                                                                                                               |
| --------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/sidebar/SidebarChrome.tsx` | `project-lifecycle` | Repositories icon in the sidebar footer. See `docs/fork/packets/L19-project-lifecycle`.                           |
| `apps/web/src/routes/loom.repositories.tsx`         | `project-lifecycle` | Repositories page route (fork-owned file in the routes directory). See `docs/fork/packets/L19-project-lifecycle`. |
| `apps/web/src/routeTree.gen.ts` (no marker)         | `project-lifecycle` | Regenerated for `/loom/repositories`.                                                                             |
