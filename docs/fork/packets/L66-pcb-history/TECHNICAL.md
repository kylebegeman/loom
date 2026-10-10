# L66 technical design

## Overview

Every root turn in a Git workspace ends with a checkpoint: a hidden commit under
`refs/t3/orchestration-v2/checkpoints/<scope key>/ordinal/<n>`
(`apps/server/src/orchestration-v2/CheckpointService.ts:26`, `:161-172`) whose projection row
(`packages/contracts/src/orchestrationV2.ts:1209-1222`) lists the repository paths the turn
touched. The thread also has a baseline at ordinal 0 before its first turn. L49 turns those refs
into file versions for the 3D panel. L66 reuses L49's service and adds what a PCB design needs:

1. A **design file set**. A KiCad design is its `.kicad_pro`, root `.kicad_sch`, sub-sheets,
   `.kicad_pcb`, `.kicad_dru`, library tables and project libraries. A tscircuit design is its
   entry file and what it imports. One pure walker computes the set over live files (for
   listing and conflict checks) and over a materialized version (for rendering and restore).
2. A **listing** method that picks the thread's checkpoints touching today's set, with a
   content key per version from `git ls-tree`. No file content is read.
3. **Rendering a version** through the existing `render` and `asset` methods with an optional
   `checkpointId`. The service materializes the version's source files into a private tree
   (L49's temp-index checkout) and renders from there. Sheets then flow through the existing
   `readSheet` RPC and GLBs through the existing signed URL, so the client's render pipeline
   barely changes.
4. **Restore and undo** of the whole set through a shared module that stages every file before
   replacing any, rolls back on failure and keeps one undo record.
5. **Compare** stays the existing method; the strip passes the version's checkpoint ref. The
   unscoped `revisions` list is replaced by this thread's turns plus the design's commits.

```
thread projection (checkpoints, runs)       workspace (live files)
        |                                            |
        v                                            v
history(design, cursor) --candidates (today's set)--> ls-tree per candidate --> PcbHistory
        |
render / asset (checkpointId)
        |-- versionDesign: ls-tree -r | update-index --index-info (temp index) | checkout-index
        |       -> <state>/fork/pcb-preview/history/trees/<key>/files/<repo path>
        |-- runRender / runAsset over a ResolvedDesign rooted in the tree (frozen snapshot)
        v
render cache (existing) --readSheet RPC--> SVG       GLB --signed URL--> Board3D

historyRestore(design, checkpointId, options, expectedContentKey, dryRun)
        |-- plan: version set vs live set (blob ids)
        |-- conflict check on today's content key
        |-- historyRestore.ts: back up, stage all, rename all, roll back on failure
        v
{ plan, undoId, written, removed }
```

Nothing runs per frame, nothing polls, and no version is materialized until someone opens it.

### Paths

Checkpoint `files` and `ls-tree --full-name` paths are repository-relative
(`apps/server/src/vcs/GitVcsDriver.ts:1214`). PCB design ids are relative to the thread's
workspace root, `realPath(thread.worktreePath ?? project.workspaceRoot)`
(`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:276-301`), which can be a subdirectory
of the repository. Convert with L49's cached `repoPrefix` (`git rev-parse --show-prefix`):
`repoPath = prefix + workspacePath`. Checkpoint refs are shared by all worktrees, so running Git
in the current root also finds refs captured before a worktree handoff.

## Shared history service (L49)

`PCB-FOLLOW-UPS.md` makes L49 the owner of "file versions from turn checkpoints, and restoring
one file". L66 uses the same files and only adds to them.

| File                                                                    | Owner            | L66 use                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/model-preview-3d/history.ts` (pure)               | L49              | `historyCandidates`, `contentKey`, `parseLsTree`, `isLfsPointer`, `UndoManifest`, the `HISTORY_*` limits. One additive change: `UndoManifest.entries[].restoredOid` becomes `Schema.NullOr(Schema.String)`, where null means "the restore removed this file". L49 always writes a string, so its records still decode. |
| `apps/server/src/fork/model-preview-3d/historyGit.ts`                   | L49              | `makeHistoryGit(runner)`: `repoPrefix`, `treeOids`, `lsTree`, `materialize`, `hashObjects`. One additive change: `lsTree(root, ref, paths, options?: { recursive?: boolean })` passes `-r` when set, so a directory pathspec lists the files under it.                                                                 |
| `apps/server/src/fork/model-preview-3d/historyRestore.ts` (new, shared) | L66, used by L49 | The byte-level restore and undo that L49 TECHNICAL.md describes inline in `historyRestore` steps 4 and 5 and `historyUndo`, generalized from one file to a list (below).                                                                                                                                               |

Order of landing:

- **L49 landed first.** Step 1 of IMPLEMENTATION.md moves L49's inline backup, copy-and-rename
  and undo code from `ModelPreviewService.ts` into `historyRestore.ts` without changing
  behavior, and `ModelPreviewService` calls it with a one-entry list. L49's tests must pass
  unchanged.
- **L66 lands first.** L66 creates `history.ts` and `historyGit.ts` exactly as L49's
  TECHNICAL.md defines them (Limits, Git plumbing, Tracked set and candidates), with the two
  additive changes above, plus `historyRestore.ts`. L49 then imports all three.

Importing from `model-preview-3d/` in `pcb-preview/` has precedent:
`PcbPreviewService.ts:31` imports `mintToken`, `verifyToken` and `resolveTokenPath` from
`../model-preview-3d/signedFiles.ts`.

If L49's `historyGit` fails with `ModelPreviewError`, the PCB service maps it at the call site
with `Effect.mapError` to `PcbPreviewError("io-failed", sameMessage)`; no change to L49.

### `historyRestore.ts`

```ts
export interface RestoreEntry {
  /** Workspace-relative destination. */
  readonly path: string;
  /** Absolute file in a materialized tree, or null to remove the destination. */
  readonly source: string | null;
  /** Git mode of the source: 0o100644 or 0o100755. Ignored for removals. */
  readonly mode: number;
  /** Blob id the destination will have after the restore; null for removals. */
  readonly oid: string | null;
}

export class HistoryRestoreError extends Schema.TaggedError<HistoryRestoreError>()(
  "HistoryRestoreError",
  {
    reason: Schema.Literals(["conflict", "not-found", "outside-root", "io"]),
    message: Schema.String,
  },
) {}

export const makeHistoryRestore = (options: {
  readonly undoDir: string; // real path, created by the caller
  readonly git: HistoryGit;
}) => ({
  restore: (input: {
    root: string;
    threadId: ThreadId;
    owner: string; // L49: the model path; L66: the design id
    entries: readonly RestoreEntry[];
  }) => Effect<{ undoId: string; written: string[]; removed: string[] }, HistoryRestoreError>,
  undo: (input: { root: string; owner: string; undoId: string }) =>
    Effect<void, HistoryRestoreError>,
  prune: () => Effect<void>, // newest HISTORY_UNDO_MAX, at most HISTORY_UNDO_TTL_MS
});
```

`restore`:

1. Resolve every destination with L49's containment rule (follow a symlink with
   `resolveSymlinkTarget`, `packages/shared/src/symlink.ts`, and require the target inside
   `root`). Any failure: `outside-root`, nothing touched.
2. Create `<undoDir>/<uuid>/`; copy each existing destination to `files/<n>` and write
   `manifest.json` (`UndoManifest`, `modelPath` = `owner`).
3. **Stage.** For each write entry, create missing parent directories and copy the source to a
   sibling `.<name>.loom-restore-<uuid>`, then apply the mode. If any copy fails, remove the
   staged files and the undo record and fail `io`. The workspace is unchanged.
4. **Commit.** Rename each staged file over its destination, then remove each removal entry.
   If a rename or removal fails, put back every entry already committed from its backup (or
   delete it when it had none) with the same stage-and-rename, remove the remaining staged
   files and the undo record, and fail `io` with "Restore stopped and the files were put back."
5. Return `{ undoId, written, removed }` and prune.

Renames are atomic per file, not across files. The window in which some files are new and some
old is the time between the first and the last rename, with all bytes already on the same
filesystem, so a file watcher or KiCad sees at most one intermediate save. That is the same
guarantee an agent's multi-file edit has.

`undo` checks `manifest.root` and `owner`, then `hashObjects` the entries: every entry with a
`restoredOid` must still have it and every removal must still be absent, else `conflict`. Then
it writes the backups back with the same stage and commit steps, deletes files whose backup is
null, and removes the record. A missing record is `not-found`.

## Design file sets

### `apps/server/src/fork/pcb-preview/designFiles.ts` (new, pure)

Moves the relevance and reference rules out of `sourceSnapshot`
(`PcbPreviewService.ts:557-596`) so live scans and versions use one definition:

```ts
/** File names the PCB tools read: today's regexes at PcbPreviewService.ts:557-564. */
export function isDesignSource(kind: PcbDesignKind, name: string): boolean;
/** Files whose text can reference other files: today's rule at :573-576. */
export function isReferenceSource(kind: PcbDesignKind, name: string): boolean;
/** Raw references in a source: today's regexes at :579-585. */
export function designReferences(kind: PcbDesignKind, text: string): string[];
/** Design-defining files; the rest of a set is supporting. */
export function isDesignFile(kind: PcbDesignKind, name: string): boolean;

export interface DesignSetIo {
  /** Workspace-relative paths; null when absent. Text only for reference sources. */
  readonly read: (path: string) => Effect.Effect<string | null>;
  /** Relevant files at or below a workspace-relative directory, recursive. */
  readonly list: (directory: string) => Effect.Effect<readonly string[]>;
  readonly exists: (path: string) => Effect.Effect<boolean>;
}

export const designSet: (input: {
  kind: PcbDesignKind;
  /** The design id (entry) and its group, see seeds below. */
  seeds: readonly string[];
  /** Expands ${KIPRJMOD}: the design's directory, workspace-relative. */
  projectDirectory: string;
  io: DesignSetIo;
}) => Effect.Effect<{ design: string[]; supporting: string[] }, DesignSetLimit>;
```

- `isDesignFile`: KiCad `.kicad_pro`, `.kicad_sch`, `.kicad_pcb`, `.kicad_dru`; tscircuit code
  files (`/\.(?:[cm]?[jt]sx?)$/`). Everything else reached (library tables, `.kicad_sym`,
  `.kicad_mod`, `.lib`, `.dcm`, `.wks`, JSON, images, 3D assets) is supporting.
- Seeds. KiCad: the entry plus `<stem>.kicad_pro`, `.kicad_sch`, `.kicad_pcb`, `.kicad_dru`,
  `sym-lib-table` and `fp-lib-table` in the design's directory, where `stem` is the entry's
  name without extension (the grouping rule in `apps/server/src/fork/pcb-preview/discovery.ts`).
  tscircuit: the entry plus `package.json` and `tscircuit.config.json` at the package root
  (`packageRoot`, `PcbPreviewService.ts:416-427`).
- Walk. Breadth first from the seeds that exist, depth at most 16. For each reference source,
  apply `designReferences`, expand `${KIPRJMOD}`, skip anything still containing `${`, resolve
  relative to the file, and drop paths outside the workspace or under an ignored directory
  (`PcbPreviewService.ts:168-182`). A reference that names a directory (a `.pretty`
  footprint library) adds the relevant files `list` returns for it. A tscircuit import without
  an extension tries `.tsx`, `.ts`, `.jsx`, `.js`, `.mjs`, `.cjs`, `.json`, then
  `/index.tsx`, `/index.ts`, `/index.js`, the first that exists wins.
- Limits: 2,000 files (`SOURCE_LIMIT`, `:184`), else `DesignSetLimit`.

The set is narrower than what `sourceSnapshot` scans. `sourceSnapshot` watches whole
directories, so another design in the same folder changes the live hash; that is fine for a
watch, but would list and restore the wrong files here.

`sourceSnapshot` keeps its behavior and only swaps its inline rules for the three helpers.

### Live set

`liveDesignSet(resolved)` runs `designSet` with an `io` over the workspace (`fs`, the
`smallSource` byte cap at `:1384-1395`) and caches the result in a `Map` keyed by
`resolved.workspaceKey + designId + sourceSnapshot(resolved).sourceHash`, capped at 200 entries
(drop the oldest). Listing and the restore conflict check use it.

## Contracts

### `packages/contracts/src/fork/pcb-workspace.ts`

Import beside `ThreadId` (`:4`):

```ts
import { CheckpointId, NonNegativeInt, PositiveInt, RunId, ThreadId } from "../baseSchemas.ts";
```

New schemas after `PcbRevisions` (`:178`), using the file's `text` and `list` helpers (`:5-8`):

```ts
export const PCB_HISTORY_PAGE_MAX = 50;

export const PcbHistoryInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  /** Exclusive upper bound on the turn number; omit or null for the newest page. */
  cursor: Schema.optional(Schema.NullOr(PositiveInt)),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: PCB_HISTORY_PAGE_MAX })),
  ),
});
export type PcbHistoryInput = typeof PcbHistoryInput.Type;

export const PcbHistoryVersion = Schema.Struct({
  checkpointId: CheckpointId,
  /** Null for the thread's starting state. */
  runId: Schema.NullOr(RunId),
  /** The chat's turn number (appRunOrdinal); 0 is the thread's start. */
  turn: NonNegativeInt,
  capturedAt: Schema.DateTimeUtc,
  /** The checkpoint ref. loom.pcb-preview.compare accepts it as from or to. */
  ref: text(200),
  /** Whether the design's entry file exists at this version. */
  present: Schema.Boolean,
  /** Whether the version has a board and a schematic, from ls-tree of the stem group. */
  views: Schema.Struct({ pcb: Schema.Boolean, schematic: Schema.Boolean }),
  /** Hash over path and blob id of today's design set at this version; null if absent. */
  contentKey: Schema.NullOr(Schema.String),
  /** Workspace-relative paths of today's set that this turn changed. Empty for the start. */
  changed: list(Schema.String, 20),
});
export type PcbHistoryVersion = typeof PcbHistoryVersion.Type;

export const PcbHistory = Schema.Struct({
  /** Newest first. The start, when listed, is last on the final page. */
  versions: list(PcbHistoryVersion, PCB_HISTORY_PAGE_MAX),
  nextCursor: Schema.NullOr(PositiveInt),
  /** The thread's latest ready turn number, for "turn 5 of 9". */
  latestTurn: Schema.NullOr(PositiveInt),
  current: Schema.Struct({ contentKey: Schema.NullOr(Schema.String) }),
  /** True while a run of the thread is not terminal. */
  threadRunning: Schema.Boolean,
  /** Why there can be no history; null when history is available. */
  unavailable: Schema.NullOr(Schema.Literals(["not-git"])),
});
export type PcbHistory = typeof PcbHistory.Type;

export const PcbHistoryRestoreInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  checkpointId: CheckpointId,
  /** Also write supporting files (libraries, tables, assets) that differ. */
  includeSupporting: Schema.Boolean,
  /** Also delete design files that exist today but not at the version. */
  removeAdded: Schema.Boolean,
  /** current.contentKey from the history the client showed. */
  expectedContentKey: Schema.NullOr(Schema.String),
  /** Return the plan without writing. */
  dryRun: Schema.optional(Schema.Boolean),
});
export type PcbHistoryRestoreInput = typeof PcbHistoryRestoreInput.Type;

export const PcbHistoryRestorePlan = Schema.Struct({
  /** Design files that differ from today, written by every restore. */
  design: list(Schema.String, 2000),
  /** Supporting files that differ; written only with includeSupporting. */
  supporting: list(Schema.String, 2000),
  /** Design files today that the version does not have; removed only with removeAdded. */
  added: list(Schema.String, 2000),
  /** KiCad lock files (~name.ext.lck) found beside design files. */
  editorLocks: list(Schema.String, 50),
});
export type PcbHistoryRestorePlan = typeof PcbHistoryRestorePlan.Type;

export const PcbHistoryRestoreResult = Schema.Struct({
  plan: PcbHistoryRestorePlan,
  /** Null for dry runs and when nothing differed. */
  undoId: Schema.NullOr(Schema.String),
  written: list(Schema.String, 4000),
  removed: list(Schema.String, 2000),
});
export type PcbHistoryRestoreResult = typeof PcbHistoryRestoreResult.Type;

export const PcbHistoryUndoInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  undoId: text(100),
});
export type PcbHistoryUndoInput = typeof PcbHistoryUndoInput.Type;
```

`PcbAssetInput` (`:137-143`) gains, with the same field on `PcbRenderInput`:

```ts
  /** Render or export the design as it was at this checkpoint of the thread. */
  checkpointId: Schema.optional(CheckpointId),
```

Optional, so older clients and agents decode unchanged. No `PcbWorkspace` field is added, so
the decoding-default rule in `PCB-FOLLOW-UPS.md` does not apply.

`PcbEditorAction` (`:300-346`): add `"turn-history"` and `"turn-compare"` to the action
literals. They reuse existing optional fields, as L49's model actions do:

- `turn-history`: `enabled` shows or hides the strip; `name` is a checkpoint id to view, or
  `"current"` to return to Now.
- `turn-compare`: `name` is a checkpoint id, or `"current"` for the working tree, to compare
  against the version being viewed (or against Now when nothing is viewed).

`PcbEditorResult.state` (`:359-378`) gains an optional field, so older clients decode:

```ts
      turnHistory: Schema.optional(
        Schema.Struct({
          open: Schema.Boolean,
          viewing: Schema.NullOr(CheckpointId),
          viewingTurn: Schema.NullOr(NonNegativeInt),
          latestTurn: Schema.NullOr(PositiveInt),
        }),
      ),
```

### `packages/contracts/src/fork/pcb-preview.ts`

Add `CheckpointId` to the `../baseSchemas.ts` import (`:7-13`). Add to
`PCB_PREVIEW_WS_METHODS` (`:15-43`) in the second group:

```ts
  history: "loom.pcb-preview.history",
  historyRestore: "loom.pcb-preview.historyRestore",
  historyUndo: "loom.pcb-preview.historyUndo",
```

`checkpointId` on `PcbRenderInput` (`:93-100`) as above. Add `"version-not-found"` to
`PcbPreviewError.reason` (`:191-209`), after `"render-not-found"`:

```ts
    "version-not-found", // checkpoint gone, from another thread, or the design absent there
```

RPCs in `PcbPreviewRpcGroup`, in the existing `Rpc.make` style with `errors`:

```ts
  Rpc.make(PCB_PREVIEW_WS_METHODS.history, {
    payload: W.PcbHistoryInput,
    success: W.PcbHistory,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.historyRestore, {
    payload: W.PcbHistoryRestoreInput,
    success: W.PcbHistoryRestoreResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.historyUndo, {
    payload: W.PcbHistoryUndoInput,
    success: Schema.Void,
    error: errors,
  }),
```

Three methods, not L49's five: a version renders through the existing `render` and `asset`
methods, whose jobs are already shared and interrupted when the client unsubscribes
(`makeSharedJobs`, `PcbPreviewService.ts:225-226`), so no `historyVersion` or `historyCancel`.

### Authorization

`apps/server/src/fork/rpcAuthorization.ts:22-46` (exhaustive, checked by
`rpcAuthorization.test.ts`):

```ts
  [P.history]: AuthOrchestrationReadScope,
  [P.historyRestore]: AuthOrchestrationOperateScope,
  [P.historyUndo]: AuthOrchestrationOperateScope,
```

`history` runs Git read commands only, like `revisions` (`:28`). Restore and undo write design
files like `applyParameters` (`:30`). A dry run is operate too: the panel only asks for the plan
while showing the restore dialog, which needs the grant anyway. Rendering a version stays
`render` and `asset` (terminal operate). Add `historyRestore` and `historyUndo` to
`packages/contracts/src/fork/clientRpcPermissions.ts:11-23` so the UI reads their
`permissionAtom`.

## Server

### Files

| File                                                          | Contents                                                                                                                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/pcb-preview/designFiles.ts` (new, pure) | Rules and `designSet`, above.                                                                                                                                                      |
| `apps/server/src/fork/pcb-preview/history.ts` (new)           | `makePcbHistory(deps)`: `history`, `versionDesign`, `restore`, `undo`, `scopedRevisions`, `pruneTrees`. Effect functions; the service passes its helpers in.                       |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`       | Call sites only: build `makePcbHistory` in `make`; `render`, `asset` and `runRender` honor `checkpointId`; `revisions` delegates; three new service methods; `prune` covers trees. |
| `apps/server/src/fork/pcb-preview/rpc.ts`, `mcp.ts`           | Handlers and tools.                                                                                                                                                                |

New server work lives beside the service, as `PCB-FOLLOW-UPS.md` asks for the 2,600-line file.

### Limits (`history.ts`)

```ts
export const PCB_HISTORY_TRACKED_MAX = 2000; // matches SOURCE_LIMIT
export const PCB_HISTORY_TREE_BYTES = 256 * 1024 * 1024; // per version, by ls-tree sizes
export const PCB_HISTORY_TREES_MAX = 40;
export const PCB_HISTORY_TREES_BYTES = 1024 * 1024 * 1024;
export const PCB_HISTORY_REFERENCE_ROUNDS = 16;
```

Page size, `ls-tree` concurrency, undo count and TTL come from L49's `history.ts`.

### Listing: `history(input)`

1. `resolveDesign(input)` (`:500-516`). `repoPrefix(root)`; null returns
   `{ versions: [], nextCursor: null, latestTurn: null, current: { contentKey: null },
threadRunning, unavailable: "not-git" }`.
2. `threads.getThreadRecords(threadId, ["checkpoints", "checkpointScopes", "runs"])`
   (`apps/server/src/orchestration-v2/ProjectionStore.ts:364`); the service already holds
   `ProjectionStoreV2` as `threads` (`PcbPreviewService.ts:199`). `threadRunning` uses
   `isTerminalRunStatus` (`apps/server/src/orchestration-v2/ThreadManagementService.ts:399`).
3. `tracked` = `liveDesignSet` (design and supporting) as repository paths.
4. `historyCandidates(checkpoints, scopes, tracked, cursor, limit ?? HISTORY_PAGE_DEFAULT)`
   from L49: ready root turn checkpoints touching `tracked`, newest first, the start appended
   on the last page.
5. Per candidate at `HISTORY_LS_TREE_CONCURRENCY`: `lsTree(root, ref, dirs, { recursive: true })`
   where `dirs` are the distinct parent directories of `tracked` (one or a few for a KiCad
   project), then keep the tracked paths. Two thousand paths as arguments would hit L49's
   200-path batching ten times per turn; directories keep it to one call. If the output is
   truncated, fall back to L49's 200-path batches. Cache by `treeOid + "\0" + trackedHash` in an
   LRU of 500, as L49 does, because rollback can reuse a ref name.
6. `present`: the entry's repository path is in the result. `views`: whether
   `<stem>.kicad_pcb` and `<stem>.kicad_sch` are present (tscircuit: both true when present).
   `contentKey`: L49's `contentKey` over the kept entries, null when absent. `ref`: the row's
   ref. `changed`: the row's `files` in `tracked`, as workspace paths, first 20.
7. `current.contentKey`: `hashObjects` over the tracked paths that exist, keyed the same way.

A ref that no longer resolves is dropped from the page.

### Materializing a version: `versionDesign(input)`

Input: `{ threadId, designId, checkpointId }`. Output: a `ResolvedDesign` (`:517`) rooted in the
tree and a frozen snapshot.

1. `resolveDesign` for the live design (the design must exist today). Prefix; not Git:
   `version-not-found` "History needs a Git workspace."
2. The checkpoint row from `getThreadRecords(threadId, ["checkpoints", "checkpointScopes"])`:
   same thread, `ready`, a root turn or the ordinal-0 start, else `version-not-found` "This
   version is no longer available. The thread was rolled back." `treeOids` for its ref, same
   error when it no longer resolves.
3. Tree key `hashKey("pcb-history-v1", root, treeOid, designId)` (`cache.ts`), directory
   `<historyDir>/trees/<key>/`, files under `files/` mirroring repository paths. `historyDir`
   is `realPath(<stateDir>/fork/pcb-preview/history)`, created in `make` like `cacheDir`
   (`:215-220`). A tree with a `complete` marker is reused (touch its mtime).
4. Otherwise materialize into `<key>.pending-<uuid>/`:
   - **Source set.** `lsTree(ref, [cwdRepoPath], { recursive: true })`, keep
     `isDesignSource` names outside ignored, `-backups` and `~` paths (the rules of
     `sourceSnapshot`, `:540-565`). This mirrors what the live render stages: KiCad scans the
     design's folder, tscircuit its package root.
   - The entry must be present, else `version-not-found` "main did not exist after turn 3."
   - **References.** Up to `PCB_HISTORY_REFERENCE_ROUNDS`: `materialize` the entries known so
     far, read newly written reference sources (at most `MAX_SVG_BYTES`, as live), resolve
     their references against the tree with `designReferences`, and `lsTree` (recursive) the
     directories they name that are not yet listed.
   - Limits: more than `PCB_HISTORY_TRACKED_MAX` files or `PCB_HISTORY_TREE_BYTES` by ls-tree
     sizes fails `source-limit` "This version uses more than 2,000 files or 256 MB; it cannot be
     previewed."
   - LFS: if the entry, board or root schematic is an L49 `isLfsPointer`, fail `io-failed`
     "This version is stored in Git LFS and cannot be previewed here."
   - tscircuit: when the live package root has `node_modules`, create a symlink to it at the
     tree's package root, as `temporaryCircuitCwd` links it for live renders (`:1496-1512`).
     Old versions build with today's installed packages; the comment says so.
   - Write `meta.json` (`{ treeOid, bytes, createdAt }`) and `complete`, rename to `<key>/`.
5. Build the resolved version: `root` = `<treeFiles>/<prefix>` (real path), the live
   `projectId` and `workspaceKey` (so `readSheet`'s owner check at `:1027-1033` accepts the
   render), `design` = the live design with `boardPath` or `schematicPath` removed when the
   version lacks them, `absolute` and `cwd` mapped into the tree.
6. Snapshot: `sourceSnapshot(resolvedVersion)` for `dirs`, with `sourceHash` replaced by
   `hashKey("pcb-history-v1", contentKey(source set entries))`. Equal content at two turns then
   shares render cache entries even though the trees differ.
7. Mark the tree protected (a `Set` of keys in use) until the caller's scope closes.

### Rendering a version

- `render(input)` (`:977-996`): when `input.checkpointId` is set, use `versionDesign` instead
  of `resolveDesign` plus `sourceSnapshot`, and pass `{ frozen: true }` to `runRender`. The job
  key already includes the snapshot hash.
- `runRender(input, resolved, snapshot, options = { frozen: false })` (`:704`): when frozen,
  skip the re-snapshot check at `:892-897`, which exists to catch live edits. Replace the
  `asset({...})` call at `:835-846` with `assetFor({ ...circuit-json input }, resolved,
snapshot, options)` so tscircuit builds from the same tree. For live renders `assetFor`
  computes the same job key as `asset` does today, so behavior is unchanged.
- `asset(input)` (`:1775-1787`) becomes `resolve` (live or `versionDesign`) plus
  `assetFor(input, resolved, snapshot, options)`; `runAsset` (`:1560`) skips its re-snapshot
  conflict check (`:1735-1739`) when frozen.
- A view the version lacks fails `unsupported-view` "This version has no board yet." or "This
  version has no schematic yet." (today's check at `:713-716` with new copy when versioned).

KiCad renders from the tree with `cwd` in the tree, so `${KIPRJMOD}` and project library tables
resolve to the version's libraries. Global libraries and 3D component models come from the
host as they do live; the version's 3D board therefore uses today's component bodies.

### `revisions(input)` (the defect)

Replace `PcbPreviewService.ts:1918-1924`, which lists the 40 newest refs under `refs/t3/` in the
whole repository (every thread, every worktree, legacy `refs/t3/checkpoints`), unfiltered by
design and labelled with the commit subject "t3 checkpoint ref=..."
(`apps/server/src/vcs/GitVcsDriver.ts:1051`). The new list:

1. `scopedRevisions`: the first `history` page with `limit: 40`, mapped to
   `{ ref: version.ref, label: version.runId ? \`Turn ${turn}\` : "Start" }`, skipping absent
   versions. Not Git: empty.
2. Then the existing `git log` commits (`:1909-1917`), widened to every path of today's design
   set (passed as directories, as in listing), labelled as today.
3. Slice to 80 (`PcbRevisions` allows 100).

`compare` itself is unchanged. It accepts any ref that resolves to a commit (`:1938-1945`), so
older refs typed by hand keep working.

### `historyRestore(input, options = { checkContent: true })`

Under `storageLock` (`:1228`), the lock `applyParameters` already takes for design writes
(`:2221`).

1. `versionDesign` (reusing a complete tree). Refuse when absent or LFS.
2. `versionSet` = `designSet` over the tree; `liveSet` = `liveDesignSet`.
3. Plan, all workspace-relative and inside the root:
   - `design`: `versionSet.design` paths whose blob id (from ls-tree) differs from
     `hashObjects` of the live file, or whose live file is missing.
   - `supporting`: the same for `versionSet.supporting`.
   - `added`: `liveSet.design` paths not in `versionSet.design` and not in
     `versionSet.supporting`.
   - `editorLocks`: for each path in `design`, `~<name>.lck` beside it, when it exists. KiCad
     writes these while a file is open (REFERENCES.md).
4. `dryRun`: return `{ plan, undoId: null, written: [], removed: [] }`.
5. Conflict, unless `checkContent` is false: today's content key over the live tracked set
   must equal `expectedContentKey`, else `conflict` "main changed since you opened history.
   Check the latest version, then try again."
6. Entries: `plan.design`, plus `plan.supporting` with `includeSupporting`, as writes from the
   tree with their ls-tree mode and oid; plus `plan.added` as removals with `removeAdded`.
   Empty: return the plan with `undoId: null`.
7. `historyRestore.restore({ root, threadId, owner: designId, entries })`; map its errors to
   `PcbPreviewError` (`conflict`, `version-not-found`, `path-outside-workspace`, `io-failed`).
8. L24's watch reports the new source hash and the panel returns to Now.

The restore is an ordinary workspace edit: the next turn's checkpoint includes it, and the
thread projection is untouched.

### `historyUndo(input)`

Under `storageLock`: `historyRestore.undo({ root, owner: designId, undoId })`, errors mapped
as above with the copy "main changed after the restore, so Undo would overwrite newer work."
and "This restore can no longer be undone."

### Errors

| Situation                                      | Reason              | Message                                                                      |
| ---------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| Not a Git workspace (version, restore)         | `version-not-found` | "History needs a Git workspace."                                             |
| Ref gone, checkpoint stale or another thread's | `version-not-found` | "This version is no longer available. The thread was rolled back."           |
| Design absent at the version                   | `version-not-found` | "main did not exist after turn 3."                                           |
| View absent at the version                     | `unsupported-view`  | "This version has no board yet."                                             |
| Over limits                                    | `source-limit`      | "This version uses more than 2,000 files or 256 MB; it cannot be previewed." |
| LFS pointer                                    | `io-failed`         | "This version is stored in Git LFS and cannot be previewed here."            |
| Git failed or timed out                        | `io-failed`         | "Git could not read this version."                                           |
| Content changed                                | `conflict`          | See restore and undo.                                                        |
| Partial write                                  | `io-failed`         | "Restore stopped and the files were put back. <cause>"                       |

## Storage

| Path under `<stateDir>/fork/pcb-preview/`      | Contents                                                      | Lifetime                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `history/trees/<key>/files/...`                | Materialized version source files mirroring repository paths. | At most 40 trees and 1 GiB via `pickPruneVictims` (`cache.ts`) on `meta.json` sizes and directory mtimes; protected trees and `*.pending-*` skipped. `prune(true)` at startup (`:621-667`) removes pending trees older than an hour. |
| `history/trees/<key>/meta.json`, `complete`    | Tree id, bytes, marker.                                       | With the tree.                                                                                                                                                                                                                       |
| `history/undo/<id>/manifest.json`, `files/<n>` | Undo records.                                                 | Newest 20, at most seven days; pruned after each restore and at startup.                                                                                                                                                             |
| `cache/<renderKey>/`                           | Renders of versions in the existing render cache.             | Existing limits (100 entries, 200 MiB).                                                                                                                                                                                              |

No database table, no migration, no workspace field.

## Clients

### Atoms (`packages/client-runtime/src/fork/pcb-preview.ts`)

```ts
    history: createEnvironmentRpcCommand(runtime, { label: "loom:pcb-history", tag: M.history }),
    historyRestore: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-history-restore",
      tag: M.historyRestore,
    }),
    historyUndo: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-history-undo",
      tag: M.historyUndo,
    }),
```

Commands, not a query family, for L49's reason: pages load on demand with explicit refresh
triggers. `render` and `asset` already accept the new optional input field.

### Pure helpers (`apps/web/src/fork/pcb-preview/history.ts`)

The same shapes as L49's `apps/web/src/fork/model-preview-3d/history.ts`, typed for
`PcbHistory`: `historyChips(pages)` (oldest first, folding equal `contentKey`, Now `matches`),
`stepChip(chips, current, direction)`, `viewingLabel(turn, latestTurn)` and
`chipLabel(version)` ("Turn 3 (not created yet)" for absent versions instead of L49's
"(deleted)", since a design's early turns usually predate it). The functions are small; copy
rather than import across panels, so neither panel's UI depends on the other's.

### `usePcbHistory.ts`

The shape of L49's `useModelHistory`: fetches the first page when the strip opens or a version
is shown; refreshes it when the design's `sourceHash` from `pcb.watch` changes or when the
signature of ready root checkpoint ids from `useThreadProjection(threadRef)?.projection
.checkpoints` (`apps/web/src/state/entities.ts:126`) changes; a request counter drops late
replies; `loadEarlier()` and `refresh()`.

### Viewing a version

- `usePcbPreview` (`apps/web/src/fork/pcb-preview/usePcbPreview.ts`) gains an optional
  `checkpointId` argument. It goes into the render input and the `requestKey`, and while it is
  set the watch's `sourceHash` is not part of the key, so live saves do not re-render an old
  version. `readSheet` needs no change: the render key identifies the version's sheets.
- `Board3D` (`Board3D.tsx:55-63`) gains an optional `checkpointId` prop passed to
  `pcb.asset`.
- `DesignWorkspace` (`PcbPreviewPanel.tsx:98`) holds `historyOpen`,
  `viewing: { checkpointId, ref, turn } | null`, `restoreTarget` and
  `undo: { undoId, label } | null`, and passes `viewing?.checkpointId` to both. One
  `usePcbPreview` stays mounted and only its input changes, so the render atom for the previous
  version unmounts and its shared job is interrupted when `[` is pressed again. Going back to
  Now hits the render cache.
- Read-only while viewing: `canMark` (`:188`) also requires `!viewing`, which disables the
  tool shelf (`:962-979`) and notes; capture and export are disabled in the document bar
  (`:1076-1092`); Inspect, Checks, Simulate and Parameters render the notice "These tools work
  on the current version." instead of their body; Views can load but not save; the Compare tab
  stays usable.
- Status bar (`:1320`): the state item reads `viewingLabel(...)` with a "Back to current"
  status chip while viewing; check chips are hidden.

### `HistoryStrip.tsx`

As L49's strip: rendered between the body and the status bar (`:1319-1320`) while open; one
row, fixed height, native horizontal scroll; "Earlier", chips, "Now"; `components/ui` `Button`
with `size="xs"`, `variant="ghost"` and `"secondary"` for the selected chip; tooltips with the
time and `changed`; `aria-label="Design history"` and a `role="listbox"` of chips with
`aria-selected`; scroll the selected chip into view only when the selection changes. Right
side: "Compare", "Restore this version..." (viewing a present version and the restore
`permissionAtom` allows it) and close. No coloured edges or stripes.

### Compare

"Compare" in the strip opens the Compare tab with `from = viewing.ref` and `to = ""` (the
working tree) and starts it. `RevisionCompare` (`RevisionCompare.tsx`) gains an optional
`initial?: { from: string; to: string; key: string }` prop: when `key` changes, it sets From and
To (`:61-62`) and runs the comparison once. The datalist and "Recent" chips (`:141-166`) show
the new labels without other changes.

### Restore dialog and Undo

`RestoreDesignDialog.tsx` uses the existing `Dialog` components. On open it calls
`historyRestore` with `dryRun: true` and shows the plan: the design files, then the two
checkboxes with their listed paths when `supporting` or `added` is non-empty, the KiCad warning
when `editorLocks` is non-empty and the running-agent warning when `threadRunning`. Confirm
sends the same input without `dryRun` and with `expectedContentKey = history.current
.contentKey`. Success clears `viewing` and shows "Restored main from turn 5." with "Undo" in
the panel's notice area (`notice` state, `:120-154`; the undo notice does not auto-clear).
`conflict` refreshes history and shows the message.

### Keys, toolbar, palette and shortcut list

- Key handler (`PcbPreviewPanel.tsx:1041-1064`): `t` toggles the strip. `[` and `]` open the
  strip if closed and step with `stepChip`. Handle the brackets before the modifier early return
  at `:1042-1051`, requiring only `!event.metaKey && !event.ctrlKey`, because several layouts
  type brackets with Option (L49's rule). Each key is one `else if`, as `PCB-FOLLOW-UPS.md`
  asks.
- Toolbar: a History `ToolButton` (`HistoryIcon` from lucide-react) in `docActions`
  (`:1072`), `aria-pressed={historyOpen}`, hint "History (T)".
- `SHORTCUTS` in `WorkspaceChrome.tsx:252-261`: add `["History", "T"]` and
  `["Previous or next version", "[ / ]"]`.
- Palette (`apps/web/src/fork/pcb-preview/palette.tsx`): "PCB: Toggle history", "PCB: Previous
  version", "PCB: Next version", listed only while the panel is open (the existing `open` check).
  They call `dispatchPcbAction(ref, "history" | "history-previous" | "history-next")` from
  `apps/web/src/fork/pcb-preview/actions.ts`, which `DesignWorkspace` subscribes to. If another
  PCB packet has created `actions.ts`, add the three literals; otherwise create it in the shape
  of `apps/web/src/fork/model-preview-3d/actions.ts`.

### Editor command

In `handleEditorRequest` (`PcbPreviewPanel.tsx:371`), handle `turn-history` and `turn-compare`
as in Contracts, and add `turnHistory` to the `snapshot` state (`:545-569`) when the strip is
open or a version is shown. An unknown checkpoint id fails with "Turn not found. List versions
with loom_pcb_history." `turn-compare` opens the Compare tab as the strip button does.

## Agent-facing tools

Add to `PcbToolkit` (`apps/server/src/fork/pcb-preview/mcp.ts:13`), with handlers in the
existing pattern (`McpToolAccess.readsAsCaller` or `actsAsCaller`, `withForkRuntime`, the
`thread` helper at `:259-267`):

```ts
  Tool.make("loom_pcb_history", {
    description:
      "List the thread's turns that changed a PCB design's files, newest first. Each version has a checkpointId for loom_pcb_render, loom_pcb_asset, loom_pcb_restore_version and the editor's turn-history action, and a ref for loom_pcb_compare.",
    parameters: Schema.Struct({
      ...design,
      cursor: W.PcbHistoryInput.fields.cursor,
      limit: W.PcbHistoryInput.fields.limit,
    }),
    success: W.PcbHistory,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "List PCB design history")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pcb_restore_version", {
    description:
      "Restore a PCB design's files from an earlier turn as one workspace write, preview the files a restore would touch, or undo a restore. plan and restore need checkpointId; undo needs the undoId restore returned. includeSupporting also writes libraries and assets; removeAdded deletes design files added since. Pass expectedContentKey (history.current.contentKey) to refuse if the files changed meanwhile.",
    parameters: Schema.Struct({
      ...design,
      action: Schema.Literals(["plan", "restore", "undo"]),
      checkpointId: Schema.optional(CheckpointId),
      undoId: Schema.optional(Schema.String),
      includeSupporting: Schema.optional(Schema.Boolean),
      removeAdded: Schema.optional(Schema.Boolean),
      expectedContentKey: Schema.optional(Schema.NullOr(Schema.String)),
    }),
    success: Schema.Struct({
      plan: Schema.NullOr(W.PcbHistoryRestorePlan),
      undoId: Schema.NullOr(Schema.String),
      written: Schema.Array(Schema.String),
      removed: Schema.Array(Schema.String),
      message: Schema.String,
    }),
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Restore PCB design version")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
```

- `loom_pcb_history`: `readsAsCaller`, calls `service.history`.
- `loom_pcb_restore_version`: `actsAsCaller`. `plan` calls `historyRestore` with `dryRun`;
  `restore` calls it with `expectedContentKey` when given and otherwise with
  `{ checkContent: false }` (an agent cannot show a dialog, as in L49); `undo` calls
  `historyUndo`. A missing `checkpointId` or `undoId` fails `invalid-parameters`. Defaults:
  `includeSupporting` and `removeAdded` false.
- `loom_pcb_render` (`:81-93`) and `loom_pcb_asset` (`:156-168`) gain
  `checkpointId: W.PcbAssetInput.fields.checkpointId` and the sentence "Pass checkpointId from
  loom_pcb_history to build an earlier version." Their handlers already forward the struct.
  `loom_pcb_read_sheet` needs nothing: it takes the render key.
- `loom_pcb_revisions` (`:172-181`) description: "List this thread's turns that changed the
  design and the design's recent Git commits, for loom_pcb_compare."
- `loom_pcb_editor` description (`:25-35`) gains: "turn-history shows the design's turn history
  or a version (name = checkpoint id or current); turn-compare compares the shown version with
  another (name = checkpoint id or current)."

`t3 pcb history '{...}'` and `t3 pcb restore_version '{...}'` work through the existing mapping
in `apps/server/src/fork/pcb-preview/cli.ts`.

## Performance

- Nothing runs until the strip opens, a key is pressed or a tool is called. The strip is static
  DOM: no animation, timers or polling. Refreshes come from the existing watch and the thread
  projection the client already receives.
- Listing per page: one projection read, one cached live set, one batched `rev-parse`, and up
  to 30 recursive `ls-tree` calls over one or a few directories at concurrency 4, cached by tree
  id. No blob content is read. Payload about 30 x 500 bytes.
- Viewing: Git writes only the design's source files (2,000 files, 256 MiB caps), reused by
  tree id. Renders go through the existing render jobs and cache, and a newer `[` press
  interrupts the older render because the atom input changes.
- Remote: SVG travels as today; GLBs by signed URL; nothing large is added to the WebSocket.

## Alternatives considered

- **A `historyVersion` method like L49's.** The PCB render already returns sheets by render key
  and is cancellable through shared jobs; a parallel method would duplicate it.
- **`git show ref:path` per file, as `compare` does (`:1948-1951`).** Fine for diffs, but
  rendering needs the whole project on disk with sheets and libraries beside it, and binary
  assets exceed the 16 MiB `git` output cap (`:1860-1881`). L49's temp-index checkout writes the
  set once and applies Git attributes.
- **Tracking `sourceSnapshot`'s directory scan.** Simpler, but turns that only changed a
  neighbouring design would be listed, and restore would overwrite that design.
- **Restoring with `git checkout <ref> -- <paths>`.** Touches the index and stages changes; a
  plain write is what an agent's edit is.
- **One-file restores in a loop.** A failure halfway leaves a project whose sheets disagree with
  its board. Stage-then-rename with rollback avoids that.
- **Keeping the unscoped refs list.** Other threads' refs have meaningless labels and numbering.
- **Upstream thread rollback.** Rolls back every file and the conversation.

## Defects noticed in the current code

- `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1918-1924`: `revisions` lists every
  `refs/t3/` ref in the repository (all threads and worktrees, legacy refs), not filtered by
  the design, labelled with "t3 checkpoint ref=..." subjects. Fixed here.
- `PcbPreviewService.ts:1909-1917`: the commit list only follows the entry, board and root
  schematic, so commits that changed only a sub-sheet or project library are missing. Fixed
  here by passing the design set.
- `PcbPreviewService.ts:835-846`: `runRender` builds tscircuit Circuit JSON through `asset()`,
  which re-resolves the live design instead of using the `resolved` it was given. Harmless today,
  but it blocks rendering any other source tree. Fixed here with `assetFor`.
- `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx:1046`: the `event.altKey` early return
  blocks any panel key typed with Option. L66 handles `[` and `]` before it.
