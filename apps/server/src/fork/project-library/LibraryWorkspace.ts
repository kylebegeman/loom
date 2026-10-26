import { libraryCloneFailure } from "./clone-failure.ts";
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
  type LibraryPlacement,
  LibraryPrepareCopyRequest,
  type LibraryRestoreCopyRequest,
  type LibrarySnapshotCopyRequest,
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
  type LibraryResource,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as NodeCrypto from "node:crypto";
import * as NodeZlib from "node:zlib";
import * as NodeStream from "@effect/platform-node/NodeStream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Config from "effect/Config";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { makeRecoveryTarReader, hasNonPortablePathCharacters } from "./LibraryPortableArchive.ts";
import { fileIdentity } from "../fileIdentity.ts";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { landedIgnoredFileBlocker } from "../../storageCleanup.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as ProjectPlacement from "../../project/ProjectPlacement.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as WorktreeSetupTracker from "../../project/WorktreeSetupTracker.ts";
import * as LibraryGitFetch from "./LibraryGitFetch.ts";
import * as LibraryWorkspaceStore from "./LibraryWorkspaceStore.ts";
import * as LibraryRecoveryPublisher from "./LibraryRecoveryPublisher.ts";
import { LIBRARY_RECOVERY_MAX_BYTES } from "./assets/LibraryRecoveryStore.ts";
import * as LibraryPublisher from "./LibraryPublisher.ts";
import { makeCopyHealthReader } from "./LibraryCopyHealth.ts";
import { makeProfileReadinessReader } from "./LibraryProfileReadiness.ts";
import { makeProfileSettings } from "./LibraryProfileSettings.ts";
import { validLibraryResources } from "./policy.ts";
import { withWorkspaceLease } from "../../workspace/workspaceLease.ts";
import * as SetupMarker from "../../workspace/setupMarker.ts";
import { proveRepositoryPublication } from "../../workspace/gitPublication.ts";
import {
  managedProjectProcessReason,
  restoreManagedProjectCheckout,
} from "../../workspace/ManagedProjectCheckout.ts";

export class LibraryWorkspace extends Context.Service<
  LibraryWorkspace,
  {
    readonly inspectFolder: (
      input: LibraryInspectFolderRequest,
    ) => Effect.Effect<LibraryFolderInspection, LibraryError>;
    readonly preparation: (input: {
      readonly requestId: string;
    }) => Effect.Effect<LibraryWorkingCopy | null, LibraryError>;
    /**
     * Where a copy of `project` would go on this computer, without changing anything. Preparing
     * without a rootPath resolves it again and claims the folder.
     */
    readonly placement: (input: {
      readonly project: LibraryProject;
      readonly resourceIds?: ReadonlyArray<string> | undefined;
    }) => Effect.Effect<LibraryPlacement, LibraryError>;
    readonly prepareCopy: (
      input: LibraryPrepareCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    /**
     * Makes a new copy's folders and local projects without downloading, so a conversation can
     * start in it at once; `fillCopy` downloads the files. A copy with nothing to download is
     * prepared in full.
     */
    readonly reserveCopy: (
      input: LibraryPrepareCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    /** Downloads a reserved copy's files once, however many callers wait for them. */
    readonly fillCopy: (input: {
      readonly workingCopyId: string;
      readonly operationId?: string | undefined;
    }) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    readonly restoreCopy: (
      input: LibraryRestoreCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    readonly snapshotCopy: (
      input: LibrarySnapshotCopyRequest,
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
      /** False starts files that are still downloading without waiting for them. */
      readonly waitForFiles?: boolean | undefined;
    }) => Effect.Effect<void, LibraryError>;
    readonly cleanupTemporaryCopies: (
      isHistoryAcknowledged: (threadId: ThreadId) => Effect.Effect<boolean, LibraryError>,
    ) => Effect.Effect<void, LibraryError>;
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
    /**
     * Binds a conversation that has not run to its copy. One that already has work in a borrowed
     * folder's own project is saved instead: its history goes to the Library while it keeps
     * running wherever it started.
     */
    readonly bindThread: (input: {
      readonly threadId: ThreadId;
      readonly binding: LibraryThreadBinding;
      readonly project?: LibraryProject | undefined;
      /** The conversation's own worktree, made from the bound copy folder when it started. */
      readonly worktreePath?: string | undefined;
    }) => Effect.Effect<LibraryResolvedBinding, LibraryError>;
    /**
     * Moves a conversation bound to its copy's folder into a worktree made from that folder, as a
     * worktree start whose files arrived after it opened does. `move` puts the conversation there
     * and answers false when it refuses, which leaves the conversation in the copy's folder.
     */
    readonly moveThread: (input: {
      readonly threadId: ThreadId;
      readonly worktreePath: string;
      readonly move: Effect.Effect<boolean, LibraryError>;
    }) => Effect.Effect<boolean, LibraryError>;
    /**
     * The local projects of this computer's registered borrowed folders, each with the binding its
     * conversations' history is saved under. Folders Loom manages bind their conversations instead.
     */
    readonly historyFolders: Effect.Effect<
      ReadonlyArray<{
        readonly resolved: LibraryResolvedBinding;
        readonly project: LibraryProject;
      }>,
      LibraryError
    >;
  }
>()("t3/fork/project-library/LibraryWorkspace") {}

const ReviewRepository = Schema.Struct({
  resourceId: Schema.String,
  head: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
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

const encodeRestoreIdentity = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      project: LibraryProject,
      rootPath: Schema.String,
      resourceIds: Schema.Array(Schema.String),
      sourceCopyId: Schema.String,
      sourceEnvironmentId: Schema.String,
      sha256: Schema.String,
      byteLength: Schema.Number,
      libraryEnvironmentId: Schema.String,
    }),
  ),
);
const encodeWorkingCopy = Schema.encodeEffect(Schema.fromJsonString(LibraryWorkingCopy));
const encodePreparation = Schema.encodeEffect(Schema.fromJsonString(LibraryPrepareCopyRequest));
const encodeReviewRepository = Schema.encodeEffect(Schema.fromJsonString(ReviewRepository));
const encodeReviewState = Schema.encodeEffect(Schema.fromJsonString(ReviewState));

const TAR_BLOCK_BYTES = 512;
const OWNER_CHECK_TIMEOUT = "30 seconds";
// "blocked" alone reads as a generic refusal, so each refusal says why and what to do next.
const COPY_IN_USE = "This working copy is still in use or has work that must be preserved.";
const CHANGED_SINCE_REVIEW =
  "These files changed since they were reviewed. Review them again, then retry.";
const EXECUTION_DISABLED =
  "This computer hosts your Library but does not run work. Choose another computer for these files.";
const FILL_CANCELLED =
  "Downloading these files was cancelled. Retry from the conversation to finish getting them.";
const CLONE_CONCURRENCY = 3;
const CREDENTIAL_GIT_VARIABLE =
  /^GIT_(?:SSH|SSH_COMMAND|SSH_VARIANT|ASKPASS|CONFIG_GLOBAL|CONFIG_SYSTEM|CONFIG_NOSYSTEM|EXEC_PATH|SSL_\w+|HTTP_\w+|PROXY_\w+|ALLOW_PROTOCOL|PROTOCOL_FROM_USER)$/;
// `git ls-files -v` tags hiding an edit from status: skip-worktree, or lowercase for assume-unchanged.
const HIDDEN_INDEX_ENTRY = /^(?:S|[a-z]) /;
const INDEX_LISTING_BYTES = 64 * 1024 * 1024;
type FillReport = (
  resource: LibraryResource,
  progress: LibraryGitFetch.LibraryCloneProgress,
) => Effect.Effect<void>;
// LibraryError details are length-limited and worktree paths are not.
const LISTED_WORKTREES = 3;
const linkedWorktreesBlocker = (paths: ReadonlyArray<string>) => {
  const more = paths.length - LISTED_WORKTREES;
  return `Worktrees made from these files still exist: ${paths.slice(0, LISTED_WORKTREES).join(", ")}${more > 0 ? ` and ${more} more` : ""}. Land or remove them first. Removing these files would break them.`;
};
const FullRecoveryManifest = Schema.Struct({
  version: Schema.Literal(1),
  project: LibraryProject,
  copy: LibraryWorkingCopy,
  rootLocalProjectId: Schema.NullOr(ProjectId),
  rootCheckpointRepository: Schema.Boolean,
  portableRepositories: Schema.optional(
    Schema.Array(
      Schema.Struct({
        relativePath: Schema.String,
        gitDirectory: Schema.String,
      }),
    ),
  ),
  bindings: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      resolved: LibraryResolvedBinding,
      project: Schema.optional(LibraryProject),
    }),
  ),
});
const decodeFullManifest = Schema.decodeEffect(Schema.fromJsonString(FullRecoveryManifest));
const encodeFullManifest = Schema.encodeEffect(Schema.fromJsonString(FullRecoveryManifest));
const isLibraryError = Schema.is(LibraryError);
const mapLibraryError = (cause: unknown) =>
  isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause });
const mapIo = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(mapLibraryError));

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
  const gitFetch = yield* LibraryGitFetch.LibraryGitFetch;
  const setupTracker = yield* WorktreeSetupTracker.WorktreeSetupTracker;
  const serviceScope = yield* Effect.scope;
  const fills = new Map<string, Deferred.Deferred<LibraryWorkingCopy, LibraryError>>();
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
  const hostEnvironment = yield* HostProcess.Environment;
  const pathKey = SetupMarker.pathKey(yield* HostProcess.Platform);
  const isolatedGitEnvironment = {
    ...Object.fromEntries(
      Object.entries(hostEnvironment).filter(([key]) => !key.startsWith("GIT_")),
    ),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(config.stateDir, "empty-git-config"),
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
  };
  // The publication proof fetches with this computer's Git credentials, as a clone does, so a
  // private repository can prove its commits are pushed. It never prompts. Of the Git variables
  // it keeps only those that reach a remote: others can point it at another repository.
  const credentialedGitEnvironment = {
    ...Object.fromEntries(
      Object.entries(hostEnvironment).filter(
        ([key]) => !key.startsWith("GIT_") || CREDENTIAL_GIT_VARIABLE.test(key),
      ),
    ),
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
  };
  const placements = yield* ProjectPlacement.ProjectPlacement;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const gitDriver = yield* GitVcsDriver.GitVcsDriver;
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
    const manifestNames =
      archive === undefined
        ? []
        : [
            "loom-working-copy.json",
            ...((yield* fs.exists(path.join(archive.manifestDirectory, "loom-portable-git")))
              ? ["loom-portable-git"]
              : []),
          ];
    // One-block records leave exactly two terminal zero blocks in the prefix tar.
    let manifestBytes = 0;
    if (archive !== undefined) {
      const prefix = path.join(archive.manifestDirectory, "prefix.tar");
      yield* Effect.gen(function* () {
        const result = yield* runner.run({
          command: "tar",
          args: [
            `--format=${format}`,
            "-b",
            "1",
            "-cf",
            prefix,
            "-C",
            archive.manifestDirectory,
            ...manifestNames,
          ],
          timeout: "10 minutes",
          maxOutputBytes: 1024,
        });
        if (result.code !== 0) return yield* new LibraryError({ reason: "io" });
        manifestBytes = Number((yield* fs.stat(prefix)).size) - 2 * TAR_BLOCK_BYTES;
      }).pipe(Effect.ensuring(fs.remove(prefix, { force: true }).pipe(Effect.ignore)));
    }
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const hash = NodeCrypto.createHash("sha256");
        let archiveBytes = 0;
        const child = yield* spawner.spawn(
          ChildProcess.make("tar", [
            `--format=${format}`,
            "-b",
            "1",
            "-cf",
            "-",
            ...(archive === undefined ? [] : ["-C", archive.manifestDirectory, ...manifestNames]),
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
                  Stream.tap((chunk) =>
                    Effect.suspend(() => {
                      archiveBytes += chunk.length;
                      return archiveBytes > LIBRARY_RECOVERY_MAX_BYTES
                        ? Effect.fail(new LibraryError({ reason: "archive-too-large" }))
                        : Effect.void;
                    }),
                  ),
                  Stream.run(fs.sink(archive.path, { mode: 0o600 })),
                ),
            Stream.runDrain(child.stderr),
          ],
          { concurrency: "unbounded" },
        );
        if ((yield* child.exitCode) !== 0)
          return yield* new LibraryError({
            reason: "blocked",
            detail:
              "Loom could not read every file in this folder. Check that its files are readable and nothing is changing them, then retry.",
          });
        return hash.digest("hex");
      }),
    );
  });
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const samePath = (left: string, right: string) => pathKey(left) === pathKey(right);
  const contained = (root: string, candidate: string) => {
    const relative = path.relative(pathKey(root), pathKey(candidate));
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
  };
  /** One folder belongs to one current project. A retired receipt only serves its old conversations. */
  const holdsRoot = (receipt: LibraryWorkspaceStore.WorkspaceReceipt, rootPath: string) =>
    samePath(receipt.copy.rootPath, rootPath) &&
    receipt.copy.state !== "released" &&
    receipt.copy.registered !== false;
  /** Whether a copy's checkout of `resource` is still at the path and remote the project names. */
  const keepsResource = (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
    resource: LibraryResource,
  ) => {
    const original = receipt.project.resources.find(
      (entry) => entry.id === resource.id && entry.kind !== "link",
    );
    return (
      original !== undefined &&
      path.resolve(receipt.copy.rootPath, original.relativePath) ===
        path.resolve(receipt.copy.rootPath, resource.relativePath) &&
      (original.remoteUrl === null
        ? resource.remoteUrl === null
        : resource.remoteUrl !== null &&
          normalizeGitRemoteUrl(original.remoteUrl) === normalizeGitRemoteUrl(resource.remoteUrl))
    );
  };
  const git = Effect.fnUntraced(function* (
    cwd: string,
    args: ReadonlyArray<string>,
    allowFailure = false,
    env: NodeJS.ProcessEnv = isolatedGitEnvironment,
  ) {
    const result = yield* runner.run({
      command: "git",
      args: ["-c", "core.fsmonitor=false", ...args],
      cwd,
      env,
      extendEnv: false,
      timeout: "2 minutes",
      maxOutputBytes: 1024 * 1024,
    });
    if (result.code !== 0 && !allowFailure)
      return yield* new LibraryError({ reason: "io", cause: result });
    return result.code === 0 ? result.stdout.trim() : null;
  });
  const workingRepositories = Effect.fn("LibraryWorkspace.workingRepositories")(function* (
    copy: LibraryWorkingCopy,
  ) {
    const repositories = new Set(copy.repositories.map((repository) => repository.path));
    const pending = [copy.rootPath];
    while (pending.length > 0) {
      const directory = pending.shift()!;
      if ((yield* fs.realPath(directory)) !== directory) continue;
      const names = yield* fs.readDirectory(directory);
      if (names.includes(".git")) repositories.add(directory);
      for (const name of names) {
        if (name === ".git") continue;
        const candidate = path.join(directory, name);
        if (
          (yield* fs.realPath(candidate).pipe(Effect.orElseSucceed(() => ""))) === candidate &&
          (yield* fs.stat(candidate)).type === "Directory"
        )
          pending.push(candidate);
      }
    }
    return [...repositories];
  });
  const portableGit = Effect.fn("LibraryWorkspace.portableGit")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
    directory: string,
  ) {
    const repositories = yield* workingRepositories(receipt.copy);
    const portableRepositories: Array<{ relativePath: string; gitDirectory: string }> = [];
    for (const [index, source] of repositories.entries()) {
      if (!contained(receipt.copy.rootPath, source))
        return yield* new LibraryError({ reason: "invalid" });
      const gitDirectory = yield* fs.realPath(
        (yield* git(source, ["rev-parse", "--absolute-git-dir"]))!,
      );
      const commonDirectory = yield* fs.realPath(
        path.resolve(source, (yield* git(source, ["rev-parse", "--git-common-dir"]))!),
      );
      const target = path.join(directory, "loom-portable-git", `repository-${index}`, ".git");
      yield* fs.makeDirectory(target, { recursive: true, mode: 0o700 });
      const objectStores = new Map<string, string>();
      // Keep complete metadata, including reflogs and interrupted operations. A linked
      // worktree gets common files plus its own private metadata, never another HEAD/index.
      const pending: Array<{
        source: string;
        target: string;
        relative: string;
        common: boolean;
        ancestors: ReadonlyArray<string>;
      }> = [];
      if (commonDirectory !== gitDirectory) {
        for (const name of yield* fs.readDirectory(commonDirectory)) {
          if (["objects", "worktrees", "commondir", "gitdir"].includes(name)) continue;
          const location = path.resolve(
            source,
            (yield* git(source, ["rev-parse", "--git-path", name]))!,
          );
          if (location === path.join(commonDirectory, name))
            pending.push({
              source: path.join(commonDirectory, name),
              target: path.join(target, name),
              relative: name,
              common: true,
              ancestors: [],
            });
        }
        objectStores.set(commonDirectory, target);
      }
      pending.push({ source: gitDirectory, target, relative: "", common: false, ancestors: [] });
      while (pending.length > 0) {
        const item = pending.shift()!;
        if (
          item.common &&
          ["logs/HEAD", "refs/bisect", "refs/worktree", "refs/rewritten"].includes(item.relative)
        )
          continue;
        const actual = yield* fs.realPath(item.source);
        const info = yield* fs.stat(actual);
        if (info.type === "Directory") {
          if (item.ancestors.includes(actual))
            return yield* new LibraryError({ reason: "archive-unverified" });
          const names = yield* fs.readDirectory(actual);
          const repository =
            names.includes("objects") && (names.includes("config") || actual === gitDirectory);
          if (repository)
            objectStores.set(actual === gitDirectory ? commonDirectory : actual, item.target);
          yield* fs.makeDirectory(item.target, { recursive: true, mode: 0o700 });
          for (const name of names) {
            if (
              (repository || item.relative === "") &&
              ["objects", "worktrees", "commondir", "gitdir", "locked"].includes(name)
            )
              continue;
            pending.push({
              source: path.join(actual, name),
              target: path.join(item.target, name),
              relative: item.relative ? `${item.relative}/${name}` : name,
              common: item.common,
              ancestors: [...item.ancestors, actual],
            });
          }
        } else if (info.type === "File") {
          yield* fs.makeDirectory(path.dirname(item.target), { recursive: true });
          yield* fs.copyFile(actual, item.target);
        } else return yield* new LibraryError({ reason: "archive-unverified" });
      }
      for (const [objectSource, objectTarget] of objectStores) {
        const packDirectory = path.join(objectTarget, "objects", "pack");
        yield* fs.makeDirectory(packDirectory, { recursive: true, mode: 0o700 });
        const packPath = path.join(packDirectory, "portable.pack");
        // Batch-all-objects includes unreachable and alternate-store objects that no
        // bundle of refs can retain. Stream both processes so large stores stay bounded.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const objects = yield* spawner.spawn(
              ChildProcess.make(
                "git",
                [
                  `--git-dir=${objectSource}`,
                  "-c",
                  "core.fsmonitor=false",
                  "cat-file",
                  "--batch-all-objects",
                  "--batch-check=%(objectname)",
                  "--unordered",
                ],
                { cwd: source, env: isolatedGitEnvironment, extendEnv: false },
              ),
            );
            const pack = yield* spawner.spawn(
              ChildProcess.make(
                "git",
                [
                  `--git-dir=${objectSource}`,
                  "-c",
                  "core.fsmonitor=false",
                  "pack-objects",
                  "--stdout",
                ],
                {
                  cwd: source,
                  env: isolatedGitEnvironment,
                  extendEnv: false,
                  stdin: objects.stdout,
                },
              ),
            );
            yield* Effect.all(
              [
                Stream.run(pack.stdout, fs.sink(packPath)),
                Stream.runDrain(pack.stderr),
                Stream.runDrain(objects.stderr),
              ],
              { concurrency: "unbounded" },
            );
            if ((yield* pack.exitCode) !== 0 || (yield* objects.exitCode) !== 0)
              return yield* new LibraryError({ reason: "archive-unverified" });
          }),
        );
        const objectFormat = yield* git(source, [
          `--git-dir=${objectSource}`,
          "rev-parse",
          "--show-object-format",
        ]);
        if (objectFormat !== "sha1" && objectFormat !== "sha256")
          return yield* new LibraryError({ reason: "archive-unverified" });
        // Index the captured pack without allowing copied source config to resolve paths.
        const indexed = yield* runner.run({
          command: "git",
          args: ["index-pack", `--object-format=${objectFormat}`, packPath],
          cwd: directory,
          env: isolatedGitEnvironment,
          extendEnv: false,
          timeout: "10 minutes",
          maxOutputBytes: 1024,
        });
        if (indexed.code !== 0) return yield* new LibraryError({ reason: "archive-unverified" });
        const packHash = indexed.stdout.trim();
        if (!/^[a-f0-9]{40,64}$/.test(packHash))
          return yield* new LibraryError({ reason: "archive-unverified" });
        yield* fs.rename(packPath, path.join(packDirectory, `pack-${packHash}.pack`));
        yield* fs.rename(
          packPath.replace(/\.pack$/, ".idx"),
          path.join(packDirectory, `pack-${packHash}.idx`),
        );
      }
      portableRepositories.push({
        relativePath: path.relative(receipt.copy.rootPath, source).split(path.sep).join("/") || ".",
        gitDirectory: `loom-portable-git/repository-${index}/.git`,
      });
    }
    return portableRepositories;
  });

  const externalGitReview = Effect.fn("LibraryWorkspace.externalGitReview")(function* (
    copy: LibraryWorkingCopy,
    /** What a caller that already walked the copy found, so one review walks it once. */
    scanned?: ReadonlyArray<string>,
  ) {
    const roots = new Set<string>();
    const repositories: string[] = [];
    for (const cwd of scanned ?? (yield* workingRepositories(copy))) {
      if (!(yield* fs.exists(path.join(cwd, ".git")))) continue;
      let available = true;
      for (const args of [
        ["rev-parse", "--absolute-git-dir"],
        ["rev-parse", "--git-common-dir"],
      ]) {
        const location = yield* git(cwd, args, true);
        if (location === null) {
          available = false;
          continue;
        }
        const actual = yield* fs.realPath(path.resolve(cwd, location));
        if (!contained(copy.rootPath, actual)) roots.add(actual);
      }
      if (available) repositories.push(cwd);
    }
    const digests: string[] = [];
    // Alternate stores can change without changing their pointer file. Bind the
    // reviewed snapshot to every available object, including unreachable objects.
    for (const cwd of repositories) {
      digests.push(
        yield* Effect.scoped(
          Effect.gen(function* () {
            const hash = NodeCrypto.createHash("sha256");
            const child = yield* spawner.spawn(
              ChildProcess.make(
                "git",
                [
                  "-c",
                  "core.fsmonitor=false",
                  "cat-file",
                  "--batch-all-objects",
                  "--batch-check=%(objectname)",
                ],
                { cwd, env: isolatedGitEnvironment, extendEnv: false },
              ),
            );
            yield* Effect.all(
              [
                child.stdout.pipe(
                  Stream.runForEach((chunk) =>
                    Effect.sync(() => {
                      hash.update(chunk);
                    }),
                  ),
                ),
                Stream.runDrain(child.stderr),
              ],
              { concurrency: "unbounded" },
            );
            if ((yield* child.exitCode) !== 0)
              return yield* new LibraryError({ reason: "archive-unverified" });
            return hash.digest("hex");
          }),
        ),
      );
    }
    for (const root of [...roots].toSorted()) {
      if ([...roots].some((other) => other !== root && contained(other, root))) continue;
      digests.push(yield* streamWorkingCopy(root));
    }
    return digests.join(":");
  });

  const inspectArchive = Effect.fn("LibraryWorkspace.inspectArchive")(function* (
    archivePath: string,
  ) {
    const reader = makeRecoveryTarReader();
    yield* fs.stream(archivePath).pipe(
      NodeStream.pipeThroughSimple(() => NodeZlib.createGunzip()),
      Stream.runForEach((chunk) =>
        Effect.try({
          try: () => reader.write(chunk),
          catch: () => new LibraryError({ reason: "archive-unverified" }),
        }),
      ),
      Effect.mapError(() => new LibraryError({ reason: "archive-unverified" })),
    );
    const archive = yield* Effect.try({
      try: reader.finish,
      catch: () => new LibraryError({ reason: "archive-unverified" }),
    });
    const manifest = yield* decodeFullManifest(archive.manifest).pipe(
      Effect.mapError(() => new LibraryError({ reason: "archive-unverified" })),
    );
    return { ...archive, manifest };
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
    // The same receipts prepareCopy checks for a conflict, so a client can choose before it creates.
    const registrations = (yield* store.receipts)
      .filter((receipt) => holdsRoot(receipt, rootPath))
      .toSorted((left, right) => Date.parse(right.copy.updatedAt) - Date.parse(left.copy.updatedAt))
      .map((receipt) => ({
        workingCopyId: receipt.copy.id,
        projectId: receipt.copy.projectId,
        projectTitle: receipt.project.title,
        ownership: receipt.copy.ownership,
      }));
    // Older clients judge the folder by this one holder. Managed files refuse a takeover without
    // asking the Library, so naming them keeps those clients from promising one.
    const preferred =
      registrations.find((registration) => registration.ownership === "managed") ??
      registrations.at(0);
    return {
      rootPath,
      exists: true,
      repositories,
      ...(preferred === undefined ? {} : { registration: preferred, registrations }),
    };
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

  /** The owner as the Library has it now, or null when the Library does not have that project. */
  const libraryOwner = Effect.fn("LibraryWorkspace.libraryOwner")(function* (projectId: string) {
    const unchecked = new LibraryError({
      reason: "blocked",
      detail:
        "Loom could not check which project owns this folder. Reconnect your Library and try again.",
    });
    if (Option.isNone(publisher) || !publisher.value.enabled) return yield* unchecked;
    return yield* publisher.value.project(projectId).pipe(
      // The prepare lock is held while this runs, so a stalled Library must not hold up others.
      Effect.timeout(OWNER_CHECK_TIMEOUT),
      Effect.catch((error) =>
        isLibraryError(error) && error.reason === "not-found"
          ? Effect.succeed(null)
          : Effect.fail(unchecked),
      ),
    );
  });

  // Archiving leaves a project's folders registered, and older builds could register one folder to
  // several projects. Only when every holder is archived or gone is each retired as unregister
  // leaves it: unregistered with state unchanged, so old conversations keep their binding.
  // Replication publishes the change, as after unregister.
  const takeOverFolder = Effect.fn("LibraryWorkspace.takeOverFolder")(function* (
    owners: ReadonlyArray<LibraryWorkspaceStore.WorkspaceReceipt>,
  ) {
    // Newest first, the order clients judge holders in, so both name the same project.
    const newest = owners.toSorted(
      (left, right) => Date.parse(right.copy.updatedAt) - Date.parse(left.copy.updatedAt),
    );
    const managed = newest.find((owner) => owner.copy.ownership === "managed");
    // Each check can wait out a stalled Library under the shared prepare lock, so they run together.
    const checks = yield* Effect.forEach(
      new Set(newest.map((owner) => owner.copy.projectId)),
      (projectId) => Effect.result(libraryOwner(projectId)),
      { concurrency: "unbounded" },
    );
    // A current project is named whatever else blocks the folder, even when another check failed.
    for (const check of checks)
      if (check._tag === "Success" && check.success !== null && !check.success.archived)
        return yield* new LibraryError({
          reason: "blocked",
          detail: `This folder already belongs to ${check.success.title}. Add it to that project instead.`,
        });
    // Files Loom created refuse the takeover whatever the Library says, so an unreachable Library
    // only loses the chance to name a current project instead.
    if (managed !== undefined)
      return yield* new LibraryError({
        reason: "blocked",
        detail: `This folder holds files Loom created for ${managed.project.title}. Review and remove them from that project before adding the folder to another one. Restore that project first if it is archived.`,
      });
    for (const check of checks) if (check._tag === "Failure") return yield* check.failure;
    const updatedAt = yield* now;
    for (const owner of owners)
      yield* store.put({ ...owner, copy: { ...owner.copy, registered: false, updatedAt } });
  });

  const emptyOrMissing = Effect.fnUntraced(function* (folder: string) {
    if (!(yield* fs.exists(folder))) return true;
    return (
      (yield* fs.stat(folder)).type === "Directory" &&
      (yield* fs.readDirectory(folder)).length === 0
    );
  });
  // A reserved copy made the repository's folder already, so an empty one is downloaded into.
  const cloneResource = Effect.fn("LibraryWorkspace.cloneResource")(function* (
    resource: LibraryResource,
    rootPath: string,
    repositoryPath: string,
    report: FillReport | undefined,
  ) {
    if (yield* fs.exists(path.join(repositoryPath, ".git"))) return;
    if (
      resource.remoteUrl === null ||
      resource.remoteUrl.startsWith("-") ||
      resource.remoteUrl.includes("\0")
    )
      return yield* new LibraryError({ reason: "invalid" });
    if (repositoryPath !== rootPath)
      yield* fs.makeDirectory(path.dirname(repositoryPath), { recursive: true });
    if (repositoryPath !== rootPath && !(yield* emptyOrMissing(repositoryPath)))
      return yield* new LibraryError({
        reason: "blocked",
        detail: `${resource.relativePath} already exists and is not a Git repository, so Loom cannot download ${resource.title} there. Move that folder, or choose another location.`,
      });
    const cloned = yield* gitFetch.cloneRepository({
      remoteUrl: resource.remoteUrl,
      branch: resource.defaultBranch,
      path: repositoryPath,
      ...(report === undefined ? {} : { onProgress: (progress) => report(resource, progress) }),
    });
    if (cloned.code !== 0)
      return yield* libraryCloneFailure({
        stderr: cloned.stderr,
        timedOut: cloned.timedOut,
        remoteUrl: resource.remoteUrl,
        environmentId,
        computer: yield* HostProcess.Hostname,
      });
  });
  /**
   * Gives a new copy its folders and local projects before any download, or null when it cannot
   * have them first: nothing to download, a repository inside another, or a folder in the way.
   */
  const reserveFolders = Effect.fn("LibraryWorkspace.reserveFolders")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
    input: LibraryPrepareCopyRequest,
    selected: ReadonlyArray<LibraryResource>,
    rootPath: string,
    paths: ReadonlyArray<string>,
  ) {
    if (receipt.reservation !== undefined) return receipt;
    if (
      selected.length === 0 ||
      selected.some(
        (resource) =>
          resource.remoteUrl === null ||
          resource.remoteUrl.startsWith("-") ||
          resource.remoteUrl.includes("\0"),
      ) ||
      paths.some((inner) => paths.some((outer) => outer !== inner && contained(outer, inner)))
    )
      return null;
    for (const repositoryPath of paths) {
      if (
        !(yield* emptyOrMissing(repositoryPath)) &&
        !(yield* fs.exists(path.join(repositoryPath, ".git")))
      )
        return null;
      yield* fs.makeDirectory(repositoryPath, { recursive: true });
    }
    const repositories: Array<{ resourceId: string; path: string; localProjectId: ProjectId }> = [];
    for (const [index, resource] of selected.entries())
      repositories.push({
        resourceId: resource.id,
        path: paths[index]!,
        localProjectId: yield* registerProject(
          input.requestId,
          receipt.copy.id,
          paths[index]!,
          resource.title,
          rootPath,
        ),
      });
    const reserved = {
      ...receipt,
      reservation: {
        resourceIds: selected.map((resource) => resource.id),
        rootLocalProjectId: yield* registerProject(
          input.requestId,
          receipt.copy.id,
          rootPath,
          input.project.title,
          rootPath,
        ),
        repositories,
      },
    };
    yield* store.put(reserved);
    return reserved;
  });

  /**
   * Where each selected repository goes. A copy of one repository is that repository, so it is
   * cloned at the copy's root; a copy that already recorded another layout keeps it.
   */
  const repositoryLayout = Effect.fn("LibraryWorkspace.repositoryLayout")(function* (
    rootPath: string,
    selected: ReadonlyArray<LibraryResource>,
    strategy: LibraryPrepareCopyRequest["strategy"],
    receipt: LibraryWorkspaceStore.WorkspaceReceipt | undefined,
  ) {
    const nested = selected.map((resource) => path.resolve(rootPath, resource.relativePath));
    const [only] = nested;
    if (only === undefined || nested.length !== 1 || only === rootPath) return nested;
    const recorded =
      receipt?.reservation?.repositories[0]?.path ?? receipt?.copy.repositories[0]?.path;
    if (recorded !== undefined) return [recorded];
    if (strategy === "reuse")
      return (yield* fs.exists(path.join(rootPath, ".git"))) &&
        !(yield* fs.exists(path.join(only, ".git")))
        ? [rootPath]
        : nested;
    // A partial download from before flat copies keeps its folder.
    return (yield* fs.exists(only)) ? nested : [rootPath];
  });

  /** Refuses places a copy must never go, including inside or around another copy. */
  const guardPlacement = Effect.fn("LibraryWorkspace.guardPlacement")(function* (
    rootPath: string,
    options: ProjectPlacement.PlacementGuardOptions & { readonly copyId?: string } = {},
  ) {
    const { copyId, ...guard } = options;
    yield* placements
      .assertPlacementAllowed(rootPath, guard)
      .pipe(
        Effect.mapError(
          (refused) => new LibraryError({ reason: "blocked", detail: refused.reason }),
        ),
      );
    const around = (yield* store.receipts).find(
      (saved) =>
        saved.copy.id !== copyId &&
        saved.copy.environmentId === environmentId &&
        saved.copy.registered !== false &&
        saved.copy.state !== "released" &&
        !samePath(saved.copy.rootPath, rootPath) &&
        (contained(rootPath, saved.copy.rootPath) || contained(saved.copy.rootPath, rootPath)),
    );
    if (around !== undefined)
      return yield* new LibraryError({
        reason: "blocked",
        detail: `Loom keeps files for ${around.project.title} inside or around this location (${around.copy.rootPath}). Choose a different location.`,
      });
  });
  const placementAllowed = (rootPath: string, options?: Parameters<typeof guardPlacement>[1]) =>
    guardPlacement(rootPath, options).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  const preparationFingerprint = Effect.fnUntraced(function* (
    input: LibraryPrepareCopyRequest,
    rootPath: string,
  ) {
    const requestedIds =
      input.resourceIds === undefined
        ? input.project.resources
            .filter((resource) => resource.kind !== "link")
            .map((resource) => resource.id)
        : [...new Set(input.resourceIds)];
    return yield* digest(
      yield* encodePreparation({ ...input, rootPath, resourceIds: requestedIds.toSorted() }),
    );
  });

  const prepareCopy = Effect.fn("LibraryWorkspace.prepareCopy")(function* (
    input: LibraryPrepareCopyRequest,
    rootPath: string,
    reserve = false,
    report?: FillReport,
  ) {
    if (!supportsExecution)
      return yield* new LibraryError({ reason: "blocked", detail: EXECUTION_DISABLED });
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
    const fingerprint = yield* preparationFingerprint(input, rootPath);
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
    const located = yield* repositoryLayout(rootPath, selected, input.strategy, existing);
    const repositoryPathOf = (resource: LibraryResource) =>
      located[selected.indexOf(resource)] ?? path.resolve(rootPath, resource.relativePath);
    if (existing === undefined) {
      yield* guardPlacement(
        rootPath,
        input.strategy === "reuse" ? { allowReuseOf: rootPath, projects: "within" } : {},
      );
      if (
        located.length > 0 &&
        !located.includes(rootPath) &&
        (yield* fs.exists(path.join(rootPath, ".git")))
      )
        return yield* new LibraryError({
          reason: "blocked",
          detail:
            "This folder is itself a Git repository, so Loom cannot add other repositories inside it. Choose another folder.",
        });
    }
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
      selected.every(
        (resource) =>
          receipt.copy.repositories.some((entry) => entry.resourceId === resource.id) &&
          keepsResource(receipt, resource),
      );
    const reusable = receipts.find(
      (receipt) =>
        samePath(receipt.copy.rootPath, rootPath) &&
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
            return yield* new LibraryError({
              reason: "blocked",
              detail: `${record.cwd} is open as another project on this computer, so Loom cannot reuse it for ${input.project.title}. Choose another folder.`,
            });
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
    // A copy this project still holds is reused above without the owner check, so starting a
    // conversation in it never depends on the Library. Registering a copy, new or retired, checks
    // first, so re-adding a folder to a project it was taken from never leaves two holding it.
    const conflicting = receipts.filter(
      (receipt) =>
        holdsRoot(receipt, rootPath) &&
        receipt.requestId !== input.requestId &&
        !(input.strategy === "reuse" && receipt.copy.projectId === input.project.id),
    );
    if (conflicting.length > 0) {
      if (input.strategy !== "reuse")
        return yield* new LibraryError({
          reason: "blocked",
          detail:
            "Loom already keeps project files at this location. Choose a different location for new files.",
        });
      yield* takeOverFolder(conflicting);
    }
    const retired = receipts.find(
      (receipt) =>
        samePath(receipt.copy.rootPath, rootPath) &&
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
    let receipt: LibraryWorkspaceStore.WorkspaceReceipt;
    if (existing === undefined) {
      if (input.strategy === "reuse") {
        if (!(yield* fs.exists(rootPath))) return yield* new LibraryError({ reason: "not-found" });
      } else if (!(yield* emptyOrMissing(rootPath)))
        return yield* new LibraryError({
          reason: "blocked",
          detail:
            "A folder already exists at this location. Choose an empty location for new files, or add the existing folder instead.",
        });
      else yield* fs.makeDirectory(rootPath, { recursive: true });
      const info = yield* fs.stat(rootPath);
      if (info.type !== "Directory") return yield* new LibraryError({ reason: "invalid" });
      const snapshot = input.strategy === "reuse" ? yield* projections.getShellSnapshot() : null;
      const existingProjects =
        input.strategy === "reuse"
          ? yield* Effect.forEach([...new Set([rootPath, ...located])], (workspaceRoot) =>
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
    if (reserve && input.strategy === "clone") {
      const reserved = yield* reserveFolders(receipt, input, selected, rootPath, located);
      if (reserved !== null) return reserved.copy;
    }
    const prepared = yield* Effect.result(
      Effect.gen(function* () {
        // Siblings download together; the loop below records them in order and stops at the first
        // that failed, as it did when they downloaded one at a time. One inside another waits there.
        const downloadFailures = new Map<string, Effect.Error<ReturnType<typeof cloneResource>>>();
        if (input.strategy === "clone") {
          const outermost = selected.filter(
            (resource) =>
              !selected.some(
                (other) =>
                  other !== resource &&
                  contained(repositoryPathOf(other), repositoryPathOf(resource)),
              ),
          );
          yield* Effect.forEach(
            outermost,
            (resource) =>
              cloneResource(resource, rootPath, repositoryPathOf(resource), report).pipe(
                Effect.catch((error) =>
                  Effect.sync(() => downloadFailures.set(resource.id, error)),
                ),
              ),
            { concurrency: CLONE_CONCURRENCY, discard: true },
          );
        }
        const repositories: Array<LibraryWorkingCopy["repositories"][number]> = [];
        for (const resource of selected.toSorted(
          (left, right) => left.relativePath.length - right.relativePath.length,
        )) {
          const repositoryPath = repositoryPathOf(resource);
          if (input.strategy === "clone") {
            const failure = downloadFailures.get(resource.id);
            if (failure !== undefined) return yield* Effect.fail(failure);
            yield* cloneResource(resource, rootPath, repositoryPath, report);
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
          if (input.strategy === "clone")
            yield* SetupMarker.write(repositoryPath).pipe(Effect.provide(restorationServices));
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
        if (input.strategy === "clone")
          yield* SetupMarker.write(rootPath).pipe(Effect.provide(restorationServices));
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

  /**
   * Linked worktrees outside the copy keep their Git metadata inside this repository, so
   * removing the copy breaks them and strands their work. Only an entry Git marks prunable is
   * already broken. A locked one may sit on unplugged media, which Git never calls prunable,
   * so a locked or unreadable entry counts as outside.
   */
  const externalWorktrees = Effect.fn("LibraryWorkspace.externalWorktrees")(function* (
    rootPath: string,
    repositoryPath: string,
  ) {
    // Git before 2.36 rejects -z; its line form differs only in the separator.
    const listed =
      (yield* git(repositoryPath, ["worktree", "list", "--porcelain", "-z"], true)) ??
      ((yield* git(repositoryPath, ["worktree", "list", "--porcelain"])) ?? "").replaceAll(
        "\n",
        "\0",
      );
    const entries: Array<{ path: string; prunable: boolean; locked: boolean }> = [];
    for (const field of listed.split("\0")) {
      const entry = entries.at(-1);
      if (field.startsWith("worktree "))
        entries.push({ path: field.slice("worktree ".length), prunable: false, locked: false });
      else if (entry === undefined) continue;
      else if (field === "prunable" || field.startsWith("prunable ")) entry.prunable = true;
      else if (field === "locked" || field.startsWith("locked ")) entry.locked = true;
    }
    const external: string[] = [];
    for (const entry of entries) {
      if (entry.locked) {
        external.push(entry.path);
        continue;
      }
      if (entry.prunable) continue;
      const actual = yield* fs.realPath(entry.path).pipe(Effect.orElseSucceed(() => null));
      if (actual === null || !contained(rootPath, actual)) external.push(entry.path);
    }
    return external;
  });

  const status = Effect.fn("LibraryWorkspace.status")(function* (
    input: { readonly workingCopyId: string },
    /** Borrowed folders are only read in full by a snapshot, which archives their files. */
    options: { readonly borrowedContents?: boolean } = {},
  ) {
    const receipt = yield* store.get(input.workingCopyId);
    const copy = receipt.copy;
    if (copy.environmentId !== environmentId) return yield* new LibraryError({ reason: "invalid" });
    const blockers: string[] = [];
    // Only removal strands these; a snapshot still reads the same files.
    const releaseBlockers: string[] = [];
    const facts: string[] = [];
    if (copy.state === "released" || copy.registered === false)
      return { copy, blockers, releaseBlockers, reviewToken: null, contentsDigest: null };
    if (copy.ownership === "borrowed") {
      // Forgetting a borrowed folder never touches its files, and unregister checks only the
      // record segment. Hashing every byte here made large folders impossible to forget.
      const root =
        (yield* fs.exists(copy.rootPath)) && (yield* fs.realPath(copy.rootPath)) === copy.rootPath
          ? fileIdentity(yield* fs.stat(copy.rootPath))
          : null;
      const contentsDigest =
        root !== null && options.borrowedContents === true
          ? yield* streamWorkingCopy(copy.rootPath)
          : null;
      return {
        copy,
        blockers,
        releaseBlockers,
        reviewToken: `${yield* digest(`unregister:${yield* encodeWorkingCopy(copy)}`)}:${root === null ? "missing" : `${root.device ?? ""}-${root.inode ?? ""}`}:${root === null ? "" : yield* externalGitReview(copy)}`,
        contentsDigest,
      };
    }
    const rootExists = yield* fs.exists(copy.rootPath);
    if (!rootExists)
      return {
        copy: { ...copy, state: "missing" as const },
        blockers: ["The working folder is unavailable."],
        releaseBlockers,
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
          other.copy.registered !== false &&
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
    const linkedWorktrees = new Set<string>();
    for (const repository of copy.repositories) {
      const inspected = (yield* fs.exists(repository.path))
        ? yield* inspectRepository(copy.rootPath, repository.path)
        : null;
      if (inspected === null) {
        blockers.push("A repository in this working folder is unavailable.");
        continue;
      }
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
        else
          for (const worktree of yield* externalWorktrees(copy.rootPath, repository.path))
            linkedWorktrees.add(worktree);
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
      else
        for (const worktree of yield* externalWorktrees(copy.rootPath, copy.rootPath))
          linkedWorktrees.add(worktree);
      facts.push(
        yield* encodeReviewRepository({
          resourceId: "project-root",
          head: yield* git(copy.rootPath, ["rev-parse", "HEAD"]),
          branch: yield* git(copy.rootPath, ["symbolic-ref", "--quiet", "--short", "HEAD"], true),
          unpushed: null,
        }),
      );
    }
    // A clone the copy never registered, such as vendor/lib, can have worktrees outside too.
    // Only a passing review needs them, and the Git review below walks the copy anyway.
    const scanned = blockers.length === 0 ? yield* workingRepositories(copy) : null;
    const checked = new Set(copy.repositories.map((repository) => repository.path));
    if (receipt.rootCheckpointRepository) checked.add(copy.rootPath);
    for (const cwd of scanned ?? []) {
      if (checked.has(cwd)) continue;
      // A .git file belongs to a worktree or submodule, and an unusable .git directory makes
      // Git search parent folders and list another repository's worktrees.
      const gitDirectory = yield* git(cwd, ["rev-parse", "--absolute-git-dir"], true);
      if (gitDirectory !== null && (yield* fs.realPath(gitDirectory)) === path.join(cwd, ".git"))
        for (const worktree of yield* externalWorktrees(copy.rootPath, cwd))
          linkedWorktrees.add(worktree);
    }
    if (linkedWorktrees.size > 0)
      releaseBlockers.push(linkedWorktreesBlocker([...linkedWorktrees].toSorted()));
    const state =
      repositories.length === copy.repositories.length ? copy.state : ("missing" as const);
    const current = {
      ...copy,
      repositories:
        repositories.length === copy.repositories.length ? repositories : copy.repositories,
      state,
    };
    // The archive digest binds index and working bytes. Git status would refresh
    // split-index metadata during this read and make every review immediately stale.
    const contentsDigest = blockers.length === 0 ? yield* streamWorkingCopy(copy.rootPath) : null;
    if (contentsDigest !== null) facts.push(`contents:${contentsDigest}`);
    if (contentsDigest !== null)
      facts.push(`git:${yield* externalGitReview(copy, scanned ?? undefined)}`);
    return {
      copy: current,
      contentsDigest,
      blockers: [...new Set(blockers)],
      releaseBlockers,
      releaseBlockerThreads: [...linkedWorktrees]
        .toSorted()
        .slice(0, LISTED_WORKTREES)
        .flatMap((worktreePath) => {
          // One owner per listed worktree keeps old conversations from flooding the repair list.
          const thread = [...snapshot.threads, ...snapshot.archivedThreads].find(
            (candidate) => candidate.deletedAt === null && candidate.worktreePath === worktreePath,
          );
          return thread === undefined
            ? []
            : [{ threadId: thread.id, title: thread.title, worktreePath }];
        }),
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
    // Files still on their way bind to the folders reserved for them.
    const reservation = LibraryWorkspaceStore.awaitingFiles(receipt)
      ? receipt.reservation
      : undefined;
    if (
      project.archived ||
      project.id !== copy.projectId ||
      !validLibraryResources(project.resources, { allowLocalRemotes: true }) ||
      copy.environmentId !== environmentId ||
      input.binding.environmentId !== environmentId ||
      copy.projectId !== input.binding.projectId ||
      project.revision !== input.binding.projectRevision ||
      (copy.state !== "ready" && reservation === undefined) ||
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
      (reservation?.repositories ?? copy.repositories).find(
        (repository) => repository.resourceId === id,
      ),
    );
    if (repositories.some((repository) => repository === undefined))
      return yield* new LibraryError({ reason: "invalid" });
    const selected = repositories.filter((repository) => repository !== undefined);
    if (selected.length === 0 && !receipt.rootCheckpointRepository)
      return yield* new LibraryError({ reason: "context-copy-required" });
    for (const repository of selected) {
      const current = project.resources.find(
        (resource) => resource.id === repository.resourceId && resource.kind !== "link",
      );
      if (current === undefined || !keepsResource(receipt, current))
        return yield* new LibraryError({ reason: "invalid" });
      if (!(yield* fs.exists(repository.path)))
        return yield* new LibraryError({ reason: "not-found" });
      if (reservation !== undefined) continue;
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
    const localProjectId =
      component?.localProjectId ?? reservation?.rootLocalProjectId ?? receipt.rootLocalProjectId;
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

  /**
   * The folder a conversation binds to: the copy's own folder, or the worktree it started in. That
   * worktree must be a linked worktree of the one repository in scope and live outside the copy,
   * where the copy's Remove files check finds it and keeps the copy until the worktree is gone.
   */
  const threadFolder = Effect.fn("LibraryWorkspace.threadFolder")(function* (
    input: LibraryResolveBindingRequest & {
      readonly project?: LibraryProject | undefined;
      readonly worktreePath?: string | undefined;
    },
  ) {
    const resolved = yield* resolveBinding({
      binding: input.binding,
      ...(input.project === undefined ? {} : { project: input.project }),
    });
    if (input.worktreePath === undefined) return resolved;
    const receipt = yield* store.get(resolved.binding.workingCopyId);
    if (
      resolved.repositoryPaths.length !== 1 ||
      resolved.repositoryPaths[0] !== resolved.cwd ||
      !(yield* fs.exists(input.worktreePath))
    )
      return yield* new LibraryError({ reason: "invalid" });
    const worktree = yield* fs.realPath(input.worktreePath);
    if (
      contained(receipt.copy.rootPath, worktree) ||
      (yield* fs.stat(path.join(worktree, ".git"))).type !== "File"
    )
      return yield* new LibraryError({ reason: "invalid" });
    const commonDirectory = Effect.fnUntraced(function* (directory: string) {
      const common = yield* git(directory, ["rev-parse", "--git-common-dir"]);
      return yield* fs.realPath(path.resolve(directory, common!));
    });
    if ((yield* commonDirectory(worktree)) !== (yield* commonDirectory(resolved.cwd)))
      return yield* new LibraryError({ reason: "invalid" });
    return { ...resolved, cwd: worktree, worktreeOf: resolved.cwd };
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
    if (reviewed.reviewToken?.split(":")[0] !== input.reviewToken.split(":")[0])
      return yield* new LibraryError({ reason: "blocked", detail: CHANGED_SINCE_REVIEW });
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
  /** A failed download never ran anything, so it is cleaned up as an unused copy would be. */
  const isReclaimableCopy = (copy: LibraryWorkingCopy) =>
    isTemporaryCopy(copy.state === "failed" ? { ...copy, state: "ready" } : copy);

  /** Whether a copy no conversation ever used has waited out the Storage setting. */
  const unusedLongEnough = Effect.fn("LibraryWorkspace.unusedLongEnough")(function* (
    copy: LibraryWorkingCopy,
  ) {
    const days = yield* serverSettings.getSettings.pipe(
      Effect.map((current) => current.storageCleanup.unusedCopiesAfterDays),
      Effect.orElseSucceed(() => null),
    );
    if (days === null) return false;
    const age = DateTime.toEpochMillis(yield* DateTime.now) - Date.parse(copy.updatedAt);
    return age >= Duration.toMillis(Duration.days(days));
  });

  /**
   * Why removing a copy's repositories could lose work, or null when each is clean, everything
   * its refs, stashes and reflogs reach is on its project's remote (fetched with this computer's
   * credentials) and its only ignored files are regenerable output such as node_modules. `.env`
   * files, local databases, submodules and any other repository in the folder count as work.
   */
  const unpublishedWork = Effect.fn("LibraryWorkspace.unpublishedWork")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
  ) {
    const copy = receipt.copy;
    const expected = new Set(copy.repositories.map((repository) => repository.path));
    if (receipt.rootCheckpointRepository) expected.add(copy.rootPath);
    if ((yield* workingRepositories(copy)).some((found) => !expected.has(found)))
      return "another repository or worktree in these files";
    for (const repository of copy.repositories) {
      const changes = yield* git(
        repository.path,
        [
          "--no-optional-locks",
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--ignore-submodules=none",
        ],
        true,
      );
      if (changes !== "") return "uncommitted changes";
      // Deinitialized submodules keep their commits here, with no folder to find.
      if (yield* fs.exists(path.join(repository.path, ".git", "modules")))
        return "submodule history";
      const index = yield* runner.run({
        command: "git",
        args: ["-c", "core.fsmonitor=false", "ls-files", "-v", "-z"],
        cwd: repository.path,
        env: isolatedGitEnvironment,
        extendEnv: false,
        timeout: "2 minutes",
        maxOutputBytes: INDEX_LISTING_BYTES,
      });
      if (index.code !== 0) return "unreadable index";
      if (index.stdout.split("\0").some((entry) => HIDDEN_INDEX_ENTRY.test(entry)))
        return "files whose changes Git status hides";
      const ignored = yield* git(
        repository.path,
        ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
        true,
      );
      const ignoredBlocker =
        ignored === null
          ? "unreadable ignored files"
          : yield* landedIgnoredFileBlocker(repository.path, ignored).pipe(
              Effect.provideService(GitVcsDriver.GitVcsDriver, gitDriver),
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
              Effect.orElseSucceed(() => "unreadable ignored files"),
            );
      if (ignoredBlocker !== null) return `ignored local files such as ${ignoredBlocker}`;
      // Only the project's own remote counts: another remote can be a local folder, or this one.
      const resource = receipt.project.resources.find(
        (entry) => entry.id === repository.resourceId && entry.kind !== "link",
      );
      const publication = yield* proveRepositoryPublication(
        (args) =>
          git(repository.path, args, false, credentialedGitEnvironment).pipe(
            Effect.filterOrFail(
              (output): output is string => output !== null,
              () => new LibraryError({ reason: "io" }),
            ),
          ),
        resource?.remoteUrl != null && validLibraryResources([resource])
          ? [resource.remoteUrl]
          : [],
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
      if (!publication.published) return publication.reason;
    }
    return null;
  });

  /** The first file in a copy that sits outside every repository, which only an archive keeps. */
  const strayEntry = Effect.fn("LibraryWorkspace.strayEntry")(function* (copy: LibraryWorkingCopy) {
    const repositories = copy.repositories.map((repository) => repository.path);
    const pending = repositories.includes(copy.rootPath) ? [] : [copy.rootPath];
    while (pending.length > 0) {
      const directory = pending.shift()!;
      for (const name of yield* fs.readDirectory(directory)) {
        const entry = path.join(directory, name);
        if (name === ".DS_Store" || repositories.includes(entry)) continue;
        if (
          repositories.some((repository) => contained(entry, repository)) &&
          (yield* fs.stat(entry)).type === "Directory"
        )
          pending.push(entry);
        else return path.relative(copy.rootPath, entry);
      }
    }
    return null;
  });

  /** Released with nothing to archive: every file is a clean, published repository's. */
  const fullyPublished = (receipt: LibraryWorkspaceStore.WorkspaceReceipt) =>
    receipt.rootCheckpointRepository || receipt.copy.repositories.length === 0
      ? Effect.succeed(false)
      : Effect.gen(function* () {
          if ((yield* unpublishedWork(receipt)) !== null) return false;
          return (yield* strayEntry(receipt.copy)) === null;
        }).pipe(Effect.orElseSucceed(() => false));

  /**
   * Whether a project or another copy now lives at or inside the folder a release set aside. A
   * search for existing checkouts can offer that folder, and its next retry would delete it.
   */
  const removalPathInUse = Effect.fn("LibraryWorkspace.removalPathInUse")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
    removalPath: string,
  ) {
    if (
      (yield* projects.listShells()).some((project) =>
        contained(removalPath, project.workspaceRoot),
      )
    )
      return true;
    return (yield* store.receipts).some(
      (other) =>
        other.copy.id !== receipt.copy.id &&
        other.copy.state !== "released" &&
        other.copy.registered !== false &&
        contained(removalPath, other.copy.rootPath),
    );
  });
  /** A copy whose folder and set-aside folder are both gone may sit on an unplugged disk. */
  const folderUnavailable = Effect.fn("LibraryWorkspace.folderUnavailable")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
  ) {
    return (
      !(yield* fs.exists(receipt.copy.rootPath)) &&
      (receipt.removalPath === null || !(yield* fs.exists(receipt.removalPath))) &&
      !(yield* fs.exists(path.dirname(receipt.copy.rootPath)))
    );
  });

  const canCleanUp = Effect.fn("LibraryWorkspace.canCleanUp")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
    isHistoryAcknowledged: (threadId: ThreadId) => Effect.Effect<boolean, LibraryError>,
  ) {
    const copy = receipt.copy;
    if (!isReclaimableCopy(copy)) return false;
    const bindings = (yield* store.bindings).filter(
      (row) => row.resolved.binding.workingCopyId === copy.id,
    );
    const projectIds = new Set([
      receipt.rootLocalProjectId,
      copy.rootLocalProjectId,
      ...copy.repositories.map((repository) => repository.localProjectId),
    ]);
    const snapshot = yield* projections.getShellSnapshot();
    const related = [...snapshot.threads, ...snapshot.archivedThreads].filter(
      (thread) =>
        projectIds.has(thread.projectId) ||
        receipt.legacyThreadIds.includes(thread.id) ||
        bindings.some((binding) => binding.threadId === thread.id) ||
        (thread.worktreePath !== null && contained(copy.rootPath, thread.worktreePath)),
    );
    // A folder prepared for work waits until it is old enough to count as unused. Missing bound
    // threads are uncertain.
    if (related.length === 0) {
      if (
        bindings.length > 0 ||
        receipt.legacyThreadIds.length > 0 ||
        !(yield* unusedLongEnough(copy))
      )
        return false;
    } else if (
      copy.state !== "ready" ||
      receipt.legacyThreadIds.some((id) => !related.some((thread) => thread.id === id)) ||
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
    for (const thread of related) if (!(yield* isHistoryAcknowledged(thread.id))) return false;
    const rootExists = yield* fs.exists(copy.rootPath);
    const processPath = rootExists ? copy.rootPath : receipt.removalPath;
    if (processPath === null) return false;
    // A settled conversation may still have a server or watcher using its checkout.
    if (
      (yield* managedProjectProcessReason(processPath).pipe(
        Effect.provide(restorationServices),
      )) !== null
    )
      return false;
    if (!rootExists)
      return (
        !(yield* folderUnavailable(receipt)) && !(yield* removalPathInUse(receipt, processPath))
      );
    if ((yield* unpublishedWork(receipt)) !== null) return false;
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

  const publishArchive = Effect.fn("LibraryWorkspace.publishArchive")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
    input: { readonly requestId: string; readonly reviewToken: string },
    reviewed: { readonly contentsDigest: string | null },
    commit: (
      saved: LibraryWorkspaceStore.WorkspaceReceipt,
    ) => Effect.Effect<LibraryWorkspaceStore.WorkspaceReceipt, LibraryError>,
  ) {
    const archiveDirectory = path.join(config.stateDir, "project-library", "archives");
    yield* fs.makeDirectory(archiveDirectory, { recursive: true, mode: 0o700 });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const archivePath = path.join(
          archiveDirectory,
          `recovery-${yield* crypto.randomUUIDv4()}.tar.gz`,
        );
        yield* Effect.acquireRelease(
          fs
            .writeFile(archivePath, new Uint8Array(), { flag: "wx", mode: 0o600 })
            .pipe(Effect.as(archivePath)),
          (stagingPath) =>
            store.receipts.pipe(
              Effect.flatMap((receipts) =>
                receipts.some((saved) => saved.archivePath === stagingPath)
                  ? Effect.void
                  : fs.remove(stagingPath, { force: true }),
              ),
              // A failed write may have committed its receipt; uncertainty must retain recovery.
              Effect.ignore,
            ),
        );
        const manifestDirectory = yield* fs.makeTempDirectoryScoped({
          directory: archiveDirectory,
          prefix: "manifest-",
        });
        const portableRepositories = yield* portableGit(receipt, manifestDirectory);
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
            portableRepositories,
          }),
          { mode: 0o600 },
        );
        if (
          (yield* streamWorkingCopy(receipt.copy.rootPath, {
            path: archivePath,
            manifestDirectory,
          })) !== reviewed.contentsDigest
        )
          return yield* new LibraryError({ reason: "blocked", detail: CHANGED_SINCE_REVIEW });
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
        const stillCurrent = yield* status({ workingCopyId: receipt.copy.id });
        if (stillCurrent.reviewToken !== input.reviewToken)
          return yield* new LibraryError({ reason: "blocked", detail: CHANGED_SINCE_REVIEW });
        if (Option.isNone(recoveryPublisher))
          return yield* new LibraryError({ reason: "publisher-unavailable" });
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
        const saved = {
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
          archivePath,
          archiveDigest,
        };
        const superseded = receipt.archivePath;
        receipt = yield* commit(saved);
        // The receipt now names the new archive, so the cached older one restores nothing.
        if (superseded !== null && superseded !== archivePath)
          yield* fs.remove(superseded, { force: true }).pipe(Effect.ignore);
      }),
    );
    return receipt;
  });

  const snapshotCopy = Effect.fn("LibraryWorkspace.snapshotCopy")(function* (
    input: LibrarySnapshotCopyRequest,
  ) {
    if (!supportsExecution)
      return yield* new LibraryError({ reason: "blocked", detail: EXECUTION_DISABLED });
    const receipt = yield* store.get(input.workingCopyId);
    if (receipt.copy.environmentId !== environmentId)
      return yield* new LibraryError({ reason: "invalid" });
    const previous = receipt.snapshotRequests?.find(
      (request) => request.requestId === input.requestId,
    );
    if (previous !== undefined) {
      if (previous.reviewToken !== input.reviewToken)
        return yield* new LibraryError({ reason: "request-conflict" });
      return previous.copy;
    }
    if (receipt.copy.state !== "ready" || receipt.copy.registered === false)
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "These files are not ready on this computer, so Loom cannot save them. Prepare them here again, then retry.",
      });
    if (
      (yield* store.receipts).some(
        (saved) =>
          saved.copy.id !== receipt.copy.id &&
          (saved.requestId === input.requestId ||
            saved.snapshotRequests?.some((request) => request.requestId === input.requestId)),
      )
    )
      return yield* new LibraryError({ reason: "request-conflict" });
    const bindings = (yield* store.bindings).filter(
      (binding) => binding.resolved.binding.workingCopyId === receipt.copy.id,
    );
    const projectIds = new Set([
      receipt.rootLocalProjectId,
      receipt.copy.rootLocalProjectId,
      ...receipt.copy.repositories.map((repository) => repository.localProjectId),
    ]);
    const assertIdle = Effect.gen(function* () {
      const snapshot = yield* projections.getShellSnapshot();
      if (
        [...snapshot.threads, ...snapshot.archivedThreads].some(
          (thread) =>
            (projectIds.has(thread.projectId) ||
              receipt.legacyThreadIds.includes(thread.id) ||
              bindings.some((binding) => binding.threadId === thread.id) ||
              (thread.worktreePath !== null &&
                contained(receipt.copy.rootPath, thread.worktreePath))) &&
            (thread.activeRunId !== null ||
              thread.pendingRuntimeRequest !== null ||
              (thread.pendingBackgroundTasks?.length ?? 0) > 0 ||
              thread.goal?.status === "active"),
        )
      )
        return yield* new LibraryError({ reason: "blocked", detail: COPY_IN_USE });
      const processReason = yield* managedProjectProcessReason(receipt.copy.rootPath).pipe(
        Effect.provide(restorationServices),
      );
      if (processReason !== null)
        return yield* new LibraryError({ reason: "blocked", detail: COPY_IN_USE });
    });
    yield* assertIdle;
    // The archive must match this digest, so a borrowed folder's files are read here, not in review.
    const reviewed = yield* status(
      { workingCopyId: input.workingCopyId },
      { borrowedContents: true },
    );
    if (
      reviewed.reviewToken !== input.reviewToken ||
      reviewed.contentsDigest === null ||
      reviewed.blockers.length > 0
    )
      return yield* new LibraryError({
        reason: "blocked",
        detail: reviewed.blockers[0] ?? CHANGED_SINCE_REVIEW,
      });
    const saved = yield* publishArchive(
      receipt,
      input,
      reviewed,
      Effect.fn("LibraryWorkspace.recordSnapshot")(function* (archived) {
        yield* mapIo(assertIdle);
        const finalReview = yield* mapIo(status({ workingCopyId: receipt.copy.id }));
        if (finalReview.reviewToken !== input.reviewToken)
          return yield* new LibraryError({ reason: "blocked", detail: CHANGED_SINCE_REVIEW });
        const recovery = archived.copy.recovery;
        if (recovery === undefined)
          return yield* new LibraryError({ reason: "archive-unverified" });
        const timestamp = yield* now;
        const saved = {
          ...archived,
          copy: { ...archived.copy, updatedAt: timestamp },
          snapshotRequests: [
            ...(archived.snapshotRequests ?? []),
            {
              requestId: input.requestId,
              reviewToken: input.reviewToken,
              copy: { ...archived.copy, updatedAt: timestamp },
            },
          ],
        };
        yield* store.put(saved);
        return saved;
      }),
    );
    return saved.copy;
  });

  const release = Effect.fn("LibraryWorkspace.release")(function* (
    input: LibraryReleaseCopyRequest,
    isHistoryAcknowledged?: (threadId: ThreadId) => Effect.Effect<boolean, LibraryError>,
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
    if (isHistoryAcknowledged && !(yield* canCleanUp(receipt, isHistoryAcknowledged)))
      return yield* new LibraryError({ reason: "blocked", detail: COPY_IN_USE });
    if (receipt.removalPath === null) {
      const reviewed = yield* status({ workingCopyId: input.workingCopyId });
      if (
        reviewed.reviewToken === null ||
        reviewed.reviewToken !== input.reviewToken ||
        reviewed.blockers.length !== 0 ||
        reviewed.releaseBlockers.length !== 0
      )
        return yield* new LibraryError({
          reason: "blocked",
          detail: reviewed.blockers[0] ?? reviewed.releaseBlockers[0] ?? CHANGED_SINCE_REVIEW,
        });
      const removalPath = `${receipt.copy.rootPath}.loom-released-${(yield* digest(input.requestId)).slice(0, 16)}`;
      // Files that are all on their remotes download again, so only the others are archived.
      if (receipt.copy.ownership === "managed" && (yield* fullyPublished(receipt))) {
        receipt = {
          ...receipt,
          publishedRelease: true,
          reopenRequestId: undefined,
          releaseRequestId: input.requestId,
          releaseReviewToken: input.reviewToken,
          removalPath,
        };
      } else if (receipt.copy.ownership === "managed") {
        if (Option.isNone(recoveryPublisher) || !recoveryPublisher.value.configured)
          return yield* new LibraryError({ reason: "publisher-unavailable" });
        receipt = yield* publishArchive(
          receipt,
          input,
          reviewed,
          Effect.fn("LibraryWorkspace.recordReleaseArchive")(function* (saved) {
            const pending = {
              ...saved,
              publishedRelease: undefined,
              reopenRequestId: undefined,
              releaseRequestId: input.requestId,
              releaseReviewToken: input.reviewToken,
              removalPath,
            };
            yield* store.put(pending);
            return pending;
          }),
        );
      }
    }
    if (receipt.copy.ownership === "managed") {
      const removalPath = receipt.removalPath;
      if (receipt.publishedRelease === true) {
        if (removalPath === null) return yield* new LibraryError({ reason: "invalid" });
      } else if (
        receipt.copy.recovery === undefined ||
        receipt.copy.recovery.sha256 !== receipt.archiveDigest
      )
        return yield* new LibraryError({ reason: "archive-unverified" });
      else if (
        receipt.archivePath === null ||
        receipt.archiveDigest === null ||
        removalPath === null ||
        !(yield* fs.exists(receipt.archivePath)) ||
        (yield* fileDigest(receipt.archivePath)) !== receipt.archiveDigest
      )
        return yield* new LibraryError({
          reason: "blocked",
          detail:
            "The saved archive for these files is missing or changed on this computer. Turn on Keep files on this computer, then review the files again before removing them.",
        });
      if (removalPath === null) return yield* new LibraryError({ reason: "invalid" });
      if (yield* fs.exists(receipt.copy.rootPath)) {
        if (yield* fs.exists(removalPath))
          return yield* new LibraryError({
            reason: "blocked",
            detail: `Something already exists at ${removalPath}, where Loom moves files before removing them. Move it, then retry.`,
          });
        const current = yield* status({ workingCopyId: input.workingCopyId });
        if (current.reviewToken !== input.reviewToken || current.releaseBlockers.length !== 0)
          return yield* new LibraryError({
            reason: "blocked",
            detail: current.releaseBlockers[0] ?? CHANGED_SINCE_REVIEW,
          });
        if (isHistoryAcknowledged && !(yield* canCleanUp(receipt, isHistoryAcknowledged)))
          return yield* new LibraryError({ reason: "blocked", detail: COPY_IN_USE });
        // Recorded only now, so a change found by the checks above leaves no pending release.
        if (receipt.publishedRelease === true) yield* store.put(receipt);
        yield* fs.rename(receipt.copy.rootPath, removalPath);
      }
      if (yield* fs.exists(removalPath)) {
        if (yield* removalPathInUse(receipt, removalPath))
          return yield* new LibraryError({
            reason: "blocked",
            detail: `Loom kept ${removalPath} because a project on this computer now uses it. Remove that project, then retry.`,
          });
        const identity = fileIdentity(yield* fs.stat(removalPath));
        if (
          (yield* fs.realPath(removalPath)) !== removalPath ||
          identity.device === null ||
          receipt.rootIdentity?.device !== identity.device ||
          receipt.rootIdentity?.inode !== identity.inode
        )
          return yield* new LibraryError({
            reason: "blocked",
            detail: `Loom kept ${removalPath} because it changed after Loom set it aside. Review it and remove it yourself.`,
          });
        yield* fs.remove(removalPath, { recursive: true });
      }
    }
    if (!(yield* fs.exists(receipt.copy.rootPath)) && (yield* folderUnavailable(receipt)))
      return yield* new LibraryError({
        reason: "blocked",
        detail: `Loom cannot reach ${path.dirname(receipt.copy.rootPath)}. Connect the disk that holds these files, then retry.`,
      });
    const released = {
      ...receipt,
      releaseRequestId: input.requestId,
      releaseReviewToken: input.reviewToken,
      copy: { ...receipt.copy, state: "released" as const, updatedAt: yield* now },
    };
    yield* store.put(released);
    for (const cwd of [released.copy.rootPath, ...released.copy.repositories.map((r) => r.path)])
      yield* SetupMarker.clear(cwd).pipe(Effect.provide(restorationServices), Effect.ignore);
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
        return yield* new LibraryError({
          reason: "blocked",
          detail:
            "Loom is already removing these files. Let the removal finish before changing whether they stay on this computer.",
        });
      receipt = {
        ...receipt,
        publishedRelease: undefined,
        releaseRequestId: null,
        releaseReviewToken: null,
        removalPath: null,
      };
    }
    const copy = { ...receipt.copy, keepOnComputer: input.keepOnComputer, updatedAt: yield* now };
    yield* store.put({ ...receipt, copy });
    return copy;
  });

  const validatePortableRepository = Effect.fn("LibraryWorkspace.validatePortableRepository")(
    function* (cwd: string, gitDirectory = path.join(cwd, ".git")) {
      if (
        !(yield* fs.exists(gitDirectory)) ||
        (yield* fs.stat(gitDirectory)).type !== "Directory" ||
        (yield* fs.realPath(gitDirectory)) !== gitDirectory
      )
        return yield* new LibraryError({ reason: "archive-unverified" });
      for (const filename of [
        "commondir",
        "gitdir",
        "objects/info/alternates",
        "objects/info/http-alternates",
      ])
        if (yield* fs.exists(path.join(gitDirectory, filename)))
          return yield* new LibraryError({ reason: "archive-unverified" });
      const packDirectory = path.join(gitDirectory, "objects", "pack");
      if (
        (yield* fs.exists(packDirectory)) &&
        (yield* fs.readDirectory(packDirectory)).some((name) => name.endsWith(".promisor"))
      )
        return yield* new LibraryError({ reason: "archive-unverified" });
      const run = Effect.fn("LibraryWorkspace.isolatedGit")(function* (
        args: ReadonlyArray<string>,
      ) {
        const result = yield* runner.run({
          command: "git",
          args: [
            `--git-dir=${gitDirectory}`,
            `--work-tree=${cwd}`,
            "-c",
            `core.hooksPath=${path.join(config.stateDir, "disabled-restore-hooks")}`,
            "-c",
            "core.fsmonitor=false",
            ...args,
          ],
          cwd,
          env: isolatedGitEnvironment,
          extendEnv: false,
          timeout: "10 minutes",
          maxOutputBytes: 16 * 1024 * 1024,
        });
        if (result.code !== 0) return yield* new LibraryError({ reason: "archive-unverified" });
        return result.stdout.trim();
      });
      const configPath = path.join(gitDirectory, "config");
      let configuration = yield* run([
        "config",
        "--file",
        configPath,
        "--no-includes",
        "--null",
        "--list",
      ]);
      const worktreeConfig = path.join(gitDirectory, "config.worktree");
      if (yield* fs.exists(worktreeConfig))
        configuration +=
          "\0" +
          (yield* run(["config", "--file", worktreeConfig, "--no-includes", "--null", "--list"]));
      // Keep portable repository settings; source includes and executable/path overrides stay local.
      yield* fs.writeFileString(configPath, "[core]\nrepositoryformatversion = 0\nbare = false\n", {
        mode: 0o600,
      });
      const records = configuration.split("\0").flatMap((record) => {
        const separator = record.indexOf("\n");
        return separator < 0
          ? []
          : [{ key: record.slice(0, separator), value: record.slice(separator + 1) }];
      });
      const isPortableNetworkUrl = (value: string) => {
        if (/^[^/\s:@]+@[^/\s:]+:/.test(value)) return true;
        try {
          const remote = new URL(value);
          return (
            ["http:", "https:", "ssh:", "git:"].includes(remote.protocol) &&
            remote.hostname !== "" &&
            remote.password === "" &&
            (remote.protocol === "ssh:" || remote.username === "")
          );
        } catch {
          return false;
        }
      };
      const isNetworkRemote = (key: string, value: string) =>
        /^remote\..+\.(?:url|pushurl)$/.test(key) && isPortableNetworkUrl(value);
      const isPortableSubmoduleSetting = (key: string, value: string) => {
        if (/^submodule\..+\.url$/.test(key))
          return (
            isPortableNetworkUrl(value) ||
            (/^\.\.?\//.test(value) && !hasNonPortablePathCharacters(value))
          );
        if (/^submodule\..+\.active$/.test(key))
          return /^(?:true|false|yes|no|on|off|0|1)$/i.test(value);
        if (/^submodule\..+\.update$/.test(key))
          return ["checkout", "rebase", "merge", "none"].includes(value);
        if (key === "submodule.active")
          return (
            value !== "" &&
            !hasNonPortablePathCharacters(value) &&
            !value.startsWith("/") &&
            !value.split("/").includes("..")
          );
        return false;
      };
      const portableRemotes = new Set(
        records
          .filter(({ key, value }) => isNetworkRemote(key, value))
          .map(({ key }) => key.slice("remote.".length, key.lastIndexOf("."))),
      );
      for (const { key, value } of records) {
        if (
          (key === "extensions.refstorage" && !["files", "reftable"].includes(value)) ||
          (key === "extensions.objectformat" && !["sha1", "sha256"].includes(value))
        )
          return yield* new LibraryError({ reason: "archive-unverified" });
        if (
          isNetworkRemote(key, value) ||
          isPortableSubmoduleSetting(key, value) ||
          (/^remote\..+\.fetch$/.test(key) &&
            portableRemotes.has(key.slice("remote.".length, -".fetch".length))) ||
          (/^branch\..+\.remote$/.test(key) && (value === "." || portableRemotes.has(value))) ||
          /^branch\..+\.(?:merge|rebase)$/.test(key) ||
          /^(?:core\.(?:repositoryformatversion|filemode|ignorecase|precomposeunicode|symlinks|sparsecheckout|sparsecheckoutcone|autocrlf|eol|safecrlf|protecthfs|protectntfs)|extensions\.(?:objectformat|refstorage))$/.test(
            key,
          )
        )
          yield* run(["config", "--file", configPath, "--add", key, value]);
      }
      const disabledHooks = path.join(
        gitDirectory,
        `loom-disabled-hooks-${yield* crypto.randomUUIDv4()}`,
      );
      yield* fs.makeDirectory(disabledHooks);
      yield* run([
        "config",
        "--file",
        configPath,
        "core.hooksPath",
        path.relative(cwd, disabledHooks).split(path.sep).join("/"),
      ]);
      for (const filename of ["config.worktree", "worktrees"])
        yield* fs.remove(path.join(gitDirectory, filename), { recursive: true, force: true });
      if (
        (yield* run(["rev-parse", "--show-toplevel"])) !== cwd ||
        (yield* run(["rev-parse", "--absolute-git-dir"])) !== gitDirectory ||
        (yield* fs.realPath(
          yield* run(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
        )) !== gitDirectory
      )
        return yield* new LibraryError({ reason: "archive-unverified" });
      yield* run(["-c", "core.fsmonitor=false", "fsck", "--full", "--cache", "--no-dangling"]);
      yield* run(["-c", "core.fsmonitor=false", "ls-files", "--stage", "-z"]);
    },
  );

  const ensureRestoreSetupPending = Effect.fn("LibraryWorkspace.ensureRestoreSetupPending")(
    function* (cwd: string, create = true) {
      const marker = yield* SetupMarker.markerPath(cwd).pipe(Effect.provide(restorationServices));
      const contents = SetupMarker.PENDING_CONTENTS;
      yield* fs.makeDirectory(path.dirname(marker), { recursive: true, mode: 0o700 });
      const unexpected = () =>
        new LibraryError({
          reason: "blocked",
          detail: `Loom found a file it did not create at ${marker}. Remove it, then retry.`,
        });
      if (Option.isSome(yield* fs.readLink(marker).pipe(Effect.option))) return yield* unexpected();
      if (create)
        yield* fs.writeFileString(marker, contents, { flag: "wx" }).pipe(
          Effect.catch(() =>
            Effect.gen(function* () {
              if (
                (yield* fs.realPath(marker)) !== marker ||
                (yield* fs.stat(marker)).type !== "File" ||
                (yield* fs.readFileString(marker)) !== contents
              )
                return yield* unexpected();
            }),
          ),
        );
      else if (yield* fs.exists(marker)) {
        if (
          (yield* fs.realPath(marker)) !== marker ||
          (yield* fs.stat(marker)).type !== "File" ||
          (yield* fs.readFileString(marker)) !== contents
        )
          return yield* unexpected();
      }
    },
  );

  const restoreCopy = Effect.fn("LibraryWorkspace.restoreCopy")(function* (
    input: LibraryRestoreCopyRequest,
    rootPath: string,
  ) {
    if (!supportsExecution)
      return yield* new LibraryError({ reason: "blocked", detail: EXECUTION_DISABLED });
    const source = input.grant.sourceCopy;
    const recovery = source.recovery;
    if (
      input.project.archived ||
      source.projectId !== input.project.id ||
      recovery === undefined ||
      input.grant.destinationEnvironmentId !== environmentId ||
      !validLibraryResources(input.project.resources, { allowLocalRemotes: true })
    )
      return yield* new LibraryError({ reason: "invalid" });
    const resourceIds =
      input.resourceIds ??
      input.project.resources
        .filter((resource) => resource.kind !== "link")
        .map((resource) => resource.id);
    if (
      new Set(resourceIds).size !== resourceIds.length ||
      resourceIds.some(
        (id) => !source.repositories.some((repository) => repository.resourceId === id),
      )
    )
      return yield* new LibraryError({ reason: "invalid" });
    // A copy that held its one repository at its root restores in that layout.
    const restoredPath = (repository: LibraryWorkingCopy["repositories"][number]) =>
      repository.path === source.rootPath
        ? "."
        : (input.project.resources.find((resource) => resource.id === repository.resourceId)
            ?.relativePath ?? ".");
    const stateRoot = yield* canonicalRoot(config.stateDir);
    if (contained(rootPath, stateRoot) || contained(stateRoot, rootPath))
      return yield* new LibraryError({ reason: "invalid" });
    // Copies and projects around this folder are checked below, with this restore's own excepted.
    yield* placements
      .assertPlacementAllowed(rootPath, { projects: "ignore" })
      .pipe(
        Effect.mapError(
          (refused) => new LibraryError({ reason: "blocked", detail: refused.reason }),
        ),
      );
    const fingerprint = yield* digest(
      yield* encodeRestoreIdentity({
        project: input.project,
        rootPath,
        resourceIds: [...resourceIds].toSorted(),
        sourceCopyId: source.id,
        sourceEnvironmentId: source.environmentId,
        sha256: recovery.sha256,
        byteLength: recovery.byteLength,
        libraryEnvironmentId: input.grant.libraryEnvironmentId,
      }),
    );
    const receipts = yield* store.receipts;
    let receipt = receipts.find((saved) => saved.requestId === input.requestId);
    if (receipt !== undefined && receipt.fingerprint !== fingerprint)
      return yield* new LibraryError({ reason: "request-conflict" });
    if (
      receipts.some(
        (saved) =>
          saved.copy.id !== receipt?.copy.id &&
          saved.copy.registered !== false &&
          saved.copy.state !== "released" &&
          (contained(rootPath, saved.copy.rootPath) || contained(saved.copy.rootPath, rootPath)),
      )
    )
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "Loom already keeps project files at, inside or around this location. Choose a different location.",
      });
    const ownProjectIds = new Set([
      receipt?.rootLocalProjectId,
      ...(receipt?.copy.repositories.map((repository) => repository.localProjectId) ?? []),
    ]);
    if (receipt !== undefined) {
      for (const cwd of [
        rootPath,
        ...source.repositories.map((repository) =>
          path.resolve(rootPath, restoredPath(repository)),
        ),
      ])
        ownProjectIds.add(
          ProjectId.make(`library-copy:${receipt.copy.id}:${(yield* digest(cwd)).slice(0, 16)}`),
        );
    }
    if (
      (yield* projects.listShells()).some(
        (project) =>
          !ownProjectIds.has(project.id) &&
          (contained(rootPath, project.workspaceRoot) ||
            contained(project.workspaceRoot, rootPath)),
      )
    )
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "Another project on this computer uses this location, a folder inside it or one around it. Choose a different location.",
      });
    const occupied = () =>
      new LibraryError({
        reason: "blocked",
        detail: `${rootPath} is not an empty folder. Choose an empty folder or a new location.`,
      });
    const ownsPublishedRoot = Effect.gen(function* () {
      if (!(yield* fs.exists(rootPath))) return false;
      if (
        (yield* fs.stat(rootPath)).type !== "Directory" ||
        (yield* fs.realPath(rootPath)) !== rootPath
      )
        return yield* occupied();
      const identity = fileIdentity(yield* fs.stat(rootPath));
      if (
        identity.device !== null &&
        identity.inode !== null &&
        receipt?.rootIdentity?.device === identity.device &&
        receipt.rootIdentity.inode === identity.inode
      )
        return true;
      if ((yield* fs.readDirectory(rootPath)).length !== 0) return yield* occupied();
      return false;
    });
    yield* ensureRestoreSetupPending(rootPath, false);
    let published = yield* ownsPublishedRoot;
    if (receipt?.copy.state === "ready") {
      if (!published)
        return yield* new LibraryError({
          reason: "blocked",
          detail: `The restored files are no longer at ${rootPath}. Restore them again to a new location.`,
        });
      return receipt.copy;
    }
    if (
      receipt !== undefined &&
      receipt.copy.state !== "preparing" &&
      receipt.copy.state !== "failed"
    )
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "The files from this restore were removed from this computer. Restore them again to bring them back.",
      });
    if (receipt === undefined) {
      const timestamp = yield* now;
      receipt = {
        requestId: input.requestId,
        fingerprint,
        project: input.project,
        copy: {
          id: `copy:${(yield* digest(`portable\0${environmentId}\0${input.requestId}`)).slice(0, 40)}`,
          projectId: input.project.id,
          projectRevision: input.project.revision,
          environmentId,
          rootPath,
          repositories: [],
          ownership: "managed",
          keepOnComputer: true,
          state: "preparing",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        rootLocalProjectId: null,
        rootCheckpointRepository: false,
        legacyThreadIds: [],
        rootIdentity: null,
        releaseRequestId: null,
        releaseReviewToken: null,
        removalPath: null,
        archivePath: null,
        archiveDigest: null,
      };
      yield* store.put(receipt);
    }
    const copyId = receipt.copy.id;
    if (!published) {
      if (Option.isNone(recoveryPublisher))
        return yield* new LibraryError({ reason: "publisher-unavailable" });
      const retriever = recoveryPublisher.value;
      yield* fs.makeDirectory(path.dirname(rootPath), { recursive: true });
      if ((yield* fs.realPath(path.dirname(rootPath))) !== path.dirname(rootPath))
        return yield* new LibraryError({
          reason: "blocked",
          detail: `The folder that holds ${rootPath} changed during the restore. Choose the location again, then retry.`,
        });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const staging = yield* fs.makeTempDirectoryScoped({
            directory: path.dirname(rootPath),
            prefix: ".loom-restore-",
          });
          // Staged paths stop existing with the stage, published or not, so their markers go too.
          const stagedMarkers: Array<string> = [];
          yield* Effect.addFinalizer(() =>
            Effect.forEach(
              stagedMarkers,
              (cwd) =>
                SetupMarker.clear(cwd).pipe(Effect.provide(restorationServices), Effect.ignore),
              { discard: true },
            ),
          );
          const archivePath = path.join(staging, "recovery.tar.gz");
          yield* retriever.retrievePortable({ grant: input.grant, archivePath });
          if (
            (yield* fs.stat(archivePath)).size !== BigInt(recovery.byteLength) ||
            (yield* fileDigest(archivePath)) !== recovery.sha256
          )
            return yield* new LibraryError({ reason: "archive-unverified" });
          const archive = yield* inspectArchive(archivePath);
          const manifest = archive.manifest;
          if (
            manifest.project.id !== input.project.id ||
            manifest.copy.id !== source.id ||
            manifest.copy.environmentId !== source.environmentId ||
            manifest.copy.projectId !== input.project.id ||
            manifest.copy.projectRevision !== source.projectRevision
          )
            return yield* new LibraryError({ reason: "archive-unverified" });
          for (const repository of source.repositories) {
            const original = manifest.project.resources.find(
              (resource) => resource.kind !== "link" && resource.id === repository.resourceId,
            );
            const current = input.project.resources.find(
              (resource) => resource.kind !== "link" && resource.id === repository.resourceId,
            );
            if (!original || !current || current.relativePath !== original.relativePath)
              return yield* new LibraryError({ reason: "archive-unverified" });
          }
          const extracted = path.join(staging, "files");
          yield* fs.makeDirectory(extracted);
          const result = yield* runner.run({
            command: "tar",
            args: ["-xf", archivePath, "--no-same-owner", "--no-same-permissions", "-C", extracted],
            timeout: "10 minutes",
            maxOutputBytes: 1024,
          });
          if (result.code !== 0) return yield* new LibraryError({ reason: "archive-unverified" });
          const restored = path.join(extracted, archive.root);
          const safeRelative = (relative: string) =>
            relative === "." ||
            (!hasNonPortablePathCharacters(relative) &&
              !relative.startsWith("/") &&
              relative.split("/").every((part) => part && part !== "." && part !== ".."));
          const hydrated = new Set<string>();
          for (const repository of manifest.portableRepositories ?? []) {
            if (
              !safeRelative(repository.relativePath) ||
              !/^loom-portable-git\/repository-[0-9]+\/\.git$/.test(repository.gitDirectory) ||
              hydrated.has(repository.relativePath)
            )
              return yield* new LibraryError({ reason: "archive-unverified" });
            hydrated.add(repository.relativePath);
            const cwd = path.resolve(restored, repository.relativePath);
            if (!(yield* fs.exists(cwd)) || (yield* fs.realPath(cwd)) !== cwd)
              return yield* new LibraryError({ reason: "archive-unverified" });
            yield* fs.remove(path.join(cwd, ".git"), { recursive: true, force: true });
            yield* fs.copy(path.join(extracted, repository.gitDirectory), path.join(cwd, ".git"), {
              overwrite: false,
            });
          }
          const gitRoots = new Set(
            [...archive.entries.keys()]
              .filter((name) => name.startsWith(`${archive.root}/`) && name.endsWith("/.git"))
              .map((name) => path.resolve(extracted, name, "..")),
          );
          for (const cwd of gitRoots) {
            yield* validatePortableRepository(cwd);
            // Deinitialized modules retain saved objects and Git metadata even without
            // a working folder. Their configs must become independent as well.
            const pendingModules = [path.join(cwd, ".git", "modules")];
            while (pendingModules.length > 0) {
              const candidate = pendingModules.shift()!;
              if (!(yield* fs.exists(candidate))) continue;
              if ((yield* fs.stat(candidate)).type !== "Directory") continue;
              if (
                (yield* fs.exists(path.join(candidate, "config"))) &&
                (yield* fs.exists(path.join(candidate, "objects")))
              ) {
                yield* validatePortableRepository(cwd, candidate);
                pendingModules.push(path.join(candidate, "modules"));
              } else {
                for (const name of yield* fs.readDirectory(candidate))
                  pendingModules.push(path.join(candidate, name));
              }
            }
          }
          for (const repository of source.repositories) {
            const relativePath = restoredPath(repository);
            if (!safeRelative(relativePath) || !gitRoots.has(path.resolve(restored, relativePath)))
              return yield* new LibraryError({ reason: "archive-unverified" });
          }
          if (manifest.rootCheckpointRepository && !gitRoots.has(restored))
            return yield* new LibraryError({ reason: "archive-unverified" });
          for (const repository of source.repositories) {
            const relativePath = restoredPath(repository);
            if (relativePath === ".") continue;
            stagedMarkers.push(path.resolve(restored, relativePath));
            yield* ensureRestoreSetupPending(path.resolve(restored, relativePath));
          }
          receipt = {
            ...receipt!,
            rootCheckpointRepository: manifest.rootCheckpointRepository,
            rootIdentity: fileIdentity(yield* fs.stat(restored)),
            copy: { ...receipt!.copy, updatedAt: yield* now },
          };
          // Persist the staged inode before publication so a crash cannot create an unowned destination.
          yield* store.put(receipt);
          if (yield* fs.exists(rootPath)) {
            if (
              (yield* fs.realPath(rootPath)) !== rootPath ||
              (yield* fs.stat(rootPath)).type !== "Directory" ||
              (yield* fs.readDirectory(rootPath)).length !== 0
            )
              return yield* occupied();
            // Node removes a directory only when asked to recurse. This one was just found empty.
            yield* fs.remove(rootPath, { recursive: true });
          }
          yield* fs.rename(restored, rootPath);
          yield* Effect.scoped(
            fs.open(path.dirname(rootPath)).pipe(Effect.flatMap((file) => file.sync)),
          );
          published = true;
        }),
      );
    }
    const repositories: Array<LibraryWorkingCopy["repositories"][number]> = [];
    for (const original of source.repositories) {
      const resource = input.project.resources.find(
        (resource) => resource.id === original.resourceId,
      )!;
      const repositoryPath = path.resolve(rootPath, restoredPath(original));
      const inspected = yield* inspectRepository(rootPath, repositoryPath);
      if (inspected === null) return yield* new LibraryError({ reason: "archive-unverified" });
      yield* ensureRestoreSetupPending(repositoryPath);
      repositories.push({
        resourceId: resource.id,
        path: repositoryPath,
        localProjectId: yield* registerProject(
          input.requestId,
          copyId,
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
    yield* ensureRestoreSetupPending(rootPath);
    const rootLocalProjectId = yield* registerProject(
      input.requestId,
      copyId,
      rootPath,
      input.project.title,
      rootPath,
    );
    const ready = {
      ...receipt,
      rootLocalProjectId,
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
  });

  const reopenCopy = Effect.fn("LibraryWorkspace.reopenCopy")(function* (
    input: LibraryReopenCopyRequest,
    keepOnComputer = true,
  ) {
    if (!supportsExecution)
      return yield* new LibraryError({ reason: "blocked", detail: EXECUTION_DISABLED });
    let receipt = yield* store.get(input.workingCopyId);
    if (receipt.copy.environmentId !== environmentId || receipt.copy.ownership !== "managed")
      return yield* new LibraryError({ reason: "not-managed" });
    const replaced = () =>
      new LibraryError({
        reason: "blocked",
        detail: `The folder at ${receipt.copy.rootPath} is missing or is not the one Loom prepared. Put the original folder back, or move the folder that is there now, then retry.`,
      });
    if (receipt.copy.state === "ready") {
      if (
        !(yield* fs.exists(receipt.copy.rootPath)) ||
        (yield* fs.realPath(receipt.copy.rootPath)) !== receipt.copy.rootPath
      )
        return yield* replaced();
      const rootIdentity = fileIdentity(yield* fs.stat(receipt.copy.rootPath));
      if (
        rootIdentity.device === null ||
        rootIdentity.device !== receipt.rootIdentity?.device ||
        rootIdentity.inode === null ||
        rootIdentity.inode !== receipt.rootIdentity?.inode
      )
        return yield* replaced();
      yield* removeArchiveCache(receipt);
      return receipt.copy;
    }
    const resuming = receipt.copy.state === "released" && receipt.reopenRequestId !== undefined;
    if (receipt.publishedRelease === true)
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "These files were removed without an archive because every commit was on its remote. Start a new conversation in the project to download them again.",
      });
    if (receipt.copy.state !== "released")
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "These files did not finish preparing on this computer. Prepare them again from the project, then retry.",
      });
    if (
      receipt.archivePath === null ||
      receipt.archiveDigest === null ||
      receipt.copy.recovery?.sha256 !== receipt.archiveDigest
    )
      return yield* new LibraryError({ reason: "archive-unverified" });
    yield* guardPlacement(receipt.copy.rootPath, {
      copyId: receipt.copy.id,
      allowReuseOf: receipt.copy.rootPath,
      projects: "within",
    });
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
        return yield* replaced();
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
          if (yield* fs.exists(receipt.copy.rootPath)) return yield* replaced();
          yield* fs.rename(restored, receipt.copy.rootPath);
        }),
      );
    }
    const ready = {
      ...receipt,
      publishedRelease: undefined,
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

  const copyKey = (workingCopyId: string) => `copy:${workingCopyId}`;
  const fillExit = (exit: Exit.Exit<LibraryWorkingCopy, LibraryError>) =>
    Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
      ? Exit.fail(new LibraryError({ reason: "blocked", detail: FILL_CANCELLED }))
      : exit;
  /** Downloads a reserved copy, showing its progress on each conversation already bound to it. */
  const fillFiles = Effect.fn("LibraryWorkspace.fillFiles")(function* (
    workingCopyId: string,
    operationId: string | undefined,
    fiber: Fiber.Fiber<unknown, unknown>,
  ) {
    const receipt = yield* store.get(workingCopyId);
    if (receipt.copy.state === "ready") return receipt.copy;
    const reservation = LibraryWorkspaceStore.awaitingFiles(receipt)
      ? receipt.reservation
      : undefined;
    if (reservation === undefined) return yield* new LibraryError({ reason: "invalid" });
    const request: LibraryPrepareCopyRequest = {
      requestId: receipt.requestId,
      project: receipt.project,
      rootPath: receipt.copy.rootPath,
      strategy: "clone",
      resourceIds: reservation.resourceIds,
    };
    const threadIds = (yield* store.bindings)
      .filter((row) => row.resolved.binding.workingCopyId === workingCopyId)
      .map((row) => row.threadId);
    for (const threadId of threadIds) {
      yield* setupTracker.begin({
        threadId,
        branch: null,
        baseRef: null,
        stages: ["fetch", "checkout"],
        fiber,
        kind: "project-files",
        operationId,
      });
      yield* setupTracker.stageStatus(threadId, "fetch", "running");
    }
    const progress = new Map<string, { fetch: number; checkout: number }>(
      reservation.resourceIds.map((id) => [id, { fetch: 0, checkout: 0 }]),
    );
    let checkingOut = false;
    let fetched = false;
    // Every repository counts the same, so the card moves steadily across siblings downloading
    // together. Progress arrives several times a second per repository, so it runs untraced.
    const report: FillReport = Effect.fnUntraced(function* (
      resource: LibraryResource,
      update: LibraryGitFetch.LibraryCloneProgress,
    ) {
      const entry = progress.get(resource.id);
      if (entry === undefined) return;
      if (update.stage === "fetch") entry.fetch = Math.max(entry.fetch, update.percent ?? 0);
      else {
        entry.fetch = 100;
        entry.checkout = Math.max(entry.checkout, update.percent ?? 0);
      }
      const totals = [...progress.values()];
      const average = (key: "fetch" | "checkout") =>
        Math.floor(totals.reduce((sum, value) => sum + value[key], 0) / totals.length);
      const detail =
        update.detail === null || progress.size === 1
          ? update.detail
          : `${resource.title}: ${update.detail}`;
      const startCheckout = update.stage === "checkout" && !checkingOut;
      if (startCheckout) checkingOut = true;
      const finishFetch = average("fetch") === 100 && !fetched;
      if (finishFetch) fetched = true;
      for (const threadId of threadIds) {
        yield* setupTracker.stage(threadId, "fetch", {
          percent: average("fetch"),
          ...(update.stage === "fetch" ? { detail } : {}),
        });
        if (startCheckout) yield* setupTracker.stageStatus(threadId, "checkout", "running");
        if (update.stage === "checkout")
          yield* setupTracker.stage(threadId, "checkout", {
            percent: average("checkout"),
            detail,
          });
        if (finishFetch) yield* setupTracker.stageStatus(threadId, "fetch", "done");
      }
    });
    return yield* prepareCopy(request, receipt.copy.rootPath, false, report).pipe(
      Effect.tap((copy) => fillProfile(request, copy)),
      Effect.onExit((exit) =>
        Effect.forEach(
          threadIds,
          (threadId) =>
            Exit.isSuccess(exit)
              ? setupTracker.finish(threadId, "done")
              : Cause.hasInterruptsOnly(exit.cause)
                ? setupTracker.finish(threadId, "cancelled")
                : setupTracker.finish(
                    threadId,
                    "failed",
                    mapLibraryError(Cause.squash(exit.cause)).message,
                  ),
          { discard: true },
        ),
      ),
    );
  });
  // The download runs on its own, so a caller that stops waiting leaves it to finish for the rest.
  // The setup card's Cancel interrupts it, which every waiter sees as FILL_CANCELLED.
  const fillCopy = (input: {
    readonly workingCopyId: string;
    readonly operationId?: string | undefined;
  }): Effect.Effect<LibraryWorkingCopy, LibraryError> =>
    Effect.suspend(() => {
      const running = fills.get(input.workingCopyId);
      if (running !== undefined) return Deferred.await(running);
      const done = Deferred.makeUnsafe<LibraryWorkingCopy, LibraryError>();
      fills.set(input.workingCopyId, done);
      return locks
        .withLock(
          copyKey(input.workingCopyId),
          Effect.withFiber((fiber) =>
            mapIo(fillFiles(input.workingCopyId, input.operationId, fiber)),
          ),
        )
        .pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => fills.delete(input.workingCopyId)).pipe(
              Effect.andThen(Deferred.done(done, fillExit(exit))),
            ),
          ),
          Effect.forkIn(serviceScope),
          Effect.andThen(Deferred.await(done)),
        );
    });

  const prepareThreadFiles = Effect.fn("LibraryWorkspace.prepareThreadFiles")(function* (input: {
    readonly threadId: ThreadId;
    readonly waitForFiles?: boolean | undefined;
  }) {
    const resolved = yield* store.getBinding(input.threadId);
    if (resolved === null) return;
    const workingCopyId = resolved.binding.workingCopyId;
    if (LibraryWorkspaceStore.awaitingFiles(yield* store.get(workingCopyId))) {
      if (input.waitForFiles === false) {
        yield* fillCopy({ workingCopyId }).pipe(Effect.ignore, Effect.forkIn(serviceScope));
        return;
      }
      yield* fillCopy({ workingCopyId });
    }
    yield* locks.withLock(copyKey(workingCopyId), prepareBoundFiles(input.threadId, resolved));
  });

  const prepareBoundFiles = Effect.fn("LibraryWorkspace.prepareBoundFiles")(function* (
    threadId: ThreadId,
    resolved: LibraryResolvedBinding,
  ) {
    const input = { threadId };
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

  // The binding moves first, because dispatch refuses moving a bound conversation anywhere else.
  // The move dispatches a command, so it never runs under the copy's lock, which a dispatch's
  // own file check can wait on.
  const moveThread = Effect.fn("LibraryWorkspace.moveThread")(function* (input: {
    readonly threadId: ThreadId;
    readonly worktreePath: string;
    readonly move: Effect.Effect<boolean, LibraryError>;
  }) {
    const current = yield* store.getBinding(input.threadId);
    if (current === null) return yield* new LibraryError({ reason: "invalid" });
    const folder = yield* threadFolder({ binding: current.binding });
    const moved = yield* threadFolder({
      binding: current.binding,
      worktreePath: input.worktreePath,
    });
    if (current.cwd !== folder.cwd && current.cwd !== moved.cwd)
      return yield* new LibraryError({ reason: "invalid" });
    const rebind = (resolved: LibraryResolvedBinding) =>
      locks.withLock(
        copyKey(current.binding.workingCopyId),
        store.moveBinding(input.threadId, resolved),
      );
    yield* rebind(moved);
    const applied = yield* input.move.pipe(
      Effect.onError(() => rebind(folder).pipe(Effect.ignore)),
    );
    if (!applied) yield* rebind(folder);
    return applied;
  });

  /**
   * A reservation whose conversations were all deleted before its files arrived never ran
   * anything, so only its download is lost. A conversation still being created holds no binding
   * yet, so a reservation without one stays.
   */
  const abandonedReservation = Effect.fn("LibraryWorkspace.abandonedReservation")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
  ) {
    const reservation = receipt.reservation;
    if (
      reservation === undefined ||
      !LibraryWorkspaceStore.awaitingFiles(receipt) ||
      receipt.copy.environmentId !== environmentId ||
      receipt.copy.ownership !== "managed" ||
      receipt.copy.keepOnComputer !== false ||
      pendingKeeps.has(receipt.copy.id) ||
      fills.has(receipt.copy.id)
    )
      return false;
    const bound = (yield* store.bindings).filter(
      (row) => row.resolved.binding.workingCopyId === receipt.copy.id,
    );
    if (bound.length === 0) return false;
    for (const row of bound) {
      const shell = yield* projections.getThreadShell(row.threadId);
      if (shell !== null && shell.deletedAt === null) return false;
    }
    const projectIds = new Set([
      reservation.rootLocalProjectId,
      ...reservation.repositories.map((repository) => repository.localProjectId),
    ]);
    const snapshot = yield* projections.getShellSnapshot();
    return ![...snapshot.threads, ...snapshot.archivedThreads].some(
      (thread) =>
        projectIds.has(thread.projectId) ||
        (thread.worktreePath !== null && contained(receipt.copy.rootPath, thread.worktreePath)),
    );
  });
  const discardReservation = Effect.fn("LibraryWorkspace.discardReservation")(function* (
    receipt: LibraryWorkspaceStore.WorkspaceReceipt,
  ) {
    const rootPath = receipt.copy.rootPath;
    if (yield* fs.exists(rootPath)) {
      const identity = fileIdentity(yield* fs.stat(rootPath));
      if (
        (yield* fs.realPath(rootPath)) !== rootPath ||
        identity.device === null ||
        receipt.rootIdentity?.device !== identity.device ||
        receipt.rootIdentity?.inode !== identity.inode
      )
        return;
      yield* fs.remove(rootPath, { recursive: true });
    }
    yield* store.put({
      ...receipt,
      copy: { ...receipt.copy, state: "released", updatedAt: yield* now },
    });
  });

  const cleanupTemporaryCopies = Effect.fn("LibraryWorkspace.cleanupTemporaryCopies")(function* (
    isHistoryAcknowledged: (threadId: ThreadId) => Effect.Effect<boolean, LibraryError>,
  ) {
    // Candidates are chosen under the shared lock; each copy is then cleaned under its own, and a
    // copy another operation holds, such as a download, waits for a later pass.
    const candidates = yield* locks.withLock(
      "prepare",
      Effect.gen(function* () {
        const busy = new Set(yield* locks.activeKeys);
        const receipts = (yield* store.receipts).filter(
          (receipt) => !busy.has(copyKey(receipt.copy.id)) && !fills.has(receipt.copy.id),
        );
        const abandoned: Array<LibraryWorkspaceStore.WorkspaceReceipt> = [];
        for (const receipt of receipts)
          if (yield* abandonedReservation(receipt).pipe(Effect.orElseSucceed(() => false)))
            abandoned.push(receipt);
        return {
          temporary: receipts.filter((receipt) => isReclaimableCopy(receipt.copy)),
          abandoned,
        };
      }),
    );
    for (const receipt of candidates.abandoned) {
      const result = yield* Effect.result(
        locks.withLock(
          copyKey(receipt.copy.id),
          Effect.gen(function* () {
            const current = yield* store.get(receipt.copy.id);
            if (yield* abandonedReservation(current))
              yield* withWorkspaceLease(current.copy.rootPath, discardReservation(current));
          }),
        ),
      );
      if (result._tag === "Failure")
        yield* Effect.logDebug("Reserved project files were preserved.", {
          copyId: receipt.copy.id,
          reason: isLibraryError(result.failure) ? result.failure.reason : "io",
        });
    }
    for (const candidate of candidates.temporary) {
      const result = yield* Effect.result(
        locks.withLock(
          copyKey(candidate.copy.id),
          Effect.gen(function* () {
            const receipt = yield* store.get(candidate.copy.id);
            if (!(yield* canCleanUp(receipt, isHistoryAcknowledged))) return;
            const review =
              receipt.removalPath !== null && receipt.releaseReviewToken !== null
                ? { reviewToken: receipt.releaseReviewToken, blockers: [], releaseBlockers: [] }
                : yield* status({ workingCopyId: receipt.copy.id });
            if (
              review.reviewToken === null ||
              review.blockers.length > 0 ||
              review.releaseBlockers.length > 0
            )
              return;
            yield* withWorkspaceLease(
              receipt.copy.rootPath,
              release(
                {
                  requestId:
                    receipt.releaseRequestId ?? `cleanup:${receipt.copy.id}:${review.reviewToken}`,
                  workingCopyId: receipt.copy.id,
                  reviewToken: receipt.releaseReviewToken ?? review.reviewToken,
                },
                isHistoryAcknowledged,
              ),
            );
          }),
        ),
      );
      if (result._tag === "Failure")
        yield* Effect.logDebug("Temporary project files were preserved.", {
          copyId: candidate.copy.id,
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
    const receipt = yield* store.get(copy.id).pipe(Effect.option);
    const placed = Option.isSome(receipt)
      ? LibraryWorkspaceStore.placedCopy(copy, receipt.value.project)
      : copy;
    yield* publisher.value.registerCopy({
      requestId: `host-copy:${yield* digest(yield* encodeWorkingCopy(placed))}`,
      authorityId: authority.authorityId,
      authorityEpoch: authority.authorityEpoch,
      copy: placed,
    });
  }, mapIo);

  // Derived the way a launch binds a new conversation, and checked by the same resolution.
  const historyFolders = Effect.fn("LibraryWorkspace.historyFolders")(function* () {
    const folders: Array<{ resolved: LibraryResolvedBinding; project: LibraryProject }> = [];
    for (const { copy, project, rootLocalProjectId } of yield* store.receipts) {
      if (
        copy.environmentId !== environmentId ||
        copy.ownership !== "borrowed" ||
        copy.state !== "ready" ||
        copy.registered === false ||
        project.archived
      )
        continue;
      const scopes = [
        ...(rootLocalProjectId === null
          ? []
          : [{ localProjectId: rootLocalProjectId, resourceIds: [] as string[] }]),
        ...copy.repositories.map((repository) => ({
          localProjectId: repository.localProjectId,
          resourceIds: [repository.resourceId],
        })),
      ];
      for (const scope of scopes) {
        if (
          scope.localProjectId.startsWith("library-copy:") ||
          folders.some((folder) => folder.resolved.localProjectId === scope.localProjectId)
        )
          continue;
        const resolved = yield* Effect.result(
          resolveBinding({
            project,
            binding: {
              projectId: copy.projectId,
              projectRevision: copy.projectRevision,
              environmentId,
              workingCopyId: copy.id,
              resourceIds: scope.resourceIds,
            },
          }),
        );
        if (resolved._tag === "Success") folders.push({ resolved: resolved.success, project });
      }
    }
    return folders;
  }, mapIo);

  // A conversation with work cannot move into a copy, so a borrowed folder's own conversation is
  // saved where it runs. Its scope follows its project, whatever the request named.
  const saveThreadHistory = Effect.fnUntraced(function* (
    input: { readonly threadId: ThreadId; readonly binding: LibraryThreadBinding },
    threadProjectId: string,
  ) {
    const folder = (yield* historyFolders()).find(
      ({ resolved }) =>
        resolved.localProjectId === threadProjectId &&
        resolved.binding.workingCopyId === input.binding.workingCopyId &&
        resolved.binding.projectId === input.binding.projectId &&
        resolved.binding.projectRevision === input.binding.projectRevision &&
        resolved.binding.environmentId === input.binding.environmentId,
    );
    // Without a detail, "blocked" reads as a busy working copy; only starting over helps here.
    if (folder === undefined)
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "This conversation already has work, so it can no longer be linked to Library files. Start a new conversation instead.",
      });
    yield* store.saveHistory({
      project: folder.project,
      threads: [
        {
          threadId: input.threadId,
          localProjectId: folder.resolved.localProjectId,
          binding: folder.resolved.binding,
        },
      ],
    });
    const saved = yield* store.savedBinding(input.threadId);
    if (
      saved === null ||
      saved.binding.workingCopyId !== folder.resolved.binding.workingCopyId ||
      saved.binding.projectRevision !== folder.resolved.binding.projectRevision
    )
      return yield* new LibraryError({ reason: "request-conflict" });
    return folder.resolved;
  });

  // A copy refreshes the mirrors this computer already keeps for the project's repositories it
  // does not clone itself, in the background, so a later copy of them starts current.
  const refreshMirrors = (input: LibraryPrepareCopyRequest) =>
    Effect.forEach(
      input.project.resources,
      (resource) =>
        resource.kind === "link" ||
        resource.remoteUrl === null ||
        (input.strategy === "clone" &&
          (input.resourceIds === undefined || input.resourceIds.includes(resource.id)))
          ? Effect.void
          : gitFetch.warmMirror({ remoteUrl: resource.remoteUrl, create: false }),
      { discard: true },
    );
  const findPlacement = Effect.fn("LibraryWorkspace.findPlacement")(function* (input: {
    readonly project: LibraryProject;
    readonly resourceIds?: ReadonlyArray<string> | undefined;
  }) {
    if (!supportsExecution)
      return yield* new LibraryError({ reason: "blocked", detail: EXECUTION_DISABLED });
    const project = input.project;
    const repositories = project.resources.filter((resource) => resource.kind !== "link");
    const selected =
      input.resourceIds === undefined
        ? repositories
        : input.resourceIds.map((id) => repositories.find((resource) => resource.id === id));
    if (project.archived || selected.some((resource) => resource === undefined))
      return yield* new LibraryError({ reason: "invalid" });
    const all = yield* store.receipts;
    const own = all
      .filter(
        (receipt) =>
          receipt.copy.environmentId === environmentId &&
          receipt.copy.projectId === project.id &&
          receipt.copy.registered !== false,
      )
      .toSorted(
        (left, right) => Date.parse(right.copy.updatedAt) - Date.parse(left.copy.updatedAt),
      );
    // A copy whose repository sits at another path or remote cannot serve the project now.
    const covers = (receipt: LibraryWorkspaceStore.WorkspaceReceipt) =>
      selected.every(
        (resource) =>
          resource !== undefined &&
          receipt.copy.repositories.some((repository) => repository.resourceId === resource.id) &&
          keepsResource(receipt, resource),
      );
    for (const receipt of own) {
      if (
        receipt.copy.state !== "ready" ||
        !covers(receipt) ||
        !(yield* fs.exists(receipt.copy.rootPath))
      )
        continue;
      const localProjectId = receipt.copy.rootLocalProjectId ?? receipt.rootLocalProjectId;
      return {
        placement: {
          action: "use",
          rootPath: receipt.copy.rootPath,
          ownership: receipt.copy.ownership,
          copyId: receipt.copy.id,
          ...(localProjectId == null ? {} : { localProjectId }),
          reason: "This computer already has these files.",
        } satisfies LibraryPlacement,
        receipt,
      };
    }
    for (const receipt of own) {
      if (
        receipt.copy.state !== "released" ||
        receipt.copy.ownership !== "managed" ||
        !covers(receipt)
      )
        continue;
      const rootPath = receipt.copy.rootPath;
      const reopenable =
        receipt.publishedRelease !== true &&
        receipt.copy.recovery !== undefined &&
        receipt.archiveDigest !== null;
      const free = !(yield* fs.exists(rootPath));
      // A reopen that already restored the folder resumes in it.
      if (!free && !(reopenable && receipt.reopenRequestId !== undefined)) continue;
      if (
        !(yield* placementAllowed(
          rootPath,
          reopenable ? { copyId: receipt.copy.id, allowReuseOf: rootPath, projects: "within" } : {},
        ))
      )
        continue;
      return reopenable
        ? {
            placement: {
              action: "reopen",
              rootPath,
              ownership: "managed",
              copyId: receipt.copy.id,
              reason: "Loom brings back the files this project had in this folder.",
            } satisfies LibraryPlacement,
            receipt,
          }
        : {
            placement: {
              action: "clone",
              rootPath,
              ownership: "managed",
              reason: "Loom downloads the files again into the folder this project used before.",
            } satisfies LibraryPlacement,
          };
    }
    const [only] = selected;
    if (selected.length === 1 && only?.remoteUrl != null) {
      for (const checkout of yield* placements.findRepositoryCheckouts(only.remoteUrl)) {
        // Another project's folder, or files Loom made, are never borrowed.
        if (
          all.some(
            (receipt) =>
              holdsRoot(receipt, checkout.path) &&
              (receipt.copy.projectId !== project.id || receipt.copy.ownership === "managed"),
          ) ||
          !(yield* placementAllowed(checkout.path, {
            allowReuseOf: checkout.path,
            projects: "within",
          }))
        )
          continue;
        return {
          placement: {
            action: "reuse-existing",
            rootPath: checkout.path,
            ownership: "borrowed",
            ...(checkout.projectId === null ? {} : { localProjectId: checkout.projectId }),
            reason: "This computer already has a checkout of this repository.",
          } satisfies LibraryPlacement,
        };
      }
    }
    return {
      placement: {
        action: "clone",
        rootPath: yield* placements.previewFolder(project.title),
        ownership: "managed",
        reason: "Loom makes a new folder for these files in the Projects folder.",
      } satisfies LibraryPlacement,
      claim: true,
    };
  });

  type PlacedRequest = LibraryPrepareCopyRequest & { readonly rootPath: string };
  /**
   * Resolves a prepare that left the folder to this computer. A retry returns to the folder its
   * request already has. The client's strategy is only a hint; the placement decides it.
   */
  const claimProjectFolder = (title: string) =>
    placements.claimFolder(title).pipe(
      Effect.mapError(
        (cause) =>
          new LibraryError({
            reason: "blocked",
            detail: `Loom could not make a folder for these files in the Projects folder: ${cause.message}`,
            cause,
          }),
      ),
    );
  /** A folder claimed for a request that recorded nothing is the server's to take back. */
  const releaseClaim = Effect.fn("LibraryWorkspace.releaseClaim")(
    function* (requestId: string, rootPath: string) {
      const recorded = (yield* store.receipts).some(
        (receipt) =>
          receipt.requestId === requestId ||
          receipt.registrationRequests?.some((request) => request.requestId === requestId),
      );
      if (!recorded && (yield* fs.exists(rootPath)) && (yield* emptyOrMissing(rootPath)))
        yield* fs.remove(rootPath, { recursive: true });
    },
    (effect) => Effect.ignore(effect),
  );

  const placeCopy = Effect.fn("LibraryWorkspace.placeCopy")(function* (
    input: LibraryPrepareCopyRequest,
  ) {
    const earlier = (yield* store.receipts).find(
      (receipt) =>
        receipt.requestId === input.requestId ||
        receipt.registrationRequests?.some((request) => request.requestId === input.requestId),
    );
    const strategyFor = (ownership: LibraryWorkingCopy["ownership"]) =>
      ownership === "borrowed" ? ("reuse" as const) : ("clone" as const);
    if (earlier !== undefined)
      return {
        request: {
          ...input,
          rootPath: earlier.copy.rootPath,
          strategy: strategyFor(earlier.copy.ownership),
        } satisfies PlacedRequest,
        claimed: false,
      };
    const found = yield* findPlacement(input);
    const { placement } = found;
    const request: PlacedRequest = {
      ...input,
      rootPath: placement.rootPath,
      strategy: strategyFor(placement.ownership),
    };
    // Files Loom made and still has, or can bring back, are this request's copy as they are.
    if (
      found.receipt !== undefined &&
      (placement.action === "reopen" || placement.ownership === "managed")
    ) {
      const copy =
        placement.action === "reopen"
          ? yield* locks.withLock(
              copyKey(found.receipt.copy.id),
              withWorkspaceLease(
                placement.rootPath,
                reopenCopy(
                  { requestId: input.requestId, workingCopyId: found.receipt.copy.id },
                  false,
                ),
              ),
            )
          : found.receipt.copy;
      const saved = yield* store.get(copy.id);
      yield* store.put({
        ...saved,
        registrationRequests: [
          ...(saved.registrationRequests ?? []),
          {
            requestId: input.requestId,
            fingerprint: yield* preparationFingerprint(request, request.rootPath),
          },
        ],
      });
      return { copy, request };
    }
    if (placement.action !== "clone") return { request, claimed: false };
    if (found.claim !== true) {
      // The folder a released copy used, unless something took it since the preview.
      yield* fs.makeDirectory(path.dirname(placement.rootPath), { recursive: true });
      const reclaimed = yield* fs.makeDirectory(placement.rootPath).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (reclaimed) return { request, claimed: true };
    }
    const rootPath = yield* claimProjectFolder(input.project.title);
    return { request: { ...request, rootPath }, claimed: true };
  });

  // Only the overlap and takeover checks share one lock, so a download never holds up the rest.
  const reserveCopy = (input: LibraryPrepareCopyRequest) =>
    locks
      .withLock(
        "prepare",
        mapIo(
          Effect.gen(function* () {
            const placed: {
              readonly request: PlacedRequest;
              readonly claimed?: boolean;
              readonly copy?: LibraryWorkingCopy;
            } =
              input.rootPath === undefined
                ? yield* placeCopy(input)
                : { request: { ...input, rootPath: input.rootPath } };
            if (placed.copy !== undefined) return { copy: placed.copy, request: placed.request };
            const rootPath = yield* canonicalRoot(placed.request.rootPath);
            const copy = yield* withWorkspaceLease(
              rootPath,
              prepareCopy(placed.request, rootPath, true),
            ).pipe(
              Effect.onError(() =>
                placed.claimed === true ? releaseClaim(input.requestId, rootPath) : Effect.void,
              ),
            );
            return { copy, request: placed.request };
          }),
        ),
      )
      .pipe(
        Effect.tap(({ copy, request }) => fillProfile(request, copy)),
        Effect.tap(({ request }) => refreshMirrors(request)),
        Effect.map(({ copy }) => copy),
      );

  /**
   * Startup bookkeeping that changes only receipts, never files: a copy whose folder was deleted
   * is missing (and ready again once it is back), and a project's duplicate registration of one
   * borrowed folder is retired. A folder whose parent is gone may sit on an unplugged disk.
   */
  const reconcileReceipts = Effect.gen(function* () {
    const timestamp = yield* now;
    for (const receipt of yield* store.receipts) {
      const { copy } = receipt;
      if (copy.environmentId !== environmentId || copy.registered === false) continue;
      if (copy.state === "ready" && receipt.removalPath === null) {
        if (!(yield* fs.exists(copy.rootPath)) && (yield* fs.exists(path.dirname(copy.rootPath))))
          yield* store.put({
            ...receipt,
            copy: { ...copy, state: "missing", updatedAt: timestamp },
          });
      } else if (copy.state === "missing" && (yield* fs.exists(copy.rootPath))) {
        const identity = fileIdentity(yield* fs.stat(copy.rootPath));
        if (
          copy.ownership === "borrowed" ||
          (identity.device !== null &&
            identity.device === receipt.rootIdentity?.device &&
            identity.inode === receipt.rootIdentity?.inode)
        )
          yield* store.put({ ...receipt, copy: { ...copy, state: "ready", updatedAt: timestamp } });
      }
    }
    const live = (yield* store.receipts).filter(
      (receipt) =>
        receipt.copy.environmentId === environmentId &&
        receipt.copy.registered !== false &&
        receipt.copy.state !== "released",
    );
    const newer = (
      left: LibraryWorkspaceStore.WorkspaceReceipt,
      right: LibraryWorkspaceStore.WorkspaceReceipt,
    ) =>
      left.copy.ownership === "managed" ||
      Date.parse(left.copy.updatedAt) > Date.parse(right.copy.updatedAt) ||
      (left.copy.updatedAt === right.copy.updatedAt && left.copy.id > right.copy.id);
    for (const receipt of live) {
      if (
        receipt.copy.ownership === "borrowed" &&
        live.some(
          (other) =>
            other !== receipt &&
            samePath(other.copy.rootPath, receipt.copy.rootPath) &&
            other.copy.projectId === receipt.copy.projectId &&
            newer(other, receipt),
        )
      )
        yield* store.put({
          ...receipt,
          copy: { ...receipt.copy, registered: false, updatedAt: timestamp },
        });
    }
  }).pipe(Effect.withSpan("LibraryWorkspace.reconcileReceipts"));
  yield* reconcileReceipts.pipe(Effect.ignoreCause({ log: true }));

  return LibraryWorkspace.of({
    historyFolders: historyFolders(),
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
      reserveCopy(input).pipe(
        Effect.flatMap((copy) =>
          copy.state === "preparing" || copy.state === "failed"
            ? fillCopy({ workingCopyId: copy.id })
            : Effect.succeed(copy),
        ),
      ),
    reserveCopy,
    fillCopy,
    placement: Effect.fn("LibraryWorkspace.placement")(function* (input) {
      return (yield* mapIo(findPlacement(input))).placement;
    }),
    restoreCopy: (input) =>
      locks
        .withLock(
          "prepare",
          mapIo(
            Effect.gen(function* () {
              // Like a prepare, a restore without a location gets a new folder, never other files.
              const earlier =
                input.rootPath === undefined
                  ? (yield* store.receipts).find((saved) => saved.requestId === input.requestId)
                  : undefined;
              const claimed = input.rootPath === undefined && earlier === undefined;
              const rootPath = yield* canonicalRoot(
                input.rootPath ??
                  earlier?.copy.rootPath ??
                  (yield* claimProjectFolder(input.project.title)),
              );
              return yield* withWorkspaceLease(rootPath, restoreCopy(input, rootPath)).pipe(
                Effect.onError(() =>
                  claimed ? releaseClaim(input.requestId, rootPath) : Effect.void,
                ),
              );
            }),
          ),
        )
        .pipe(Effect.tap(publishCopy)),
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
        copyKey(input.workingCopyId),
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
        () => locks.withLock(copyKey(input.workingCopyId), mapIo(setCopyRetention(input))),
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
          copyKey(input.workingCopyId),
          mapIo(
            Effect.gen(function* () {
              const receipt = yield* store.get(input.workingCopyId);
              return yield* withWorkspaceLease(receipt.copy.rootPath, reopenCopy(input));
            }),
          ),
        )
        .pipe(Effect.tap(publishCopy)),
    snapshotCopy: (input) =>
      locks
        .withLock(
          copyKey(input.workingCopyId),
          mapIo(
            Effect.gen(function* () {
              const receipt = yield* store.get(input.workingCopyId);
              return yield* withWorkspaceLease(receipt.copy.rootPath, snapshotCopy(input));
            }),
          ),
        )
        .pipe(Effect.tap(publishCopy)),
    prepareThreadFiles: (input) => mapIo(prepareThreadFiles(input)),
    cleanupTemporaryCopies: (isHistoryAcknowledged) =>
      mapIo(cleanupTemporaryCopies(isHistoryAcknowledged)),
    unregister: (input) => locks.withLock(copyKey(input.workingCopyId), mapIo(unregister(input))),
    release: (input) =>
      locks.withLock(
        copyKey(input.workingCopyId),
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
        copyKey(input.binding.workingCopyId),
        mapIo(
          Effect.gen(function* () {
            const savedBinding = yield* store.getBinding(input.threadId);
            const savedCopy =
              savedBinding === null ? null : yield* store.get(savedBinding.binding.workingCopyId);
            const resolved =
              savedBinding !== null && savedCopy?.copy.registered === false
                ? { ...savedBinding, binding: input.binding }
                : yield* threadFolder({
                    ...input,
                    // Binding again, as a retry does, keeps the worktree the conversation started in.
                    worktreePath:
                      input.worktreePath ??
                      (savedBinding?.worktreeOf === undefined ? undefined : savedBinding.cwd),
                  });
            const thread = yield* projections.getThread(input.threadId);
            const localProject = yield* projects.getById(thread.projectId);
            const threadCwd = thread.worktreePath ?? Option.getOrNull(localProject)?.workspaceRoot;
            const elsewhere =
              thread.projectId !== resolved.localProjectId ||
              threadCwd === undefined ||
              !(yield* fs.exists(threadCwd)) ||
              (yield* fs.realPath(threadCwd)) !== resolved.cwd;
            const existing = yield* store.getBinding(input.threadId);
            const latestRunId = (yield* projections.getThreadShell(input.threadId))?.latestRunId;
            // A conversation that ran, or that runs elsewhere with messages (compaction can drop an
            // old one's runs), is saved where it is. A launch retry lands here when its
            // conversation was used before binding finished.
            if (
              existing === null &&
              (latestRunId != null ||
                (elsewhere && (yield* projections.getMessageCount(input.threadId)) > 0))
            )
              return yield* saveThreadHistory(input, thread.projectId);
            if (elsewhere) return yield* new LibraryError({ reason: "invalid" });
            yield* store.bind(input.threadId, resolved, input.project);
            return resolved;
          }),
        ),
      ),
    moveThread: (input) => mapIo(moveThread(input)),
  });
});

export const layer = Layer.effect(LibraryWorkspace, make);
