// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import {
  ThreadId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2CheckpointScope,
} from "@t3tools/contracts";

export const HISTORY_PAGE_DEFAULT = 30;
export const HISTORY_LS_TREE_CONCURRENCY = 4;
export const HISTORY_TRACKED_MAX = 200;
export const HISTORY_CLOSURE_DEPTH = 8;
export const HISTORY_CLOSURE_FILES = 200;
export const HISTORY_CLOSURE_BYTES = 64 * 1024 * 1024;
export const HISTORY_SCAD_PARSE_BYTES = 256 * 1024;
export const HISTORY_TREES_MAX = 40;
export const HISTORY_TREES_BYTES = 1024 * 1024 * 1024;
export const HISTORY_UNDO_MAX = 20;
export const HISTORY_UNDO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TreeEntry {
  readonly path: string;
  readonly oid: string;
  readonly mode: "100644" | "100755";
  readonly size: number;
}
export const safeRepoPath = (path: string) =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !/[\0\n\r\\]/.test(path) &&
  !path.split("/").some((part) => part === ".." || part === "." || part.length === 0);
/** NUL records retain spaces and tabs in filenames and omit non-file tree entries. */
export function parseLsTree(output: string): TreeEntry[] {
  return output.split("\0").flatMap((record) => {
    const match = /^(100644|100755) blob ([0-9a-f]{40,64}) +([0-9]+)\t([\s\S]+)$/.exec(record);
    if (!match || !safeRepoPath(match[4]!)) return [];
    const size = Number(match[3]);
    return Number.isSafeInteger(size)
      ? [{ mode: match[1] as TreeEntry["mode"], oid: match[2]!, size, path: match[4]! }]
      : [];
  });
}
export const contentKey = (entries: ReadonlyArray<Pick<TreeEntry, "path" | "oid">>) =>
  NodeCrypto.createHash("sha256")
    .update(
      entries
        .toSorted((a, b) => a.path.localeCompare(b.path))
        .map((entry) => `${entry.path}\0${entry.oid}\n`)
        .join(""),
    )
    .digest("hex");
export const isLfsPointer = (bytes: Uint8Array) =>
  bytes.length < 1024 &&
  new TextDecoder().decode(bytes).startsWith("version https://git-lfs.github.com/spec/v1\n");
export function historyCandidates(
  checkpoints: ReadonlyArray<OrchestrationV2Checkpoint>,
  scopes: ReadonlyArray<Pick<OrchestrationV2CheckpointScope, "id" | "kind" | "threadId">>,
  tracked: ReadonlySet<string>,
  cursor: number | null,
  limit: number,
) {
  const roots = new Map(
    scopes.filter((scope) => scope.kind === "root_run").map((scope) => [scope.id, scope.threadId]),
  );
  const ready = checkpoints.filter(
    (checkpoint) =>
      checkpoint.status === "ready" && roots.get(checkpoint.scopeId) === checkpoint.threadId,
  );
  const latestTurn = ready.reduce<number | null>(
    (latest, checkpoint) =>
      checkpoint.appRunOrdinal === null ? latest : Math.max(latest ?? 0, checkpoint.appRunOrdinal),
    null,
  );
  const candidates = ready
    .filter(
      (checkpoint) =>
        checkpoint.runId !== null &&
        checkpoint.appRunOrdinal !== null &&
        (cursor === null || checkpoint.appRunOrdinal < cursor) &&
        checkpoint.files.some((file) => tracked.has(file.path)),
    )
    .toSorted(
      (a, b) =>
        b.appRunOrdinal! - a.appRunOrdinal! ||
        DateTime.toEpochMillis(b.capturedAt) - DateTime.toEpochMillis(a.capturedAt),
    );
  const unique = candidates.filter(
    (checkpoint, index) =>
      index === 0 || candidates[index - 1]!.appRunOrdinal !== checkpoint.appRunOrdinal,
  );
  const baseline = ready
    .filter((checkpoint) => checkpoint.runId === null && checkpoint.ordinalWithinScope === 0)
    .toSorted(
      (a, b) => DateTime.toEpochMillis(b.capturedAt) - DateTime.toEpochMillis(a.capturedAt),
    )[0];
  const selected = unique.slice(0, limit);
  // Start consumes a page slot too; otherwise a full final page would violate the wire limit.
  const hasMore =
    unique.length > selected.length || (selected.length === limit && baseline !== undefined);
  if (!hasMore && baseline) selected.push(baseline);
  return {
    checkpoints: selected,
    nextCursor: hasMore ? selected.at(-1)!.appRunOrdinal : null,
    latestTurn,
  };
}
export const UndoManifest = Schema.Struct({
  id: Schema.String,
  root: Schema.String,
  threadId: ThreadId,
  modelPath: Schema.String,
  createdAt: Schema.Number,
  entries: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      backup: Schema.NullOr(Schema.String),
      mode: Schema.Number,
      restoredOid: Schema.NullOr(Schema.String),
      target: Schema.String,
      restoredMode: Schema.Number,
    }),
  ),
});
export type UndoManifest = typeof UndoManifest.Type;
