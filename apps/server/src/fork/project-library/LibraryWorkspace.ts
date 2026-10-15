// @effect-diagnostics nodeBuiltinImport:off -- Stream recovery archive hashing without buffering archive bytes.
import { CommandId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryCopyStatus,
  type LibraryFolderInspection,
  type LibraryInspectFolderRequest,
  LibraryPrepareCopyRequest,
  LibraryProject,
  LibraryThreadBinding,
  LibraryResolvedBinding,
  type LibraryReleaseCopyRequest,
  type LibraryResolveBindingRequest,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as NodeCrypto from "node:crypto";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";
import * as Context from "effect/Context";
import * as Config from "effect/Config";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as LibraryWorkspaceStore from "./LibraryWorkspaceStore.ts";
import * as LibraryRecoveryPublisher from "./LibraryRecoveryPublisher.ts";
import { validLibraryResources } from "./policy.ts";
import { withWorkspaceLease } from "../../workspace/workspaceLease.ts";

export class LibraryWorkspace extends Context.Service<
  LibraryWorkspace,
  {
    readonly inspectFolder: (
      input: LibraryInspectFolderRequest,
    ) => Effect.Effect<LibraryFolderInspection, LibraryError>;
    readonly preparation: (input: {
      readonly requestId: string;
    }) => Effect.Effect<LibraryWorkingCopy | null, LibraryError>;
    readonly prepareCopy: (
      input: LibraryPrepareCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    readonly status: (input: {
      readonly workingCopyId: string;
    }) => Effect.Effect<LibraryCopyStatus, LibraryError>;
    readonly release: (
      input: LibraryReleaseCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    readonly unregister: (
      input: LibraryReleaseCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    readonly threadBinding: (input: {
      threadId: ThreadId;
    }) => Effect.Effect<LibraryThreadBinding | null, LibraryError>;
    readonly resolveBinding: (
      input: LibraryResolveBindingRequest,
    ) => Effect.Effect<LibraryResolvedBinding, LibraryError>;
    readonly bindThread: (input: {
      readonly threadId: ThreadId;
      readonly binding: LibraryThreadBinding;
      readonly project?: LibraryProject | undefined;
    }) => Effect.Effect<LibraryResolvedBinding, LibraryError>;
  }
>()("t3/fork/project-library/LibraryWorkspace") {}

const ReviewRepository = Schema.Struct({
  resourceId: Schema.String,
  head: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  changes: Schema.NullOr(Schema.String),
  unpushed: Schema.NullOr(Schema.String),
});
const ReviewState = Schema.Struct({
  copyId: Schema.String,
  root: Schema.String,
  device: Schema.Number,
  inode: Schema.NullOr(Schema.Number),
  state: LibraryWorkingCopy.fields.state,
  facts: Schema.Array(Schema.String),
});

const encodeWorkingCopy = Schema.encodeEffect(Schema.fromJsonString(LibraryWorkingCopy));
const encodePreparation = Schema.encodeEffect(Schema.fromJsonString(LibraryPrepareCopyRequest));
const encodeReviewRepository = Schema.encodeEffect(Schema.fromJsonString(ReviewRepository));
const encodeReviewState = Schema.encodeEffect(Schema.fromJsonString(ReviewState));

const FullRecoveryManifest = Schema.Struct({
  version: Schema.Literal(1),
  project: LibraryProject,
  copy: LibraryWorkingCopy,
  rootLocalProjectId: Schema.NullOr(ProjectId),
  rootCheckpointRepository: Schema.Boolean,
  bindings: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      resolved: LibraryResolvedBinding,
      project: Schema.optional(LibraryProject),
    }),
  ),
});
const encodeFullManifest = Schema.encodeEffect(Schema.fromJsonString(FullRecoveryManifest));
const isLibraryError = Schema.is(LibraryError);
const mapIo = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
    ),
  );

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const runner = yield* ProcessRunner.ProcessRunner;
  const projects = yield* ProjectService.ProjectService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
  const recoveryPublisher = yield* Effect.serviceOption(
    LibraryRecoveryPublisher.LibraryRecoveryPublisher,
  );
  const authorityOnly = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(
    Config.withDefault(false),
  );
  const supportsExecution = yield* Config.Boolean("LOOM_EXECUTION_ENABLED").pipe(
    Config.withDefault(!authorityOnly),
  );
  const locks = yield* KeyedLock.make<string>();
  const environmentId = yield* identity.getEnvironmentId;
  const homeDirectory = yield* HostProcess.HomeDirectory;
  const requestedRoot = (rootPath: string) =>
    path.resolve(expandHomePath(rootPath.trim(), homeDirectory));
  const digest = (text: string | Uint8Array) =>
    crypto
      .digest("SHA-256", typeof text === "string" ? new TextEncoder().encode(text) : text)
      .pipe(Effect.map(Hex.encode), Effect.orDie);
  const fileDigest = Effect.fnUntraced(function* (filePath: string) {
    const hash = NodeCrypto.createHash("sha256");
    yield* Stream.runForEach(fs.stream(filePath), (chunk) =>
      Effect.sync(() => {
        hash.update(chunk);
      }),
    );
    return hash.digest("hex");
  });
  const tarFormat = yield* Effect.cached(
    Effect.gen(function* () {
      const result = yield* runner.run({
        command: "tar",
        args: ["--version"],
        maxOutputBytes: 1024,
      });
      if (result.code !== 0) return yield* new LibraryError({ reason: "io" });
      return result.stdout.includes("bsdtar") ? "gnutar" : "gnu";
    }),
  );
  // GNU-format headers omit access times, so repeated streams bind review to exact archive contents.
  const streamWorkingCopy = Effect.fnUntraced(function* (rootPath: string, archivePath?: string) {
    const format = yield* tarFormat;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const hash = NodeCrypto.createHash("sha256");
        const child = yield* spawner.spawn(
          ChildProcess.make("tar", [
            `--format=${format}`,
            "-cf",
            "-",
            "-C",
            path.dirname(rootPath),
            "--",
            path.basename(rootPath),
          ]),
        );
        const body = child.stdout.pipe(
          Stream.tap((chunk) =>
            Effect.sync(() => {
              hash.update(chunk);
            }),
          ),
        );
        yield* Effect.all(
          [
            archivePath === undefined
              ? Stream.runDrain(body)
              : Stream.run(body, fs.sink(archivePath, { mode: 0o600 })),
            Stream.runDrain(child.stderr),
          ],
          { concurrency: "unbounded" },
        );
        if ((yield* child.exitCode) !== 0) return yield* new LibraryError({ reason: "blocked" });
        return hash.digest("hex");
      }),
    );
  });
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const contained = (root: string, candidate: string) => {
    const relative = path.relative(root, candidate);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
  };
  const git = Effect.fnUntraced(function* (
    cwd: string,
    args: ReadonlyArray<string>,
    allowFailure = false,
  ) {
    const result = yield* runner.run({
      command: "git",
      args,
      cwd,
      timeout: "2 minutes",
      maxOutputBytes: 1024 * 1024,
    });
    if (result.code !== 0 && !allowFailure)
      return yield* new LibraryError({ reason: "io", cause: result });
    return result.code === 0 ? result.stdout.trim() : null;
  });
  const inspectRepository = Effect.fnUntraced(function* (rootPath: string, repositoryPath: string) {
    if (!(yield* fs.exists(path.join(repositoryPath, ".git")))) return null;
    if ((yield* fs.realPath(repositoryPath)) !== repositoryPath) return null;
    const top = yield* git(repositoryPath, ["rev-parse", "--show-toplevel"], true);
    if (top === null || (yield* fs.realPath(top)) !== repositoryPath) return null;
    return {
      path: repositoryPath,
      relativePath: path.relative(rootPath, repositoryPath).split(path.sep).join("/") || ".",
      remoteUrl: yield* git(repositoryPath, ["remote", "get-url", "origin"], true),
      head: yield* git(repositoryPath, ["rev-parse", "--verify", "HEAD"], true),
      branch: yield* git(repositoryPath, ["symbolic-ref", "--quiet", "--short", "HEAD"], true),
    };
  });
  const inspectFolder = Effect.fn("LibraryWorkspace.inspectFolder")(function* (
    input: LibraryInspectFolderRequest,
  ) {
    const requested = requestedRoot(input.rootPath);
    if (!(yield* fs.exists(requested)))
      return { rootPath: requested, exists: false, repositories: [] };
    if ((yield* fs.stat(requested)).type !== "Directory")
      return yield* new LibraryError({ reason: "invalid" });
    const rootPath = yield* fs.realPath(requested);
    const repositories: Array<LibraryFolderInspection["repositories"][number]> = [];
    const rootRepository = yield* inspectRepository(rootPath, rootPath);
    if (rootRepository !== null) repositories.push(rootRepository);
    for (const entry of (yield* fs.readDirectory(rootPath)).toSorted()) {
      if (entry.startsWith(".")) continue;
      const candidate = path.join(rootPath, entry);
      if ((yield* fs.stat(candidate)).type !== "Directory") continue;
      const repository = yield* inspectRepository(rootPath, candidate);
      if (repository !== null) repositories.push(repository);
    }
    return { rootPath, exists: true, repositories };
  });
  const findLocalProjectId = Effect.fnUntraced(function* (cwd: string, workspaceLeaseHeld = false) {
    const exact = yield* projects.getByWorkspaceRoot(cwd, { workspaceLeaseHeld });
    if (Option.isSome(exact)) return exact.value.id;
    for (const project of yield* projects.listShells()) {
      if (
        (yield* fs.exists(project.workspaceRoot)) &&
        (yield* fs.realPath(project.workspaceRoot)) === cwd
      )
        return project.id;
    }
    return null;
  });
  const registerProject = Effect.fnUntraced(function* (
    requestId: string,
    copyId: string,
    cwd: string,
    title: string,
    leasedRoot: string,
  ) {
    const workspaceLeaseHeld = cwd === leasedRoot;
    const existingId = yield* findLocalProjectId(cwd, workspaceLeaseHeld);
    if (existingId !== null) return existingId;
    const localId = ProjectId.make(`library-copy:${copyId}:${(yield* digest(cwd)).slice(0, 16)}`);
    return (yield* projects.bootstrap(
      {
        commandId: CommandId.make(`library-copy:${requestId}:${localId}`),
        projectId: localId,
        title,
        workspaceRoot: cwd,
      },
      { workspaceLeaseHeld },
    )).project.id;
  });

  const prepareCopy = Effect.fn("LibraryWorkspace.prepareCopy")(function* (
    input: LibraryPrepareCopyRequest,
  ) {
    if (!supportsExecution) return yield* new LibraryError({ reason: "blocked" });
    if (
      !validLibraryResources(input.project.resources, {
        allowLocalRemotes: input.strategy === "reuse",
      })
    )
      return yield* new LibraryError({ reason: "invalid" });
    const requestedPath = requestedRoot(input.rootPath);
    const rootPath = (yield* fs.exists(requestedPath))
      ? yield* fs.realPath(requestedPath)
      : path.join(yield* fs.realPath(path.dirname(requestedPath)), path.basename(requestedPath));
    if (contained(rootPath, config.stateDir)) return yield* new LibraryError({ reason: "invalid" });
    const requestedIds =
      input.resourceIds === undefined
        ? input.project.resources
            .filter((resource) => resource.kind !== "link")
            .map((resource) => resource.id)
        : [...new Set(input.resourceIds)];
    if (requestedIds.length !== (input.resourceIds?.length ?? requestedIds.length))
      return yield* new LibraryError({ reason: "invalid" });
    const resources = requestedIds.map((id) =>
      input.project.resources.find((resource) => resource.kind !== "link" && resource.id === id),
    );
    if (resources.some((resource) => resource === undefined) || input.project.archived)
      return yield* new LibraryError({ reason: "invalid" });
    const selected = resources.filter((resource) => resource !== undefined);
    const paths = selected.map((resource) => path.resolve(rootPath, resource.relativePath));
    if (
      new Set(paths).size !== paths.length ||
      selected.some(
        (resource, index) =>
          path.isAbsolute(resource.relativePath) ||
          resource.relativePath.includes("\0") ||
          !contained(rootPath, paths[index]!),
      )
    )
      return yield* new LibraryError({ reason: "invalid" });
    const fingerprint = yield* digest(
      yield* encodePreparation({
        ...input,
        rootPath,
        resourceIds: requestedIds.toSorted(),
      }),
    );
    const receipts = yield* store.receipts;
    const existing = receipts.find(
      (receipt) =>
        receipt.requestId === input.requestId ||
        receipt.registrationRequests?.some((request) => request.requestId === input.requestId),
    );
    const savedFingerprint =
      existing?.requestId === input.requestId
        ? existing.fingerprint
        : existing?.registrationRequests?.find((request) => request.requestId === input.requestId)
            ?.fingerprint;
    if (existing !== undefined && savedFingerprint !== fingerprint)
      return yield* new LibraryError({ reason: "request-conflict" });
    if (existing?.copy.state === "ready" || existing?.copy.state === "released")
      return existing.copy;
    const compatible = (receipt: LibraryWorkspaceStore.WorkspaceReceipt) =>
      selected.every((resource) => {
        const original = receipt.project.resources.find(
          (entry) => entry.id === resource.id && entry.kind !== "link",
        );
        return (
          original !== undefined &&
          receipt.copy.repositories.some((entry) => entry.resourceId === resource.id) &&
          path.resolve(rootPath, original.relativePath) ===
            path.resolve(rootPath, resource.relativePath) &&
          (original.remoteUrl === null
            ? resource.remoteUrl === null
            : resource.remoteUrl !== null &&
              normalizeGitRemoteUrl(original.remoteUrl) ===
                normalizeGitRemoteUrl(resource.remoteUrl))
        );
      });
    const reusable = receipts.find(
      (receipt) =>
        receipt.copy.rootPath === rootPath &&
        receipt.copy.ownership === "borrowed" &&
        receipt.copy.registered !== false &&
        receipt.copy.projectId === input.project.id &&
        compatible(receipt) &&
        (receipt.copy.state === "ready" || receipt.copy.state === "missing"),
    );
    if (existing === undefined && reusable !== undefined && input.strategy === "reuse") {
      yield* resolveBinding({
        binding: {
          projectId: input.project.id,
          projectRevision: input.project.revision,
          workingCopyId: reusable.copy.id,
          environmentId,
          resourceIds: requestedIds,
        },
        project: input.project,
      });
      // Shadow imports preserve source IDs without writing the live catalog. Materialize any
      // component records through the normal project service when this copy is first reused.
      const required = [
        ...(reusable.rootLocalProjectId
          ? [{ id: reusable.rootLocalProjectId, cwd: rootPath, title: input.project.title }]
          : []),
        ...reusable.copy.repositories.map((repository) => ({
          id: repository.localProjectId,
          cwd: repository.path,
          title:
            input.project.resources.find((resource) => resource.id === repository.resourceId)
              ?.title ?? input.project.title,
        })),
      ];
      for (const record of required) {
        const current = yield* projects.getById(record.id);
        if (Option.isSome(current)) {
          if (
            (yield* fs.realPath(current.value.workspaceRoot)) !== (yield* fs.realPath(record.cwd))
          )
            return yield* new LibraryError({ reason: "invalid" });
        } else {
          const created = yield* projects.bootstrap(
            {
              commandId: CommandId.make(`library-reuse:${reusable.copy.id}:${record.id}`),
              projectId: record.id,
              title: record.title,
              workspaceRoot: record.cwd,
            },
            { workspaceLeaseHeld: record.cwd === requestedRoot(input.rootPath) },
          );
          if (created.project.id !== record.id)
            return yield* new LibraryError({ reason: "blocked" });
        }
      }
      const restored = {
        ...reusable,
        copy: {
          ...reusable.copy,
          rootLocalProjectId: reusable.rootLocalProjectId,
          state: "ready" as const,
          updatedAt: yield* now,
        },
        registrationRequests: [
          ...(reusable.registrationRequests ?? []),
          { requestId: input.requestId, fingerprint },
        ],
      };
      yield* store.put(restored);
      return restored.copy;
    }
    const retired = receipts.find(
      (receipt) =>
        receipt.copy.rootPath === rootPath &&
        receipt.copy.ownership === "borrowed" &&
        receipt.copy.registered === false &&
        receipt.copy.projectId === input.project.id &&
        compatible(receipt),
    );
    if (existing === undefined && retired !== undefined && input.strategy === "reuse") {
      yield* resolveBinding(
        {
          binding: {
            projectId: input.project.id,
            projectRevision: input.project.revision,
            workingCopyId: retired.copy.id,
            environmentId,
            resourceIds: requestedIds,
          },
          project: input.project,
        },
        true,
      );
      const restored = {
        ...retired,
        copy: { ...retired.copy, registered: true, updatedAt: yield* now },
        releaseRequestId: null,
        releaseReviewToken: null,
        registrationRequests: [
          ...(retired.registrationRequests ?? []),
          { requestId: input.requestId, fingerprint },
        ],
      };
      yield* store.put(restored);
      return restored.copy;
    }
    const conflicting = receipts.find(
      (receipt) =>
        receipt.copy.rootPath === rootPath &&
        receipt.copy.state !== "released" &&
        receipt.copy.registered !== false &&
        receipt.requestId !== input.requestId &&
        !(input.strategy === "reuse" && receipt.copy.projectId === input.project.id),
    );
    if (conflicting !== undefined) return yield* new LibraryError({ reason: "blocked" });
    let receipt: LibraryWorkspaceStore.WorkspaceReceipt;
    if (existing === undefined) {
      if (input.strategy === "reuse") {
        if (!(yield* fs.exists(rootPath))) return yield* new LibraryError({ reason: "not-found" });
      } else {
        if (yield* fs.exists(rootPath)) return yield* new LibraryError({ reason: "blocked" });
        yield* fs.makeDirectory(rootPath);
      }
      const info = yield* fs.stat(rootPath);
      if (info.type !== "Directory") return yield* new LibraryError({ reason: "invalid" });
      const snapshot = input.strategy === "reuse" ? yield* projections.getShellSnapshot() : null;
      const existingProjects =
        input.strategy === "reuse"
          ? yield* Effect.forEach([...new Set([rootPath, ...paths])], (workspaceRoot) =>
              findLocalProjectId(workspaceRoot, workspaceRoot === requestedRoot(input.rootPath)),
            )
          : [];
      const existingProjectIds = new Set(
        existingProjects.filter((projectId) => projectId !== null),
      );
      const legacyThreadIds =
        snapshot === null
          ? []
          : [...snapshot.threads, ...snapshot.archivedThreads]
              .filter(
                (thread) =>
                  existingProjectIds.has(thread.projectId) ||
                  (thread.worktreePath !== null && contained(rootPath, thread.worktreePath)),
              )
              .map((thread) => thread.id);
      const timestamp = yield* now;
      receipt = {
        requestId: input.requestId,
        fingerprint,
        project: input.project,
        copy: {
          id: `copy:${(yield* digest(`${environmentId}\0${input.requestId}`)).slice(0, 40)}`,
          projectId: input.project.id,
          projectRevision: input.project.revision,
          environmentId,
          rootPath,
          repositories: [],
          ownership: input.strategy === "reuse" ? "borrowed" : "managed",
          state: "preparing",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        rootLocalProjectId: null,
        rootCheckpointRepository: false,
        legacyThreadIds,
        rootIdentity: { device: info.dev, inode: Option.getOrNull(info.ino) },
        releaseRequestId: null,
        releaseReviewToken: null,
        removalPath: null,
        archivePath: null,
        archiveDigest: null,
      };
      yield* store.put(receipt);
    } else receipt = existing;
    const prepared = yield* Effect.result(
      Effect.gen(function* () {
        const repositories: Array<LibraryWorkingCopy["repositories"][number]> = [];
        for (const resource of selected.toSorted(
          (left, right) => left.relativePath.length - right.relativePath.length,
        )) {
          const repositoryPath = path.resolve(rootPath, resource.relativePath);
          if (
            input.strategy === "clone" &&
            !(yield* fs.exists(path.join(repositoryPath, ".git")))
          ) {
            if (
              resource.remoteUrl === null ||
              resource.remoteUrl.startsWith("-") ||
              resource.remoteUrl.includes("\0")
            )
              return yield* new LibraryError({ reason: "invalid" });
            if (repositoryPath !== rootPath)
              yield* fs.makeDirectory(path.dirname(repositoryPath), { recursive: true });
            if (repositoryPath !== rootPath && (yield* fs.exists(repositoryPath)))
              return yield* new LibraryError({ reason: "blocked" });
            const cloned = yield* runner.run({
              command: "git",
              args: [
                "clone",
                ...(resource.defaultBranch === null ? [] : ["--branch", resource.defaultBranch]),
                "--",
                resource.remoteUrl,
                repositoryPath,
              ],
              timeout: "10 minutes",
              maxOutputBytes: 1024 * 1024,
            });
            if (cloned.code !== 0) return yield* new LibraryError({ reason: "io", cause: cloned });
          }
          const inspected = yield* inspectRepository(rootPath, repositoryPath);
          if (
            inspected === null ||
            (resource.remoteUrl !== null &&
              (inspected.remoteUrl === null ||
                normalizeGitRemoteUrl(resource.remoteUrl) !==
                  normalizeGitRemoteUrl(inspected.remoteUrl)))
          )
            return yield* new LibraryError({ reason: "invalid" });
          repositories.push({
            resourceId: resource.id,
            path: repositoryPath,
            localProjectId: yield* registerProject(
              input.requestId,
              receipt.copy.id,
              repositoryPath,
              resource.title,
              requestedRoot(input.rootPath),
            ),
            head: inspected.head,
            branch: inspected.branch,
          });
          receipt = { ...receipt, copy: { ...receipt.copy, repositories: [...repositories] } };
          yield* store.put(receipt);
        }
        if (
          selected.length === 0 &&
          input.strategy === "clone" &&
          !(yield* fs.exists(path.join(rootPath, ".git")))
        ) {
          yield* git(rootPath, ["init", "--initial-branch=main"]);
          yield* git(rootPath, [
            "-c",
            "user.name=Loom",
            "-c",
            "user.email=loom@local",
            "commit",
            "--allow-empty",
            "-m",
            "Initialize project workspace",
          ]);
        }
        const rootCheckpointRepository =
          selected.length === 0 && (yield* inspectRepository(rootPath, rootPath)) !== null;
        const rootLocalProjectId = yield* registerProject(
          input.requestId,
          receipt.copy.id,
          rootPath,
          input.project.title,
          requestedRoot(input.rootPath),
        );
        const ready = {
          ...receipt,
          rootLocalProjectId,
          rootCheckpointRepository,
          copy: {
            ...receipt.copy,
            rootLocalProjectId,
            repositories,
            state: "ready" as const,
            updatedAt: yield* now,
          },
        };
        yield* store.put(ready);
        return ready.copy;
      }),
    );
    if (prepared._tag === "Failure") {
      yield* store.put({
        ...receipt,
        copy: { ...receipt.copy, state: "failed", updatedAt: yield* now },
      });
      return yield* Effect.fail(prepared.failure);
    }
    return prepared.success;
  });

  const status = Effect.fn("LibraryWorkspace.status")(function* (input: {
    readonly workingCopyId: string;
  }) {
    const receipt = yield* store.get(input.workingCopyId);
    const copy = receipt.copy;
    const blockers: string[] = [];
    const facts: string[] = [];
    if (copy.state === "released" || copy.registered === false)
      return { copy, blockers, reviewToken: null, contentsDigest: null };
    if (copy.ownership === "borrowed")
      return {
        copy,
        blockers,
        reviewToken: yield* digest(`unregister:${yield* encodeWorkingCopy(copy)}`),
        contentsDigest: null,
      };
    const rootExists = yield* fs.exists(copy.rootPath);
    if (!rootExists)
      return {
        copy: { ...copy, state: "missing" as const },
        blockers: ["The working folder is unavailable."],
        reviewToken: null,
        contentsDigest: null,
      };
    if ((yield* fs.realPath(copy.rootPath)) !== copy.rootPath)
      blockers.push("The working folder now points to a different location.");
    const info = yield* fs.stat(copy.rootPath);
    if (
      copy.ownership === "managed" &&
      (receipt.rootIdentity?.device !== info.dev ||
        receipt.rootIdentity?.inode === null ||
        receipt.rootIdentity?.inode !== Option.getOrNull(info.ino))
    )
      blockers.push("Ownership of this working folder changed.");
    const bindings = (yield* store.bindings).filter(
      (row) => row.resolved.binding.workingCopyId === copy.id,
    );
    const snapshot = yield* projections.getShellSnapshot();
    const registeredProjects = yield* projects.listShells();
    const ownProjectIds = new Set([
      receipt.rootLocalProjectId,
      ...copy.repositories.map((repository) => repository.localProjectId),
    ]);
    if (
      registeredProjects.some(
        (project) =>
          !ownProjectIds.has(project.id) && contained(copy.rootPath, project.workspaceRoot),
      )
    )
      blockers.push("Another project uses a folder inside this working folder.");
    if (
      (yield* store.receipts).some(
        (other) =>
          other.copy.id !== copy.id &&
          other.copy.state !== "released" &&
          contained(copy.rootPath, other.copy.rootPath),
      )
    )
      blockers.push("Another working copy uses a folder inside this working folder.");
    const containedProjectIds = new Set(
      registeredProjects
        .filter((project) => contained(copy.rootPath, project.workspaceRoot))
        .map((project) => project.id),
    );
    for (const thread of [...snapshot.threads, ...snapshot.archivedThreads]) {
      if (
        thread.activeRunId !== null &&
        (containedProjectIds.has(thread.projectId) ||
          bindings.some((binding) => binding.threadId === thread.id) ||
          (thread.worktreePath !== null && contained(copy.rootPath, thread.worktreePath)) ||
          copy.repositories.some((repository) => repository.localProjectId === thread.projectId) ||
          receipt.rootLocalProjectId === thread.projectId)
      )
        blockers.push("A conversation is still running in this working folder.");
    }
    const repositories: Array<LibraryWorkingCopy["repositories"][number]> = [];
    for (const repository of copy.repositories) {
      const inspected = (yield* fs.exists(repository.path))
        ? yield* inspectRepository(copy.rootPath, repository.path)
        : null;
      if (inspected === null) {
        blockers.push("A repository in this working folder is unavailable.");
        continue;
      }
      const changes = yield* git(repository.path, [
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "-z",
      ]);
      const unpushed = yield* git(
        repository.path,
        ["rev-list", "--count", "HEAD", "--not", "--remotes"],
        true,
      );
      facts.push(
        yield* encodeReviewRepository({
          resourceId: repository.resourceId,
          head: inspected.head,
          branch: inspected.branch,
          changes,
          unpushed,
        }),
      );
      if (copy.ownership === "managed") {
        const gitPath = path.join(repository.path, ".git");
        if (
          (yield* fs.stat(gitPath)).type !== "Directory" ||
          (yield* fs.realPath(gitPath)) !== gitPath
        )
          blockers.push("A repository uses an external Git directory.");
      }
      repositories.push({ ...repository, head: inspected.head, branch: inspected.branch });
    }
    if (receipt.rootCheckpointRepository) {
      const gitPath = path.join(copy.rootPath, ".git");
      if (
        copy.ownership === "managed" &&
        ((yield* fs.stat(gitPath)).type !== "Directory" ||
          (yield* fs.realPath(gitPath)) !== gitPath)
      )
        blockers.push("The project folder uses an external Git directory.");
      const changes = yield* git(copy.rootPath, [
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "-z",
      ]);
      facts.push(
        yield* encodeReviewRepository({
          resourceId: "project-root",
          head: yield* git(copy.rootPath, ["rev-parse", "HEAD"]),
          branch: yield* git(copy.rootPath, ["symbolic-ref", "--quiet", "--short", "HEAD"], true),
          changes,
          unpushed: null,
        }),
      );
    }
    const state =
      repositories.length === copy.repositories.length ? copy.state : ("missing" as const);
    const current = {
      ...copy,
      repositories:
        repositories.length === copy.repositories.length ? repositories : copy.repositories,
      state,
    };
    const contentsDigest = blockers.length === 0 ? yield* streamWorkingCopy(copy.rootPath) : null;
    if (contentsDigest !== null) facts.push(`contents:${contentsDigest}`);
    return {
      copy: current,
      contentsDigest,
      blockers: [...new Set(blockers)],
      reviewToken:
        blockers.length === 0
          ? yield* digest(
              yield* encodeReviewState({
                copyId: copy.id,
                root: copy.rootPath,
                device: info.dev,
                inode: Option.getOrNull(info.ino),
                state,
                facts,
              }),
            )
          : null,
    };
  });

  const resolveBinding = Effect.fn("LibraryWorkspace.resolveBinding")(function* (
    input: LibraryResolveBindingRequest & { readonly project?: LibraryProject | undefined },
    allowUnregistered = false,
  ) {
    const receipt = yield* store.get(input.binding.workingCopyId);
    const copy = receipt.copy;
    const project = input.project ?? receipt.project;
    if (
      project.archived ||
      project.id !== copy.projectId ||
      !validLibraryResources(project.resources, { allowLocalRemotes: true }) ||
      copy.environmentId !== environmentId ||
      input.binding.environmentId !== environmentId ||
      copy.projectId !== input.binding.projectId ||
      project.revision !== input.binding.projectRevision ||
      copy.state !== "ready" ||
      (!allowUnregistered && copy.registered === false)
    )
      return yield* new LibraryError({ reason: "invalid" });
    const resourceIds =
      input.binding.resourceIds.length === 0
        ? project.resources
            .filter((resource) => resource.kind !== "link")
            .map((resource) => resource.id)
        : input.binding.resourceIds;
    if (input.binding.resourceIds.length > 1) {
      const projectRepositoryIds = project.resources
        .filter((resource) => resource.kind !== "link")
        .map((resource) => resource.id);
      if (
        resourceIds.length !== projectRepositoryIds.length ||
        projectRepositoryIds.some((id) => !resourceIds.includes(id))
      )
        return yield* new LibraryError({ reason: "invalid" });
    }
    if (new Set(resourceIds).size !== resourceIds.length)
      return yield* new LibraryError({ reason: "invalid" });
    const repositories = resourceIds.map((id) =>
      copy.repositories.find((repository) => repository.resourceId === id),
    );
    if (repositories.some((repository) => repository === undefined))
      return yield* new LibraryError({ reason: "invalid" });
    const selected = repositories.filter((repository) => repository !== undefined);
    if (selected.length === 0 && !receipt.rootCheckpointRepository)
      return yield* new LibraryError({ reason: "context-copy-required" });
    for (const repository of selected) {
      const original = receipt.project.resources.find(
        (resource) => resource.id === repository.resourceId && resource.kind !== "link",
      );
      const current = project.resources.find(
        (resource) => resource.id === repository.resourceId && resource.kind !== "link",
      );
      if (
        original === undefined ||
        current === undefined ||
        path.resolve(copy.rootPath, original.relativePath) !==
          path.resolve(copy.rootPath, current.relativePath) ||
        (original.remoteUrl === null
          ? current.remoteUrl !== null
          : current.remoteUrl === null ||
            normalizeGitRemoteUrl(original.remoteUrl) !== normalizeGitRemoteUrl(current.remoteUrl))
      )
        return yield* new LibraryError({ reason: "invalid" });
      if (!(yield* fs.exists(repository.path)))
        return yield* new LibraryError({ reason: "not-found" });
      const actual = yield* inspectRepository(copy.rootPath, repository.path);
      if (
        actual === null ||
        (current.remoteUrl !== null &&
          (actual.remoteUrl === null ||
            normalizeGitRemoteUrl(current.remoteUrl) !== normalizeGitRemoteUrl(actual.remoteUrl)))
      )
        return yield* new LibraryError({ reason: "invalid" });
    }
    const component = input.binding.resourceIds.length === 1 ? selected[0] : undefined;
    const cwd = component?.path ?? copy.rootPath;
    const localProjectId = component?.localProjectId ?? receipt.rootLocalProjectId;
    if (localProjectId === null) return yield* new LibraryError({ reason: "invalid" });
    for (const repositoryPath of [cwd, ...selected.map((repository) => repository.path)]) {
      if (!(yield* fs.exists(repositoryPath)))
        return yield* new LibraryError({ reason: "not-found" });
      if ((yield* fs.realPath(repositoryPath)) !== repositoryPath)
        return yield* new LibraryError({ reason: "invalid" });
    }
    return {
      cwd,
      localProjectId,
      repositoryPaths: selected.map((repository) => repository.path),
      binding: input.binding,
    };
  });

  const unregister = Effect.fn("LibraryWorkspace.unregister")(function* (
    input: LibraryReleaseCopyRequest,
  ) {
    const receipt = yield* store.get(input.workingCopyId);
    const previous = receipt.unregisterRequests?.find(
      (request) => request.requestId === input.requestId,
    );
    if (
      previous !== undefined &&
      (previous.reviewToken !== input.reviewToken || receipt.copy.registered !== false)
    )
      return yield* new LibraryError({ reason: "request-conflict" });
    if (receipt.copy.ownership !== "borrowed")
      return yield* new LibraryError({ reason: "invalid" });
    if (
      receipt.releaseRequestId !== null &&
      (receipt.releaseRequestId !== input.requestId ||
        receipt.releaseReviewToken !== input.reviewToken)
    )
      return yield* new LibraryError({ reason: "request-conflict" });
    if (receipt.copy.registered === false) return receipt.copy;
    const reviewed = yield* status({ workingCopyId: input.workingCopyId });
    if (reviewed.reviewToken !== input.reviewToken)
      return yield* new LibraryError({ reason: "blocked" });
    const removed = {
      ...receipt,
      unregisterRequests: [
        ...(receipt.unregisterRequests ?? []),
        { requestId: input.requestId, reviewToken: input.reviewToken },
      ],
      releaseRequestId: input.requestId,
      releaseReviewToken: input.reviewToken,
      copy: { ...receipt.copy, registered: false, updatedAt: yield* now },
    };
    yield* store.put(removed);
    return removed.copy;
  });

  const release = Effect.fn("LibraryWorkspace.release")(function* (
    input: LibraryReleaseCopyRequest,
  ) {
    let receipt = yield* store.get(input.workingCopyId);
    if (receipt.copy.ownership === "borrowed") return yield* unregister(input);
    if (
      receipt.releaseRequestId !== null &&
      (receipt.releaseRequestId !== input.requestId ||
        receipt.releaseReviewToken !== input.reviewToken)
    )
      return yield* new LibraryError({ reason: "request-conflict" });
    if (receipt.copy.state === "released") return receipt.copy;
    if (receipt.removalPath === null) {
      const reviewed = yield* status({ workingCopyId: input.workingCopyId });
      if (
        reviewed.reviewToken === null ||
        reviewed.reviewToken !== input.reviewToken ||
        reviewed.blockers.length !== 0
      )
        return yield* new LibraryError({ reason: "blocked" });
      if (receipt.copy.ownership === "managed") {
        if (Option.isNone(recoveryPublisher) || !recoveryPublisher.value.configured)
          return yield* new LibraryError({ reason: "publisher-unavailable" });
        const archiveDirectory = path.join(config.stateDir, "project-library", "archives");
        yield* fs.makeDirectory(archiveDirectory, { recursive: true, mode: 0o700 });
        const archivePath = path.join(
          archiveDirectory,
          `${(yield* digest(receipt.copy.id)).slice(0, 40)}.tar`,
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const manifestDirectory = yield* fs.makeTempDirectoryScoped({
              directory: archiveDirectory,
              prefix: "manifest-",
            });
            const bindings = (yield* store.bindings).filter(
              (row) => row.resolved.binding.workingCopyId === receipt.copy.id,
            );
            yield* fs.writeFileString(
              path.join(manifestDirectory, "loom-working-copy.json"),
              yield* encodeFullManifest({
                version: 1,
                project: receipt.project,
                copy: receipt.copy,
                rootLocalProjectId: receipt.rootLocalProjectId,
                rootCheckpointRepository: receipt.rootCheckpointRepository,
                bindings,
              }),
              { mode: 0o600 },
            );
            if (
              (yield* streamWorkingCopy(receipt.copy.rootPath, archivePath)) !==
              reviewed.contentsDigest
            )
              return yield* new LibraryError({ reason: "blocked" });
            const result = yield* runner.run({
              command: "tar",
              args: ["-rf", archivePath, "-C", manifestDirectory, "loom-working-copy.json"],
              timeout: "10 minutes",
              maxOutputBytes: 1024,
              outputMode: "truncate",
            });
            if (result.code !== 0) return yield* new LibraryError({ reason: "io", cause: result });
          }),
        );
        yield* fs.chmod(archivePath, 0o600);
        const verified = yield* runner.run({
          command: "tar",
          args: ["-tf", archivePath],
          timeout: "10 minutes",
          maxOutputBytes: 1024,
          outputMode: "truncate",
        });
        if (verified.code !== 0) return yield* new LibraryError({ reason: "io", cause: verified });
        const archiveDigest = yield* fileDigest(archivePath);
        yield* Effect.scoped(fs.open(archivePath).pipe(Effect.flatMap((file) => file.sync)));
        yield* Effect.scoped(fs.open(archiveDirectory).pipe(Effect.flatMap((file) => file.sync)));
        const stillCurrent = yield* status({ workingCopyId: input.workingCopyId });
        if (stillCurrent.reviewToken !== input.reviewToken)
          return yield* new LibraryError({ reason: "blocked" });
        const recovery = yield* recoveryPublisher.value.publish({
          archivePath,
          sha256: archiveDigest,
          manifest: {
            version: 1,
            projectId: receipt.copy.projectId,
            projectRevision: receipt.copy.projectRevision,
            copyId: receipt.copy.id,
            environmentId: receipt.copy.environmentId,
            title: receipt.project.title,
            rootBasename: path.basename(receipt.copy.rootPath),
            manifestFile: "loom-working-copy.json",
          },
        });
        receipt = {
          ...receipt,
          copy: {
            ...receipt.copy,
            recovery: {
              sha256: recovery.sha256,
              byteLength: recovery.byteLength,
              archiveKey: recovery.archiveKey,
              verifiedAt: recovery.verifiedAt,
            },
          },
          releaseRequestId: input.requestId,
          releaseReviewToken: input.reviewToken,
          archivePath,
          archiveDigest,
          removalPath: `${receipt.copy.rootPath}.loom-released-${(yield* digest(input.requestId)).slice(0, 16)}`,
        };
        yield* store.put(receipt);
      }
    }
    if (receipt.copy.ownership === "managed") {
      if (
        receipt.copy.recovery === undefined ||
        receipt.copy.recovery.sha256 !== receipt.archiveDigest
      )
        return yield* new LibraryError({ reason: "archive-unverified" });
      if (
        receipt.archivePath === null ||
        receipt.archiveDigest === null ||
        receipt.removalPath === null ||
        !(yield* fs.exists(receipt.archivePath)) ||
        (yield* fileDigest(receipt.archivePath)) !== receipt.archiveDigest
      )
        return yield* new LibraryError({ reason: "blocked" });
      if (yield* fs.exists(receipt.copy.rootPath)) {
        if (yield* fs.exists(receipt.removalPath))
          return yield* new LibraryError({ reason: "blocked" });
        const current = yield* status({ workingCopyId: input.workingCopyId });
        if (current.reviewToken !== input.reviewToken)
          return yield* new LibraryError({ reason: "blocked" });
        yield* fs.rename(receipt.copy.rootPath, receipt.removalPath);
      }
      if (yield* fs.exists(receipt.removalPath)) {
        const info = yield* fs.stat(receipt.removalPath);
        if (
          (yield* fs.realPath(receipt.removalPath)) !== receipt.removalPath ||
          receipt.rootIdentity?.device !== info.dev ||
          receipt.rootIdentity?.inode !== Option.getOrNull(info.ino)
        )
          return yield* new LibraryError({ reason: "blocked" });
        yield* fs.remove(receipt.removalPath, { recursive: true });
      }
    }
    const released = {
      ...receipt,
      releaseRequestId: input.requestId,
      releaseReviewToken: input.reviewToken,
      copy: { ...receipt.copy, state: "released" as const, updatedAt: yield* now },
    };
    yield* store.put(released);
    return released.copy;
  });

  return LibraryWorkspace.of({
    threadBinding: (input) =>
      store.getBinding(input.threadId).pipe(Effect.map((resolved) => resolved?.binding ?? null)),
    inspectFolder: (input) => mapIo(inspectFolder(input)),
    preparation: (input) =>
      store.receipts.pipe(
        Effect.map(
          (receipts) =>
            receipts.find(
              (receipt) =>
                receipt.requestId === input.requestId ||
                receipt.registrationRequests?.some(
                  (request) => request.requestId === input.requestId,
                ),
            )?.copy ?? null,
        ),
      ),
    prepareCopy: (input) =>
      locks.withLock(
        "prepare",
        withWorkspaceLease(requestedRoot(input.rootPath), mapIo(prepareCopy(input))),
      ),
    status: (input) =>
      mapIo(
        status(input).pipe(Effect.map(({ contentsDigest: _contentsDigest, ...review }) => review)),
      ),
    unregister: (input) => locks.withLock("prepare", mapIo(unregister(input))),
    release: (input) =>
      locks.withLock(
        "prepare",
        mapIo(
          Effect.gen(function* () {
            const receipt = yield* store.get(input.workingCopyId);
            return yield* withWorkspaceLease(receipt.copy.rootPath, release(input));
          }),
        ),
      ),
    resolveBinding: (input) => mapIo(resolveBinding(input)),
    bindThread: (input) =>
      locks.withLock(
        "prepare",
        mapIo(
          Effect.gen(function* () {
            const savedBinding = yield* store.getBinding(input.threadId);
            const savedCopy =
              savedBinding === null ? null : yield* store.get(savedBinding.binding.workingCopyId);
            const resolved =
              savedBinding !== null && savedCopy?.copy.registered === false
                ? { ...savedBinding, binding: input.binding }
                : yield* resolveBinding({
                    binding: input.binding,
                    ...(input.project === undefined ? {} : { project: input.project }),
                  });
            const thread = yield* projections.getThread(input.threadId);
            const localProject = yield* projects.getById(thread.projectId);
            const threadCwd = thread.worktreePath ?? Option.getOrNull(localProject)?.workspaceRoot;
            if (
              thread.projectId !== resolved.localProjectId ||
              threadCwd === undefined ||
              !(yield* fs.exists(threadCwd)) ||
              (yield* fs.realPath(threadCwd)) !== resolved.cwd
            )
              return yield* new LibraryError({ reason: "invalid" });
            const existing = yield* store.getBinding(input.threadId);
            if (
              existing === null &&
              (yield* projections.getThreadShell(input.threadId))?.latestRunId != null
            )
              return yield* new LibraryError({ reason: "blocked" });
            yield* store.bind(input.threadId, resolved, input.project);
            return resolved;
          }),
        ),
      ),
  });
});

export const layer = Layer.effect(LibraryWorkspace, make);
