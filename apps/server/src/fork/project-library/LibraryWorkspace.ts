// @effect-diagnostics nodeBuiltinImport:off -- Stream recovery archive hashing without buffering archive bytes.
import { CommandId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  type LibraryApplyProfileRequest,
  LibraryError,
  type LibraryCopyHealth,
  type LibraryCopyHealthRequest,
  type LibraryCopyStatus,
  type LibraryFolderInspection,
  type LibraryInspectFolderRequest,
  LibraryPrepareCopyRequest,
  type LibraryProfileReadiness,
  type LibraryProfileReadinessRequest,
  type LibraryProfileSettings,
  type LibraryProfileSettingsRequest,
  LibraryProject,
  LibraryThreadBinding,
  LibraryResolvedBinding,
  type LibraryReleaseCopyRequest,
  type LibrarySetCopyRetentionRequest,
  type LibraryReopenCopyRequest,
  type LibraryResolveBindingRequest,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as NodeCrypto from "node:crypto";
import * as NodeZlib from "node:zlib";
import * as NodeStream from "@effect/platform-node/NodeStream";
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
import { fileIdentity } from "../fileIdentity.ts";
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
import * as LibraryPublisher from "./LibraryPublisher.ts";
import { makeCopyHealthReader } from "./LibraryCopyHealth.ts";
import { makeProfileReadinessReader } from "./LibraryProfileReadiness.ts";
import { makeProfileSettings } from "./LibraryProfileSettings.ts";
import { validLibraryResources } from "./policy.ts";
import { withWorkspaceLease } from "../../workspace/workspaceLease.ts";
import { restoreManagedProjectCheckout } from "../../workspace/ManagedProjectCheckout.ts";

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
    /** Live branch, divergence and change counts for each repository in a copy on this computer. */
    readonly health: (
      input: LibraryCopyHealthRequest,
    ) => Effect.Effect<LibraryCopyHealth, LibraryError>;
    /** Checks a project's required tools on this computer. Secret values are never read. */
    readonly readiness: (
      input: LibraryProfileReadinessRequest,
    ) => Effect.Effect<LibraryProfileReadiness, LibraryError>;
    /** Where a copy's local project settings differ from its project's setup. */
    readonly profileSettings: (
      input: LibraryProfileSettingsRequest,
    ) => Effect.Effect<LibraryProfileSettings, LibraryError>;
    /** Replaces the reviewed differences with the setup's values; a changed one is `blocked`. */
    readonly applyProfile: (
      input: LibraryApplyProfileRequest,
    ) => Effect.Effect<LibraryProfileSettings, LibraryError>;
    readonly setCopyRetention: (
      input: LibrarySetCopyRetentionRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    readonly reopenCopy: (
      input: LibraryReopenCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    readonly prepareThreadFiles: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<void, LibraryError>;
    readonly cleanupTemporaryCopies: Effect.Effect<void, LibraryError>;
    readonly release: (
      input: LibraryReleaseCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    readonly unregister: (
      input: LibraryReleaseCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    readonly threadProject: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<LibraryProject | null, LibraryError>;
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
  device: Schema.NullOr(Schema.Number),
  inode: Schema.NullOr(Schema.Number),
  state: LibraryWorkingCopy.fields.state,
  facts: Schema.Array(Schema.String),
});

const encodeWorkingCopy = Schema.encodeEffect(Schema.fromJsonString(LibraryWorkingCopy));
const encodePreparation = Schema.encodeEffect(Schema.fromJsonString(LibraryPrepareCopyRequest));
const encodeReviewRepository = Schema.encodeEffect(Schema.fromJsonString(ReviewRepository));
const encodeReviewState = Schema.encodeEffect(Schema.fromJsonString(ReviewState));

const TAR_BLOCK_BYTES = 512;
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
  const restorationServices =
    yield* Effect.context<Effect.Services<ReturnType<typeof restoreManagedProjectCheckout>>>();
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
  const publisher = yield* Effect.serviceOption(LibraryPublisher.LibraryPublisher);
  const authorityOnly = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(
    Config.withDefault(false),
  );
  const supportsExecution = yield* Config.Boolean("LOOM_EXECUTION_ENABLED").pipe(
    Config.withDefault(!authorityOnly),
  );
  const locks = yield* KeyedLock.make<string>();
  const pendingKeeps = new Map<string, number>();
  const readHealth = yield* makeCopyHealthReader;
  const readReadiness = yield* makeProfileReadinessReader;
  const settings = yield* makeProfileSettings;
  const environmentId = yield* identity.getEnvironmentId;
  const homeDirectory = yield* HostProcess.HomeDirectory;
  const requestedRoot = (rootPath: string) =>
    path.resolve(expandHomePath(rootPath.trim(), homeDirectory));
  const canonicalRoot = Effect.fn("LibraryWorkspace.canonicalRoot")(function* (rootPath: string) {
    const requestedPath = requestedRoot(rootPath);
    let ancestor = requestedPath;
    while (!(yield* fs.exists(ancestor))) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return yield* new LibraryError({ reason: "not-found" });
      ancestor = parent;
    }
    return path.resolve(yield* fs.realPath(ancestor), path.relative(ancestor, requestedPath));
  });
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
  const streamWorkingCopy = Effect.fnUntraced(function* (
    rootPath: string,
    archive?: { readonly path: string; readonly manifestDirectory: string },
  ) {
    const format = yield* tarFormat;
    // With one-block records the suffix after this fixed manifest entry is the exact reviewed tar.
    let manifestBytes =
      archive === undefined
        ? 0
        : TAR_BLOCK_BYTES *
          (1 +
            Math.ceil(
              Number(
                (yield* fs.stat(path.join(archive.manifestDirectory, "loom-working-copy.json")))
                  .size,
              ) / TAR_BLOCK_BYTES,
            ));
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const hash = NodeCrypto.createHash("sha256");
        const child = yield* spawner.spawn(
          ChildProcess.make("tar", [
            `--format=${format}`,
            "-b",
            "1",
            "-cf",
            "-",
            ...(archive === undefined
              ? []
              : ["-C", archive.manifestDirectory, "loom-working-copy.json"]),
            "-C",
            path.dirname(rootPath),
            `./${path.basename(rootPath)}`,
          ]),
        );
        const body = child.stdout.pipe(
          Stream.tap((chunk) =>
            Effect.sync(() => {
              const skip = Math.min(manifestBytes, chunk.length);
              manifestBytes -= skip;
              hash.update(chunk.subarray(skip));
            }),
          ),
        );
        yield* Effect.all(
          [
            archive === undefined
              ? Stream.runDrain(body)
              : body.pipe(
                  NodeStream.pipeThroughSimple(() => NodeZlib.createGzip()),
                  Stream.run(fs.sink(archive.path, { mode: 0o600 })),
                ),
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

  const ensureCheckpointRoot = Effect.fn("LibraryWorkspace.ensureCheckpointRoot")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
  ) {
    const rootPath = receipt.copy.rootPath;
    if (
      !(yield* fs.exists(rootPath)) ||
      (yield* fs.stat(rootPath)).type !== "Directory" ||
      (yield* fs.realPath(rootPath)) !== rootPath
    )
      return yield* new LibraryError({ reason: "invalid" });
    const gitPath = path.join(rootPath, ".git");
    // Never initialize over dangling links or unrecognized Git metadata. Borrowed
    // repositories may already use a gitdir file, as native worktrees do.
    if ((yield* fs.readDirectory(rootPath)).includes(".git")) {
      const gitType = (yield* fs.stat(gitPath)).type;
      if (
        (gitType !== "Directory" &&
          !(receipt.copy.ownership === "borrowed" && gitType === "File")) ||
        (yield* fs.realPath(gitPath)) !== gitPath ||
        (yield* inspectRepository(rootPath, rootPath)) === null
      )
        return yield* new LibraryError({ reason: "invalid" });
    } else {
      if ((yield* git(rootPath, ["rev-parse", "--is-bare-repository"], true)) === "true")
        return yield* new LibraryError({ reason: "invalid" });
      yield* git(rootPath, ["init", "--initial-branch=main"]);
      if ((yield* inspectRepository(rootPath, rootPath)) === null)
        return yield* new LibraryError({ reason: "invalid" });
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
    if (receipt.rootCheckpointRepository) return receipt;
    const checkpointable = { ...receipt, rootCheckpointRepository: true };
    yield* store.put(checkpointable);
    return checkpointable;
  });

  const prepareCopy = Effect.fn("LibraryWorkspace.prepareCopy")(function* (
    input: LibraryPrepareCopyRequest,
    rootPath: string,
  ) {
    if (!supportsExecution) return yield* new LibraryError({ reason: "blocked" });
    if (
      !validLibraryResources(input.project.resources, {
        allowLocalRemotes: input.strategy === "reuse",
      })
    )
      return yield* new LibraryError({ reason: "invalid" });
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
    if (input.strategy === "reuse")
      yield* restoreManagedProjectCheckout(rootPath, true).pipe(
        Effect.provide(restorationServices),
      );
    if (existing?.copy.state === "ready") {
      if (selected.length === 0 && existing.copy.repositories.length === 0)
        yield* ensureCheckpointRoot(existing);
      return existing.copy;
    }
    if (existing?.copy.state === "released") return existing.copy;
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
      if (selected.length === 0 && reusable.copy.repositories.length === 0)
        yield* ensureCheckpointRoot(reusable);
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
            { workspaceLeaseHeld: record.cwd === rootPath },
          );
          if (created.project.id !== record.id)
            return yield* new LibraryError({ reason: "blocked" });
        }
      }
      const restored = {
        ...(yield* store.get(reusable.copy.id)),
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
      if (selected.length === 0 && retired.copy.repositories.length === 0)
        yield* ensureCheckpointRoot(retired);
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
        ...(yield* store.get(retired.copy.id)),
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
        yield* fs.makeDirectory(rootPath, { recursive: true });
      }
      const info = yield* fs.stat(rootPath);
      if (info.type !== "Directory") return yield* new LibraryError({ reason: "invalid" });
      const snapshot = input.strategy === "reuse" ? yield* projections.getShellSnapshot() : null;
      const existingProjects =
        input.strategy === "reuse"
          ? yield* Effect.forEach([...new Set([rootPath, ...paths])], (workspaceRoot) =>
              findLocalProjectId(workspaceRoot, workspaceRoot === rootPath),
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
          keepOnComputer: input.strategy === "reuse",
          state: "preparing",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        rootLocalProjectId: null,
        rootCheckpointRepository: false,
        legacyThreadIds,
        rootIdentity: fileIdentity(info),
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
              rootPath,
            ),
            head: inspected.head,
            branch: inspected.branch,
          });
          receipt = { ...receipt, copy: { ...receipt.copy, repositories: [...repositories] } };
          yield* store.put(receipt);
        }
        if (selected.length === 0) receipt = yield* ensureCheckpointRoot(receipt);
        const rootCheckpointRepository = receipt.rootCheckpointRepository;
        const rootLocalProjectId = yield* registerProject(
          input.requestId,
          receipt.copy.id,
          rootPath,
          input.project.title,
          rootPath,
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
    if (copy.environmentId !== environmentId) return yield* new LibraryError({ reason: "invalid" });
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
    const identity = fileIdentity(info);
    if (
      copy.ownership === "managed" &&
      (identity.device === null ||
        receipt.rootIdentity?.device !== identity.device ||
        receipt.rootIdentity?.inode === null ||
        receipt.rootIdentity?.inode !== identity.inode)
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
                device: identity.device,
                inode: identity.inode,
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

  const isTemporaryCopy = (copy: LibraryWorkingCopy) =>
    copy.environmentId === environmentId &&
    copy.ownership === "managed" &&
    copy.keepOnComputer === false &&
    !pendingKeeps.has(copy.id) &&
    copy.registered !== false &&
    copy.state === "ready";

  const canCleanUp = Effect.fn("LibraryWorkspace.canCleanUp")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
  ) {
    const copy = receipt.copy;
    if (!isTemporaryCopy(copy)) return false;
    const bindings = (yield* store.bindings).filter(
      (row) => row.resolved.binding.workingCopyId === copy.id,
    );
    const projectIds = new Set([
      receipt.rootLocalProjectId,
      ...copy.repositories.map((repository) => repository.localProjectId),
    ]);
    const snapshot = yield* projections.getShellSnapshot();
    const related = [...snapshot.threads, ...snapshot.archivedThreads].filter(
      (thread) =>
        projectIds.has(thread.projectId) ||
        bindings.some((binding) => binding.threadId === thread.id) ||
        (thread.worktreePath !== null && contained(copy.rootPath, thread.worktreePath)),
    );
    // A folder prepared for work has no finished work yet. Missing bound threads are uncertain.
    if (
      related.length === 0 ||
      bindings.some((binding) => !related.some((thread) => thread.id === binding.threadId)) ||
      related.some((thread) => !bindings.some((binding) => binding.threadId === thread.id))
    )
      return false;
    if (
      related.some(
        (thread) =>
          thread.activeRunId !== null ||
          thread.pendingRuntimeRequest !== null ||
          (thread.pendingBackgroundTasks?.length ?? 0) > 0 ||
          thread.goal?.status === "active" ||
          (thread.archivedAt === null && thread.settledOverride !== "settled"),
      )
    )
      return false;
    if (!(yield* fs.exists(copy.rootPath))) return receipt.removalPath !== null;
    for (const repository of copy.repositories) {
      const changes = yield* git(
        repository.path,
        ["--no-optional-locks", "status", "--porcelain=v1", "-z"],
        true,
      );
      const unpushed = yield* git(
        repository.path,
        ["rev-list", "--count", "HEAD", "--not", "--remotes"],
        true,
      );
      if (changes !== "" || unpushed !== "0") return false;
    }
    // A discussion's synthetic Git repository has no upstream. Its full history is archived.
    if (
      receipt.rootCheckpointRepository &&
      (yield* git(
        copy.rootPath,
        ["--no-optional-locks", "status", "--porcelain=v1", "-z"],
        true,
      )) !== ""
    )
      return false;
    return true;
  });

  const removeArchiveCache = Effect.fn("LibraryWorkspace.removeArchiveCache")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
  ) {
    if (
      (receipt.copy.state === "released" ||
        (receipt.copy.state === "ready" &&
          receipt.reopenRequestId !== undefined &&
          receipt.removalPath === null)) &&
      receipt.archivePath !== null &&
      receipt.archiveDigest !== null &&
      receipt.copy.recovery?.sha256 === receipt.archiveDigest
    )
      yield* fs.remove(receipt.archivePath, { force: true });
  });

  const ensureRecoveryArchive = Effect.fn("LibraryWorkspace.ensureRecoveryArchive")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
  ) {
    const { archivePath, archiveDigest, copy } = receipt;
    if (archivePath === null || archiveDigest === null || copy.recovery?.sha256 !== archiveDigest)
      return yield* new LibraryError({ reason: "archive-unverified" });
    if (!(yield* fs.exists(archivePath))) {
      if (Option.isNone(recoveryPublisher))
        return yield* new LibraryError({ reason: "publisher-unavailable" });
      yield* recoveryPublisher.value.retrieve({
        archivePath,
        sourceEnvironmentId: copy.environmentId,
        copyId: copy.id,
        sha256: archiveDigest,
        byteLength: copy.recovery.byteLength,
      });
    }
    const stat = yield* fs.stat(archivePath);
    if (
      stat.type !== "File" ||
      stat.size !== BigInt(copy.recovery.byteLength) ||
      (yield* fileDigest(archivePath)) !== archiveDigest
    )
      return yield* new LibraryError({ reason: "archive-unverified" });
    return archivePath;
  });

  const release = Effect.fn("LibraryWorkspace.release")(function* (
    input: LibraryReleaseCopyRequest,
    automatic = false,
  ) {
    let receipt = yield* store.get(input.workingCopyId);
    if (receipt.copy.environmentId !== environmentId)
      return yield* new LibraryError({ reason: "invalid" });
    if (receipt.copy.ownership === "borrowed") return yield* unregister(input);
    if (
      receipt.releaseRequestId !== null &&
      (receipt.releaseRequestId !== input.requestId ||
        receipt.releaseReviewToken !== input.reviewToken)
    )
      return yield* new LibraryError({ reason: "request-conflict" });
    if (receipt.copy.state === "released") {
      yield* removeArchiveCache(receipt);
      return receipt.copy;
    }
    if (automatic && !(yield* canCleanUp(receipt)))
      return yield* new LibraryError({ reason: "blocked" });
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
          `${(yield* digest(receipt.copy.id)).slice(0, 40)}.tar.gz`,
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
              (yield* streamWorkingCopy(receipt.copy.rootPath, {
                path: archivePath,
                manifestDirectory,
              })) !== reviewed.contentsDigest
            )
              return yield* new LibraryError({ reason: "blocked" });
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
          reopenRequestId: undefined,
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
        if (automatic && !(yield* canCleanUp(receipt)))
          return yield* new LibraryError({ reason: "blocked" });
        yield* fs.rename(receipt.copy.rootPath, receipt.removalPath);
      }
      if (yield* fs.exists(receipt.removalPath)) {
        const identity = fileIdentity(yield* fs.stat(receipt.removalPath));
        if (
          (yield* fs.realPath(receipt.removalPath)) !== receipt.removalPath ||
          identity.device === null ||
          receipt.rootIdentity?.device !== identity.device ||
          receipt.rootIdentity?.inode !== identity.inode
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
    // Keep the retry archive until the deletion and released state are durably recorded.
    yield* removeArchiveCache(released);
    return released.copy;
  });

  const setCopyRetention = Effect.fn("LibraryWorkspace.setCopyRetention")(function* (
    input: LibrarySetCopyRetentionRequest,
  ) {
    let receipt = yield* store.get(input.workingCopyId);
    if (receipt.copy.environmentId !== environmentId)
      return yield* new LibraryError({ reason: "invalid" });
    if (receipt.copy.ownership === "borrowed" && !input.keepOnComputer)
      return yield* new LibraryError({ reason: "not-managed" });
    if (
      receipt.copy.keepOnComputer === input.keepOnComputer &&
      (receipt.removalPath === null || receipt.copy.state === "released")
    )
      return receipt.copy;
    if (receipt.removalPath !== null && receipt.copy.state !== "released") {
      if (
        !input.keepOnComputer ||
        !(yield* fs.exists(receipt.copy.rootPath)) ||
        (yield* fs.exists(receipt.removalPath))
      )
        return yield* new LibraryError({ reason: "blocked" });
      receipt = { ...receipt, releaseRequestId: null, releaseReviewToken: null, removalPath: null };
    }
    const copy = { ...receipt.copy, keepOnComputer: input.keepOnComputer, updatedAt: yield* now };
    yield* store.put({ ...receipt, copy });
    return copy;
  });

  const reopenCopy = Effect.fn("LibraryWorkspace.reopenCopy")(function* (
    input: LibraryReopenCopyRequest,
    keepOnComputer = true,
  ) {
    if (!supportsExecution) return yield* new LibraryError({ reason: "blocked" });
    let receipt = yield* store.get(input.workingCopyId);
    if (receipt.copy.environmentId !== environmentId || receipt.copy.ownership !== "managed")
      return yield* new LibraryError({ reason: "not-managed" });
    if (receipt.copy.state === "ready") {
      if (
        !(yield* fs.exists(receipt.copy.rootPath)) ||
        (yield* fs.realPath(receipt.copy.rootPath)) !== receipt.copy.rootPath
      )
        return yield* new LibraryError({ reason: "blocked" });
      const rootIdentity = fileIdentity(yield* fs.stat(receipt.copy.rootPath));
      if (
        rootIdentity.device === null ||
        rootIdentity.device !== receipt.rootIdentity?.device ||
        rootIdentity.inode === null ||
        rootIdentity.inode !== receipt.rootIdentity?.inode
      )
        return yield* new LibraryError({ reason: "blocked" });
      yield* removeArchiveCache(receipt);
      return receipt.copy;
    }
    const resuming = receipt.copy.state === "released" && receipt.reopenRequestId !== undefined;
    if (receipt.copy.state !== "released") return yield* new LibraryError({ reason: "blocked" });
    if (
      receipt.archivePath === null ||
      receipt.archiveDigest === null ||
      receipt.copy.recovery?.sha256 !== receipt.archiveDigest
    )
      return yield* new LibraryError({ reason: "archive-unverified" });
    if (yield* fs.exists(receipt.copy.rootPath)) {
      const rootIdentity = fileIdentity(yield* fs.stat(receipt.copy.rootPath));
      if (
        !resuming ||
        (yield* fs.realPath(receipt.copy.rootPath)) !== receipt.copy.rootPath ||
        rootIdentity.device === null ||
        rootIdentity.device !== receipt.rootIdentity?.device ||
        rootIdentity.inode === null ||
        rootIdentity.inode !== receipt.rootIdentity?.inode
      )
        return yield* new LibraryError({ reason: "blocked" });
    } else {
      const archivePath = yield* ensureRecoveryArchive(receipt);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const staging = yield* fs.makeTempDirectoryScoped({
            directory: path.dirname(receipt.copy.rootPath),
            prefix: ".loom-reopen-",
          });
          const basename = path.basename(receipt.copy.rootPath);
          const restored = path.join(staging, basename);
          const result = yield* runner.run({
            command: "tar",
            args: ["-xf", archivePath, "-C", staging],
            timeout: "10 minutes",
            maxOutputBytes: 1024,
            outputMode: "truncate",
          });
          if (
            result.code !== 0 ||
            !(yield* fs.exists(restored)) ||
            (yield* fs.stat(restored)).type !== "Directory" ||
            (yield* fs.realPath(restored)) !== restored
          )
            return yield* new LibraryError({ reason: "archive-unverified" });
          receipt = {
            ...receipt,
            reopenRequestId: input.requestId,
            rootIdentity: fileIdentity(yield* fs.stat(restored)),
            copy: { ...receipt.copy, updatedAt: yield* now },
          };
          yield* store.put(receipt);
          // The recorded inode makes a retry distinguish our restored folder from someone else's.
          if (yield* fs.exists(receipt.copy.rootPath))
            return yield* new LibraryError({ reason: "blocked" });
          yield* fs.rename(restored, receipt.copy.rootPath);
        }),
      );
    }
    const ready = {
      ...receipt,
      reopenRequestId: input.requestId,
      releaseRequestId: null,
      releaseReviewToken: null,
      removalPath: null,
      copy: {
        ...receipt.copy,
        state: "ready" as const,
        keepOnComputer,
        updatedAt: yield* now,
      },
    };
    yield* store.put(ready);
    yield* removeArchiveCache(ready);
    return ready.copy;
  });

  const prepareThreadFiles = Effect.fn("LibraryWorkspace.prepareThreadFiles")(function* (input: {
    readonly threadId: ThreadId;
  }) {
    const resolved = yield* store.getBinding(input.threadId);
    if (resolved === null) return;
    const receipt = yield* store.get(resolved.binding.workingCopyId);
    const thread = yield* projections.getThread(input.threadId);
    const project = yield* projects.getById(thread.projectId);
    const cwd = thread.worktreePath ?? Option.getOrNull(project)?.workspaceRoot;
    if (
      receipt.copy.environmentId !== environmentId ||
      resolved.binding.environmentId !== environmentId ||
      thread.projectId !== resolved.localProjectId ||
      cwd === undefined ||
      path.resolve(cwd) !== resolved.cwd
    )
      return yield* new LibraryError({ reason: "invalid" });
    return yield* withWorkspaceLease(
      receipt.copy.rootPath,
      Effect.gen(function* () {
        if (receipt.copy.state === "released") {
          const copy = yield* reopenCopy(
            {
              requestId: `resume:${input.threadId}:${receipt.copy.id}`,
              workingCopyId: receipt.copy.id,
            },
            receipt.copy.keepOnComputer !== false,
          );
          yield* publishCopy(copy);
        } else {
          yield* restoreManagedProjectCheckout(receipt.copy.rootPath, true).pipe(
            Effect.provide(restorationServices),
          );
        }
      }),
    );
  });

  const cleanupTemporaryCopies = Effect.fn("LibraryWorkspace.cleanupTemporaryCopies")(function* () {
    for (const receipt of (yield* store.receipts).filter((entry) => isTemporaryCopy(entry.copy))) {
      const result = yield* Effect.result(
        Effect.gen(function* () {
          if (!(yield* canCleanUp(receipt))) return;
          const review =
            receipt.removalPath !== null && receipt.releaseReviewToken !== null
              ? { reviewToken: receipt.releaseReviewToken, blockers: [] }
              : yield* status({ workingCopyId: receipt.copy.id });
          if (review.reviewToken === null || review.blockers.length > 0) return;
          yield* withWorkspaceLease(
            receipt.copy.rootPath,
            release(
              {
                requestId:
                  receipt.releaseRequestId ?? `cleanup:${receipt.copy.id}:${review.reviewToken}`,
                workingCopyId: receipt.copy.id,
                reviewToken: receipt.releaseReviewToken ?? review.reviewToken,
              },
              true,
            ),
          );
        }),
      );
      if (result._tag === "Failure")
        yield* Effect.logDebug("Temporary project files were preserved.", {
          copyId: receipt.copy.id,
          reason: isLibraryError(result.failure) ? result.failure.reason : "io",
        });
    }
  });

  /** The local projects a profile's settings apply to: the copy's root and each repository. */
  const copyLocalProjects = (receipt: LibraryWorkspaceStore.WorkspaceReceipt) =>
    [
      receipt.copy.rootLocalProjectId ?? receipt.rootLocalProjectId,
      ...receipt.copy.repositories.map((repository) => repository.localProjectId),
    ].filter((id): id is ProjectId => id != null);

  const settingsCopy = Effect.fn("LibraryWorkspace.settingsCopy")(function* (
    input: LibraryProfileSettingsRequest,
  ) {
    const receipt = yield* store.get(input.workingCopyId);
    if (receipt.copy.state !== "ready" || receipt.copy.registered === false)
      return yield* new LibraryError({ reason: "invalid" });
    return {
      workingCopyId: receipt.copy.id,
      localProjectIds: copyLocalProjects(receipt),
      profile: input.profile ?? receipt.project.profile ?? {},
    };
  });

  // Getting or reusing a copy fills settings the local projects lack. Values someone set
  // locally stay; `profileSettings` shows them and `applyProfile` replaces them with consent.
  const fillProfile = (input: LibraryPrepareCopyRequest, copy: LibraryWorkingCopy) =>
    input.project.profile === undefined || copy.state !== "ready"
      ? Effect.void
      : store.get(copy.id).pipe(
          Effect.flatMap((receipt) =>
            settings.fillEmpty({
              requestId: input.requestId,
              localProjectIds: copyLocalProjects(receipt),
              profile: input.project.profile ?? {},
            }),
          ),
          Effect.catch((cause) =>
            Effect.logWarning("Could not apply the project setup to a Library copy.", {
              copyId: copy.id,
              cause,
            }),
          ),
        );

  const publishCopy = Effect.fn("LibraryWorkspace.publishCopy")(function* (
    copy: LibraryWorkingCopy,
  ) {
    if (Option.isNone(publisher) || !publisher.value.enabled) return;
    const authority = yield* publisher.value.info;
    yield* publisher.value.registerCopy({
      requestId: `host-copy:${yield* digest(yield* encodeWorkingCopy(copy))}`,
      authorityId: authority.authorityId,
      authorityEpoch: authority.authorityEpoch,
      copy,
    });
  }, mapIo);

  return LibraryWorkspace.of({
    threadProject: (input) => store.getBoundProject(input.threadId),
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
      locks
        .withLock(
          "prepare",
          mapIo(
            Effect.gen(function* () {
              const rootPath = yield* canonicalRoot(input.rootPath);
              return yield* withWorkspaceLease(rootPath, prepareCopy(input, rootPath));
            }),
          ),
        )
        .pipe(Effect.tap((copy) => fillProfile(input, copy))),
    readiness: (input) =>
      mapIo(
        Effect.gen(function* () {
          const recorded =
            input.profile === undefined
              ? (yield* store.receipts)
                  .filter((receipt) => receipt.project.id === input.projectId)
                  .toSorted((left, right) => right.project.revision - left.project.revision)[0]
              : undefined;
          if (input.profile === undefined && recorded === undefined)
            return yield* new LibraryError({ reason: "not-found" });
          return yield* readReadiness({
            projectId: input.projectId,
            environmentId,
            profile: input.profile ?? recorded?.project.profile ?? {},
          });
        }),
      ),
    profileSettings: (input) => mapIo(settingsCopy(input).pipe(Effect.flatMap(settings.read))),
    applyProfile: (input) =>
      locks.withLock(
        "prepare",
        mapIo(
          settingsCopy(input).pipe(
            Effect.flatMap((copy) => settings.apply({ ...copy, reviewToken: input.reviewToken })),
          ),
        ),
      ),
    status: (input) =>
      mapIo(
        Effect.gen(function* () {
          const { contentsDigest: _contentsDigest, ...review } = yield* status(input);
          if (review.copy.state === "released" || review.copy.registered === false) return review;
          return { ...review, health: yield* readHealth(review.copy) };
        }),
      ),
    health: (input) =>
      mapIo(
        Effect.gen(function* () {
          const { copy } = yield* store.get(input.workingCopyId);
          if (copy.state === "released" || copy.registered === false)
            return yield* new LibraryError({ reason: "invalid" });
          return yield* readHealth(copy, { refreshRemote: input.refreshRemote });
        }),
      ),
    setCopyRetention: (input) =>
      Effect.acquireUseRelease(
        // A Keep request can arrive while automatic cleanup uploads its archive under the lock.
        Effect.sync(() => {
          if (input.keepOnComputer)
            pendingKeeps.set(input.workingCopyId, (pendingKeeps.get(input.workingCopyId) ?? 0) + 1);
        }),
        () => locks.withLock("prepare", mapIo(setCopyRetention(input))),
        () =>
          Effect.sync(() => {
            if (!input.keepOnComputer) return;
            const remaining = (pendingKeeps.get(input.workingCopyId) ?? 1) - 1;
            if (remaining === 0) pendingKeeps.delete(input.workingCopyId);
            else pendingKeeps.set(input.workingCopyId, remaining);
          }),
      ).pipe(Effect.tap(publishCopy)),
    reopenCopy: (input) =>
      locks
        .withLock(
          "prepare",
          mapIo(
            Effect.gen(function* () {
              const receipt = yield* store.get(input.workingCopyId);
              return yield* withWorkspaceLease(receipt.copy.rootPath, reopenCopy(input));
            }),
          ),
        )
        .pipe(Effect.tap(publishCopy)),
    prepareThreadFiles: (input) => locks.withLock("prepare", mapIo(prepareThreadFiles(input))),
    cleanupTemporaryCopies: locks.withLock("prepare", mapIo(cleanupTemporaryCopies())),
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
