import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryProject,
  LibraryThreadBinding,
  LibraryWorkingCopy,
  LibraryResolvedBinding,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { libraryComputerDirectory } from "./enrollment.ts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as ServerConfig from "../../config.ts";

const FilesystemIdentity = Schema.Struct({
  device: Schema.NullOr(Schema.Number),
  inode: Schema.NullOr(Schema.Number),
});
export const WorkspaceReceipt = Schema.Struct({
  requestId: Schema.String,
  fingerprint: Schema.String,
  snapshotRequests: Schema.optional(
    Schema.Array(
      Schema.Struct({
        requestId: Schema.String,
        reviewToken: Schema.String,
        copy: LibraryWorkingCopy,
      }),
    ),
  ),
  unregisterRequests: Schema.optional(
    Schema.Array(Schema.Struct({ requestId: Schema.String, reviewToken: Schema.String })),
  ),
  registrationRequests: Schema.optional(
    Schema.Array(Schema.Struct({ requestId: Schema.String, fingerprint: Schema.String })),
  ),
  project: LibraryProject,
  copy: LibraryWorkingCopy,
  rootLocalProjectId: Schema.NullOr(ProjectId),
  rootCheckpointRepository: Schema.Boolean,
  legacyThreadIds: Schema.Array(ThreadId),
  rootIdentity: Schema.NullOr(FilesystemIdentity),
  reopenRequestId: Schema.optional(Schema.String),
  releaseRequestId: Schema.NullOr(Schema.String),
  releaseReviewToken: Schema.NullOr(Schema.String),
  removalPath: Schema.NullOr(Schema.String),
  archivePath: Schema.NullOr(Schema.String),
  archiveDigest: Schema.NullOr(Schema.String),
  /** Released without an archive because every file was in a clean repository already pushed. */
  publishedRelease: Schema.optional(Schema.Boolean),
  /**
   * A new copy whose conversation starts before its files download. Its folders and local
   * projects exist from the start; `resourceIds` is the request the download completes.
   */
  reservation: Schema.optional(
    Schema.Struct({
      resourceIds: Schema.Array(Schema.String),
      rootLocalProjectId: ProjectId,
      repositories: Schema.Array(
        Schema.Struct({
          resourceId: Schema.String,
          path: Schema.String,
          localProjectId: ProjectId,
        }),
      ),
    }),
  ),
});
export type WorkspaceReceipt = typeof WorkspaceReceipt.Type;
/**
 * The copy as the Library publishes it: each repository with its place and remote in the project
 * the copy was made for, which `keepsResource` compares, so clients skip copies we would refuse.
 */
export const placedCopy = (
  copy: LibraryWorkingCopy,
  project: LibraryProject,
): LibraryWorkingCopy => ({
  ...copy,
  repositories: copy.repositories.map((repository) => {
    const resource = project.resources.find(
      (entry) => entry.id === repository.resourceId && entry.kind !== "link",
    );
    return resource === undefined
      ? repository
      : { ...repository, relativePath: resource.relativePath, remoteUrl: resource.remoteUrl };
  }),
});
/** A reserved copy's files are still on their way, so its conversations wait for them. */
export const awaitingFiles = (receipt: WorkspaceReceipt) =>
  receipt.reservation !== undefined &&
  (receipt.copy.state === "preparing" || receipt.copy.state === "failed");
export const ImportedHistoryWatermark = Schema.Struct({
  authorityId: Schema.String,
  authorityEpoch: Schema.Number,
  sequence: Schema.Number,
  sourceEventSequence: Schema.Number,
});
const StoredBinding = Schema.Struct({
  importedHistory: Schema.optional(ImportedHistoryWatermark),
  threadId: ThreadId,
  resolved: LibraryResolvedBinding,
  project: Schema.optional(LibraryProject),
});
const Database = Schema.Struct({
  version: Schema.Literal(1),
  receipts: Schema.Array(WorkspaceReceipt),
  bindings: Schema.Array(StoredBinding),
});
/** A conversation whose history the Library saves while it keeps running wherever it started. */
export const SavedThread = Schema.Struct({
  threadId: ThreadId,
  localProjectId: ProjectId,
  binding: LibraryThreadBinding,
  /** It was already there when saving began, so it waits its turn in the backfill. */
  backfill: Schema.optional(Schema.Boolean),
});
export type SavedThread = typeof SavedThread.Type;
// Kept apart from workspaces.json, which every turn reads: execution never needs these records.
// Each binding's project manifest is stored once per revision.
const SavedHistory = Schema.Struct({
  version: Schema.Literal(1),
  projects: Schema.Array(LibraryProject),
  threads: Schema.Array(SavedThread),
});
const ReceiptIdentity = Schema.Struct({
  copyId: Schema.String,
  projectId: Schema.String,
  projectRevision: Schema.Number,
  environmentId: Schema.String,
  rootPath: Schema.String,
  ownership: Schema.Literals(["borrowed", "managed"]),
  rootLocalProjectId: Schema.NullOr(ProjectId),
  repositories: Schema.Array(
    Schema.Struct({ resourceId: Schema.String, path: Schema.String, localProjectId: ProjectId }),
  ),
});
const encodeIdentity = Schema.encodeEffect(Schema.fromJsonString(ReceiptIdentity));
const receiptIdentity = (receipt: WorkspaceReceipt) => ({
  copyId: receipt.copy.id,
  projectId: receipt.copy.projectId,
  projectRevision: receipt.copy.projectRevision,
  environmentId: receipt.copy.environmentId,
  rootPath: receipt.copy.rootPath,
  ownership: receipt.copy.ownership,
  rootLocalProjectId: receipt.rootLocalProjectId,
  repositories: receipt.copy.repositories
    .map(({ resourceId, path, localProjectId }) => ({ resourceId, path, localProjectId }))
    .toSorted((left, right) => left.resourceId.localeCompare(right.resourceId)),
});
const Codec = Schema.fromJsonString(Database);
const decodeDatabase = Schema.decodeEffect(Codec);
const encodeDatabase = Schema.encodeEffect(Codec);
const encodeBinding = Schema.encodeEffect(Schema.fromJsonString(LibraryResolvedBinding));
const encodeProject = Schema.encodeEffect(Schema.fromJsonString(LibraryProject));
const SavedCodec = Schema.fromJsonString(SavedHistory);
const decodeSaved = Schema.decodeEffect(SavedCodec);
const encodeSaved = Schema.encodeEffect(SavedCodec);
const encodeThreadBinding = Schema.encodeEffect(Schema.fromJsonString(LibraryThreadBinding));
// Unregistering or archiving the folder's project stops its saving; registering it again resumes.
const savesHistory = (receipts: ReadonlyArray<WorkspaceReceipt>, saved: SavedThread) => {
  const receipt = receipts.find((row) => row.copy.id === saved.binding.workingCopyId);
  return (
    receipt !== undefined &&
    receipt.copy.ownership === "borrowed" &&
    receipt.copy.state === "ready" &&
    receipt.copy.registered !== false &&
    !receipt.project.archived
  );
};

/** Host receipts remain available when the central Library is disconnected. */
export class LibraryWorkspaceStore extends Context.Service<
  LibraryWorkspaceStore,
  {
    readonly receipts: Effect.Effect<ReadonlyArray<WorkspaceReceipt>, LibraryError>;
    readonly put: (receipt: WorkspaceReceipt) => Effect.Effect<void, LibraryError>;
    /**
     * Takes the Library's archived flag onto every receipt of this project. The rest of each
     * receipt's project stays the revision its copy was laid out from.
     */
    readonly followArchived: (project: LibraryProject) => Effect.Effect<void, LibraryError>;
    readonly get: (workingCopyId: string) => Effect.Effect<WorkspaceReceipt, LibraryError>;
    readonly getBinding: (
      threadId: ThreadId,
    ) => Effect.Effect<LibraryResolvedBinding | null, LibraryError>;
    readonly bind: (
      threadId: ThreadId,
      resolved: LibraryResolvedBinding,
      project?: LibraryProject,
    ) => Effect.Effect<void, LibraryError>;
    /** Moves a bound conversation between its copy's folder and a worktree made from it. */
    readonly moveBinding: (
      threadId: ThreadId,
      resolved: LibraryResolvedBinding,
    ) => Effect.Effect<void, LibraryError>;
    readonly importBindings: (input: {
      readonly receipts: ReadonlyArray<WorkspaceReceipt>;
      readonly bindings: ReadonlyArray<{
        readonly threadId: ThreadId;
        readonly importedHistory?: typeof ImportedHistoryWatermark.Type;
        readonly resolved: LibraryResolvedBinding;
        readonly project: LibraryProject;
      }>;
    }) => Effect.Effect<void, LibraryError>;
    readonly getBoundProject: (
      threadId: ThreadId,
    ) => Effect.Effect<LibraryProject | null, LibraryError>;
    readonly bindings: Effect.Effect<ReadonlyArray<typeof StoredBinding.Type>, LibraryError>;
    /** Saved conversations without a binding whose folder still saves history, in recorded order. */
    readonly savedThreads: Effect.Effect<ReadonlyArray<SavedThread>, LibraryError>;
    readonly savedBinding: (threadId: ThreadId) => Effect.Effect<
      {
        readonly localProjectId: ProjectId;
        readonly binding: LibraryThreadBinding;
        readonly project: LibraryProject;
      } | null,
      LibraryError
    >;
    /**
     * Records conversations to save without binding them. A bound or already saved conversation
     * keeps what it has, except that a request without `backfill` moves it out of the backfill.
     */
    readonly saveHistory: (input: {
      readonly project: LibraryProject;
      readonly threads: ReadonlyArray<SavedThread>;
    }) => Effect.Effect<void, LibraryError>;
    readonly repositoriesForRoot: (
      cwd: string,
      threadId?: ThreadId,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly path: string; readonly relativePath: string }> | null,
      LibraryError
    >;
    readonly validateThreadCwd: (input: {
      readonly threadId: ThreadId;
      readonly localProjectId: ProjectId;
      readonly cwd: string;
    }) => Effect.Effect<string, LibraryError>;
  }
>()("t3/fork/project-library/LibraryWorkspaceStore") {}

const isLibraryError = Schema.is(LibraryError);
const mapIo = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
    ),
  );

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const locks = yield* KeyedLock.make<string>();
  const identity = yield* Effect.serviceOption(ServerEnvironmentIdentity);
  const externalDirectory = Option.isSome(identity)
    ? libraryComputerDirectory(
        yield* HostProcess.HomeDirectory,
        yield* identity.value.getEnvironmentId,
      )
    : null;
  const directory =
    externalDirectory !== null &&
    (yield* fs.exists(path.join(externalDirectory, "project-library", "host", "workspaces.json")))
      ? path.join(externalDirectory, "project-library", "host")
      : path.join(config.stateDir, "project-library", "host");
  // Turns and replication read these files every few seconds and decoding a large one takes
  // milliseconds. Every write renames a new file into place, so its inode, time and size identify
  // one decoded value.
  const cachedFile = <A, E>(
    target: string,
    empty: A,
    decode: (contents: string) => Effect.Effect<A, E>,
  ) => {
    let cached: { readonly key: string; readonly value: A } | undefined;
    return mapIo(
      Effect.gen(function* () {
        if (!(yield* fs.exists(target))) return empty;
        const info = yield* fs.stat(target);
        const key = `${Option.getOrNull(info.ino)}:${Option.getOrNull(info.mtime)?.getTime()}:${info.size}`;
        if (cached?.key === key) return cached.value;
        const value = yield* decode(yield* fs.readFileString(target));
        cached = { key, value };
        return value;
      }),
    );
  };
  const databasePath = path.join(directory, "workspaces.json");
  const read = cachedFile(
    databasePath,
    { version: 1 as const, receipts: [], bindings: [] },
    decodeDatabase,
  );
  const savedPath = path.join(directory, "saved-history.json");
  const readSaved = cachedFile(
    savedPath,
    { version: 1 as const, projects: [], threads: [] },
    decodeSaved,
  );
  const writeFile = Effect.fnUntraced(function* (target: string, contents: string) {
    yield* fs.makeDirectory(directory, { recursive: true });
    const temporary = path.join(directory, `workspaces-${yield* randomUuidV4}.pending`);
    yield* Effect.gen(function* () {
      yield* fs.writeFileString(temporary, contents, { flag: "wx", mode: 0o600 });
      yield* Effect.scoped(fs.open(temporary).pipe(Effect.flatMap((file) => file.sync)));
      yield* fs.rename(temporary, target);
      yield* Effect.scoped(fs.open(directory).pipe(Effect.flatMap((file) => file.sync)));
    }).pipe(Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
  });
  const write = Effect.fnUntraced(function* (database: typeof Database.Type) {
    yield* writeFile(databasePath, yield* encodeDatabase(database));
  });
  const get = Effect.fnUntraced(function* (workingCopyId: string) {
    const receipt = (yield* read).receipts.find((row) => row.copy.id === workingCopyId);
    if (receipt === undefined) return yield* new LibraryError({ reason: "not-found" });
    return receipt;
  });
  const getBinding = Effect.fnUntraced(function* (threadId: ThreadId) {
    return (yield* read).bindings.find((row) => row.threadId === threadId)?.resolved ?? null;
  });
  return LibraryWorkspaceStore.of({
    receipts: read.pipe(Effect.map((database) => database.receipts)),
    bindings: read.pipe(Effect.map((database) => database.bindings)),
    savedThreads: Effect.gen(function* () {
      const database = yield* read;
      const bound = new Set(database.bindings.map((row) => row.threadId));
      return (yield* readSaved).threads.filter(
        (row) => !bound.has(row.threadId) && savesHistory(database.receipts, row),
      );
    }),
    savedBinding: (threadId) =>
      mapIo(
        Effect.gen(function* () {
          const database = yield* read;
          if (database.bindings.some((row) => row.threadId === threadId)) return null;
          const saved = yield* readSaved;
          const entry = saved.threads.find((row) => row.threadId === threadId);
          if (entry === undefined || !savesHistory(database.receipts, entry)) return null;
          const project = saved.projects.find(
            (row) =>
              row.id === entry.binding.projectId && row.revision === entry.binding.projectRevision,
          );
          if (project === undefined) return yield* new LibraryError({ reason: "invalid" });
          return { localProjectId: entry.localProjectId, binding: entry.binding, project };
        }),
      ),
    saveHistory: (input) =>
      locks.withLock(
        savedPath,
        mapIo(
          Effect.gen(function* () {
            const bound = new Set((yield* read).bindings.map((row) => row.threadId));
            const saved = yield* readSaved;
            const threads = new Map(saved.threads.map((row) => [row.threadId, row]));
            let changed = false;
            for (const thread of input.threads) {
              if (
                thread.binding.projectId !== input.project.id ||
                thread.binding.projectRevision !== input.project.revision
              )
                return yield* new LibraryError({ reason: "invalid" });
              if (bound.has(thread.threadId)) continue;
              const previous = threads.get(thread.threadId);
              if (previous === undefined) threads.set(thread.threadId, thread);
              else if (
                previous.backfill === true &&
                thread.backfill !== true &&
                (yield* encodeThreadBinding(previous.binding)) ===
                  (yield* encodeThreadBinding(thread.binding))
              )
                threads.set(thread.threadId, { ...previous, backfill: false });
              else continue;
              changed = true;
            }
            if (!changed) return;
            const pinned = saved.projects.some(
              (row) => row.id === input.project.id && row.revision === input.project.revision,
            );
            yield* writeFile(
              savedPath,
              yield* encodeSaved({
                version: 1,
                projects: pinned ? saved.projects : [...saved.projects, input.project],
                threads: [...threads.values()],
              }),
            );
          }),
        ),
      ),
    get,
    getBinding,
    getBoundProject: (threadId) =>
      mapIo(
        Effect.gen(function* () {
          const saved = (yield* read).bindings.find((row) => row.threadId === threadId);
          if (saved === undefined) return null;
          return saved.project ?? (yield* get(saved.resolved.binding.workingCopyId)).project;
        }),
      ),
    importBindings: (input) =>
      locks.withLock(
        databasePath,
        mapIo(
          Effect.gen(function* () {
            const database = yield* read;
            const receipts = new Map(
              database.receipts.map((receipt) => [receipt.copy.id, receipt]),
            );
            for (const incoming of input.receipts) {
              const existing = receipts.get(incoming.copy.id);
              if (existing === undefined) receipts.set(incoming.copy.id, incoming);
              else {
                if (
                  (yield* encodeIdentity(receiptIdentity(existing))) !==
                  (yield* encodeIdentity(receiptIdentity(incoming)))
                )
                  return yield* new LibraryError({ reason: "blocked" });
                receipts.set(existing.copy.id, {
                  ...existing,
                  legacyThreadIds: [
                    ...new Set([...existing.legacyThreadIds, ...incoming.legacyThreadIds]),
                  ],
                });
              }
            }
            const bindings = new Map(
              database.bindings.map((binding) => [binding.threadId, binding]),
            );
            for (const incoming of input.bindings) {
              const copy = receipts.get(incoming.resolved.binding.workingCopyId);
              if (
                copy === undefined ||
                copy.copy.projectId !== incoming.resolved.binding.projectId ||
                copy.copy.environmentId !== incoming.resolved.binding.environmentId ||
                incoming.project.id !== copy.copy.projectId ||
                incoming.project.revision !== incoming.resolved.binding.projectRevision
              )
                return yield* new LibraryError({ reason: "invalid" });
              const existing = bindings.get(incoming.threadId);
              if (existing === undefined) bindings.set(incoming.threadId, incoming);
              else {
                const pinned =
                  existing.project ??
                  receipts.get(existing.resolved.binding.workingCopyId)?.project;
                if (
                  pinned === undefined ||
                  (yield* encodeBinding(existing.resolved)) !==
                    (yield* encodeBinding(incoming.resolved)) ||
                  (yield* encodeProject(pinned)) !== (yield* encodeProject(incoming.project))
                )
                  return yield* new LibraryError({ reason: "blocked" });
                if (incoming.importedHistory) {
                  const previous = existing.importedHistory;
                  if (
                    previous &&
                    (previous.authorityId !== incoming.importedHistory.authorityId ||
                      previous.authorityEpoch !== incoming.importedHistory.authorityEpoch ||
                      previous.sequence > incoming.importedHistory.sequence)
                  )
                    return yield* new LibraryError({ reason: "blocked" });
                  bindings.set(incoming.threadId, {
                    ...existing,
                    importedHistory: incoming.importedHistory,
                  });
                }
              }
            }
            yield* write({
              ...database,
              receipts: [...receipts.values()],
              bindings: [...bindings.values()],
            });
          }),
        ),
      ),
    put: (receipt) =>
      locks.withLock(
        databasePath,
        mapIo(
          Effect.gen(function* () {
            const database = yield* read;
            yield* write({
              ...database,
              receipts: [
                ...database.receipts.filter((row) => row.copy.id !== receipt.copy.id),
                receipt,
              ],
            });
          }),
        ),
      ),
    followArchived: (project) =>
      locks.withLock(
        databasePath,
        mapIo(
          Effect.gen(function* () {
            const database = yield* read;
            const stale = (row: WorkspaceReceipt) =>
              row.project.id === project.id && row.project.archived !== project.archived;
            if (!database.receipts.some(stale)) return;
            yield* write({
              ...database,
              receipts: database.receipts.map((row) =>
                stale(row)
                  ? { ...row, project: { ...row.project, archived: project.archived } }
                  : row,
              ),
            });
          }),
        ),
      ),
    bind: (threadId, resolved, project) =>
      locks.withLock(
        databasePath,
        mapIo(
          Effect.gen(function* () {
            const database = yield* read;
            const existing = database.bindings.find((row) => row.threadId === threadId);
            if (existing !== undefined) {
              if ((yield* encodeBinding(existing.resolved)) !== (yield* encodeBinding(resolved)))
                return yield* new LibraryError({ reason: "request-conflict" });
              const pinnedProject =
                existing.project ?? (yield* get(existing.resolved.binding.workingCopyId)).project;
              if (
                project !== undefined &&
                (yield* encodeProject(pinnedProject)) !== (yield* encodeProject(project))
              )
                return yield* new LibraryError({ reason: "request-conflict" });
              return;
            }
            const pinnedProject = project ?? (yield* get(resolved.binding.workingCopyId)).project;
            yield* write({
              ...database,
              bindings: [...database.bindings, { threadId, resolved, project: pinnedProject }],
            });
          }),
        ),
      ),
    moveBinding: (threadId, resolved) =>
      locks.withLock(
        databasePath,
        mapIo(
          Effect.gen(function* () {
            const database = yield* read;
            const existing = database.bindings.find((row) => row.threadId === threadId)?.resolved;
            if (
              existing === undefined ||
              (existing.worktreeOf ?? existing.cwd) !== (resolved.worktreeOf ?? resolved.cwd) ||
              existing.localProjectId !== resolved.localProjectId ||
              (yield* encodeThreadBinding(existing.binding)) !==
                (yield* encodeThreadBinding(resolved.binding))
            )
              return yield* new LibraryError({ reason: "request-conflict" });
            yield* write({
              ...database,
              bindings: database.bindings.map((row) =>
                row.threadId === threadId ? { ...row, resolved } : row,
              ),
            });
          }),
        ),
      ),
    repositoriesForRoot: (cwd, threadId) =>
      mapIo(
        Effect.gen(function* () {
          const normalized = path.resolve(cwd);
          const database = yield* read;
          const binding =
            threadId === undefined
              ? undefined
              : database.bindings.find((row) => row.threadId === threadId);
          const candidates = database.receipts.filter(
            (row) =>
              path.resolve(row.copy.rootPath) === normalized &&
              row.copy.state !== "released" &&
              (binding === undefined || binding.resolved.binding.workingCopyId === row.copy.id),
          );
          // A folder taken over by another project keeps its retired receipt for the old bound
          // conversations, which the binding above selects. Everything else uses the current one.
          const receipt = candidates.find((row) => row.copy.registered !== false) ?? candidates[0];
          if (receipt === undefined) return null;
          if (receipt.copy.repositories.length === 0 && receipt.rootCheckpointRepository)
            return [{ path: receipt.copy.rootPath, relativePath: "" }];
          if (
            binding !== undefined &&
            (binding.resolved.binding.workingCopyId !== receipt.copy.id ||
              path.resolve(binding.resolved.cwd) !== normalized)
          )
            return yield* new LibraryError({ reason: "invalid" });
          return receipt.copy.repositories
            .filter(
              (repository) =>
                binding === undefined || binding.resolved.repositoryPaths.includes(repository.path),
            )
            .map((repository) => ({
              path: repository.path,
              relativePath: path
                .relative(receipt.copy.rootPath, repository.path)
                .split(path.sep)
                .join("/"),
            }));
        }),
      ),
    validateThreadCwd: (input) =>
      mapIo(
        Effect.gen(function* () {
          const resolved = yield* getBinding(input.threadId);
          if (resolved === null) {
            const owners = (yield* read).receipts.filter(
              (row) =>
                row.rootLocalProjectId === input.localProjectId ||
                row.copy.repositories.some(
                  (repository) => repository.localProjectId === input.localProjectId,
                ),
            );
            // Borrowing an existing native project must not take over its launch path.
            // Library-created projects still require an explicit conversation binding.
            if (
              (!input.localProjectId.startsWith("library-copy:") &&
                owners.every((row) => row.copy.ownership === "borrowed")) ||
              owners.some(
                (row) =>
                  row.copy.ownership === "borrowed" && row.legacyThreadIds.includes(input.threadId),
              )
            )
              return input.cwd;
            return yield* new LibraryError({
              reason: "blocked",
              detail:
                "This conversation is not linked to its Library files, so it cannot run in this folder. Start a new conversation from the Library project instead.",
            });
          }
          const receipt = yield* get(resolved.binding.workingCopyId);
          const unavailableFiles = () =>
            new LibraryError({
              reason: "blocked",
              detail: `This conversation's files are not ready at ${resolved.cwd}. Put them back there, or start a new conversation from the Library project.`,
            });
          if (
            !(yield* fs.exists(input.cwd)) &&
            resolved.legacyWorktreeRoot !== undefined &&
            receipt.copy.ownership === "borrowed" &&
            receipt.copy.state === "ready" &&
            receipt.legacyThreadIds.includes(input.threadId) &&
            input.localProjectId === resolved.localProjectId &&
            path.resolve(input.cwd) === resolved.cwd &&
            resolved.cwd !== resolved.legacyWorktreeRoot &&
            ((receipt.rootLocalProjectId === input.localProjectId &&
              receipt.copy.rootPath === resolved.legacyWorktreeRoot) ||
              receipt.copy.repositories.some(
                (repository) =>
                  repository.localProjectId === input.localProjectId &&
                  repository.path === resolved.legacyWorktreeRoot,
              )) &&
            (yield* fs.exists(resolved.legacyWorktreeRoot)) &&
            (yield* fs.realPath(resolved.legacyWorktreeRoot)) === resolved.legacyWorktreeRoot &&
            (yield* fs.exists(path.join(resolved.legacyWorktreeRoot, ".git")))
          ) {
            // The normal provider-start path restores native branches/checkpoints. Only an
            // imported native worktree may pass this gate without its immutable cwd existing.
            let ancestor = path.dirname(resolved.cwd);
            while (!(yield* fs.exists(ancestor))) {
              const parent = path.dirname(ancestor);
              if (parent === ancestor) return yield* unavailableFiles();
              ancestor = parent;
            }
            if ((yield* fs.realPath(ancestor)) !== ancestor)
              return yield* new LibraryError({ reason: "invalid" });
            return resolved.cwd;
          }
          if (
            (receipt.copy.state !== "ready" && !awaitingFiles(receipt)) ||
            input.localProjectId !== resolved.localProjectId ||
            !(yield* fs.exists(input.cwd)) ||
            (yield* fs.realPath(input.cwd)) !== resolved.cwd
          )
            return yield* unavailableFiles();
          for (const repositoryPath of [resolved.cwd, ...resolved.repositoryPaths]) {
            if (!(yield* fs.exists(repositoryPath)))
              return yield* new LibraryError({ reason: "not-found" });
            if ((yield* fs.realPath(repositoryPath)) !== repositoryPath)
              return yield* new LibraryError({ reason: "invalid" });
          }
          return resolved.cwd;
        }),
      ),
  });
});

export const layer = Layer.effect(LibraryWorkspaceStore, make);
