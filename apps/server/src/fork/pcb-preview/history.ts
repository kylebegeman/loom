// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type { ThreadId } from "@t3tools/contracts";
import {
  PcbPreviewError,
  ModelPreviewError,
  type PcbDesign,
  type PcbHistoryInput,
  type PcbHistory,
  type PcbHistoryRestoreInput,
  type PcbHistoryUndoInput,
  type PcbInspectInput,
} from "@t3tools/contracts/fork";
import { makeHistoryGit } from "../model-preview-3d/history/git.ts";
import { makeHistoryRestore } from "../model-preview-3d/history/restore.ts";
import {
  contentKey,
  historyCandidates,
  isLfsPointer,
  type TreeEntry,
} from "../model-preview-3d/history/helpers.ts";
import { isContained } from "../model-preview-3d/signedFiles.ts";
import { ProjectionStoreV2 } from "../../orchestration-v2/ProjectionStore.ts";
import { isTerminalRunStatus } from "../../orchestration-v2/ThreadManagementService.ts";
import {
  designSet,
  designSeeds,
  allowedDesignPath,
  isDesignSource,
  type DesignSetIo,
} from "./designFiles.ts";

interface Resolved {
  root: string;
  absolute: string;
  cwd: string;
  workspaceKey: string;
  design: Pick<PcbDesign, "id" | "kind" | "boardPath" | "schematicPath">;
}
const fail = (reason: PcbPreviewError["reason"], message: string) =>
  new PcbPreviewError({ reason, message });
const isPreviewError = Schema.is(PcbPreviewError);
const isModelError = Schema.is(ModelPreviewError);
const hasMessage = Schema.is(Schema.Struct({ message: Schema.String }));
const checked = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((error) => {
      if (isPreviewError(error)) return error;
      if (isModelError(error))
        return fail(
          error.reason === "conflict"
            ? "conflict"
            : error.reason === "not-found"
              ? "version-not-found"
              : error.reason === "invalid-path"
                ? "path-outside-workspace"
                : "io-failed",
          error.message,
        );
      if (hasMessage(error)) return fail("io-failed", error.message);
      return fail("io-failed", "The PCB history operation failed.");
    }),
  );
const TREE_BYTES = 256 * 1024 * 1024;
const Meta = Schema.Struct({
  treeOid: Schema.String,
  bytes: Schema.Number,
  createdAt: Schema.Number,
  entries: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      oid: Schema.String,
      mode: Schema.Literals(["100644", "100755"]),
      size: Schema.Number,
    }),
  ),
});
const encodeMeta = Schema.encodeSync(Schema.fromJsonString(Meta));
const decodeMeta = Schema.decodeEffect(Schema.fromJsonString(Meta));

export const makePcbHistory = <R extends Resolved, E>(options: {
  historyDir: string;
  resolve: (input: PcbInspectInput) => Effect.Effect<R, PcbPreviewError>;
  snapshot: (
    resolved: R,
  ) => Effect.Effect<{ sourceHash: string; dirs: string[]; files: string[] }, E>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const projections = yield* ProjectionStoreV2;
    const git = yield* makeHistoryGit;
    const trees = path.join(options.historyDir, "trees");
    yield* fs.makeDirectory(trees, { recursive: true });
    const restores = yield* makeHistoryRestore({
      undoDir: path.join(options.historyDir, "undo"),
      git,
    });
    const treeLock = yield* Semaphore.make(1);
    const protectedTrees = new Map<string, number>();
    const sets = new Map<string, Effect.Success<ReturnType<typeof designSet>>>();
    const listings = new Map<string, readonly TreeEntry[]>();
    const relative = (root: string, absolute: string) =>
      path.relative(root, absolute).split(path.sep).join("/");
    const liveIo = (root: string): DesignSetIo => {
      const safe = (name: string) =>
        fs.realPath(path.join(root, name)).pipe(
          Effect.map((real) => (isContained(root, real) ? real : null)),
          Effect.orElseSucceed(() => null),
        );
      const list = (directory: string, seen = new Set<string>()): Effect.Effect<string[]> =>
        Effect.gen(function* () {
          const real = yield* safe(directory);
          if (!real || seen.has(real) || (yield* fs.stat(real)).type !== "Directory") return [];
          seen.add(real);
          const results: string[] = [];
          for (const name of yield* fs.readDirectory(real)) {
            const child = NodePath.posix.join(directory, name);
            if (!allowedDesignPath(child)) continue;
            const absolute = yield* safe(child);
            if (!absolute) continue;
            const info = yield* fs.stat(absolute);
            if (info.type === "Directory") results.push(...(yield* list(child, seen)));
            else if (info.type === "File") results.push(child);
            if (results.length > 2000) return results;
          }
          return results;
        }).pipe(Effect.orElseSucceed(() => []));
      return {
        exists: (name) => safe(name).pipe(Effect.map((real) => real !== null)),
        read: (name) =>
          Effect.gen(function* () {
            const real = yield* safe(name);
            if (!real || Number((yield* fs.stat(real)).size) > 4 * 1024 * 1024) return null;
            return yield* fs.readFileString(real);
          }).pipe(Effect.orElseSucceed(() => null)),
        list,
      };
    };
    const setFor = <E>(resolved: R, io: DesignSetIo<E>) =>
      designSet({
        kind: resolved.design.kind,
        seeds: designSeeds(
          resolved.design.kind,
          resolved.design.id,
          relative(resolved.root, resolved.cwd),
        ),
        projectDirectory: NodePath.posix.dirname(resolved.design.id),
        io,
      });
    const liveSet = Effect.fn("PcbHistory.liveSet")(function* (resolved: R) {
      const snapshot = yield* checked(options.snapshot(resolved));
      const key = resolved.workspaceKey + resolved.design.id + snapshot.sourceHash;
      const cached = sets.get(key);
      if (cached) return cached;
      const result = yield* setFor(resolved, liveIo(resolved.root)).pipe(
        Effect.mapError((error) =>
          isPreviewError(error) ? error : fail("source-limit", error.message),
        ),
      );
      if (sets.size >= 200) sets.delete(sets.keys().next().value!);
      sets.set(key, result);
      return result;
    });
    const records = (threadId: ThreadId) =>
      projections.getThreadRecords(threadId, ["checkpoints", "checkpointScopes", "runs"]);
    const currentKey = (root: string, tracked: readonly string[]) =>
      git
        .hashObjects(root, tracked)
        .pipe(
          Effect.map((hashes) => contentKey([...hashes].map(([path, oid]) => ({ path, oid })))),
        );
    const history = (input: PcbHistoryInput) =>
      checked(
        Effect.gen(function* () {
          const resolved = yield* options.resolve(input);
          const state = yield* records(input.threadId);
          const threadRunning = state.runs.some((run) => !isTerminalRunStatus(run.status));
          const prefix = yield* git.repoPrefix(resolved.root);
          if (prefix === null)
            return {
              versions: [],
              nextCursor: null,
              latestTurn: null,
              current: { contentKey: null },
              threadRunning,
              unavailable: "not-git",
            } satisfies PcbHistory;
          const set = yield* liveSet(resolved);
          const tracked = [...set.design, ...set.supporting];
          const repoPaths = tracked.map((name) => prefix + name);
          const candidates = historyCandidates(
            state.checkpoints.filter((item) => item.threadId === input.threadId),
            state.checkpointScopes,
            new Set(repoPaths),
            input.cursor ?? null,
            input.limit ?? 30,
          );
          const top = yield* git.repoRoot(resolved.root);
          const oids = yield* git.treeOids(
            top,
            candidates.checkpoints.map((checkpoint) => checkpoint.ref),
          );
          const versions = yield* Effect.forEach(
            candidates.checkpoints,
            (checkpoint) =>
              Effect.gen(function* () {
                const tree = oids.get(checkpoint.ref);
                if (!tree) return null;
                const key = tree + contentKey(repoPaths.map((path) => ({ path, oid: "" })));
                let entries = listings.get(key);
                if (!entries) {
                  // Exact path batches avoid unrelated directory contents and truncated output.
                  const batches: TreeEntry[] = [];
                  for (let index = 0; index < repoPaths.length; index += 200)
                    batches.push(
                      ...(yield* git.lsTree(top, tree, repoPaths.slice(index, index + 200))),
                    );
                  entries = batches;
                  if (listings.size >= 500) listings.delete(listings.keys().next().value!);
                  listings.set(key, entries);
                }
                const present = entries.some((entry) => entry.path === prefix + input.designId);
                const stem = input.designId.replace(/\.kicad_(?:pcb|sch|pro)$/i, "");
                return {
                  checkpointId: checkpoint.id,
                  runId: checkpoint.runId,
                  turn: checkpoint.appRunOrdinal ?? 0,
                  capturedAt: checkpoint.capturedAt,
                  ref: checkpoint.ref,
                  present,
                  views: {
                    pcb:
                      resolved.design.kind === "tscircuit"
                        ? present
                        : entries.some((entry) => entry.path === prefix + stem + ".kicad_pcb"),
                    schematic:
                      resolved.design.kind === "tscircuit"
                        ? present
                        : entries.some((entry) => entry.path === prefix + stem + ".kicad_sch"),
                  },
                  contentKey: present ? contentKey(entries) : null,
                  changed: checkpoint.files
                    .filter((file) => repoPaths.includes(file.path))
                    .map((file) => file.path.slice(prefix.length))
                    .slice(0, 20),
                };
              }),
            { concurrency: 4 },
          );
          return {
            versions: versions.filter((version) => version !== null),
            nextCursor: candidates.nextCursor,
            latestTurn: candidates.latestTurn,
            current: { contentKey: yield* currentKey(resolved.root, tracked) },
            threadRunning,
            unavailable: null,
          } satisfies PcbHistory;
        }),
      );
    const pruneTrees = treeLock.withPermit(
      Effect.gen(function* () {
        let count = 0,
          bytes = 0;
        const names = yield* fs.readDirectory(trees);
        const candidates = yield* Effect.forEach(names, (name) =>
          Effect.gen(function* () {
            const dir = path.join(trees, name);
            const meta = yield* fs.readFileString(path.join(dir, "meta.json")).pipe(
              Effect.flatMap(decodeMeta),
              Effect.orElseSucceed(() => null),
            );
            return meta ? { name, bytes: meta.bytes, at: meta.createdAt } : null;
          }),
        );
        for (const item of candidates.filter((item) => item !== null).sort((a, b) => b.at - a.at)) {
          count++;
          bytes += item.bytes;
          if ((count > 40 || bytes > 1024 * 1024 * 1024) && !protectedTrees.has(item.name))
            yield* fs.remove(path.join(trees, item.name), { recursive: true, force: true });
        }
      }),
    );
    const versionDesign = (
      input: PcbInspectInput & { checkpointId: import("@t3tools/contracts").CheckpointId },
    ) =>
      checked(
        Effect.gen(function* () {
          const live = yield* options.resolve(input);
          const prefix = yield* git.repoPrefix(live.root);
          if (prefix === null)
            return yield* fail("version-not-found", "History needs a Git workspace.");
          const state = yield* records(input.threadId);
          const checkpoint = state.checkpoints.find(
            (item) =>
              item.id === input.checkpointId &&
              item.threadId === input.threadId &&
              item.status === "ready" &&
              state.checkpointScopes.some(
                (scope) =>
                  scope.id === item.scopeId &&
                  scope.threadId === input.threadId &&
                  scope.kind === "root_run",
              ) &&
              ((item.runId !== null && item.appRunOrdinal !== null) ||
                (item.runId === null && item.ordinalWithinScope === 0)),
          );
          if (!checkpoint)
            return yield* fail(
              "version-not-found",
              "This version is no longer available. The thread was rolled back.",
            );
          const top = yield* git.repoRoot(live.root);
          const treeOid = yield* git
            .treeOid(top, checkpoint.ref)
            .pipe(
              Effect.mapError(() =>
                fail(
                  "version-not-found",
                  "This version is no longer available. The thread was rolled back.",
                ),
              ),
            );
          const key = NodeCrypto.createHash("sha256")
            .update(live.root + treeOid + input.designId)
            .digest("hex");
          yield* Effect.acquireRelease(
            Effect.sync(() => protectedTrees.set(key, (protectedTrees.get(key) ?? 0) + 1)),
            () =>
              Effect.sync(() => {
                const count = protectedTrees.get(key)! - 1;
                if (count) protectedTrees.set(key, count);
                else protectedTrees.delete(key);
              }),
          );
          const dir = path.join(trees, key);
          const materialized = yield* treeLock.withPermit(
            Effect.gen(function* () {
              if (yield* fs.exists(path.join(dir, "complete"))) {
                return {
                  entries: (yield* decodeMeta(
                    yield* fs.readFileString(path.join(dir, "meta.json")),
                  )).entries,
                  files: path.join(dir, "files"),
                };
              }
              const pending = yield* Effect.acquireRelease(
                fs.makeTempDirectory({ directory: trees, prefix: "pending-" }),
                (dir) => fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore),
              );
              const files = path.join(pending, "files");
              const all = new Map<string, TreeEntry>();
              const fetched = new Set<string>();
              const fetch = Effect.fn("PcbHistory.fetch")(function* (name: string) {
                const query = name === "." ? prefix.replace(/\/$/, "") || "." : prefix + name;
                if (fetched.has(query)) return;
                fetched.add(query);
                const entries = yield* git.lsTree(top, treeOid, [query], { recursive: true });
                for (const entry of entries)
                  if (
                    entry.path.startsWith(prefix) &&
                    allowedDesignPath(entry.path.slice(prefix.length)) &&
                    isDesignSource(live.design.kind, entry.path)
                  )
                    all.set(entry.path, entry);
                if (
                  all.size > 2000 ||
                  [...all.values()].reduce((sum, entry) => sum + entry.size, 0) > TREE_BYTES
                )
                  return yield* fail(
                    "source-limit",
                    "This version uses more than 2,000 files or 256 MB; it cannot be previewed.",
                  );
              });
              yield* fetch(relative(live.root, live.cwd) || ".");
              const lookup = (name: string) =>
                Effect.gen(function* () {
                  if (!all.has(prefix + name)) yield* fetch(name);
                  return (
                    all.has(prefix + name) ||
                    [...all.keys()].some((key) => key.startsWith(prefix + name + "/"))
                  );
                });
              const io: DesignSetIo<PcbPreviewError> = {
                exists: (name) => checked(lookup(name)),
                list: (name) =>
                  fetch(name).pipe(
                    Effect.map(() =>
                      [...all.keys()]
                        .filter((entry) => entry.startsWith(prefix + name + "/"))
                        .map((entry) => entry.slice(prefix.length)),
                    ),
                    Effect.mapError((error) =>
                      isPreviewError(error)
                        ? error
                        : fail("io-failed", "Git could not read this version."),
                    ),
                  ),
                read: (name) =>
                  Effect.gen(function* () {
                    const entry = all.get(prefix + name);
                    if (!entry || entry.size > 4 * 1024 * 1024) return null;
                    yield* git.materialize(top, treeOid, [entry], files);
                    return yield* fs.readFileString(path.join(files, entry.path));
                  }).pipe(
                    Effect.mapError(() => fail("io-failed", "Git could not read this version.")),
                  ),
              };
              const set = yield* setFor(live, io).pipe(
                Effect.mapError((error) =>
                  isPreviewError(error) ? error : fail("source-limit", error.message),
                ),
              );
              if (!all.has(prefix + input.designId))
                return yield* fail(
                  "version-not-found",
                  `${path.basename(input.designId)} did not exist after turn ${checkpoint.appRunOrdinal ?? 0}.`,
                );
              const entries = [...set.design, ...set.supporting].map((name) =>
                all.get(prefix + name)!,
              );
              yield* git.materialize(top, treeOid, entries, files);
              for (const name of [input.designId, live.design.boardPath, live.design.schematicPath])
                if (
                  name &&
                  (yield* fs.exists(path.join(files, prefix + name))) &&
                  isLfsPointer(yield* fs.readFile(path.join(files, prefix + name)))
                )
                  return yield* fail(
                    "io-failed",
                    "This version is stored in Git LFS and cannot be previewed here.",
                  );
              const packageDirectory = relative(live.root, live.cwd);
              if (
                live.design.kind === "tscircuit" &&
                (yield* fs.exists(path.join(live.cwd, "node_modules")))
              ) {
                // Historical source uses the environment's currently installed dependencies.
                const destination = path.join(files, prefix, packageDirectory, "node_modules");
                yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
                yield* fs.symlink(path.join(live.cwd, "node_modules"), destination);
              }
              yield* fs.writeFileString(
                path.join(pending, "meta.json"),
                encodeMeta({
                  treeOid,
                  entries,
                  bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
                  createdAt: DateTime.toEpochMillis(yield* DateTime.now),
                }),
              );
              yield* fs.writeFileString(path.join(pending, "complete"), "");
              yield* fs.rename(pending, dir);
              return { entries, files: path.join(dir, "files") };
            }),
          );
          const root = path.join(materialized.files, prefix);
          const names = new Set(
            materialized.entries.map((entry) => entry.path.slice(prefix.length)),
          );
          const resolved: R = {
            ...live,
            root,
            absolute: path.join(root, input.designId),
            cwd: path.join(root, relative(live.root, live.cwd)),
            design: {
              ...live.design,
              ...(live.design.boardPath && !names.has(live.design.boardPath)
                ? { boardPath: undefined }
                : {}),
              ...(live.design.schematicPath && !names.has(live.design.schematicPath)
                ? { schematicPath: undefined }
                : {}),
            },
          };
          const set = yield* setFor(resolved, liveIo(root)).pipe(
            Effect.mapError((error) =>
              isPreviewError(error) ? error : fail("source-limit", error.message),
            ),
          );
          return {
            resolved,
            live,
            entries: materialized.entries,
            prefix,
            files: materialized.files,
            set,
            snapshot: {
              sourceHash: "history-" + contentKey(materialized.entries),
              dirs: [resolved.cwd],
              files: [...names],
            },
          };
        }),
      );
    const restore = (input: PcbHistoryRestoreInput, settings = { checkContent: true }) =>
      checked(
        Effect.scoped(
          Effect.gen(function* () {
            const version = yield* versionDesign(input);
            const live = yield* liveSet(version.live);
            const hashes = yield* git.hashObjects(version.live.root, [
              ...new Set([
                ...live.design,
                ...live.supporting,
                ...version.set.design,
                ...version.set.supporting,
              ]),
            ]);
            const entries = new Map(
              version.entries.map((entry) => [entry.path.slice(version.prefix.length), entry]),
            );
            const changed = (name: string) =>
              hashes.get(version.prefix + name) !== entries.get(name)?.oid;
            const plan = {
              design: version.set.design.filter(changed),
              supporting: version.set.supporting.filter(changed),
              added: live.design.filter((name) => !entries.has(name)),
              editorLocks: [] as string[],
            };
            for (const name of plan.design) {
              const lock = NodePath.posix.join(
                NodePath.posix.dirname(name),
                "~" + NodePath.posix.basename(name) + ".lck",
              );
              if (yield* fs.exists(path.join(version.live.root, lock))) plan.editorLocks.push(lock);
            }
            if (input.dryRun) return { plan, undoId: null, written: [], removed: [] };
            if (
              settings.checkContent &&
              input.expectedContentKey !==
                (yield* currentKey(version.live.root, [...live.design, ...live.supporting]))
            )
              return yield* fail(
                "conflict",
                "The design changed since you opened history. Check the latest version, then try again.",
              );
            const written = [...plan.design, ...(input.includeSupporting ? plan.supporting : [])];
            const removed = input.removeAdded ? plan.added : [];
            if (!written.length && !removed.length) return { plan, undoId: null, written, removed };
            const result = yield* restores.restore({
              root: version.live.root,
              file: { threadId: input.threadId, path: input.designId },
              entries: [
                ...written.map((name) => ({
                  path: name,
                  source: path.join(version.files, version.prefix + name),
                  mode: Number.parseInt(entries.get(name)!.mode, 8),
                })),
                ...removed.map((name) => ({ path: name, source: null, mode: 0 })),
              ],
            });
            return { plan, undoId: result.undoId, written, removed };
          }),
        ),
      );
    const undo = (input: PcbHistoryUndoInput) =>
      checked(
        Effect.gen(function* () {
          const resolved = yield* options.resolve(input);
          yield* restores.undo({
            root: resolved.root,
            file: { threadId: input.threadId, path: input.designId },
            undoId: input.undoId,
          });
        }),
      );
    const tracked = (input: PcbInspectInput) =>
      checked(
        options.resolve(input).pipe(
          Effect.flatMap(liveSet),
          Effect.map((set) => [...set.design, ...set.supporting]),
        ),
      );
    yield* pruneTrees;
    return { history, versionDesign, restore, undo, tracked, pruneTrees };
  });
