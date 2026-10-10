# L46 seams

## Extension points created by this packet

None: all existed. The service, RPC group, MCP toolkit, panel and settings section are L23's
(`ext-core`, `ext-mcp`, `ext-panels`, `ext-settings`).

## Packet seams

| File                         | Marker                    | Lines | Why                                            |
| ---------------------------- | ------------------------- | ----- | ---------------------------------------------- |
| `apps/server/vite.config.ts` | `fork: model-print-check` | 1     | Bundle the check worker as its own pack entry. |

The pack `entry` line (`apps/server/vite.config.ts:81`) becomes, with the marker on its own line
above it because the line is longer than 90 characters:

```ts
      // fork: model-print-check
      entry: packExecutable ? ["src/bin.ts"] : ["src/bin.ts", "src/claude-history-worker.ts", "src/fork/model-preview-3d/check/model-check-worker.ts"],
```

`vp fmt` will wrap the array; the marker stays above the statement, which is how CONVENTIONS.md
handles a seam the formatter might wrap. The executable branch is untouched: it embeds one entry,
and the checker reports "unavailable" there (PRODUCT.md, decision 2).

Why no extension point covers it: a worker thread needs a separate script, and the pack entry
list is the only place that decides which scripts exist in `dist/`. Upstream added its own
worker on this same line. An `ext-` extension point for "extra pack entries" would be a larger
seam (an import into `vite.config.ts`) for one entry. If a second fork packet ever needs a pack
entry, that is the moment to create one.

## Fork-owned shared files edited

Other follow-up packets edit these too. Keep each change additive.

| File                                                           | Change                                                              | Also edited by                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/contracts/src/fork/model-print-check.ts`             | New.                                                                | L48 (adds assembly check schemas or reuses the finding shape) |
| `packages/contracts/src/fork/model-preview-3d.ts`              | Two methods, two RPCs, `unavailable` reason, three settings fields. | L32, L33, L34, L36 (`overhangAngleDegrees`), L40, L48, L51    |
| `packages/contracts/src/fork/model-editor.ts`                  | `findings` field for `display`.                                     | L31, L36, L42 and other display-mode packets                  |
| `packages/contracts/src/fork/index.ts`                         | One export line.                                                    | Any packet adding a contracts file                            |
| `packages/contracts/src/fork/clientRpcPermissions.ts`          | Two rows.                                                           | Any packet adding a guarded method                            |
| `apps/server/src/fork/rpcAuthorization.ts`                     | Two rows.                                                           | Any packet adding a method                                    |
| `packages/client-runtime/src/fork/model-preview-3d.ts`         | Two commands.                                                       | L48, L51                                                      |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts` | `makePrintChecker(...)` created in `make`, spread into the service. | L32, L35, L36, L48, L51                                       |
| `apps/server/src/fork/model-preview-3d/rpc.ts`                 | Two handlers.                                                       | L48, L51                                                      |
| `apps/server/src/fork/model-preview-3d/mcp.ts`                 | One tool and handler.                                               | L32, L35, L36, L48, L51                                       |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts`    | `setFindings`, `frame`, one line at the end of `drawOverlay`.       | Most viewer packets (added methods only)                      |
| `apps/web/src/fork/model-preview-3d/ModelInspector.tsx`        | Part renders `PrintCheckSection`; watertight fact reads the report. | L32, L34, L35, L40                                            |
| `apps/web/src/fork/model-preview-3d/MarkupSection.tsx`         | "Print check" group.                                                | L38, L39                                                      |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`            | Hook, display state, badge, editor `display` field, Escape branch.  | Most packets                                                  |
| `apps/web/src/fork/model-preview-3d/WorkspaceTools.tsx`        | One display menu item.                                              | L31, L36, L42 (append-only menu)                              |
| `apps/web/src/fork/model-preview-3d/SettingsSection.tsx`       | Three rows.                                                         | L33, L36, L40, L51                                            |
| `apps/web/src/fork/model-preview-3d/workspace.module.css`      | `check-*` pin styles.                                               | Most UI packets                                               |

If L32's bed move has not landed, this packet does it first, in its own commit, exactly as
L32's TECHNICAL.md and SEAMS.md describe.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0, or a conflict listing only `apps/server/vite.config.ts` when upstream
changed the pack entry line in that nightly. Resolve by keeping upstream's line and re-adding the
worker path. `scripts/fork/loom.sh check` then confirms the marker survived.

## FORK.md rows

FORK.md's "Packet seams" section is written as one short paragraph per seam (FORK.md:105-117),
although CONVENTIONS.md describes a table. Follow the file:

```md
L46 adds the print check worker to the server pack entries in `apps/server/vite.config.ts`
(`fork: model-print-check`) so the worker ships beside `bin.mjs`. The single-file executable
does not include it and reports print checks as unavailable. See the
[L46 packet](docs/fork/packets/L46-model-print-check/SEAMS.md).
```

`docs/fork/seams.tsv`, same commit:

```text
apps/server/vite.config.ts	model-print-check	1
```
