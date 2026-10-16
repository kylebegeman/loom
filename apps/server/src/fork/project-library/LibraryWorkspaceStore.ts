import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryProject,
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
  releaseRequestId: Schema.NullOr(Schema.String),
  releaseReviewToken: Schema.NullOr(Schema.String),
  removalPath: Schema.NullOr(Schema.String),
  archivePath: Schema.NullOr(Schema.String),
  archiveDigest: Schema.NullOr(Schema.String),
});
export type WorkspaceReceipt = typeof WorkspaceReceipt.Type;
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

/** Host receipts remain available when the central Library is disconnected. */
export class LibraryWorkspaceStore extends Context.Service<
  LibraryWorkspaceStore,
  {
    readonly receipts: Effect.Effect<ReadonlyArray<WorkspaceReceipt>, LibraryError>;
    readonly put: (receipt: WorkspaceReceipt) => Effect.Effect<void, LibraryError>;
    readonly get: (workingCopyId: string) => Effect.Effect<WorkspaceReceipt, LibraryError>;
    readonly getBinding: (
      threadId: ThreadId,
    ) => Effect.Effect<LibraryResolvedBinding | null, LibraryError>;
    readonly bind: (
      threadId: ThreadId,
      resolved: LibraryResolvedBinding,
      project?: LibraryProject,
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
  const databasePath = path.join(directory, "workspaces.json");
  const read = mapIo(
    Effect.gen(function* () {
      if (!(yield* fs.exists(databasePath)))
        return { version: 1 as const, receipts: [], bindings: [] };
      return yield* decodeDatabase(yield* fs.readFileString(databasePath));
    }),
  );
  const write = Effect.fnUntraced(function* (database: typeof Database.Type) {
    yield* fs.makeDirectory(directory, { recursive: true });
    const temporary = path.join(directory, `workspaces-${yield* randomUuidV4}.pending`);
    yield* Effect.gen(function* () {
      yield* fs.writeFileString(temporary, yield* encodeDatabase(database), {
        flag: "wx",
        mode: 0o600,
      });
      yield* Effect.scoped(fs.open(temporary).pipe(Effect.flatMap((file) => file.sync)));
      yield* fs.rename(temporary, databasePath);
      yield* Effect.scoped(fs.open(directory).pipe(Effect.flatMap((file) => file.sync)));
    }).pipe(Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
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
    repositoriesForRoot: (cwd, threadId) =>
      mapIo(
        Effect.gen(function* () {
          const normalized = path.resolve(cwd);
          const database = yield* read;
          const binding =
            threadId === undefined
              ? undefined
              : database.bindings.find((row) => row.threadId === threadId);
          const receipt = database.receipts.find(
            (row) =>
              path.resolve(row.copy.rootPath) === normalized &&
              row.copy.state !== "released" &&
              (binding === undefined || binding.resolved.binding.workingCopyId === row.copy.id),
          );
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
            if (
              (owners.length === 0 && !input.localProjectId.startsWith("library-copy:")) ||
              owners.some(
                (row) =>
                  row.copy.ownership === "borrowed" && row.legacyThreadIds.includes(input.threadId),
              )
            )
              return input.cwd;
            return yield* new LibraryError({ reason: "blocked" });
          }
          const receipt = yield* get(resolved.binding.workingCopyId);
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
              if (parent === ancestor) return yield* new LibraryError({ reason: "blocked" });
              ancestor = parent;
            }
            if ((yield* fs.realPath(ancestor)) !== ancestor)
              return yield* new LibraryError({ reason: "invalid" });
            return resolved.cwd;
          }
          if (
            receipt.copy.state !== "ready" ||
            input.localProjectId !== resolved.localProjectId ||
            !(yield* fs.exists(input.cwd)) ||
            (yield* fs.realPath(input.cwd)) !== resolved.cwd
          )
            return yield* new LibraryError({ reason: "blocked" });
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
