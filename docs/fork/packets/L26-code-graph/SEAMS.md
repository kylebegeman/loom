# L26 seams

## Extension points created by this packet

None specific. It uses `ext-core` (with persistence, reactors), `ext-panels`, `ext-mcp`,
`ext-settings`, `ext-palette` and `ext-diff-header`
([EXTENSION-POINTS.md, section 17](../EXTENSION-POINTS.md#17-diff-panel-header-ext-diff-header)). Run each existence check; create any missing
one exactly as specified in [EXTENSION-POINTS.md](../EXTENSION-POINTS.md), one commit each,
and record the commits here.

## Registrations (fork-owned files only)

| Registry                   | File                                       | Entry                                                   |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| `FORK_DIFF_HEADER_ACTIONS` | `apps/web/src/fork/diffHeader/registry.ts` | `codeGraphDiffHeaderAction` (id `code-graph`)           |
| `FORK_PANELS`              | `apps/web/src/fork/panels/registry.ts`     | `codeGraphPanel` (id `code-graph`, launcher letter `Y`) |

The other registrations (RPC group, services, migrations, MCP toolkit, settings section,
palette source) follow EXTENSION-POINTS.md and are listed in TECHNICAL.md.

## Packet seams

None. The "Impact" button in the diff panel header goes through `ext-diff-header`, whose two
marked lines in `apps/web/src/components/DiffPanel.tsx` belong to the extension point (L15
may add its own button there too).

### The diff header action

`apps/web/src/fork/code-graph/DiffImpactButton.tsx` exports `codeGraphDiffHeaderAction`
(`{ id: "code-graph", Component: DiffImpactButton }`), where `DiffImpactButton` takes
`ForkDiffHeaderActionProps` (`threadRef`, `files`, `scopeLabel`, `selection`).

It renders null when there is no thread, no files, or the thread's environment lacks the
`code-graph` feature, and otherwise an icon button (`NetworkIcon`, tooltip "Show impact of
these changes") styled like the neighboring `Button size="icon-sm" variant="ghost"`. On
click it writes the file list into the fork impact store and opens
`forkPanelSurface("code-graph", "impact")` with `openSurface`. It makes no request itself.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result. Conflicts may only touch extension point seams this packet
created (for example the two `fork: ext-diff-header` lines in `DiffPanel.tsx`).

## FORK.md rows

No "Packet seams" rows. If this packet creates `ext-diff-header`, add to "Extension point
seams":

| File                                    | Marker            | Why                                                      |
| --------------------------------------- | ----------------- | -------------------------------------------------------- |
| `apps/web/src/components/DiffPanel.tsx` | `ext-diff-header` | Fork buttons in the diff panel header (L26 Impact, L15). |
