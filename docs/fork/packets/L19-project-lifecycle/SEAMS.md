# L19 seams

This packet edits no upstream source line. It adds one fork-owned file inside upstream's
routes directory (the router only discovers routes there) and regenerates the route tree.

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

| File                                        | Marker                     | Lines      | Why                                                                               |
| ------------------------------------------- | -------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `apps/web/src/routes/loom.repositories.tsx` | none (new fork-owned file) | whole file | TanStack Router discovers routes only in `apps/web/src/routes/` (CONVENTIONS.md). |
| `apps/web/src/routeTree.gen.ts`             | none (generated)           | generated  | The router plugin regenerates it when a route file is added.                      |

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

Why no extension point covers it: EXTENSION-POINTS.md has settings pages and right panels
but no generic full-page route registry. A page registry would still need one route file
per path, so it would save nothing.

Rejected seams (see PRODUCT.md, open questions 2 and 3): a Repositories icon in
`SidebarUtilityMenu` (`apps/web/src/components/sidebar/SidebarChrome.tsx:192-212`) and a
"Park" item in the sidebar project menu (`apps/web/src/components/LegacySidebar.tsx:1560-1670`
area and the new sidebar). Add them only if Kyle asks; each would be a marked
`fork: project-lifecycle` seam listed here.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: no conflicts from this packet, except possibly `apps/web/src/routeTree.gen.ts`
when upstream also adds a route. Record the tag and result here.

## FORK.md rows

"Packet seams" table:

| File                                        | Packet              | Why                                                                                                               |
| ------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/routes/loom.repositories.tsx` | `project-lifecycle` | Repositories page route (fork-owned file in the routes directory). See `docs/fork/packets/L19-project-lifecycle`. |
| `apps/web/src/routeTree.gen.ts` (no marker) | `project-lifecycle` | Regenerated for `/loom/repositories`.                                                                             |
