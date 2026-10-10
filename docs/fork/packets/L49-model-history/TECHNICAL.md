# L49 technical design

## Overview

Every root turn in a Git workspace ends with a checkpoint: a hidden commit under
`refs/t3/orchestration-v2/checkpoints/<scope key>/ordinal/<n>`
(`apps/server/src/orchestration-v2/CheckpointService.ts:26`, `:161-172`) whose projection row
lists the files the turn's own work touched (`CheckpointService.ts:443-486`). Before the first
turn the thread also has a baseline checkpoint at ordinal 0 with no run
(`apps/server/src/orchestration-v2/CheckpointCaptureService.ts:107-123`,
`CheckpointService.ts:333-345`). Those refs are the whole history source. L49 adds:

1. A **listing** method that picks the checkpoints whose `files` touch the model or a file the
   model reads today, and gives each a content key from `git ls-tree`. No file content is read.
2. A **version** method that materializes one version's files from Git into a private tree
   under the server's state directory (the model plus its SCAD closure at that version), renders
   SCAD there with OpenSCAD, and returns a signed URL for the mesh.
3. **Restore** and **undo** methods that copy files from a materialized tree into the
   workspace with a content check, keeping a server-side undo record.
4. A server-side link from accepted annotations to the turn that resolved them.
5. The strip, compare ghost and restore dialog in the panel, and agent tools over the same
   service methods.

```
thread projection (checkpoints, runs)          workspace (live files)
        |                                               |
        v                                               v
history(file, cursor) --candidates--> git ls-tree per candidate --> ModelHistory (page)
        |
historyVersion(file, checkpointId)
        |-- git ls-tree | update-index --index-info (temp index) | checkout-index --prefix
        |       -> <state>/fork/model-preview-3d/history/trees/<key>/files/<repo path>
        |-- SCAD: runRender(snapshot mode) -> renders/<hash>.stl|3mf -> sign(cacheDir)
        |-- mesh: sign(<tree>/files, model)
        v
SignedFile --HTTP--> /api/loom/model-preview-3d/f/<token>/<name>  (existing route)

historyRestore(file, checkpointId, includeDependencies, expectedContentKey)
        |-- hash-object current files == expectedContentKey ? else "conflict"
        |-- back up current bytes -> history/undo/<id>/
        |-- copy tree file -> sibling temp -> rename over the workspace file
        v
{ undoId, restored }
```

Nothing watches the filesystem beyond L23's existing watch, nothing runs per frame, and no
version is loaded until the user or agent asks for it.

### Paths

Checkpoint `files` and `git ls-tree --full-name` paths are relative to the repository top
(`apps/server/src/vcs/GitVcsDriver.ts:1214`). `ModelFileRef.path` is relative to the thread's
workspace root, `realPath(thread.worktreePath ?? project.workspaceRoot)`
(`apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:142-167`), which can be a
subdirectory of the repository. The service reads the prefix once per root with
`git rev-parse --show-prefix` (prints `sub/`, or an empty line at the top) and converts with
`repoPath = prefix + workspacePath`. Checkpoint refs are shared by all worktrees of a repository
(they are not under `refs/worktree/`), so running Git in the current root also finds refs
captured before a worktree handoff. If L41 has landed, reuse its cached `repoPrefix` helper;
otherwise add it as L41's TECHNICAL.md describes (a `Map<string, string | null>`, `null` for
"not a Git repository").

## Contracts

### `packages/contracts/src/fork/model-preview-3d.ts`

Import beside `ThreadId` (`:7`):

```ts
import { CheckpointId, NonNegativeInt, PositiveInt, RunId, ThreadId } from "../baseSchemas.ts";
```

Add `"conflict"` to `ModelPreviewError.reason` (`:267-276`), after `"command-failed"`:

```ts
      "conflict", // the workspace file changed since the client last read it
```

New schemas, placed after `ScadRenderResult` (`:117-139`):

```ts
export const MODEL_HISTORY_PAGE_MAX = 50;

export const ModelHistoryInput = Schema.Struct({
  file: ModelFileRef,
  /** Exclusive upper bound on the turn number; omit or null for the newest page. */
  cursor: Schema.optional(Schema.NullOr(PositiveInt)),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MODEL_HISTORY_PAGE_MAX })),
  ),
});

export const ModelHistoryVersion = Schema.Struct({
  checkpointId: CheckpointId,
  /** Null for the thread's starting state. */
  runId: Schema.NullOr(RunId),
  /** The chat's turn number (appRunOrdinal); 0 is the thread's start. */
  turn: NonNegativeInt,
  capturedAt: Schema.DateTimeUtc,
  /** Whether the model file exists at this version. */
  present: Schema.Boolean,
  /** Hash of path and blob id for the model and the files it reads today; null if absent. */
  contentKey: Schema.NullOr(Schema.String),
  /** Model file size at this version, from git ls-tree. */
  sizeBytes: Schema.NullOr(NonNegativeInt),
  /** Workspace-relative tracked paths this turn changed. Empty for the start. */
  changed: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
  /** Ids of annotations whose resolvedIn names this checkpoint. */
  resolvedAnnotations: Schema.Array(Schema.String).check(Schema.isMaxLength(30)),
});

export const ModelHistory = Schema.Struct({
  /** Newest first. The start, when listed, is last on the final page. */
  versions: Schema.Array(ModelHistoryVersion).check(Schema.isMaxLength(MODEL_HISTORY_PAGE_MAX)),
  /** Pass as cursor for the next older page; null when there is none. */
  nextCursor: Schema.NullOr(PositiveInt),
  /** The thread's latest ready turn number, for "turn 4 of 9". */
  latestTurn: Schema.NullOr(PositiveInt),
  current: Schema.Struct({
    present: Schema.Boolean,
    contentKey: Schema.NullOr(Schema.String),
  }),
  /** True while a run of the thread is not terminal. */
  threadRunning: Schema.Boolean,
  /** Why there can be no history; null when history is available. */
  unavailable: Schema.NullOr(Schema.Literals(["not-git"])),
});

export const ModelHistoryVersionInput = Schema.Struct({
  file: ModelFileRef,
  checkpointId: CheckpointId,
  allowLarge: Schema.optional(Schema.Boolean),
});

export const ModelHistoryVersionResult = Schema.Struct({
  checkpointId: CheckpointId,
  status: Schema.Literals(["ok", "error", "cancelled"]),
  mesh: Schema.NullOr(SignedFile),
  meshFormat: Schema.NullOr(Schema.Literals(["stl", "3mf", "obj", "glb", "gltf"])),
  /** Present for SCAD versions: the render log, summary and cache state. */
  render: Schema.NullOr(ScadRenderResult),
  /** Workspace paths of files this version reads (not the model) that differ from today. */
  differingIncludes: Schema.Array(Schema.String).check(Schema.isMaxLength(200)),
});

export const ModelHistoryRestoreInput = Schema.Struct({
  file: ModelFileRef,
  checkpointId: CheckpointId,
  includeDependencies: Schema.Boolean,
  /** current.contentKey from the history the client showed. Null when the file is absent. */
  expectedContentKey: Schema.NullOr(Schema.String),
});

export const ModelHistoryRestoreResult = Schema.Struct({
  undoId: Schema.String,
  /** Workspace-relative paths written. */
  restored: Schema.Array(Schema.String),
});

export const ModelHistoryUndoInput = Schema.Struct({
  file: ModelFileRef,
  undoId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});

export type ModelHistoryInput = typeof ModelHistoryInput.Type;
export type ModelHistoryVersion = typeof ModelHistoryVersion.Type;
export type ModelHistory = typeof ModelHistory.Type;
export type ModelHistoryVersionInput = typeof ModelHistoryVersionInput.Type;
export type ModelHistoryVersionResult = typeof ModelHistoryVersionResult.Type;
export type ModelHistoryRestoreInput = typeof ModelHistoryRestoreInput.Type;
export type ModelHistoryRestoreResult = typeof ModelHistoryRestoreResult.Type;
```

Add to `MODEL_PREVIEW_3D_WS_METHODS` (`:10-28`):

```ts
  history: "loom.model-preview-3d.history",
  historyVersion: "loom.model-preview-3d.historyVersion",
  historyCancel: "loom.model-preview-3d.historyCancel",
  historyRestore: "loom.model-preview-3d.historyRestore",
  historyUndo: "loom.model-preview-3d.historyUndo",
```

Add to `ModelPreview3dRpcGroup` (`:317-392`) with the existing `rpc` helper (`:307-316`):

```ts
  rpc(MODEL_PREVIEW_3D_WS_METHODS.history, ModelHistoryInput, ModelHistory),
  rpc(
    MODEL_PREVIEW_3D_WS_METHODS.historyVersion,
    ModelHistoryVersionInput,
    ModelHistoryVersionResult,
  ),
  rpc(MODEL_PREVIEW_3D_WS_METHODS.historyCancel, ModelFileRef, Schema.Void),
  rpc(
    MODEL_PREVIEW_3D_WS_METHODS.historyRestore,
    ModelHistoryRestoreInput,
    ModelHistoryRestoreResult,
  ),
  rpc(MODEL_PREVIEW_3D_WS_METHODS.historyUndo, ModelHistoryUndoInput, Schema.Void),
```

Authorization, `apps/server/src/fork/rpcAuthorization.ts:49-65` (the table is exhaustive and
`apps/server/src/fork/rpcAuthorization.test.ts` fails without the rows):

```ts
  [M.history]: AuthOrchestrationReadScope,
  [M.historyVersion]: AuthOrchestrationOperateScope,
  [M.historyCancel]: AuthOrchestrationOperateScope,
  [M.historyRestore]: AuthOrchestrationOperateScope,
  [M.historyUndo]: AuthOrchestrationOperateScope,
```

`historyVersion` is operate because it spends render time and writes cache files, the same as
`renderScad` (`:61`). Add the four operate methods to
`packages/contracts/src/fork/clientRpcPermissions.ts:24-31` so the UI reads their
`permissionAtom`.

### `packages/contracts/src/fork/model-workspace.ts`

Annotations remember the turn that resolved them. Add imports:

```ts
import * as Effect from "effect/Effect";
import { CheckpointId, NonNegativeInt, ThreadId } from "../baseSchemas.ts";
```

and a field on `ModelAnnotation` (`:37-46`) after `reviewedRevision`:

```ts
  /** Set by the server when the annotation is accepted; clients' values are ignored. */
  resolvedIn: Schema.NullOr(
    Schema.Struct({ threadId: ThreadId, checkpointId: CheckpointId, turn: NonNegativeInt }),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
```

Workspaces saved before L49 decode with `resolvedIn: null`, the same mechanism as
`BuildPlateSetting.pattern` (`model-preview-3d.ts:237`). The encoded side is optional, so older
clients and agents that omit it still pass validation. The two places that create annotations,
`apps/web/src/fork/model-preview-3d/useModelEditing.ts:68` and `:157`, add `resolvedIn: null`.

### `packages/contracts/src/fork/model-editor.ts`

Add two literals to `ModelEditorAction.action` (`:6-34`): `"turn-history"` and
`"turn-compare"`. They reuse existing optional fields:

- `turn-history`: `enabled` shows or hides the strip; `name` is a checkpoint id to view, or
  `"current"` to go back to Now.
- `turn-compare`: `name` is the checkpoint id (or `"current"`) to overlay; `enabled: false`
  stops comparing.

The names avoid `parameter-history`, which already means the customizer's undo stack (`:24`,
`:78-79`). Add to `ModelEditorState` (`:65-82`):

```ts
  turnHistory: Schema.optional(
    Schema.Struct({
      open: Schema.Boolean,
      viewing: Schema.NullOr(CheckpointId),
      viewingTurn: Schema.NullOr(NonNegativeInt),
      comparing: Schema.NullOr(CheckpointId),
      latestTurn: Schema.NullOr(PositiveInt),
    }),
  ),
```

Optional, so older clients and servers still decode, like L42's `previous`.

## Server

### Files

| File                                                                             | Contents                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/model-preview-3d/history.ts` (new, pure)                   | `historyCandidates`, `contentKey`, `parseLsTree`, `isLfsPointer`, the `UndoManifest` schema and the `HISTORY_*` limits.                                                                                                                                                                                                                                                                                                           |
| `apps/server/src/fork/model-preview-3d/historyGit.ts` (new)                      | `makeHistoryGit(runner)`: `lsTree`, `treeOid`, `materialize`, `hashObjects`. Effect functions over `ProcessRunner`.                                                                                                                                                                                                                                                                                                               |
| `apps/server/src/fork/model-preview-3d/historyRestore.ts` (new, shared with L66) | `makeHistoryRestore({ undoDir, git })`: `restore`, `undo`, `prune` over a list of entries. The backup, copy-and-rename and undo steps below (`historyRestore` steps 4 and 5, `historyUndo`) live here, not inline in the service; L49 calls it with a one-entry list (two or more with `includeDependencies`). Defined in [L66 TECHNICAL.md](../L66-pcb-history/TECHNICAL.md#historyrestorets); created by whichever lands first. |
| `apps/server/src/fork/model-preview-3d/scadIncludes.ts`                          | Shared with L41; created by whichever lands first.                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/server/src/fork/model-preview-3d/formats.ts`                               | Shared with L41 (`SCAD_INPUT_EXTENSIONS`); formats come from `modelFormatOf` in contracts (L50's shared definition).                                                                                                                                                                                                                                                                                                              |
| `ModelPreviewService.ts`                                                         | Methods `history`, `historyVersion`, `historyCancel`, `historyRestore`, `historyUndo`; `renderImages` gains a checkpoint; `runRender` gains snapshot mode; `updateWorkspaceMany` sets `resolvedIn`.                                                                                                                                                                                                                               |
| `rpc.ts`                                                                         | Five handlers, each calling one service method.                                                                                                                                                                                                                                                                                                                                                                                   |
| `mcp.ts`                                                                         | Two tools, the render option, editor tool description.                                                                                                                                                                                                                                                                                                                                                                            |

### Limits

Put these in `history.ts` so tests and the service share them:

```ts
export const HISTORY_PAGE_DEFAULT = 30;
export const HISTORY_LS_TREE_CONCURRENCY = 4;
export const HISTORY_TRACKED_MAX = 200; // model + current closure paths
export const HISTORY_CLOSURE_DEPTH = 8;
export const HISTORY_CLOSURE_FILES = 200;
export const HISTORY_CLOSURE_BYTES = 64 * 1024 * 1024;
export const HISTORY_SCAD_PARSE_BYTES = 256 * 1024; // larger SCAD sources are not parsed
export const HISTORY_TREES_MAX = 40;
export const HISTORY_TREES_BYTES = 1024 * 1024 * 1024;
export const HISTORY_UNDO_MAX = 20;
export const HISTORY_UNDO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
```

### Git plumbing (`historyGit.ts`)

All commands run through the existing `runner` (`ProcessRunner`, options at
`apps/server/src/processRunner.ts:19-40`) with `command: "git"`, `cwd: root`,
`timeout: "30 seconds"`, `outputMode: "truncate"`, `maxOutputBytes: 4 * 1024 * 1024`, and
`env: { GIT_LITERAL_PATHSPECS: "1", GIT_LFS_SKIP_SMUDGE: "1" }` (the runner extends the parent
environment by default). Literal pathspecs stop a model named `part[1].stl` from being read as
a glob. Follow the error style of the PCB helper
(`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1860-1880`): a non-zero exit or
truncated output fails with `ModelPreviewError("command-failed", ...)`.

- `treeOid(root, ref)`: `git rev-parse --verify --quiet <ref>^{tree}`. Exit 1 means the ref is
  gone (rolled back); map to `not-found` with "This version is no longer available. The thread
  was rolled back."
- `lsTree(root, ref, workspacePaths)`: `git ls-tree -z -l --full-name <ref> -- <paths>`. Paths
  are given relative to `cwd` (the workspace root); output paths are repository-relative. Parse
  each NUL-terminated record `mode SP type SP oid SP+ size TAB path` with `parseLsTree` in
  `history.ts`. Missing paths are simply absent from the output. Keep only `type === "blob"` with
  mode `100644` or `100755`; symlinks (`120000`) and submodules (`160000`) count as absent.
  Batch at most 200 paths per call (the tracked set is capped at 200, so one call).
  An optional fourth argument `{ recursive?: boolean }` adds `-r`, so a directory pathspec lists
  the files under it. L49 never sets it; L66 lists design folders with it.
- `materialize(root, ref, entries, treeFiles)`: write `mode SP oid TAB path NUL` lines (from
  the filtered `lsTree` entries, repository-relative paths) to stdin of
  `git update-index -z --index-info` with `GIT_INDEX_FILE=<tree>/index`, then run
  `git checkout-index --all --force --prefix=<treeFiles>/` with the same index. This writes each
  file at `<treeFiles>/<repository path>` and applies the repository's end-of-line and filter
  attributes as a normal checkout would. LFS smudge is skipped by the environment, so an LFS
  file arrives as its pointer text. `runner.run`'s `stdin` is a string; repository paths are
  UTF-8 in practice and a path containing a newline or NUL is skipped earlier.
- `hashObjects(root, workspacePaths)`: `git hash-object -- <paths>` from the workspace root.
  This applies the same clean filters Git would on `git add`, so the result equals the blob id
  a checkpoint would record. Missing files are filtered out before the call (check with
  `fs.exists`), since one missing path fails the whole command.

### Tracked set and candidates

`trackedPaths(root, absoluteModel)` returns the workspace-relative model path plus the files the
current model reads, at most `HISTORY_TRACKED_MAX`:

- Non-SCAD models: the model, and for `.gltf` the relative `buffers[].uri` and `images[].uri`
  values that are not `data:` URIs and resolve below the model's directory (the loader only
  allows those, `apps/web/src/fork/model-preview-3d/viewer/load.ts:60`).
- SCAD models: a breadth-first walk with `scadReferences` and `resolveScadReference` over live
  files, depth `HISTORY_CLOSURE_DEPTH`, skipping sources over `HISTORY_SCAD_PARSE_BYTES`, files
  outside the repository, and extensions not in `SCAD_INPUT_EXTENSIONS`. Only `.scad` files are
  parsed further. Merge in the in-memory OpenSCAD dependency list for the file
  (`dependencies.get(absolute)`, `ModelPreviewService.ts:126`, filled by `readDeps` at
  `:386-402`) restricted to the workspace, which catches includes that the regex parser cannot
  see (computed file names). Cache the walk by the model's revision and the revisions of the
  files it found, in a `Map` capped at 200 entries (drop the oldest).

`historyCandidates(checkpoints, scopes, trackedRepoPaths, cursor, limit)` is pure:

1. Turn checkpoints: `status === "ready"`, `runId !== null`, `appRunOrdinal !== null`, scope
   kind `"root_run"` (`packages/contracts/src/orchestrationV2.ts:715-727`), and
   `appRunOrdinal < cursor` when a cursor is set.
2. Keep those with at least one `files[].path` in `trackedRepoPaths`. Paths in `files` use the
   destination of a rename (`apps/server/src/checkpointing/Diffs.ts:9-37`), which is what the
   tracked set holds.
3. Sort by `appRunOrdinal` descending, then `capturedAt` descending; if two ready checkpoints
   share a turn number (possible after a rollback reused an ordinal), keep the newest.
4. Take `limit`. `nextCursor` is the last taken turn number when more candidates remain,
   otherwise null.
5. When `nextCursor` is null, append the start: the ready checkpoint with `runId === null`,
   `ordinalWithinScope === 0` in the root scope. Baselines at other ordinals
   (`CheckpointCaptureService.ts:107-123`) are skipped: their content equals the previous turn's.

`latestTurn` is the highest `appRunOrdinal` among ready root checkpoints, whether or not it
touched the model, so the label matches the chat.

### `history(input)`

1. `resolveWorkspace(input.file)`; read the prefix. Not a Git repository: return
   `{ versions: [], nextCursor: null, latestTurn: null, current, threadRunning,
unavailable: "not-git" }`.
2. `queries.getThreadRecords(threadId, ["checkpoints", "checkpointScopes", "runs"])`
   (`apps/server/src/orchestration-v2/ProjectionStore.ts:364`). `threadRunning` is
   `runs.some((run) => !isTerminalRunStatus(run.status))`, with `isTerminalRunStatus` from
   `apps/server/src/orchestration-v2/ThreadManagementService.ts:399`.
3. `trackedPaths`, then `historyCandidates`.
4. For each candidate, at concurrency `HISTORY_LS_TREE_CONCURRENCY`: `lsTree(root, ref,
tracked)`. `present` is whether the model's entry exists and `sizeBytes` is its size.
   `contentKey` is `contentKey(entries)`: SHA-256 over the sorted
   `repoPath + "\0" + oid` lines, or null when the model entry is absent. A ref that no
   longer resolves is dropped from the page, and so is the start when the model is absent
   there. LFS is only detected when a version is opened.
5. `changed`: the candidate's `files` paths that are in the tracked set, converted to workspace
   paths, first 20.
6. `resolvedAnnotations`: ids of annotations in the file's workspace
   (`store.getWorkspace(projectId, root + "\0" + path)`, as at `ModelPreviewService.ts:813`)
   whose `resolvedIn.checkpointId` is the candidate's id.
7. `current`: `present` from `fs.exists`; `contentKey` from `hashObjects` over the tracked
   paths that exist, keyed the same way. This is what restore checks against.

Cache `lsTree` results in an LRU `Map` keyed by `treeOid + "\0" + trackedHash` (500 entries).
Key by tree id, not ref name: rollback deletes later refs
(`apps/server/src/orchestration-v2/CheckpointRollbackService.ts:269-278`) and a later turn can
reuse the same ref name with different content. `treeOid` itself is one `rev-parse` per
candidate; batch it with `git rev-parse <ref1>^{tree} <ref2>^{tree} ...` (one call per page)
and treat a failed batch by retrying per ref so one deleted ref does not hide the page.

### `historyVersion(input)`

Job handling mirrors `renderScad` (`ModelPreviewService.ts:587-622`): the job key is
`workspaceAbsolute + "\0history"`, stored in the existing `jobs` map under `jobLock`, so a new
version request for the same model interrupts the previous one (fast `[` presses cancel stale
work) and an interrupt returns `{ status: "cancelled", mesh: null, ... }`. Rendering takes a
`renderSlots` permit like live renders.

1. Resolve the workspace and prefix. Load the checkpoint row by id from
   `getThreadRecords(threadId, ["checkpoints"])`; it must belong to the thread, be ready and be
   a turn or the start, else `not-found`.
2. `treeOid(root, ref)`. Tree directory key:
   `sha256(root + "\0" + treeOid + "\0" + workspacePath)`, directory
   `<historyDir>/trees/<key>/`, files under `<historyDir>/trees/<key>/files/`. `historyDir` is
   `realPath(<stateDir>/fork/model-preview-3d/history)` created at startup like `cacheDir`
   (`:116-118`), because the signed-file check compares real paths (`signedFiles.ts:30-38`).
   If `<key>/complete` exists, skip to step 5 (touch the directory's mtime for pruning).
3. Materialize under a fresh `<key>.pending-<uuid>/`, renamed to `<key>/` when complete, so a
   crash never leaves a half tree that looks complete:
   - Round 0: `lsTree` for the model path. Absent: fail `not-found` with
     "bracket.scad did not exist after turn 5." Over `settings.maxFileMegabytes` and not
     `allowLarge`: fail `too-large` with the same message `sign` uses (`:186-191`).
   - SCAD rounds, up to `HISTORY_CLOSURE_DEPTH`: materialize the entries known so far, read
     each newly written `.scad` (skip over `HISTORY_SCAD_PARSE_BYTES`), collect
     `scadReferences`, resolve each with `resolveScadReference` against the file's location in
     the tree, keep those inside `<treeFiles>` and with an extension in
     `SCAD_INPUT_EXTENSIONS`, convert back to repository paths, and `lsTree` the new ones. Stop
     when no new path appears or a limit is hit (`HISTORY_CLOSURE_FILES`,
     `HISTORY_CLOSURE_BYTES` by the ls-tree sizes). Includes may live anywhere in the
     repository, also outside the workspace subdirectory, because the tree mirrors the
     repository layout. Library includes outside the repository are not materialized; OpenSCAD
     falls back to `OPENSCADPATH` and its library folders as it does live.
   - glTF: one extra round for the relative `buffers` and `images` URIs below the model's
     directory.
   - Write `<key>.pending/meta.json` (`{ treeOid, bytes, createdAt }`) and an empty `complete`
     marker, then rename.
4. LFS: if the model file starts with `version https://git-lfs.github.com/spec/v1` and is
   under 1024 bytes, fail `command-failed` with "This version is stored in Git LFS and cannot
   be previewed here."
5. Hold a protection for the tree while it is used (`createStemProtection`,
   `apps/server/src/fork/model-preview-3d/renderCache.ts:41-58`, a second instance for trees).
6. Mesh formats: `sign(treeFiles, treeModel, allowLarge)` (`:179-201`). The token's base is
   the model's directory inside the tree, so glTF buffers resolve exactly as for live files.
   Return `{ status: "ok", mesh, meshFormat, render: null, differingIncludes }`.
7. SCAD: `runRender(renderInput, snapshotResolved, { snapshot: true })` where
   `renderInput = { file: input.file, overrides: {}, parameterSet: null }` and
   `snapshotResolved` has `absolute` = the tree model, `root` = `treeFiles` and the real
   workspace's `projectId`. Return its result as `render` with `mesh`/`meshFormat` copied out.
8. `differingIncludes`: the materialized files other than the model that are inside the
   workspace root and whose blob id differs from `hashObjects` of the live file (or whose live
   file is missing). One `hash-object` call.
9. Run `pruneTrees()` (Storage) after returning the URL, outside the job.

#### `runRender` snapshot mode

`runRender` (`:403-586`) gets a third parameter `options: { readonly snapshot: boolean }`
(default false at the two existing call sites). In snapshot mode:

- Skip `restoreDependencies` (`:433`), both `readDeps` calls (`:516`, `:563`), the dependency
  record write (`:543`) and `saveParams` (`:568`). The in-memory dependency map and saved
  parameters must only ever describe live files.
- Use an empty sidecar instead of `readSidecar`, and reject a non-null `parameterSet`.
  `overrides` are still validated against the old source's customizer (agents may pass them;
  the panel sends none).
- The cache key already includes the absolute source path and its text (`:436-445`), and the
  tree path includes the tree id, so equal content at two turns renders once per tree. The key
  does not cover library files outside the repository; changing an installed library does not
  invalidate history renders until the cache is cleared. Note this in the code comment.

Everything else (OpenSCAD arguments, timeout with `timeoutBehavior: "timedOutResult"` at
`:482-484`, log parsing, `sign(cacheDir, output, true)`, `prune()`) is shared.

### `historyCancel(file)`

Interrupt `jobs.get(workspaceAbsolute + "\0history")` under `jobLock`. No error when idle.

### `historyRestore(input)`

Runs under a new `historyLock = Semaphore.make(1)`.

1. Resolve, load the checkpoint and materialize exactly as `historyVersion` steps 1 to 4
   (reusing a complete tree). Refuse when the model is absent (`not-found`) or an LFS pointer
   (`command-failed`).
2. Targets: the model; with `includeDependencies`, also the version's `differingIncludes`
   (`historyVersion` step 8). Files that exist now but not at the version are never deleted.
3. Conflict check: compute the current content key over the tracked set (as in `history` step
   7). If it differs from `expectedContentKey`, fail `conflict` with "bracket.scad changed since
   you opened history. Check the latest version, then try again." Agents may pass null for
   "no check" through the tool only (see Agent-facing tools); the RPC requires the key.
4. Undo record: `<historyDir>/undo/<uuid>/`. For each target, copy the current file to
   `files/<n>` (or record `"absent"`), and write `manifest.json`:

   ```ts
   const UndoManifest = Schema.Struct({
     id: Schema.String,
     root: Schema.String,
     threadId: ThreadId,
     modelPath: Schema.String,
     createdAt: Schema.Number,
     entries: Schema.Array(
       Schema.Struct({
         path: Schema.String, // workspace-relative
         backup: Schema.NullOr(Schema.String), // file name under files/, null when absent
         mode: Schema.Number,
         restoredOid: Schema.NullOr(Schema.String), // blob id written by the restore; null when it removed the file (L66 only)
       }),
     ),
   });
   ```

5. Write each target: resolve the destination with the containment rules of
   `resolveWorkspace`; if it is a symlink, follow it with `resolveSymlinkTarget`
   (`packages/shared/src/symlink.ts`, used by `writeFileStringAtomically` at
   `packages/shared/src/atomicWrite.ts:11-38`) and require the target to stay inside the root.
   Copy the tree file to a sibling `.<name>.loom-restore-<uuid>` with `fs.copyFile`, apply the
   mode (`0o755` for `100755`), then `fs.rename` over the destination. The shared helper only
   writes strings, and models are binary, so this is the bytes equivalent. Create missing parent
   directories for included files.
6. Return `{ undoId, restored }`. L23's watch (`ModelPreviewService.ts:635`) then reports the new
   revision and the panel reloads Now. Prune undo records (Storage).

The write is an ordinary workspace edit: the next turn's checkpoint includes it, and the thread
projection is not touched.

### `historyUndo(input)`

Under `historyLock`: read the manifest, check `manifest.root` equals the resolved root and
`modelPath` equals the file, then `hashObjects` the entries. If any differs from
`restoredOid` (or a restored file is missing), fail `conflict` with "bracket.scad changed after
the restore, so Undo would overwrite newer work." Otherwise copy each backup back the same
atomic way, delete files whose backup is `null`, and remove the record. A missing record is
`not-found` "This restore can no longer be undone."

### Annotation link in `updateWorkspaceMany`

In `updateWorkspaceMany` (`:805-839`), after the operations are reduced and before
`saveWorkspace`, normalize `resolvedIn` for each annotation in `value`:

- status not `"accepted"`: `resolvedIn: null`.
- accepted and the previous state had the same id accepted: keep the previous `resolvedIn`.
- newly accepted: `resolvedIn = latestTouching(file)`, or null when there is none or the
  lookup fails (never fail the save for this).

`latestTouching(file)` reuses `trackedPaths` and `historyCandidates` with `limit: 1` and no Git
call beyond the cached prefix: it returns `{ threadId, checkpointId, turn }` of the newest ready
turn whose `files` touch the tracked set, which is the turn that made the change being
accepted. It runs inside `workspaceLock`, which is acceptable: it reads one projection and, at
most, a cached closure.

### `renderImages` with a checkpoint

`renderImages(file, views, overrides)` (`:1104-1254`) gains `checkpointId?: CheckpointId`.
When set, it materializes the version (shared helper from `historyVersion` steps 1 to 4) and
uses the tree file in place of `resolved.absolute` for both the SCAD path and the
`import(...)` wrapper. Timeouts already report `timeout` (fixed in `59638f0231` on the local
`fix/preview-defects` branch); if that commit is not on your base, pass
`timeoutBehavior: "timedOutResult"` at `:1203-1210` and turn `result.timedOut` into a
`timeout` error, as `runRender` does.

### Errors

| Situation                                         | Reason                | Message                                                                   |
| ------------------------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| Not a Git workspace (version, restore)            | `workspace-not-found` | "History needs a Git workspace."                                          |
| Ref gone, checkpoint stale or from another thread | `not-found`           | "This version is no longer available. The thread was rolled back."        |
| Model absent at the version                       | `not-found`           | "bracket.scad did not exist after turn 5."                                |
| Model too large                                   | `too-large`           | As `sign` today.                                                          |
| Closure over limits                               | `command-failed`      | "This version uses more than 200 files or 64 MB; it cannot be previewed." |
| LFS pointer                                       | `command-failed`      | "This version is stored in Git LFS and cannot be previewed here."         |
| Git failed or timed out                           | `command-failed`      | "Git could not read this version."                                        |
| Content changed                                   | `conflict`            | See restore and undo.                                                     |

## Storage

| Path under `<stateDir>/fork/model-preview-3d/` | Contents                                                    | Lifetime                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `history/trees/<key>/files/...`                | Materialized version files mirroring repository paths.      | LRU: at most 40 trees and 1 GiB, via `pruneList` (`renderCache.ts:27-39`) on `meta.json` sizes and directory mtimes; protected trees and `*.pending-*` are skipped. Pending directories older than an hour are removed at startup. |
| `history/trees/<key>/meta.json`, `complete`    | Tree id, byte count, marker.                                | With the tree.                                                                                                                                                                                                                     |
| `history/undo/<id>/manifest.json`, `files/<n>` | Undo records.                                               | Newest 20, at most seven days; pruned after each restore and at startup.                                                                                                                                                           |
| `renders/<hash>.*`                             | SCAD renders of old versions, in the existing render cache. | Existing pruning (`ModelPreviewService.ts:334-356`).                                                                                                                                                                               |

`clearCache` (`:1082-1103`) also interrupts history jobs (they are in `jobs`) and removes
`history/trees`. It leaves `history/undo` alone, because Undo protects user work.

Persisted data: `resolvedIn` on annotations in the existing workspace store, with a decoding
default. No migration, no new table.

## Clients

### Atoms (`packages/client-runtime/src/fork/model-preview-3d.ts:11-93`)

```ts
    history: createEnvironmentRpcCommand(runtime, { label: "loom:model-history", tag: M.history }),
    historyVersion: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-history-version",
      tag: M.historyVersion,
    }),
    historyCancel: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-history-cancel",
      tag: M.historyCancel,
    }),
    historyRestore: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-history-restore",
      tag: M.historyRestore,
    }),
    historyUndo: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-history-undo",
      tag: M.historyUndo,
    }),
```

`history` is a command, not a query family: pages are fetched on demand and refreshed by
explicit triggers, and an idle query would keep stale pages around per file.

### Pure helpers (`apps/web/src/fork/model-preview-3d/history.ts`)

```ts
export type HistoryChip =
  | { kind: "version"; version: ModelHistoryVersion; folded: number }
  | { kind: "now"; matches: CheckpointId | null };
/** Oldest first. Adjacent versions with the same contentKey fold into the older one. */
export function historyChips(pages: readonly ModelHistory[]): HistoryChip[];
/** The chip `[` or `]` moves to; null at either end. "now" is after the newest. */
export function stepChip(
  chips: readonly HistoryChip[],
  current: CheckpointId | "now",
  direction: -1 | 1,
): CheckpointId | "now" | null;
/** "Viewing turn 4 of 9", "Viewing the start of the thread". */
export function viewingLabel(turn: number, latestTurn: number | null): string;
/** "Turn 4", "Start", "Turn 5 (deleted)". */
export function chipLabel(version: ModelHistoryVersion): string;
/** Per-axis size delta and triangle delta, B minus A, rounded to 0.1 mm. */
export function sizeDelta(
  a: { size: readonly number[]; triangles: number },
  b: { size: readonly number[]; triangles: number },
): { size: [number, number, number]; triangles: number };
```

Folding is done on the client so paging stays simple: the server lists every touching turn,
and the client folds a newer version into the older one when their `contentKey` match (the
newer turn left the model as it was). The `folded` count shows in the chip's tooltip ("Turns 7
and 8 made no change to this model"). `matches` on Now is the newest version whose `contentKey`
equals `current.contentKey`, shown as "Same as turn 7".

### `useModelHistory.ts`

```ts
export function useModelHistory(input: {
  threadRef: ScopedThreadRef;
  path: string;
  /** True while the strip is open or a version is shown. */
  active: boolean;
  /** L23's watch revision for the file. */
  liveRevision: string | null;
}): {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  pages: readonly ModelHistory[];
  chips: readonly HistoryChip[];
  latestTurn: number | null;
  current: ModelHistory["current"] | null;
  threadRunning: boolean;
  loadEarlier(): void;
  refresh(): void;
};
```

- Fetches the first page with `runModelCommand(models.history, ...)` (`state.ts`) when
  `active` turns true, and nothing while inactive.
- Refreshes the first page (keeping older pages) when `liveRevision` changes or the thread's
  ready checkpoint list changes. Read the latter from
  `useThreadProjection(threadRef)?.projection.checkpoints` (`apps/web/src/state/entities.ts:126`,
  already used by fork code at `apps/web/src/fork/thread-inspector/useInspectorInputs.ts:53`) and
  reduce it to a signature string of ready root checkpoint ids, memoized, so unrelated projection
  updates do not refetch.
- Drops responses that arrive after a newer request (a request counter), like the panel's other
  effects (`ModelPanel.tsx:501-536` uses an `active` flag).

### `HistoryStrip.tsx`

Rendered in `ModelFile` between the canvas row and the status bar (`ModelPanel.tsx:1135`), only
while open. One row, fixed height, horizontally scrollable with native scrolling:

- Left: "Earlier" when `nextCursor` is set. Then chips oldest to newest, then "Now".
- Chip: a `Button` from `components/ui` with an existing small variant (`size="xs"`, `variant`
  `"ghost"`, and `"secondary"` for the selected chip), so no `className` restyling
  (AGENTS.md "Taste"). A check icon marks chips with `resolvedAnnotations`. A compared chip
  shows a ghost icon. Tooltips use the existing tooltip component with time and changed paths.
  No coloured edges or stripes.
- Right: "Compare" (a menu of the other chips), "Restore this version..." (only when viewing a
  present, non-LFS version and the restore permission atom allows it), and a close button.
- `aria-label="Model history"`, chips are a `role="listbox"` with `aria-selected`, so screen
  readers announce "Turn 4, selected".
- Scroll the selected chip into view with `scrollIntoView({ block: "nearest", inline:
"nearest" })` on selection change only.

### `ModelPanel.tsx` integration

New state in `ModelFile` (`:90`):

```ts
const [historyOpen, setHistoryOpen] = useState(false);
const [viewing, setViewing] = useState<{
  checkpointId: CheckpointId;
  turn: number;
  status: "loading" | "ready" | "error" | "absent";
  mesh: { url: string; format: ModelEntry["format"]; revision: string } | null;
  stats: ReturnType<typeof meshStats> | null;
  result: ModelHistoryVersionResult | null;
  error: string | null;
} | null>(null);
const [comparing, setComparing] = useState<{
  checkpointId: CheckpointId | "now";
  label: string;
  stats: ReturnType<typeof meshStats> | null;
  overlay: boolean; // false when over the ghost triangle limit
} | null>(null);
const [restoreTarget, setRestoreTarget] = useState<ModelHistoryVersion | null>(null);
const [undo, setUndo] = useState<{ undoId: string; label: string } | null>(null);
```

- Selecting a version calls `historyVersion` and fills `viewing`. The canvas gets
  `shownMesh = viewing?.mesh ?? mesh` at `:845-864`, so `ViewerCanvas` loads the old URL and
  keeps the camera (it passes `keepCamera` after the first load, `viewer/ViewerCanvas.tsx:121`).
- While viewing, pass a separate `onStats` that stores `viewing.stats` and does not touch
  `stats` or `geometryRevision` (`:485-492`), so markup state keyed by the current geometry stays
  correct. The status bar (`:1135-1162`) shows `viewing?.stats ?? stats` and replaces the render
  state with `viewingLabel(...)` plus "Back to current".
- While viewing, `editDisabled` (`:539`) is also true, which disables capture, the tool rail
  (measure, annotate, section toggle), markup and saved views. Pass `measurements={[]}` and
  `annotations={[]}` to the canvas, and wrap the Customize tab's `ScadFile` (`:1043-1054`) in a
  disabled `fieldset` with the notice "Parameters apply to the current version." `ScadFile`
  keeps rendering the live file in the background, so going back is instant.
- A SCAD version's render log goes to the Part tab through the existing `render` display,
  using `viewing?.result?.render ?? render`.
- "Back to current", the Now chip, or closing the strip clears `viewing` and `comparing` and
  calls `historyCancel`. Switching tabs away does not clear it.
- Selecting a version while another is loading calls `historyVersion` again; the server
  interrupts the older job, and a request counter ignores its late reply.

### Compare ghost

`viewer/ghost.ts` follows the shared definition in
[MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md), "Ghost overlay", and L42's material values.
If L42 has not landed, L49 creates `ghost.ts` and the viewer's `ghosts` group exactly as
[L42's TECHNICAL.md](../L42-model-change-ghost/TECHNICAL.md#ghost) describes, without L42's
`keepPrevious` logic.

Add to the object returned by `createViewer` (`viewer/createViewer.ts:452`):

```ts
    /** Shows another version as a ghost; the viewer takes ownership. Null clears it. */
    setCompareModel(next: Object3D | null) {
      compareGhost ??= createGhost(ghosts, requestRender);
      compareGhost.setTheme(dark);
      compareGhost.setClipping(section.enabled ? [plane] : []);
      compareGhost.set(next);
    },
```

with `let compareGhost: ReturnType<typeof createGhost> | null = null`, also updated in
`applySection` and `theme()` and disposed in `dispose()`, beside L42's previous ghost.

The panel loads the compared version with `loadModel(url, format, signal)`
(`viewer/load.ts:163`), computes `meshStats` (`:46-58`) for the delta, and hands the object to
`viewer.current.setCompareModel`. When the compared version has more than 1,000,000 triangles
(L42's `GHOST_TRIANGLE_LIMIT`), dispose it, set `overlay: false` and show only the numbers with
"Too large to overlay". The delta text uses `formatLength` from `units.ts` when L40 has landed,
otherwise `value.toFixed(1)` with " mm" as the status bar does today (`ModelPanel.tsx:1137`),
from a single helper so swapping is one line. When L35's placement rotation exists, apply it to
the ghost root as to the model.

Comparing against "now" loads the current mesh URL (`mesh.url`) the same way.

### Restore dialog and Undo

`RestoreVersionDialog.tsx` uses the existing `Dialog` components, with the copy from
PRODUCT.md. The version is already loaded (`viewing`), so the includes checkbox reads
`viewing.result.differingIncludes`: hidden when empty, otherwise "Also restore N included
files" with the paths listed under it. The dialog adds the running-agent warning when the
history's `threadRunning` is true.

On confirm: `historyRestore` with `expectedContentKey = history.current.contentKey`. On
success: clear `viewing`, show the notice with "Undo" in the panel's existing success area
(`success` state, `:122`, shown for five seconds at `:173-177`; the undo notice stays until
dismissed or the next restore). `conflict` refreshes the history and shows the message.

### Markup link

In `MarkupSection.tsx`, where an accepted annotation shows "Accepted" (`:394-398`), render
"Accepted in turn N" and a "View turn N" `Button` (`size="xs"`, `variant="outline"`) when
`annotation.resolvedIn` is set and `resolvedIn.threadId` is the panel's thread. The button
calls a new prop `onViewTurn(checkpointId)`, which `ModelFile` wires to open the strip and
select that version. Annotations accepted in another thread show "Accepted in another thread"
without a button.

### Keys, toolbar, palette and actions

- Keyboard in the handler at `ModelPanel.tsx:718-772`, all guarded by `visible`:
  - `t`: toggle the strip.
  - `[` and `]`: open the strip if closed (first press only loads), then `stepChip`. Handle
    these two before the modifier early return at `:736-746`, requiring only
    `!event.metaKey && !event.ctrlKey`, because several European layouts type brackets with
    Option. Windows AltGr reports Ctrl and Alt together, so there the strip buttons remain the
    way in.
- Toolbar: a History `ModelTool` (`HistoryIcon` from lucide-react) in the document bar's
  actions (`:787`), `aria-pressed={historyOpen}`.
- `actions.ts`: extend `ModelAction` (`:2`) with `"history" | "history-previous" |
"history-next"`, handled in the `onModelAction` effect (`:651-657`).
- `palette.tsx`: three entries after the capture actions (`:54-63`): "3D model: Toggle
  history", "3D model: Previous version" and "3D model: Next version". Palette sources do not
  see panel state, so one toggle entry is clearer than separate show and hide entries.

### Editor command

In `handleEditorRequest` (`ModelPanel.tsx:187`), handle `turn-history` and `turn-compare` as in
Contracts, and include `turnHistory` in the returned state when the strip is open or a version
is shown. Unknown checkpoint ids complete with an error message ("Turn not found. List versions
with loom_model_preview_3d_history."). Extend the editor tool description in
`apps/server/src/fork/model-preview-3d/mcp.ts:16` with one sentence: "turn-history shows the
model's turn history or a version (name = checkpoint id or current); turn-compare overlays
another version."

## Agent-facing tools

Add to `ModelPreview3dToolkit` in `apps/server/src/fork/model-preview-3d/mcp.ts:14-200`, using
`modelThread` (`:203-211`) for the thread, `withForkRuntime` and the service, and add both names
to the list in `apps/server/src/fork/model-preview-3d/mcp.test.ts:48`:

```ts
  Tool.make("loom_model_preview_3d_history", {
    description:
      "List the thread's turns that changed a workspace model or the files it includes, newest first. Each version has a checkpointId to pass to loom_model_preview_3d_render, loom_model_preview_3d_restore_version or the editor's turn-history action.",
    parameters: Schema.Struct({
      path: Schema.String,
      cursor: Schema.optional(Schema.NullOr(PositiveInt)),
      limit: ModelHistoryInput.fields.limit,
    }),
    success: ModelHistory,
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "List model history")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_model_preview_3d_restore_version", {
    description:
      "Restore a workspace model from an earlier turn as a normal file write, or undo such a restore. Restore needs checkpointId; undo needs the undoId it returned. includeDependencies also restores included files that differ. Pass expectedContentKey (history.current.contentKey) to refuse if the file changed meanwhile.",
    parameters: Schema.Struct({
      path: Schema.String,
      action: Schema.Literals(["restore", "undo"]),
      checkpointId: Schema.optional(CheckpointId),
      undoId: Schema.optional(Schema.String),
      includeDependencies: Schema.optional(Schema.Boolean),
      expectedContentKey: Schema.optional(Schema.NullOr(Schema.String)),
    }),
    success: Schema.Struct({
      undoId: Schema.NullOr(Schema.String),
      restored: Schema.Array(Schema.String),
      message: Schema.String,
    }),
    failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "Restore model version")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
```

Handlers: `loom_model_preview_3d_history` uses `McpToolAccess.readsAsCaller` and calls
`service.history`. `loom_model_preview_3d_restore_version` uses `McpToolAccess.actsAsCaller`; for
`restore` it calls `service.historyRestore` with `expectedContentKey` when given and otherwise a
service variant that skips the conflict check (`historyRestore(input, { checkContent: false })`),
because an agent that just listed history and immediately restores gains nothing from the check
and cannot show a dialog. Missing `checkpointId` or `undoId` for the chosen action fails
`invalid-parameter`. Both tools respect `settings.agentToolEnabled` like the others.

`loom_model_preview_3d_render` (`:181-200`) gains
`checkpointId: Schema.optional(CheckpointId)` with the description addition "Pass checkpointId
from loom_model_preview_3d_history to render an earlier version." `renderModelTool`
(`:212-229`) forwards it to `renderImages`.

The `t3 model <action> '<json>'` CLI maps actions to tool names
(`apps/server/src/fork/model-preview-3d/cli.ts:5-15`), so `t3 model history` and
`t3 model restore_version` work without changes.

## Performance

- Nothing runs until the strip opens, a key is pressed, or a tool is called. The strip is static
  DOM; no animation, no timers, no polling. Refreshes are driven by the existing watch revision
  and the thread projection, which the client already receives.
- Listing cost per page: one projection read, one cached closure walk, one batched
  `rev-parse`, and up to 30 `ls-tree` calls at concurrency 4 that are cached by tree id. No
  blob content is read for listing. Payload: 30 versions at roughly 400 bytes each, about
  12 KB.
- Version cost: Git writes only the model and its closure (capped at 200 files and 64 MiB),
  reused across requests by tree id. SCAD renders go through the existing render slots and
  cache; stepping quickly interrupts stale renders.
- The viewer still holds one model; the compare ghost holds one more, capped at 1,000,000
  triangles and disposed on clear. The viewer renders on demand
  (`viewer/createViewer.ts:356`).
- Remote: version meshes are fetched by URL over the existing signed route; nothing large goes
  over the WebSocket.

## Alternatives considered

- **`git show <ref>:<path>` into memory**, like the PCB service's `gitBytes`
  (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1882-1905`). Simple for one file, but
  OpenSCAD needs the includes on disk next to the model, eol and filter attributes would be
  skipped, and the 16 MiB in-memory cap is too small for meshes. The temp-index checkout writes
  only the files needed and applies attributes.
- **`git worktree add` or `git archive` per version.** Writes the whole tree for every version;
  too slow and too large for big repositories.
- **Diffing the whole checkpoint for each version.** Upstream's diff RPCs answer "what changed in
  this turn", not "what did this file look like". The `files` list plus `ls-tree` is cheaper.
- **Content keys from the closure at each version.** Exact, but needs SCAD parsing per turn when
  listing. The current closure plus `ls-tree` is cheap; the exact closure is resolved only when a
  version is opened.
- **Upstream thread rollback for restore.** Rolls back every file and the conversation. Kyle
  wants one model back.
- **Restore through Git (`git checkout <ref> -- path`).** Touches the index and stages the
  change, surprising users who manage their own staging. A plain file write is what an agent's
  edit would be.
- **Commit history as a second source.** Useful, but different numbering and scope. Left for a
  later packet.
- **A query atom family for history.** Would cache pages per file indefinitely and refetch on
  every subscription; explicit commands with clear triggers are cheaper.
- **Storing the history in a fork table.** The projection already has the checkpoints; a copy
  would drift after rollbacks.

## Defects noticed in the current code

- `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:1203-1210`: `renderImages` runs
  OpenSCAD without `timeoutBehavior`, so a timeout raises `ProcessTimeoutError`, which `mapError`
  (`:63-70`) turns into `command-failed` instead of `timeout`. Fixed in this packet (step 8).
- `apps/web/src/fork/model-preview-3d/ModelPanel.tsx:741`: the `event.altKey` early return
  blocks any panel key typed with Option. L49 handles `[` and `]` before it.
