// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import type { CheckpointId, ProjectId } from "@t3tools/contracts";
import {
  ModelPreviewError,
  modelFormatOf,
  type ModelFileRef,
  type SignedFile,
  type ScadRenderInput,
  type ScadRenderResult,
} from "@t3tools/contracts/fork";
import type {
  ModelHistory as HistoryPage,
  ModelHistoryInput,
  ModelHistoryVersionInput,
  ModelHistoryVersionResult,
  ModelHistoryRestoreInput,
  ModelHistoryUndoInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Fiber from "effect/Fiber";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import { isTerminalRunStatus } from "../../../orchestration-v2/ThreadManagementService.ts";
import { scadReferences, resolveScadReference } from "../scadIncludes.ts";
import { SCAD_INPUT_EXTENSIONS } from "../formats.ts";
import { isContained } from "../signedFiles.ts";
import { createStemProtection, pruneList } from "../renderCache.ts";
import { makeHistoryGit, unavailable } from "./git.ts";
import { makeHistoryRestore } from "./restore.ts";
import {
  contentKey,
  historyCandidates,
  isLfsPointer,
  safeRepoPath,
  HISTORY_PAGE_DEFAULT,
  HISTORY_TRACKED_MAX,
  HISTORY_CLOSURE_DEPTH,
  HISTORY_CLOSURE_FILES,
  HISTORY_CLOSURE_BYTES,
  HISTORY_SCAD_PARSE_BYTES,
  HISTORY_TREES_MAX,
  HISTORY_TREES_BYTES,
  HISTORY_LS_TREE_CONCURRENCY,
  type TreeEntry,
} from "./helpers.ts";

export interface HistoryWorkspace {
  readonly root: string;
  readonly absolute: string;
  readonly projectId: ProjectId;
}
export interface HistorySnapshot extends HistoryWorkspace {
  readonly legacyParamsPath: null;
  readonly info: FileSystem.File.Info;
}
interface RenderedSnapshot {
  readonly status: "ok" | "error" | "cancelled";
  readonly mesh: SignedFile | null;
  readonly meshFormat: ModelHistoryVersionResult["meshFormat"];
  readonly render: ScadRenderResult | null;
}
export interface HistoryOptions {
  readonly historyDir: string;
  readonly resolveWorkspace: (
    file: ModelFileRef,
  ) => Effect.Effect<HistoryWorkspace, ModelPreviewError>;
  readonly sign: (
    root: string,
    absolute: string,
    allowLarge: boolean,
  ) => Effect.Effect<SignedFile, ModelPreviewError>;
  readonly renderSnapshot: (
    input: ScadRenderInput,
    resolved: HistorySnapshot,
  ) => Effect.Effect<RenderedSnapshot, ModelPreviewError>;
  readonly maxFileBytes: () => number;
  readonly currentDependencies?: (absolute: string) => ReadonlyArray<string>;
  readonly resolvedAnnotations?: (file: ModelFileRef) => Effect.Effect<
    ReadonlyArray<{
      readonly id: string;
      readonly resolvedIn: { readonly checkpointId: CheckpointId } | null;
    }>,
    ModelPreviewError
  >;
}
const fail = (reason: ModelPreviewError["reason"], message: string) =>
  new ModelPreviewError({ reason, message });
const TreeMeta = Schema.Struct({
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
const decodeMeta = Schema.decodeEffect(Schema.fromJsonString(TreeMeta));
const encodeMeta = Schema.encodeSync(Schema.fromJsonString(TreeMeta));
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const Gltf = Schema.Struct({
  buffers: Schema.optional(Schema.Array(Schema.Struct({ uri: Schema.optional(Schema.String) }))),
  images: Schema.optional(Schema.Array(Schema.Struct({ uri: Schema.optional(Schema.String) }))),
});
const decodeGltf = Schema.decodeUnknownEffect(Gltf);
const isHistoryError = Schema.is(ModelPreviewError);
const checked = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
  operation.pipe(
    Effect.mapError((error) =>
      isHistoryError(error) ? error : fail("command-failed", "The model history operation failed."),
    ),
  );

/** Checkpoint history lives in this helper; transports call the owning model service. */
export const makeHistory = Effect.fn("ModelHistory.make")(function* (options: HistoryOptions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const queries = yield* ProjectionStore.ProjectionStoreV2;
  const git = yield* makeHistoryGit;
  yield* fs.makeDirectory(options.historyDir, { recursive: true });
  const historyDir = yield* fs.realPath(options.historyDir);
  const treeDir = path.join(historyDir, "trees");
  yield* fs.makeDirectory(treeDir, { recursive: true });
  const restores = yield* makeHistoryRestore({ undoDir: path.join(historyDir, "undo"), git });
  const protection = createStemProtection();
  const treeLock = yield* Semaphore.make(1);
  const historyLock = yield* Semaphore.make(1);
  const jobLock = yield* Semaphore.make(1);
  const jobs = new Map<string, Fiber.Fiber<ModelHistoryVersionResult, ModelPreviewError>>();
  const listingCache = new Map<string, ReadonlyArray<TreeEntry>>();
  const closureCache = new Map<string, { paths: ReadonlyArray<string>; signature: string }>();
  const timestamp = Effect.map(DateTime.now, DateTime.toEpochMillis);
  const protect = (key: string) =>
    Effect.acquireRelease(
      Effect.sync(() => protection.acquire(key)),
      (release) => Effect.sync(release),
    );
  const repository = Effect.fn("ModelHistory.repository")(function* (file: ModelFileRef) {
    const workspace = yield* options.resolveWorkspace(file);
    const prefix = yield* git.repoPrefix(workspace.root);
    if (prefix === null)
      return yield* fail("workspace-not-found", "History needs a Git workspace.");
    return {
      ...workspace,
      prefix,
      top: yield* git.repoRoot(workspace.root),
      modelPath: prefix + file.path,
    };
  });
  const refsFromSource = Effect.fn("ModelHistory.references")(function* (
    absolute: string,
    containment: string,
  ) {
    const ext = path.extname(absolute).toLowerCase();
    if (!new Set([".scad", ".gltf", ".py"]).has(ext)) return [];
    const info = yield* fs.stat(absolute);
    if (Number(info.size) > HISTORY_SCAD_PARSE_BYTES) return [];
    const source = yield* fs.readFileString(absolute);
    if (ext === ".scad")
      return scadReferences(source)
        .map((ref) => resolveScadReference(absolute, ref))
        .filter(
          (ref) =>
            isContained(containment, ref) &&
            SCAD_INPUT_EXTENSIONS.has(path.extname(ref).toLowerCase()),
        );
    if (ext === ".gltf") {
      const value = yield* decodeJson(source).pipe(
        Effect.flatMap(decodeGltf),
        Effect.orElseSucceed(() => null),
      );
      if (value === null) return [];
      return [...(value.buffers ?? []), ...(value.images ?? [])].flatMap(({ uri }) => {
        if (!uri || /^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith("/")) return [];
        let decoded: string;
        try {
          decoded = decodeURIComponent(uri);
        } catch {
          return [];
        }
        const reference = path.resolve(path.dirname(absolute), decoded);
        return isContained(path.dirname(absolute), reference) && isContained(containment, reference)
          ? [reference]
          : [];
      });
    }
    // Resolve project-local literal Python imports without executing historical source.
    const modules: string[] = [];
    for (const match of source.matchAll(
      /^\s*(?:from\s+([.\w]+)\s+import\s+([\w, ]+)|import\s+([\w., ]+))/gm,
    )) {
      if (match[1]) {
        modules.push(match[1]);
        for (const name of match[2]!.split(","))
          modules.push(`${match[1]}.${name.trim().split(/\s+/)[0]}`);
      } else for (const name of match[3]!.split(",")) modules.push(name.trim().split(/\s+/)[0]!);
    }
    return [
      ...new Set(
        modules
          .flatMap((module) => {
            const relative = module.match(/^\.+/)?.[0].length ?? 0;
            const bases =
              relative > 0
                ? [
                    path.resolve(
                      path.dirname(absolute),
                      ...Array.from({ length: relative - 1 }, () => ".."),
                    ),
                  ]
                : [path.dirname(absolute), containment];
            const parts = module.slice(relative).split(".").filter(Boolean);
            return bases.flatMap((base) => [
              path.join(base, ...parts) + ".py",
              path.join(base, ...parts, "__init__.py"),
              ...parts
                .slice(0, -1)
                .map((_, index) => path.join(base, ...parts.slice(0, index + 1), "__init__.py")),
            ]);
          })
          .filter((ref) => isContained(containment, ref)),
      ),
    ];
  });
  const revisionSignature = (top: string, paths: ReadonlyArray<string>) =>
    Effect.forEach(paths, (relative) =>
      fs.stat(path.join(top, relative)).pipe(
        Effect.map(
          (info) =>
            `${relative}\0${Number(info.size)}\0${Option.getOrElse(
              Option.map(info.mtime, (date) => date.getTime()),
              () => 0,
            )}\0${Option.getOrElse(info.ino, () => 0)}`,
        ),
        Effect.orElseSucceed(() => `${relative}\0missing`),
      ),
    ).pipe(Effect.map((parts) => parts.join("\n")));
  const trackedPaths = Effect.fn("ModelHistory.trackedPaths")(function* (repo: {
    root: string;
    top: string;
    absolute: string;
    modelPath: string;
  }) {
    const extra = [
      ...(options.currentDependencies?.(repo.absolute) ?? []),
      ...(modelFormatOf(repo.absolute) === "build123d"
        ? [repo.absolute.replace(/\.b3d\.py$/i, ".json")]
        : []),
    ]
      .filter((ref) => isContained(repo.root, ref))
      .map((ref) => path.relative(repo.top, ref));
    const key = repo.absolute + "\0" + extra.join("\0");
    const cached = closureCache.get(key);
    if (cached && cached.signature === (yield* revisionSignature(repo.top, cached.paths)))
      return cached.paths;
    const tracked = new Set([repo.modelPath, ...extra]);
    let frontier = [repo.modelPath];
    for (
      let depth = 0;
      depth < HISTORY_CLOSURE_DEPTH && frontier.length > 0 && tracked.size < HISTORY_TRACKED_MAX;
      depth++
    ) {
      const next: string[] = [];
      for (const relative of frontier) {
        const absolute = path.join(repo.top, relative);
        const real = yield* fs.realPath(absolute).pipe(Effect.orElseSucceed(() => null));
        if (real === null || !isContained(repo.top, real)) continue;
        const refs = yield* refsFromSource(real, repo.top);
        for (const ref of refs) {
          const candidate = path.relative(repo.top, ref).split(path.sep).join("/");
          if (
            !safeRepoPath(candidate) ||
            tracked.has(candidate) ||
            tracked.size >= HISTORY_TRACKED_MAX
          )
            continue;
          tracked.add(candidate);
          next.push(candidate);
        }
      }
      frontier = next;
    }
    const paths = [...tracked].slice(0, HISTORY_TRACKED_MAX);
    if (closureCache.size >= 200) closureCache.delete(closureCache.keys().next().value!);
    closureCache.set(key, { paths, signature: yield* revisionSignature(repo.top, paths) });
    return paths;
  });
  const current = Effect.fn("ModelHistory.current")(function* (
    repo: { top: string; modelPath: string },
    tracked: ReadonlyArray<string>,
  ) {
    const hashes = yield* git.hashObjects(repo.top, tracked);
    const present = hashes.has(repo.modelPath);
    return {
      present,
      contentKey: present ? contentKey([...hashes].map(([path, oid]) => ({ path, oid }))) : null,
    };
  });
  const history = (input: ModelHistoryInput) =>
    checked(
      Effect.gen(function* () {
        const workspace = yield* options.resolveWorkspace(input.file);
        const records = yield* queries.getThreadRecords(input.file.threadId, [
          "checkpoints",
          "checkpointScopes",
          "runs",
        ]);
        const threadRunning = records.runs.some((run) => !isTerminalRunStatus(run.status));
        const prefix = yield* git.repoPrefix(workspace.root);
        if (prefix === null)
          return {
            versions: [],
            nextCursor: null,
            latestTurn: null,
            current: { present: yield* fs.exists(workspace.absolute), contentKey: null },
            threadRunning,
            unavailable: "not-git",
          } satisfies HistoryPage;
        const repo = {
          ...workspace,
          prefix,
          top: yield* git.repoRoot(workspace.root),
          modelPath: prefix + input.file.path,
        };
        const tracked = yield* trackedPaths(repo);
        const candidates = historyCandidates(
          records.checkpoints.filter((checkpoint) => checkpoint.threadId === input.file.threadId),
          records.checkpointScopes,
          new Set(tracked),
          input.cursor ?? null,
          input.limit ?? HISTORY_PAGE_DEFAULT,
        );
        const oids = yield* git.treeOids(
          repo.root,
          candidates.checkpoints.map((checkpoint) => checkpoint.ref),
        );
        const annotations = options.resolvedAnnotations
          ? yield* options.resolvedAnnotations(input.file)
          : [];
        const versions = yield* Effect.forEach(
          candidates.checkpoints,
          (checkpoint) =>
            Effect.gen(function* () {
              const tree = oids.get(checkpoint.ref);
              if (!tree) return null;
              const cacheKey = tree + "\0" + contentKey(tracked.map((path) => ({ path, oid: "" })));
              let entries = listingCache.get(cacheKey);
              if (entries) {
                listingCache.delete(cacheKey);
                listingCache.set(cacheKey, entries);
              } else {
                entries = yield* git.lsTree(repo.top, tree, tracked);
                if (listingCache.size >= 500)
                  listingCache.delete(listingCache.keys().next().value!);
                listingCache.set(cacheKey, entries);
              }
              const model = entries.find((entry) => entry.path === repo.modelPath);
              if (!model && checkpoint.runId === null) return null;
              return {
                checkpointId: checkpoint.id,
                runId: checkpoint.runId,
                turn: checkpoint.appRunOrdinal ?? 0,
                capturedAt: checkpoint.capturedAt,
                present: model !== undefined,
                contentKey: model ? contentKey(entries) : null,
                sizeBytes: model?.size ?? null,
                changed: checkpoint.files
                  .filter((file) => tracked.includes(file.path) && file.path.startsWith(prefix))
                  .map((file) => file.path.slice(prefix.length))
                  .slice(0, 20),
                resolvedAnnotations: annotations
                  .filter((annotation) => annotation.resolvedIn?.checkpointId === checkpoint.id)
                  .map((annotation) => annotation.id)
                  .slice(0, 30),
              };
            }),
          { concurrency: HISTORY_LS_TREE_CONCURRENCY },
        );
        return {
          versions: versions.filter((version) => version !== null),
          nextCursor: candidates.nextCursor,
          latestTurn: candidates.latestTurn,
          current: yield* current(repo, tracked),
          threadRunning,
          unavailable: null,
        } satisfies HistoryPage;
      }),
    );
  const checkpoint = Effect.fn("ModelHistory.checkpoint")(function* (
    file: ModelFileRef,
    id: CheckpointId,
  ) {
    const records = yield* queries.getThreadRecords(file.threadId, [
      "checkpoints",
      "checkpointScopes",
    ]);
    const candidate = records.checkpoints.find(
      (item) =>
        item.id === id &&
        item.threadId === file.threadId &&
        item.status === "ready" &&
        records.checkpointScopes.some(
          (scope) =>
            scope.id === item.scopeId &&
            scope.threadId === file.threadId &&
            scope.kind === "root_run",
        ) &&
        ((item.runId !== null && item.appRunOrdinal !== null) ||
          (item.runId === null && item.ordinalWithinScope === 0)),
    );
    if (!candidate) return yield* unavailable();
    return candidate;
  });
  const pruneTrees = treeLock.withPermit(
    Effect.gen(function* () {
      const names = yield* fs.readDirectory(treeDir);
      const records = yield* Effect.forEach(
        names.filter((name) => /^[a-f0-9]{64}$/.test(name)),
        (name) =>
          Effect.gen(function* () {
            const dir = path.join(treeDir, name);
            const meta = yield* fs.readFileString(path.join(dir, "meta.json")).pipe(
              Effect.flatMap(decodeMeta),
              Effect.orElseSucceed(() => null),
            );
            if (!meta) return null;
            const info = yield* fs.stat(dir);
            return {
              name,
              bytes: meta.bytes,
              modifiedAt: Option.getOrElse(
                Option.map(info.mtime, (date) => date.getTime()),
                () => 0,
              ),
            };
          }),
      );
      const removals = pruneList(
        records
          .filter((record) => record !== null)
          .filter((record) => !new Set(protection.stems()).has(record.name))
          .map((record) => ({
            path: record.name,
            size: record.bytes,
            modified: record.modifiedAt,
          })),
        HISTORY_TREES_MAX,
        HISTORY_TREES_BYTES,
      );
      yield* Effect.forEach(
        removals,
        (name) => fs.remove(path.join(treeDir, name), { recursive: true, force: true }),
        { discard: true },
      );
    }),
  );
  const materialize = (input: ModelHistoryVersionInput) =>
    checked(
      Effect.gen(function* () {
        const repo = yield* repository(input.file);
        const version = yield* checkpoint(input.file, input.checkpointId);
        const treeOid = yield* git.treeOid(repo.root, version.ref);
        const seeds =
          modelFormatOf(input.file.path) === "build123d"
            ? [
                ...new Set([
                  repo.modelPath,
                  repo.modelPath.replace(/\.b3d\.py$/i, ".json"),
                  ...(options.currentDependencies?.(repo.absolute) ?? [])
                    .filter((ref) => isContained(repo.root, ref))
                    .map((ref) => path.relative(repo.top, ref).split(path.sep).join("/"))
                    .filter(safeRepoPath),
                ]),
              ].toSorted()
            : [repo.modelPath];
        const key = NodeCrypto.createHash("sha256")
          .update(`${repo.root}\0${treeOid}\0${input.file.path}\0${seeds.join("\0")}`)
          .digest("hex");
        yield* protect(key);
        const target = path.join(treeDir, key);
        const meta = yield* treeLock.withPermit(
          Effect.gen(function* () {
            if (yield* fs.exists(path.join(target, "complete"))) {
              const meta = yield* fs
                .readFileString(path.join(target, "meta.json"))
                .pipe(Effect.flatMap(decodeMeta));
              yield* fs.utimes(target, (yield* timestamp) / 1000, (yield* timestamp) / 1000);
              return meta;
            }
            const pending = path.join(treeDir, `${key}.pending-${NodeCrypto.randomUUID()}`);
            const files = path.join(pending, "files");
            yield* fs.makeDirectory(files, { recursive: true });
            return yield* Effect.gen(function* () {
              const initial = yield* git.lsTree(repo.top, treeOid, seeds);
              const model = initial.find((entry) => entry.path === repo.modelPath);
              if (!model)
                return yield* fail(
                  "not-found",
                  `${path.basename(input.file.path)} did not exist ${version.appRunOrdinal === null ? "at the start of this thread" : `after turn ${version.appRunOrdinal}`}.`,
                );
              if (model.size > options.maxFileBytes() && !input.allowLarge)
                return yield* fail(
                  "too-large",
                  "This model is larger than the preview limit. Open it anyway to continue.",
                );
              const entries = new Map(initial.map((entry) => [entry.path, entry]));
              const searched = new Set(seeds);
              let frontier = initial;
              for (let depth = 0; depth <= HISTORY_CLOSURE_DEPTH && frontier.length > 0; depth++) {
                if (
                  entries.size > HISTORY_CLOSURE_FILES ||
                  [...entries.values()].reduce((total, entry) => total + entry.size, 0) >
                    HISTORY_CLOSURE_BYTES
                )
                  return yield* fail(
                    "command-failed",
                    "This version uses more than 200 files or 64 MB; it cannot be previewed.",
                  );
                yield* git.materialize(repo.top, treeOid, [...entries.values()], files);
                if (depth === HISTORY_CLOSURE_DEPTH) break;
                const discovered = new Set<string>();
                for (const entry of frontier)
                  for (const ref of yield* refsFromSource(path.join(files, entry.path), files)) {
                    const relative = path.relative(files, ref).split(path.sep).join("/");
                    if (safeRepoPath(relative) && !searched.has(relative)) {
                      searched.add(relative);
                      discovered.add(relative);
                    }
                  }
                if (discovered.size === 0) break;
                frontier = yield* git.lsTree(repo.top, treeOid, [...discovered]);
                for (const entry of frontier) entries.set(entry.path, entry);
                if (
                  entries.size > HISTORY_CLOSURE_FILES ||
                  [...entries.values()].reduce((total, entry) => total + entry.size, 0) >
                    HISTORY_CLOSURE_BYTES
                )
                  return yield* fail(
                    "command-failed",
                    "This version uses more than 200 files or 64 MB; it cannot be previewed.",
                  );
              }
              const meta = {
                treeOid,
                bytes: [...entries.values()].reduce((total, entry) => total + entry.size, 0),
                createdAt: yield* timestamp,
                entries: [...entries.values()],
              };
              yield* fs.writeFileString(path.join(pending, "meta.json"), encodeMeta(meta));
              yield* fs.writeFileString(path.join(pending, "complete"), "");
              yield* fs.rename(pending, target);
              return meta;
            }).pipe(
              Effect.ensuring(
                fs.remove(pending, { recursive: true, force: true }).pipe(Effect.ignore),
              ),
            );
          }),
        );
        const files = path.join(target, "files");
        const absolute = path.join(files, repo.modelPath);
        const info = yield* fs.stat(absolute);
        if (Number(info.size) > options.maxFileBytes() && !input.allowLarge)
          return yield* fail(
            "too-large",
            "This model is larger than the preview limit. Open it anyway to continue.",
          );
        if (Number(info.size) < 1024 && isLfsPointer(yield* fs.readFile(absolute)))
          return yield* fail(
            "command-failed",
            "This version is stored in Git LFS and cannot be previewed here.",
          );
        const historicalIncludes = meta.entries.filter(
          (entry) => entry.path !== repo.modelPath && entry.path.startsWith(repo.prefix),
        );
        const hashes = yield* git.hashObjects(
          repo.top,
          historicalIncludes.map((entry) => entry.path),
        );
        const differingIncludes = historicalIncludes
          .filter((entry) => hashes.get(entry.path) !== entry.oid)
          .map((entry) => entry.path.slice(repo.prefix.length));
        return {
          key,
          repo,
          treeOid,
          files,
          absolute,
          info,
          entries: meta.entries,
          differingIncludes,
          checkpoint: version,
          resolved: {
            root: files,
            absolute,
            projectId: repo.projectId,
            legacyParamsPath: null,
            info,
          } satisfies HistorySnapshot,
        };
      }),
    );
  const loadVersion = (input: ModelHistoryVersionInput) =>
    checked(
      Effect.scoped(
        Effect.gen(function* () {
          const snapshot = yield* materialize(input);
          yield* protect(snapshot.key);
          const format = modelFormatOf(input.file.path);
          if (
            format === "scad" ||
            format === "step" ||
            path.extname(input.file.path).toLowerCase() === ".py"
          ) {
            const rendered = yield* options.renderSnapshot(
              { file: input.file, overrides: {}, parameterSet: null },
              snapshot.resolved,
            );
            return {
              checkpointId: input.checkpointId,
              ...rendered,
              differingIncludes: snapshot.differingIncludes,
            } satisfies ModelHistoryVersionResult;
          }
          if (!format || !new Set(["stl", "3mf", "obj", "glb", "gltf"]).has(format))
            return yield* fail("command-failed", "This model format cannot be previewed.");
          return {
            checkpointId: input.checkpointId,
            status: "ok",
            mesh: yield* options.sign(snapshot.files, snapshot.absolute, input.allowLarge ?? false),
            meshFormat: format as ModelHistoryVersionResult["meshFormat"],
            render: null,
            differingIncludes: snapshot.differingIncludes,
          } satisfies ModelHistoryVersionResult;
        }),
      ),
    );
  const historyVersion = (input: ModelHistoryVersionInput) =>
    checked(
      Effect.gen(function* () {
        const resolved = yield* options.resolveWorkspace(input.file);
        const job = yield* jobLock.withPermit(
          Effect.gen(function* () {
            const previous = jobs.get(resolved.absolute);
            if (previous) yield* Fiber.interrupt(previous);
            const next = yield* Effect.forkChild(loadVersion(input));
            jobs.set(resolved.absolute, next);
            return next;
          }),
        );
        const result = yield* Fiber.await(job).pipe(
          Effect.ensuring(
            jobLock.withPermit(
              Effect.sync(() => {
                if (jobs.get(resolved.absolute) === job) jobs.delete(resolved.absolute);
              }),
            ),
          ),
        );
        if (Exit.isSuccess(result)) {
          yield* pruneTrees;
          return result.value;
        }
        if (Cause.hasInterruptsOnly(result.cause))
          return {
            checkpointId: input.checkpointId,
            status: "cancelled",
            mesh: null,
            meshFormat: null,
            render: null,
            differingIncludes: [],
          } satisfies ModelHistoryVersionResult;
        return yield* Effect.failCause(result.cause);
      }),
    );
  const historyCancel = (file: ModelFileRef) =>
    checked(
      Effect.gen(function* () {
        const workspace = yield* options.resolveWorkspace(file);
        yield* jobLock.withPermit(
          Effect.gen(function* () {
            const job = jobs.get(workspace.absolute);
            if (job) yield* Fiber.interrupt(job);
          }),
        );
      }),
    );
  const historyRestore = (input: ModelHistoryRestoreInput) =>
    checked(
      historyLock.withPermit(
        Effect.scoped(
          Effect.gen(function* () {
            const snapshot = yield* materialize({
              file: input.file,
              checkpointId: input.checkpointId,
              allowLarge: true,
            });
            yield* protect(snapshot.key);
            const tracked = yield* trackedPaths(snapshot.repo);
            const latest = yield* current(snapshot.repo, tracked);
            if (latest.contentKey !== input.expectedContentKey)
              return yield* fail(
                "conflict",
                `${path.basename(input.file.path)} changed since you opened history. Check the latest version, then try again.`,
              );
            const selected = new Set([
              snapshot.repo.modelPath,
              ...(input.includeDependencies
                ? snapshot.differingIncludes.map((relative) => snapshot.repo.prefix + relative)
                : []),
            ]);
            return yield* restores.restore({
              root: snapshot.repo.root,
              file: input.file,
              entries: snapshot.entries
                .filter((entry) => selected.has(entry.path))
                .map((entry) => ({
                  path: entry.path.slice(snapshot.repo.prefix.length),
                  source: path.join(snapshot.files, entry.path),
                  mode: entry.mode === "100755" ? 0o755 : 0o644,
                })),
            });
          }),
        ),
      ),
    );
  const historyUndo = (input: ModelHistoryUndoInput) =>
    checked(
      historyLock.withPermit(
        Effect.gen(function* () {
          const workspace = yield* options.resolveWorkspace(input.file);
          yield* restores.undo({ root: workspace.root, file: input.file, undoId: input.undoId });
        }),
      ),
    );
  const latestTouching = (file: ModelFileRef) =>
    checked(
      Effect.gen(function* () {
        const repo = yield* repository(file);
        const tracked = yield* trackedPaths(repo);
        const records = yield* queries.getThreadRecords(file.threadId, [
          "checkpoints",
          "checkpointScopes",
        ]);
        const found = historyCandidates(
          records.checkpoints.filter((checkpoint) => checkpoint.threadId === file.threadId),
          records.checkpointScopes,
          new Set(tracked),
          null,
          1,
        ).checkpoints.find((checkpoint) => checkpoint.appRunOrdinal !== null);
        return found
          ? { threadId: file.threadId, checkpointId: found.id, turn: found.appRunOrdinal! }
          : null;
      }),
    );
  const clearTrees = checked(
    jobLock.withPermit(
      Effect.gen(function* () {
        yield* Effect.forEach([...jobs.values()], Fiber.interrupt, { discard: true });
        jobs.clear();
        yield* treeLock.withPermit(
          Effect.gen(function* () {
            yield* fs.remove(treeDir, { recursive: true, force: true });
            yield* fs.makeDirectory(treeDir, { recursive: true });
          }),
        );
        listingCache.clear();
        closureCache.clear();
      }),
    ),
  );
  const names = yield* fs.readDirectory(treeDir);
  for (const name of names.filter((name) => /^[a-f0-9]{64}\.pending-/.test(name))) {
    const pending = path.join(treeDir, name);
    const info = yield* fs.stat(pending);
    if (
      (yield* timestamp) -
        Option.getOrElse(
          Option.map(info.mtime, (date) => date.getTime()),
          () => 0,
        ) >
      60 * 60 * 1000
    )
      yield* fs.remove(pending, { recursive: true, force: true });
  }
  return {
    history,
    historyVersion,
    historyCancel,
    historyRestore,
    historyUndo,
    materialize,
    latestTouching,
    clearTrees,
  };
});
