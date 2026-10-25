import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as HttpClient from "effect/http/HttpClient";
import {
  CommandId,
  EnvironmentId,
  type OrchestrationV2ThreadShell,
  type Project,
  ProjectId,
  ThreadId,
  RunId,
} from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryProject,
  type LibraryThreadBinding,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";
import { expect, vi } from "vite-plus/test";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { scratchArchivePaths } from "../../workspace/ScratchCheckout.ts";
import { withWorkspaceLease } from "../../workspace/workspaceLease.ts";
import { buildRepositoryIdentity } from "../../project/RepositoryIdentityResolver.ts";
import {
  markManagedProjectCheckout,
  readManagedProjectCheckout,
  archiveManagedProjectCheckout,
  releaseManagedProjectCheckout,
} from "../../workspace/ManagedProjectCheckout.ts";
import * as LibraryWorkspace from "./LibraryWorkspace.ts";
import { archiveFor } from "./Library.testkit.ts";
import * as LibraryWorkspaceStore from "./LibraryWorkspaceStore.ts";
import * as LibraryRecoveryPublisher from "./LibraryRecoveryPublisher.ts";
import * as LibraryRecoveryStore from "./assets/LibraryRecoveryStore.ts";
import { LibraryAssetMigrations } from "./assets/migrations.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import * as LibraryPublisher from "./LibraryPublisher.ts";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { parseTurnDiffFilesFromNumstat } from "../../checkpointing/Diffs.ts";

const recoveryArchiveLimit = vi.hoisted(() => ({ bytes: undefined as number | undefined }));
vi.mock("./assets/LibraryRecoveryStore.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof LibraryRecoveryStore>();
  return {
    ...actual,
    get LIBRARY_RECOVERY_MAX_BYTES() {
      return recoveryArchiveLimit.bytes ?? actual.LIBRARY_RECOVERY_MAX_BYTES;
    },
  };
});

const environmentId = EnvironmentId.make("library-workspace-test");
const decodeUnknownJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const config = ServerConfig.layerTest(process.cwd(), { prefix: "library-workspace-test-" });
const store = LibraryWorkspaceStore.layer;
const projectLayer = Layer.unwrap(
  Effect.sync(() => {
    const records = new Map<string, Project>();
    return Layer.mock(ProjectService.ProjectService)({
      bootstrap: (input) => {
        const existing = [...records.values()].find(
          (project) => project.workspaceRoot === input.workspaceRoot,
        );
        if (existing !== undefined) return Effect.succeed({ project: existing, created: false });
        const project: Project = {
          id: input.projectId,
          title: input.title,
          workspaceRoot: input.workspaceRoot,
          repositoryIdentity: null,
          faviconPath: null,
          defaultModelSelection: null,
          defaultThreadEnvMode: null,
          autoPull: false,
          projectIcon: null,
          scripts: [],
          createdAt: "2026-10-15T00:00:00Z",
          updatedAt: "2026-10-15T00:00:00Z",
          deletedAt: null,
        };
        records.set(project.id, project);
        return Effect.succeed({ project, created: true });
      },
      getById: (id) => Effect.succeed(Option.fromUndefinedOr(records.get(id))),
      getByWorkspaceRoot: (workspaceRoot) =>
        Effect.succeed(
          Option.fromUndefinedOr(
            [...records.values()].find((project) => project.workspaceRoot === workspaceRoot),
          ),
        ),
      listShells: () => Effect.succeed([]),
    });
  }),
);
const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
  getShellSnapshot: () =>
    Effect.succeed({ schemaVersion: 1, snapshotSequence: 0, threads: [], archivedThreads: [] }),
});
const cloneSources = new Map<string, string>();
const publisherFailures = new Set<string>();
const publisherEdits = new Map<string, { path: string; contents: string }>();
const recoveryArchivePath = Effect.fnUntraced(function* (sha256: string) {
  const config = yield* ServerConfig.ServerConfig;
  return (yield* Path.Path).join(config.stateDir, "project-library", "recovery", sha256);
});
const runnerLayer = Layer.effect(
  ProcessRunner.ProcessRunner,
  Effect.gen(function* () {
    const runner = yield* ProcessRunner.make();
    return ProcessRunner.ProcessRunner.of({
      run: (input) => {
        if (input.command !== "git" || input.args[0] !== "clone") return runner.run(input);
        return Effect.gen(function* () {
          const remoteIndex = input.args.indexOf("--") + 1;
          const remoteUrl = input.args[remoteIndex]!;
          const source = cloneSources.get(remoteUrl);
          if (source === undefined) return yield* Effect.die("Unexpected clone fixture");
          const args = [...input.args];
          args[remoteIndex] = source;
          const result = yield* runner.run({ ...input, args });
          if (result.code === 0)
            yield* runner.run({
              command: "git",
              args: ["remote", "set-url", "origin", remoteUrl],
              cwd: args.at(-1)!,
            });
          return result;
        });
      },
    });
  }),
);
const vcsCalls: string[] = [];
const vcsStatus = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: true,
  refName: "main",
  hasWorkingTreeChanges: true,
  workingTree: {
    files: [{ path: "a.ts", insertions: 1, deletions: 0 }],
    insertions: 1,
    deletions: 0,
  },
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};
const broadcasterLayer = Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
  refreshLocalStatus: (cwd) => Effect.sync(() => (vcsCalls.push(`local:${cwd}`), vcsStatus)),
  refreshStatus: (cwd) => Effect.sync(() => (vcsCalls.push(`fetch:${cwd}`), vcsStatus)),
});
const hostDependencies = Layer.mergeAll(
  store,
  broadcasterLayer,
  projectLayer,
  projections,
  Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
    getEnvironmentId: Effect.succeed(environmentId),
  }),
  runnerLayer,
  Layer.effect(
    LibraryRecoveryPublisher.LibraryRecoveryPublisher,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const canonicalFor = (sha256: string) =>
        path.join(config.stateDir, "project-library", "recovery", sha256);
      return LibraryRecoveryPublisher.LibraryRecoveryPublisher.of({
        configured: true,
        retrievePortable: (input) =>
          Effect.gen(function* () {
            const recovery = input.grant.sourceCopy.recovery;
            if (!recovery) return yield* new LibraryError({ reason: "archive-unverified" });
            yield* fs.copyFile(canonicalFor(recovery.sha256), input.archivePath);
          }).pipe(Effect.mapError(() => new LibraryError({ reason: "archive-unverified" }))),
        retrieve: (input) =>
          Effect.gen(function* () {
            yield* fs.copyFile(canonicalFor(input.sha256), input.archivePath);
          }).pipe(Effect.mapError(() => new LibraryError({ reason: "archive-unverified" }))),
        publish: (input) =>
          Effect.gen(function* () {
            if (publisherFailures.has(input.manifest.copyId))
              return yield* new LibraryError({ reason: "archive-unverified" });
            const canonical = canonicalFor(input.sha256);
            yield* fs.makeDirectory(path.dirname(canonical), { recursive: true });
            yield* fs.copyFile(input.archivePath, canonical);
            const edit = publisherEdits.get(input.manifest.copyId);
            if (edit !== undefined) yield* fs.writeFileString(edit.path, edit.contents);
            return {
              sourceEnvironmentId: input.manifest.environmentId,
              copyId: input.manifest.copyId,
              sha256: input.sha256,
              byteLength: Number((yield* fs.stat(input.archivePath)).size),
              archiveKey: `recovery/${input.manifest.copyId}/${input.sha256}`,
              verifiedAt: "2026-10-15T00:00:00Z",
            };
          }).pipe(Effect.mapError(() => new LibraryError({ reason: "archive-unverified" }))),
      });
    }),
  ),
  VcsProcess.layer,
  VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer)),
).pipe(Layer.provideMerge(config), Layer.provideMerge(NodeServices.layer));
const layerTest = Layer.mergeAll(LibraryWorkspace.layer, CheckpointStore.layer).pipe(
  Layer.provideMerge(hostDependencies),
  Layer.provideMerge(NodeServices.layer),
);

const makeProject = (resources: LibraryProject["resources"]): LibraryProject => ({
  id: "project:multi-repository",
  title: "Multi repository",
  brief: "Shared project context",
  revision: 1,
  resources,
  archived: false,
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: "2026-10-15T00:00:00Z",
});
const makeTemp = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "library-workspace-" }));
});
const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const result = yield* runner.run({ command: "git", args, cwd, timeout: "10 seconds" });
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.trim();
});
const initRepo = Effect.fnUntraced(function* (cwd: string, remote?: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(cwd, { recursive: true });
  yield* git(cwd, ["init", "--initial-branch=main"]);
  yield* git(cwd, ["config", "user.email", "test@example.com"]);
  yield* git(cwd, ["config", "user.name", "Test"]);
  yield* fs.writeFileString(path.join(cwd, "README.md"), "initial\n");
  yield* git(cwd, ["add", "."]);
  yield* git(cwd, ["commit", "-m", "Initial"]);
  if (remote !== undefined) yield* git(cwd, ["remote", "add", "origin", remote]);
});
const projectFor = (rootResource = false) =>
  makeProject(
    rootResource
      ? [{ id: "root", title: "Root", relativePath: ".", remoteUrl: null, defaultBranch: "main" }]
      : [
          { id: "web", title: "Web", relativePath: "web", remoteUrl: null, defaultBranch: "main" },
          {
            id: "server",
            title: "Server",
            relativePath: "server",
            remoteUrl: null,
            defaultBranch: "main",
          },
        ],
  );

/** A workspace whose Library answers folder-owner checks with `lookup`. */
const withOwnerLookup = (
  lookup: (projectId: string) => Effect.Effect<LibraryProject, LibraryError>,
) =>
  LibraryWorkspace.LibraryWorkspace.pipe(
    Effect.provide(
      Layer.fresh(LibraryWorkspace.layer).pipe(
        Layer.provide(
          Layer.mock(LibraryPublisher.LibraryPublisher)({ enabled: true, project: lookup }),
        ),
      ),
    ),
  );
const takenFolder = Effect.fnUntraced(function* (slug: string) {
  const rootPath = yield* makeTemp;
  const path = yield* Path.Path;
  yield* initRepo(path.join(rootPath, "web"));
  yield* initRepo(path.join(rootPath, "server"));
  const old = { ...projectFor(), id: `project:old-${slug}`, title: "Old app" };
  const next = {
    ...makeProject([
      { id: "web", title: "Web", relativePath: "web", remoteUrl: null, defaultBranch: "main" },
    ]),
    id: `project:new-${slug}`,
    title: "New app",
  };
  return { rootPath, old, next };
});
const reconnectDetail =
  "Loom could not check which project owns this folder. Reconnect your Library and try again.";

it.layer(layerTest)("LibraryWorkspace", (it) => {
  it.effect(
    "portable snapshots allow idle conversations, reject active and pending work, and replay immutable results",
    () =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const project = makeProject([]);
        const rootPath = path.join(parent, "idle-snapshot");
        const copy = yield* service.prepareCopy({
          requestId: "idle-snapshot-prepare",
          project,
          rootPath,
          strategy: "clone",
        });
        const archive = yield* archiveFor(project);
        const importedProjectId = ProjectId.make("imported-snapshot-project");
        const originalReceipt = yield* store.get(copy.id);
        yield* store.put({
          ...originalReceipt,
          copy: { ...originalReceipt.copy, rootLocalProjectId: importedProjectId },
          legacyThreadIds: [archive.projection.thread.id],
        });
        let state: "idle" | "active" | "pending" | "imported" | "legacy" = "idle";
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const snapshotting = yield* LibraryWorkspace.LibraryWorkspace.pipe(
          Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
          Effect.provideService(ProjectionStore.ProjectionStoreV2, {
            ...projections,
            getShellSnapshot: () =>
              Effect.succeed({
                schemaVersion: 1,
                snapshotSequence: 0,
                archivedThreads: [],
                threads: [
                  {
                    ...archive.projection.thread,
                    projectId:
                      state === "imported"
                        ? importedProjectId
                        : state === "legacy"
                          ? ProjectId.make("unrelated-legacy-project")
                          : copy.rootLocalProjectId!,
                    worktreePath: state === "imported" || state === "legacy" ? null : rootPath,
                    latestRunId: null,
                    status: "idle" as const,
                    latestVisibleMessage: null,
                    latestUserMessageAt: null,
                    hasActionableProposedPlan: false,
                    itemCount: 0,
                    visibleItemCount: 0,
                    activeRunId:
                      state === "active" || state === "imported" || state === "legacy"
                        ? RunId.make("active-snapshot-run")
                        : null,
                    pendingRuntimeRequest: state === "pending" ? ({} as never) : null,
                    settledOverride: null,
                    archivedAt: null,
                    pendingBackgroundTasks: [],
                    goal: null,
                  },
                ],
              }),
          }),
        );
        const notes = path.join(rootPath, "notes.txt");
        yield* fs.writeFileString(notes, "first snapshot\n");
        const firstReview = yield* snapshotting.status({ workingCopyId: copy.id });
        const firstRequest = {
          requestId: "immutable-snapshot-first",
          workingCopyId: copy.id,
          reviewToken: firstReview.reviewToken!,
        };
        const first = yield* snapshotting.snapshotCopy(firstRequest);
        expect(first.keepOnComputer).toBe(false);
        yield* fs.writeFileString(notes, "second snapshot\n");
        const secondReview = yield* snapshotting.status({ workingCopyId: copy.id });
        const secondRequest = {
          requestId: "immutable-snapshot-second",
          workingCopyId: copy.id,
          reviewToken: secondReview.reviewToken!,
        };
        state = "active";
        expect((yield* snapshotting.snapshotCopy(secondRequest).pipe(Effect.flip)).reason).toBe(
          "blocked",
        );
        state = "pending";
        expect((yield* snapshotting.snapshotCopy(secondRequest).pipe(Effect.flip)).reason).toBe(
          "blocked",
        );
        for (const activeState of ["imported", "legacy"] as const) {
          state = activeState;
          expect((yield* snapshotting.snapshotCopy(secondRequest).pipe(Effect.flip)).reason).toBe(
            "blocked",
          );
        }
        state = "idle";
        const second = yield* snapshotting.snapshotCopy(secondRequest);
        expect(second.recovery?.sha256).not.toBe(first.recovery?.sha256);
        expect(yield* snapshotting.snapshotCopy(firstRequest)).toEqual(first);
        const finalReview = yield* snapshotting.status({ workingCopyId: copy.id });
        publisherEdits.set(copy.id, { path: notes, contents: "changed during publication\n" });
        const failed = yield* snapshotting
          .snapshotCopy({
            requestId: "snapshot-source-changed",
            workingCopyId: copy.id,
            reviewToken: finalReview.reviewToken!,
          })
          .pipe(Effect.flip, Effect.ensuring(Effect.sync(() => publisherEdits.delete(copy.id))));
        expect(failed).toMatchObject({
          reason: "blocked",
          detail: "These files changed since they were reviewed. Review them again, then retry.",
        });
        expect((yield* store.get(copy.id)).copy.recovery).toEqual(second.recovery);
        expect(yield* fs.readFileString(notes)).toBe("changed during publication\n");
        expect((yield* store.get(copy.id)).copy.state).toBe("ready");
      }),
  );

  it.effect.each(["discussion", "multiple", "worktree", "rebase", "submodules"] as const)(
    "portable recovery restores %s to an isolated computer with fresh identities and no source access",
    (scope) =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const sourceStore = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const sourceConfig = yield* ServerConfig.ServerConfig;
        const rootPath = path.join(parent, "source-copy");
        let project: LibraryProject;
        let sourceCopy: LibraryWorkingCopy;
        if (scope === "discussion") {
          project = makeProject([]);
          sourceCopy = yield* service.prepareCopy({
            requestId: `portable-source-${scope}`,
            project,
            rootPath,
            strategy: "clone",
          });
        } else {
          project = scope === "multiple" ? projectFor() : projectFor(true);
          if (scope === "worktree") {
            const common = path.join(parent, "common");
            yield* initRepo(common);
            yield* git(common, ["worktree", "add", "-b", "feature/local", rootPath]);
          } else if (scope === "rebase" || scope === "submodules") {
            yield* initRepo(rootPath);
          } else {
            yield* initRepo(path.join(rootPath, "web"));
            yield* initRepo(path.join(rootPath, "server"));
          }
          sourceCopy = yield* service.prepareCopy({
            requestId: `portable-source-${scope}`,
            project,
            rootPath,
            strategy: "reuse",
          });
        }
        const repository = sourceCopy.repositories[0]?.path ?? rootPath;
        let moduleHead: string | undefined;
        if (scope === "submodules") {
          const moduleOrigin = path.join(parent, "module-origin");
          yield* initRepo(moduleOrigin);
          moduleHead = yield* git(moduleOrigin, ["rev-parse", "HEAD"]);
          for (const name of ["active-module", "cached-module", "removed-module"])
            yield* git(repository, [
              "-c",
              "protocol.file.allow=always",
              "submodule",
              "add",
              moduleOrigin,
              name,
            ]);
          yield* git(repository, [
            "config",
            "submodule.active-module.url",
            "https://example.com/portable-module.git",
          ]);
          yield* git(repository, ["config", "submodule.active-module.update", "checkout"]);
          yield* git(repository, ["config", "submodule.active", "active-module"]);
          yield* git(repository, [
            "config",
            "submodule.removed-module.update",
            "!source-only-command",
          ]);
          yield* git(repository, ["submodule", "deinit", "-f", "cached-module"]);
          yield* git(repository, ["rm", "--cached", "removed-module"]);
          const cachedGit = path.join(repository, ".git", "modules", "cached-module");
          yield* git(repository, [
            `--git-dir=${cachedGit}`,
            "config",
            "core.worktree",
            path.join(repository, "cached-module"),
          ]);
          yield* git(repository, [
            `--git-dir=${cachedGit}`,
            "config",
            "include.path",
            path.join(parent, "source-only-config"),
          ]);
          yield* fs.writeFileString(
            path.join(repository, "active-module", "README.md"),
            "saved submodule local work\n",
          );
          yield* git(path.join(repository, "active-module"), ["add", "README.md"]);
          yield* fs.writeFileString(
            path.join(repository, "removed-module", "README.md"),
            "saved removed submodule work\n",
          );
          yield* git(path.join(repository, "removed-module"), ["add", "README.md"]);
        }
        yield* git(repository, [
          "config",
          "--add",
          "remote.network.url",
          "https://example.com/repo.git",
        ]);
        yield* git(repository, [
          "config",
          "--add",
          "remote.network.fetch",
          "+refs/heads/*:refs/remotes/network/*",
        ]);
        yield* git(repository, [
          "config",
          "--add",
          "remote.network.fetch",
          "+refs/notes/*:refs/notes/network/*",
        ]);
        yield* git(repository, ["config", "branch.saved-local.remote", rootPath]);
        const checkpoint = "refs/t3/checkpoints/portable/turn/1";
        const head = yield* git(repository, ["rev-parse", "HEAD"]);
        yield* git(repository, ["branch", "saved-local"]);
        yield* git(repository, ["tag", "saved-tag"]);
        yield* git(repository, ["update-ref", checkpoint, head]);
        yield* git(repository, [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "--allow-empty",
          "-m",
          "Saved reflog-only work",
        ]);
        const reflogOnly = yield* git(repository, ["rev-parse", "HEAD"]);
        yield* git(repository, ["reset", "--soft", head]);
        const sourceGitDirectory = yield* git(repository, ["rev-parse", "--absolute-git-dir"]);
        yield* fs.remove(path.join(sourceGitDirectory, "ORIG_HEAD"), { force: true });
        const runner = yield* ProcessRunner.ProcessRunner;
        const unreachable = yield* runner.run({
          command: "git",
          args: ["hash-object", "-w", "--stdin"],
          cwd: repository,
          stdin: "unreachable saved local blob\n",
        });
        expect(unreachable.code).toBe(0);
        const alternate = path.join(parent, "alternate-source");
        yield* initRepo(alternate);
        const alternateBlob = yield* runner.run({
          command: "git",
          args: ["hash-object", "-w", "--stdin"],
          cwd: alternate,
          stdin: "alternate local blob\n",
        });
        expect(alternateBlob.code).toBe(0);
        const alternatePointer = path.resolve(
          repository,
          yield* git(repository, ["rev-parse", "--git-path", "objects/info/alternates"]),
        );
        yield* fs.makeDirectory(path.dirname(alternatePointer), { recursive: true });
        yield* fs.writeFileString(alternatePointer, path.join(alternate, ".git", "objects") + "\n");
        const operationFiles = new Map<string, string>();
        if (scope === "worktree" || scope === "rebase") {
          const originalBranch = yield* git(repository, ["symbolic-ref", "--short", "HEAD"]);
          yield* git(repository, ["checkout", "-b", "conflicting-work"]);
          yield* fs.writeFileString(path.join(repository, "README.md"), "their conflicting work\n");
          yield* git(repository, ["add", "README.md"]);
          yield* git(repository, ["commit", "-m", "Other local work"]);
          yield* git(repository, ["checkout", originalBranch]);
          yield* fs.writeFileString(path.join(repository, "README.md"), "our conflicting work\n");
          yield* git(repository, ["add", "README.md"]);
          yield* git(repository, ["commit", "-m", "Current local work"]);
          const conflict = yield* runner.run({
            command: "git",
            args: [scope === "worktree" ? "merge" : "rebase", "conflicting-work"],
            cwd: repository,
          });
          expect(conflict.code).toBe(1);
          const filenames =
            scope === "worktree"
              ? ["MERGE_HEAD", "MERGE_MSG", "ORIG_HEAD"]
              : [
                  "rebase-merge/orig-head",
                  "rebase-merge/head-name",
                  "rebase-merge/git-rebase-todo",
                  "rebase-merge/done",
                  "rebase-merge/onto",
                ];
          for (const filename of filenames)
            operationFiles.set(
              filename,
              yield* fs.readFileString(path.join(sourceGitDirectory, filename)),
            );
        }

        yield* fs.writeFileString(path.join(repository, "staged.txt"), "staged-only blob\n");
        yield* git(repository, ["add", "staged.txt"]);
        if (scope === "worktree" || scope === "discussion")
          yield* git(repository, ["update-index", "--split-index"]);
        yield* fs.writeFileString(path.join(repository, "staged.txt"), "newer unstaged work\n");
        yield* fs.writeFileString(path.join(rootPath, "local-only.txt"), "root local file\n");
        yield* fs.symlink("local-only.txt", path.join(rootPath, "local-link"));
        const sourceIndex = yield* git(repository, ["ls-files", "--stage"]);
        const monitor = path.join(sourceGitDirectory, "hooks", "portable-fsmonitor");
        yield* fs.makeDirectory(path.dirname(monitor), { recursive: true });
        yield* fs.writeFileString(monitor, "#!/bin/sh\nprintf called > hook-ran\nprintf '\\0'\n", {
          mode: 0o755,
        });
        yield* fs.copyFile(monitor, path.join(sourceGitDirectory, "hooks", "pre-commit"));
        yield* git(repository, ["config", "core.fsmonitor", monitor]);
        let review = yield* service.status({ workingCopyId: sourceCopy.id });
        if (scope === "worktree") {
          yield* git(repository, ["update-ref", "refs/t3/checkpoints/external-change", "HEAD"]);
          expect(
            (yield* service
              .snapshotCopy({
                requestId: "stale-external-git",
                workingCopyId: sourceCopy.id,
                reviewToken: review.reviewToken!,
              })
              .pipe(Effect.flip)).reason,
          ).toBe("blocked");
          review = yield* service.status({ workingCopyId: sourceCopy.id });
        }
        const snapshotInput = {
          requestId: `portable-snapshot-${scope}`,
          workingCopyId: sourceCopy.id,
          reviewToken: review.reviewToken!,
        };
        const saved = yield* service.snapshotCopy(snapshotInput);
        expect(saved.id).toBe(sourceCopy.id);
        expect(saved.state).toBe("ready");
        expect(saved.keepOnComputer).toBe(sourceCopy.keepOnComputer);
        expect(saved.recovery).toBeDefined();
        expect(yield* git(repository, ["-c", "core.fsmonitor=false", "ls-files", "--stage"])).toBe(
          sourceIndex,
        );
        expect(yield* fs.exists(path.join(repository, "hook-ran"))).toBe(false);
        expect((yield* service.snapshotCopy(snapshotInput)).recovery).toEqual(saved.recovery);
        expect(
          (yield* service
            .snapshotCopy({ ...snapshotInput, reviewToken: "different" })
            .pipe(Effect.flip)).reason,
        ).toBe("request-conflict");
        const authorityArchive = path.join(parent, "authority.tar.gz");
        yield* fs.copyFile(
          path.join(sourceConfig.stateDir, "project-library", "recovery", saved.recovery!.sha256),
          authorityArchive,
        );
        const sourceReceipt = yield* sourceStore.get(sourceCopy.id);
        yield* fs.remove(sourceReceipt.archivePath!, { force: true });
        yield* fs.remove(rootPath, { recursive: true });
        yield* fs.remove(alternate, { recursive: true });
        if (scope === "submodules")
          yield* fs.remove(path.join(parent, "module-origin"), { recursive: true });
        if (scope === "worktree")
          yield* fs.remove(path.join(parent, "common"), { recursive: true });
        const destinationEnvironmentId = EnvironmentId.make(`portable-target-${scope}`);
        const publisher = yield* LibraryRecoveryPublisher.LibraryRecoveryPublisher;
        let downloads = 0;
        const destinationLayer = Layer.fresh(LibraryWorkspace.layer).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              Layer.fresh(hostDependencies),
              Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
                getEnvironmentId: Effect.succeed(destinationEnvironmentId),
              }),
              Layer.succeed(LibraryRecoveryPublisher.LibraryRecoveryPublisher, {
                ...publisher,
                retrievePortable: (input) =>
                  Effect.gen(function* () {
                    downloads += 1;
                    expect(input.grant.destinationEnvironmentId).toBe(destinationEnvironmentId);
                    yield* fs.copyFile(authorityArchive, input.archivePath);
                  }).pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause }))),
              }),
            ),
          ),
        );
        const destination = yield* Effect.gen(function* () {
          return {
            service: yield* LibraryWorkspace.LibraryWorkspace,
            store: yield* LibraryWorkspaceStore.LibraryWorkspaceStore,
            config: yield* ServerConfig.ServerConfig,
            context: yield* Effect.context<Layer.Success<typeof destinationLayer>>(),
          };
        }).pipe(Effect.provide(destinationLayer));
        expect(destination.config.stateDir).not.toBe(sourceConfig.stateDir);
        const destinationRoot = path.join(parent, "destination", "renamed-copy");
        const input = {
          requestId: `portable-restore-${scope}`,
          project,
          rootPath: destinationRoot,
          grant: {
            sourceCopy: saved,
            destinationEnvironmentId,
            libraryEnvironmentId: EnvironmentId.make("portable-authority"),
            expiresAt: "2099-01-01T00:00:00Z",
            accessToken: "test-grant",
          },
        };
        if (scope === "multiple") {
          yield* fs.makeDirectory(path.dirname(destinationRoot), { recursive: true });
          const protectedFile = path.join(parent, "existing-marker-target");
          yield* fs.writeFileString(protectedFile, "saved destination data");
          const marker = `${destinationRoot}.t3-setup-pending`;
          yield* fs.symlink(protectedFile, marker);
          expect((yield* destination.service.restoreCopy(input).pipe(Effect.flip)).reason).toBe(
            "blocked",
          );
          expect(yield* fs.readFileString(protectedFile)).toBe("saved destination data");
          expect(yield* fs.exists(destinationRoot)).toBe(false);
          expect(downloads).toBe(0);
          yield* fs.remove(marker);
        }
        let restoring = destination.service;
        if (scope === "discussion") {
          let interrupt = true;
          restoring = yield* LibraryWorkspace.LibraryWorkspace.pipe(
            Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
            Effect.provideService(LibraryWorkspaceStore.LibraryWorkspaceStore, {
              ...destination.store,
              put: (receipt) => {
                if (interrupt && receipt.copy.state === "ready") {
                  interrupt = false;
                  return Effect.fail(new LibraryError({ reason: "io" }));
                }
                return destination.store.put(receipt);
              },
            }),
            Effect.provide(destination.context),
          );
          expect((yield* restoring.restoreCopy(input).pipe(Effect.flip)).reason).toBe("io");
          expect(yield* fs.exists(destinationRoot)).toBe(true);
          yield* fs.remove(authorityArchive);
        }
        const restored = yield* restoring.restoreCopy(input);
        expect(restored.id).not.toBe(sourceCopy.id);
        expect(restored.environmentId).toBe(destinationEnvironmentId);
        expect(restored.state).toBe("ready");
        expect(restored.keepOnComputer).toBe(true);
        expect(restored.recovery).toBeUndefined();
        expect(restored.rootLocalProjectId).not.toBe(sourceCopy.rootLocalProjectId);
        expect(yield* destination.store.bindings).toEqual([]);
        const targetRepository = restored.repositories[0]?.path ?? destinationRoot;
        expect(yield* fs.readFileString(path.join(destinationRoot, "local-only.txt"))).toBe(
          "root local file\n",
        );
        expect(yield* fs.readLink(path.join(destinationRoot, "local-link"))).toBe("local-only.txt");
        expect(yield* git(targetRepository, ["show", ":staged.txt"])).toBe("staged-only blob");
        expect(yield* fs.readFileString(path.join(targetRepository, "staged.txt"))).toBe(
          "newer unstaged work\n",
        );
        expect(yield* git(targetRepository, ["rev-parse", "saved-local"])).toBe(head);
        expect(yield* git(targetRepository, ["rev-parse", "saved-tag"])).toBe(head);
        expect(yield* git(targetRepository, ["rev-parse", checkpoint])).toBe(head);
        expect(yield* git(targetRepository, ["cat-file", "-t", reflogOnly])).toBe("commit");
        expect(yield* git(targetRepository, ["reflog", "--format=%H"])).toContain(reflogOnly);
        expect(yield* git(targetRepository, ["cat-file", "-p", unreachable.stdout.trim()])).toBe(
          "unreachable saved local blob",
        );
        expect(yield* git(targetRepository, ["cat-file", "-p", alternateBlob.stdout.trim()])).toBe(
          "alternate local blob",
        );
        expect(yield* git(targetRepository, ["ls-files", "--stage"])).toBe(sourceIndex);
        const targetGitDirectory = path.join(targetRepository, ".git");
        for (const [filename, content] of operationFiles)
          expect(yield* fs.readFileString(path.join(targetGitDirectory, filename))).toBe(content);
        yield* git(targetRepository, ["hook", "run", "--ignore-missing", "pre-commit"]);
        expect(yield* fs.exists(path.join(targetRepository, "hook-ran"))).toBe(false);
        expect(
          yield* fs.readFileString(path.join(targetGitDirectory, "hooks", "portable-fsmonitor")),
        ).toContain("hook-ran");
        expect(
          yield* fs.exists(path.join(targetGitDirectory, "objects", "info", "alternates")),
        ).toBe(false);
        const targetConfig = yield* fs.readFileString(path.join(targetGitDirectory, "config"));
        expect(targetConfig).not.toContain(rootPath);
        expect(targetConfig).not.toContain(alternate);
        expect(yield* git(targetRepository, ["config", "--get-all", "remote.network.fetch"])).toBe(
          "+refs/heads/*:refs/remotes/network/*\n+refs/notes/*:refs/notes/network/*",
        );
        if (scope === "submodules") {
          expect(
            yield* git(path.join(targetRepository, "active-module"), ["show", ":README.md"]),
          ).toBe("saved submodule local work");
          expect(
            yield* git(path.join(targetRepository, "removed-module"), ["show", ":README.md"]),
          ).toBe("saved removed submodule work");
          expect(yield* git(targetRepository, ["config", "submodule.active-module.url"])).toBe(
            "https://example.com/portable-module.git",
          );
          expect(yield* git(targetRepository, ["config", "submodule.active-module.active"])).toBe(
            "true",
          );
          expect(yield* git(targetRepository, ["config", "submodule.active"])).toBe(
            "active-module",
          );
          expect(
            yield* git(targetRepository, ["submodule", "status", "active-module"]),
          ).not.toMatch(/^-/);
          expect(yield* git(targetRepository, ["submodule", "status", "active-module"])).toContain(
            moduleHead,
          );
          expect(
            yield* git(targetRepository, [
              "-c",
              "protocol.file.allow=never",
              "-c",
              "protocol.https.allow=never",
              "submodule",
              "update",
              "--no-fetch",
              "active-module",
            ]),
          ).toBe("");
          expect(
            yield* git(path.join(targetRepository, "active-module"), ["show", ":README.md"]),
          ).toBe("saved submodule local work");
          expect(targetConfig).not.toContain("!source-only-command");
          const cachedGit = path.join(targetGitDirectory, "modules", "cached-module");
          expect(
            yield* git(targetRepository, [`--git-dir=${cachedGit}`, "rev-parse", "HEAD"]),
          ).toBe(moduleHead);
          const cachedConfig = yield* fs.readFileString(path.join(cachedGit, "config"));
          expect(cachedConfig).not.toContain(rootPath);
          expect(cachedConfig).not.toContain("include");
          yield* git(targetRepository, [
            `--git-dir=${cachedGit}`,
            "fsck",
            "--full",
            "--no-dangling",
          ]);
        }

        expect(yield* git(targetRepository, ["rev-parse", "--absolute-git-dir"])).toBe(
          path.join(targetRepository, ".git"),
        );
        yield* git(targetRepository, ["fsck", "--full", "--cache", "--no-dangling"]);
        for (const cwd of new Set([
          destinationRoot,
          ...restored.repositories.map((repository) => repository.path),
        ]))
          expect(yield* fs.exists(`${cwd}.t3-setup-pending`)).toBe(true);
        const binding = yield* destination.service.resolveBinding({
          binding: {
            projectId: project.id,
            projectRevision: project.revision,
            workingCopyId: restored.id,
            environmentId: destinationEnvironmentId,
            resourceIds: project.resources.map((resource) => resource.id),
          },
        });
        expect(binding.cwd).toBe(destinationRoot);
        expect((yield* destination.service.restoreCopy(input)).id).toBe(restored.id);
        expect(downloads).toBe(1);
        const occupied = path.join(parent, "occupied");
        yield* fs.makeDirectory(occupied);
        yield* fs.writeFileString(path.join(occupied, "keep.txt"), "existing destination");
        expect(
          yield* destination.service
            .restoreCopy({ ...input, requestId: `occupied-${scope}`, rootPath: occupied })
            .pipe(Effect.flip),
        ).toMatchObject({
          reason: "blocked",
          detail: `${occupied} is not an empty folder. Choose an empty folder or a new location.`,
        });
        expect(yield* fs.readFileString(path.join(occupied, "keep.txt"))).toBe(
          "existing destination",
        );
        const alias = path.join(parent, "destination-alias");
        yield* fs.symlink(destinationRoot, alias);
        expect(
          (yield* destination.service
            .restoreCopy({
              ...input,
              requestId: `alias-${scope}`,
              rootPath: path.join(alias, "nested"),
            })
            .pipe(Effect.flip)).reason,
        ).toBe("blocked");
        if (scope !== "discussion") {
          yield* fs.writeFileString(authorityArchive, "corrupt saved archive");
          const corruptDestination = path.join(parent, "corrupt-destination");
          expect(
            (yield* destination.service
              .restoreCopy({
                ...input,
                requestId: `corrupt-${scope}`,
                rootPath: corruptDestination,
              })
              .pipe(Effect.flip)).reason,
          ).toBe("archive-unverified");
          expect(yield* fs.exists(corruptDestination)).toBe(false);
        }
        expect(
          (yield* destination.service
            .restoreCopy({ ...input, rootPath: path.join(parent, "other") })
            .pipe(Effect.flip)).reason,
        ).toBe("request-conflict");
      }),
  );

  it.effect.each(["root", "component"] as const)(
    "restores released managed files for a bound %s conversation without changing history or IDs",
    (scope) =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const source = path.join(parent, "source");
        yield* initRepo(source);
        const remote = `https://example.com/acme/resume-${scope}.git`;
        cloneSources.set(remote, source);
        const project = makeProject(
          scope === "root"
            ? []
            : [
                {
                  id: "repo",
                  title: "Repo",
                  relativePath: "repo",
                  remoteUrl: remote,
                  defaultBranch: "main",
                },
              ],
        );
        const rootPath = path.join(parent, "managed");
        const copy = yield* service.prepareCopy({
          requestId: `resume-prepare-${scope}`,
          project,
          rootPath,
          strategy: "clone",
        });
        const binding: LibraryThreadBinding = {
          projectId: project.id,
          projectRevision: project.revision,
          workingCopyId: copy.id,
          environmentId,
          resourceIds: scope === "root" ? [] : ["repo"],
        };
        const resolved = yield* service.resolveBinding({ binding });
        const threadId = ThreadId.make(`managed-resume-${scope}`);
        yield* store.bind(threadId, resolved, { ...project, brief: "Pinned conversation context" });
        const beforeBindings = yield* store.bindings;
        yield* fs.writeFileString(
          path.join(resolved.cwd, "local.txt"),
          "uncommitted local content",
        );
        const ref = checkpointRefForThreadTurn(threadId, 1);
        yield* (yield* CheckpointStore.CheckpointStore).captureCheckpoint({
          cwd: resolved.cwd,
          checkpointRef: ref,
        });
        const checkpoint = yield* git(resolved.cwd, ["rev-parse", ref]);
        const review = yield* service.status({ workingCopyId: copy.id });
        yield* service.release({
          requestId: `resume-release-${scope}`,
          workingCopyId: copy.id,
          reviewToken: review.reviewToken!,
        });
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const resuming = yield* LibraryWorkspace.LibraryWorkspace.pipe(
          Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
          Effect.provideService(ProjectionStore.ProjectionStoreV2, {
            ...projections,
            getThread: () =>
              Effect.succeed({
                id: threadId,
                projectId: resolved.localProjectId,
                worktreePath: resolved.cwd,
              } as never),
          }),
        );
        const entered = yield* Deferred.make<void>();
        const unlock = yield* Deferred.make<void>();
        const held = yield* withWorkspaceLease(
          rootPath,
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(unlock))),
        ).pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(entered);
        const restores = yield* Effect.all(
          [resuming.prepareThreadFiles({ threadId }), resuming.prepareThreadFiles({ threadId })],
          { concurrency: "unbounded" },
        ).pipe(Effect.forkChild({ startImmediately: true }));
        expect(yield* fs.exists(rootPath)).toBe(false);
        yield* Deferred.succeed(unlock, undefined);
        yield* Fiber.join(held);
        yield* Fiber.join(restores);
        const ready = (yield* store.get(copy.id)).copy;
        expect(ready.id).toBe(copy.id);
        expect(ready.rootLocalProjectId).toBe(copy.rootLocalProjectId);
        expect(ready.repositories).toEqual(copy.repositories);
        expect(ready.state).toBe("ready");
        expect(ready.keepOnComputer).toBe(copy.keepOnComputer);
        expect(yield* fs.readFileString(path.join(resolved.cwd, "local.txt"))).toBe(
          "uncommitted local content",
        );
        expect(yield* git(resolved.cwd, ["rev-parse", ref])).toBe(checkpoint);
        expect(yield* store.bindings).toEqual(beforeBindings);
        expect(yield* store.getBoundProject(threadId)).toEqual({
          ...project,
          brief: "Pinned conversation context",
        });
      }),
  );

  it.effect.each(["missing", "corrupt", "foreign", "replacement", "wrong-thread"] as const)(
    "blocks automatic conversation recovery for a %s archive or destination",
    (failure) =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const project = makeProject([]);
        const rootPath = path.join(parent, "managed");
        const copy = yield* service.prepareCopy({
          requestId: `resume-guard-prepare-${failure}`,
          project,
          rootPath,
          strategy: "clone",
        });
        const binding: LibraryThreadBinding = {
          projectId: project.id,
          projectRevision: project.revision,
          workingCopyId: copy.id,
          environmentId,
          resourceIds: [],
        };
        const resolved = yield* service.resolveBinding({ binding });
        const threadId = ThreadId.make(`resume-guard-${failure}`);
        yield* store.bind(threadId, resolved, project);
        const review = yield* service.status({ workingCopyId: copy.id });
        yield* service.release({
          requestId: `resume-guard-release-${failure}`,
          workingCopyId: copy.id,
          reviewToken: review.reviewToken!,
        });
        const receipt = yield* store.get(copy.id);
        if (failure === "missing")
          yield* fs.remove(yield* recoveryArchivePath(receipt.archiveDigest!));
        if (failure === "corrupt")
          yield* fs.writeFileString(receipt.archivePath!, "corrupt archive");
        if (failure === "foreign")
          yield* store.put({
            ...receipt,
            copy: { ...receipt.copy, environmentId: EnvironmentId.make("other-computer") },
          });
        if (failure === "replacement") {
          yield* fs.makeDirectory(rootPath);
          yield* fs.writeFileString(path.join(rootPath, "local.txt"), "unrelated files");
        }
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const resuming = yield* LibraryWorkspace.LibraryWorkspace.pipe(
          Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
          Effect.provideService(ProjectionStore.ProjectionStoreV2, {
            ...projections,
            getThread: () =>
              Effect.succeed({
                id: threadId,
                projectId: resolved.localProjectId,
                worktreePath: failure === "wrong-thread" ? parent : resolved.cwd,
              } as never),
          }),
        );
        const error = yield* resuming.prepareThreadFiles({ threadId }).pipe(Effect.flip);
        expect(error.reason).toBe(
          failure === "foreign" || failure === "wrong-thread"
            ? "invalid"
            : failure === "replacement"
              ? "blocked"
              : "archive-unverified",
        );
        expect((yield* store.get(copy.id)).copy.state).toBe("released");
        if (failure === "replacement")
          expect(yield* fs.readFileString(path.join(rootPath, "local.txt"))).toBe(
            "unrelated files",
          );
        else expect(yield* fs.exists(rootPath)).toBe(false);
      }),
  );

  it.effect("refuses adopted folder reuse when its local archive is missing", () =>
    Effect.gen(function* () {
      const parent = yield* makeTemp;
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const rootPath = path.join(parent, "adopted-missing");
      yield* initRepo(rootPath);
      const projectId = ProjectId.make("adopted-missing-project");
      yield* markManagedProjectCheckout(
        rootPath,
        buildRepositoryIdentity({
          rootPath,
          remoteName: "origin",
          remoteUrl: "https://example.com/acme/project.git",
          originUrl: undefined,
        }),
        { ownershipSource: "adopted", retention: "release-on-settle", projectId },
      );
      const receipt = (yield* readManagedProjectCheckout(rootPath))!;
      const archive = yield* archiveManagedProjectCheckout(receipt, projectId);
      yield* releaseManagedProjectCheckout(receipt, projectId, archive.archive);
      yield* fs.remove(scratchArchivePaths(archive.input).archive, { recursive: true });
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const error = yield* service
        .prepareCopy({
          requestId: "adopted-missing-prepare",
          project: projectFor(true),
          rootPath,
          strategy: "reuse",
        })
        .pipe(Effect.flip);
      expect(error.reason).toBe("io");
      expect(yield* fs.exists(rootPath)).toBe(false);
      expect((yield* readManagedProjectCheckout(rootPath))?.released).toBe(true);
    }),
  );

  it.effect.each(["new", "compatible", "retry"] as const)(
    "restores an adopted lifecycle root before %s folder reuse",
    (scenario) =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const rootPath = path.join(parent, "adopted");
        yield* initRepo(rootPath);
        const project = projectFor(true);
        const request = {
          requestId: `adopted-first-${scenario}`,
          project,
          rootPath,
          strategy: "reuse" as const,
        };
        const previous = scenario === "new" ? null : yield* service.prepareCopy(request);
        const localProjectId =
          previous?.repositories[0]?.localProjectId ?? ProjectId.make("adopted-project");
        yield* markManagedProjectCheckout(
          rootPath,
          buildRepositoryIdentity({
            rootPath,
            remoteName: "origin",
            remoteUrl: "https://example.com/adopted.git",
            originUrl: undefined,
          }),
          { ownershipSource: "adopted", retention: "release-on-settle", projectId: localProjectId },
        );
        const ref = "refs/t3/retained-local-work";
        yield* git(rootPath, ["update-ref", ref, "HEAD"]);
        const head = yield* git(rootPath, ["rev-parse", "HEAD"]);
        const receipt = (yield* readManagedProjectCheckout(rootPath))!;
        const archive = yield* archiveManagedProjectCheckout(receipt, localProjectId);
        yield* releaseManagedProjectCheckout(receipt, localProjectId, archive.archive);
        expect(yield* fs.exists(rootPath)).toBe(false);
        const copy = yield* service.prepareCopy({
          ...request,
          requestId: scenario === "retry" ? request.requestId : `adopted-next-${scenario}`,
        });
        expect(copy.state).toBe("ready");
        if (previous !== null) expect(copy.id).toBe(previous.id);
        expect(yield* fs.readFileString(path.join(rootPath, "README.md"))).toBe("initial\n");
        expect(yield* git(rootPath, ["rev-parse", ref])).toBe(head);
        expect((yield* readManagedProjectCheckout(rootPath))?.released).toBe(false);
      }),
  );

  it.effect.each(["new", "compatible", "retry"] as const)(
    "makes %s plain-folder reuse checkpointable without changing existing files or its parent repository",
    (scenario) =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        yield* initRepo(parent);
        const parentHead = yield* git(parent, ["rev-parse", "HEAD"]);
        const rootPath = path.join(parent, "notes");
        yield* fs.makeDirectory(rootPath);
        yield* fs.writeFileString(path.join(rootPath, "notes.txt"), "keep these notes");
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const project = makeProject([]);
        const request = {
          requestId: `folder-first-${scenario}`,
          rootPath,
          project,
          strategy: "reuse" as const,
        };
        const previous = scenario === "new" ? null : yield* service.prepareCopy(request);
        if (previous !== null) {
          const receipt = yield* store.get(previous.id);
          yield* fs.remove(path.join(rootPath, ".git"), { recursive: true, force: true });
          yield* store.put({ ...receipt, rootCheckpointRepository: false });
        }
        const copy = yield* service.prepareCopy({
          ...request,
          requestId: scenario === "retry" ? request.requestId : `folder-next-${scenario}`,
        });
        const resolved = yield* service.resolveBinding({
          binding: {
            projectId: project.id,
            projectRevision: project.revision,
            workingCopyId: copy.id,
            environmentId,
            resourceIds: [],
          },
        });
        if (previous !== null) expect(copy.id).toBe(previous.id);
        expect(resolved.cwd).toBe(rootPath);
        expect(yield* fs.readFileString(path.join(rootPath, "notes.txt"))).toBe("keep these notes");
        expect(yield* git(rootPath, ["rev-parse", "--show-toplevel"])).toBe(rootPath);
        expect(yield* git(rootPath, ["ls-files"])).toBe("");
        expect(yield* git(parent, ["rev-parse", "HEAD"])).toBe(parentHead);
        const checkpoints = yield* CheckpointStore.CheckpointStore;
        const ref = checkpointRefForThreadTurn(ThreadId.make("plain-folder-checkpoint"), 1);
        yield* checkpoints.captureCheckpoint({ cwd: rootPath, checkpointRef: ref });
        expect(yield* git(rootPath, ["show", `${ref}:notes.txt`])).toBe("keep these notes");
      }),
  );

  it.effect("keeps a borrowed folder's valid gitdir file and existing history", () =>
    Effect.gen(function* () {
      const parent = yield* makeTemp;
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const rootPath = path.join(parent, "borrowed-gitdir");
      yield* initRepo(rootPath);
      const head = yield* git(rootPath, ["rev-parse", "HEAD"]);
      yield* git(rootPath, ["init", "--separate-git-dir", path.join(parent, "git-metadata")]);
      const gitFile = yield* fs.readFileString(path.join(rootPath, ".git"));
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const project = makeProject([]);
      const copy = yield* service.prepareCopy({
        requestId: "borrowed-gitdir-context",
        project,
        rootPath,
        strategy: "reuse",
      });
      const resolved = yield* service.resolveBinding({
        binding: {
          projectId: project.id,
          projectRevision: project.revision,
          workingCopyId: copy.id,
          environmentId,
          resourceIds: [],
        },
      });
      expect(resolved.cwd).toBe(rootPath);
      expect(yield* fs.readFileString(path.join(rootPath, ".git"))).toBe(gitFile);
      expect(yield* git(rootPath, ["rev-parse", "HEAD"])).toBe(head);
    }),
  );

  it.effect.each(["external", "dangling", "invalid"] as const)(
    "refuses initializing a plain folder with %s Git metadata",
    (kind) =>
      Effect.gen(function* () {
        const rootPath = yield* makeTemp;
        const other = yield* makeTemp;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* initRepo(other);
        const head = yield* git(other, ["rev-parse", "HEAD"]);
        if (kind === "invalid")
          yield* fs.writeFileString(path.join(rootPath, ".git"), "broken git metadata");
        else
          yield* fs.symlink(
            path.join(other, kind === "external" ? ".git" : "missing"),
            path.join(rootPath, ".git"),
          );
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const result = yield* service
          .prepareCopy({
            requestId: `unsafe-folder-${kind}`,
            project: makeProject([]),
            rootPath,
            strategy: "reuse",
          })
          .pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        expect(yield* git(other, ["rev-parse", "HEAD"])).toBe(head);
      }),
  );

  it.effect("inspects the root and direct repositories and preserves fork origin identity", () =>
    Effect.gen(function* () {
      const rootPath = yield* makeTemp;
      const path = yield* Path.Path;
      yield* initRepo(rootPath, "git@github.com:kyle/fork.git");
      yield* git(rootPath, [
        "remote",
        "add",
        "upstream",
        "https://github.com/upstream/project.git",
      ]);
      yield* initRepo(path.join(rootPath, "web"));
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const inspection = yield* service.inspectFolder({ rootPath });
      expect(inspection.repositories.map((repository) => repository.relativePath)).toEqual([
        ".",
        "web",
      ]);
      expect(inspection.repositories[0]?.remoteUrl).toBe("git@github.com:kyle/fork.git");
    }),
  );
  it.effect(
    "prepares borrowed multi-repository folders idempotently and preserves their files on release",
    () =>
      Effect.gen(function* () {
        const rootPath = yield* makeTemp;
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        yield* initRepo(path.join(rootPath, "web"));
        yield* initRepo(path.join(rootPath, "server"));
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const request = {
          requestId: "borrowed-multi",
          project: projectFor(),
          rootPath,
          strategy: "reuse" as const,
        };
        const copy = yield* service.prepareCopy(request);
        expect(copy.ownership).toBe("borrowed");
        expect(copy.repositories).toHaveLength(2);
        expect(yield* service.prepareCopy(request)).toEqual(copy);
        const repeated = yield* Effect.result(
          service.prepareCopy({ ...request, resourceIds: ["web"] }),
        );
        expect(repeated._tag).toBe("Failure");
        if (repeated._tag === "Failure") expect(repeated.failure.reason).toBe("request-conflict");
        const status = yield* service.status({ workingCopyId: copy.id });
        expect(status.reviewToken).not.toBeNull();
        yield* service.release({
          requestId: "release-borrowed",
          workingCopyId: copy.id,
          reviewToken: status.reviewToken!,
        });
        expect(yield* fs.exists(path.join(rootPath, "web", "README.md"))).toBe(true);
      }),
  );
  it.effect("reports repository health in copy status and fetches only on request", () =>
    Effect.gen(function* () {
      const rootPath = yield* makeTemp;
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      yield* initRepo(path.join(rootPath, "web"));
      yield* initRepo(path.join(rootPath, "server"));
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const copy = yield* service.prepareCopy({
        requestId: "health-status",
        project: projectFor(),
        rootPath,
        strategy: "reuse",
      });
      yield* fs.remove(path.join(rootPath, "server"), { recursive: true });
      const status = yield* service.status({ workingCopyId: copy.id });
      expect(status.health?.copyId).toBe(copy.id);
      expect(
        Object.fromEntries(
          (status.health?.repositories ?? []).map((repository) => [
            repository.resourceId,
            repository.error ?? `${repository.branch} ${repository.uncommittedFiles}`,
          ]),
        ),
      ).toEqual({ web: "main 1", server: "missing" });
      const ownCalls = () => vcsCalls.filter((call) => call.includes(rootPath));
      expect(ownCalls().some((call) => call.startsWith("fetch:"))).toBe(false);
      yield* service.health({ workingCopyId: copy.id, refreshRemote: true });
      expect(ownCalls().filter((call) => call.startsWith("fetch:"))).toEqual([
        `fetch:${path.join(rootPath, "web")}`,
      ]);
    }),
  );
  it.effect(
    "resolves whole-project and component scope while rejecting cross-host and stale bindings",
    () =>
      Effect.gen(function* () {
        const rootPath = yield* makeTemp;
        const path = yield* Path.Path;
        yield* initRepo(path.join(rootPath, "web"));
        yield* initRepo(path.join(rootPath, "server"));
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const copy = yield* service.prepareCopy({
          requestId: "binding-scope",
          project: projectFor(),
          rootPath,
          strategy: "reuse",
        });
        const binding: LibraryThreadBinding = {
          projectId: copy.projectId,
          projectRevision: copy.projectRevision,
          workingCopyId: copy.id,
          environmentId,
          resourceIds: [],
        };
        const whole = yield* service.resolveBinding({ binding });
        expect(whole.cwd).toBe(rootPath);
        expect(whole.repositoryPaths).toHaveLength(2);
        const component = yield* service.resolveBinding({
          binding: { ...binding, resourceIds: ["web"] },
        });
        expect(component.cwd).toBe(path.join(rootPath, "web"));
        const receiptStore = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const threadId = ThreadId.make("scope-bound-thread");
        yield* receiptStore.bind(threadId, whole);
        expect((yield* Effect.result(receiptStore.bind(threadId, component)))._tag).toBe("Failure");
        expect(
          (yield* Effect.result(
            service.resolveBinding({
              binding: { ...binding, environmentId: EnvironmentId.make("other-host") },
            }),
          ))._tag,
        ).toBe("Failure");
        expect(
          (yield* Effect.result(
            service.resolveBinding({ binding: { ...binding, projectRevision: 2 } }),
          ))._tag,
        ).toBe("Failure");
        expect(
          (yield* Effect.result(
            receiptStore.validateThreadCwd({
              threadId,
              localProjectId: whole.localProjectId,
              cwd: component.cwd,
            }),
          ))._tag,
        ).toBe("Failure");
      }),
  );
  it.effect("captures, diffs and restores every repository from a nongit project parent", () =>
    Effect.gen(function* () {
      const rootPath = yield* makeTemp;
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const checkpoints = yield* CheckpointStore.CheckpointStore;
      yield* initRepo(path.join(rootPath, "web"));
      yield* initRepo(path.join(rootPath, "server"));
      yield* service.prepareCopy({
        requestId: "checkpoint-multi",
        project: projectFor(),
        rootPath,
        strategy: "reuse",
      });
      const threadId = ThreadId.make("multi-checkpoint-thread");
      const baseline = checkpointRefForThreadTurn(threadId, 0);
      const completed = checkpointRefForThreadTurn(threadId, 1);
      expect(yield* checkpoints.isGitRepository(rootPath)).toBe(true);
      yield* checkpoints.captureCheckpoint({ cwd: rootPath, checkpointRef: baseline });
      yield* fs.writeFileString(path.join(rootPath, "web", "README.md"), "web edited\n");
      yield* fs.writeFileString(path.join(rootPath, "server", "README.md"), "server edited\n");
      yield* checkpoints.captureCheckpoint({ cwd: rootPath, checkpointRef: completed });
      const numstat = yield* checkpoints.diffCheckpoints({
        cwd: rootPath,
        fromCheckpointRef: baseline,
        toCheckpointRef: completed,
        ignoreWhitespace: false,
        format: "numstat",
      });
      expect(parseTurnDiffFilesFromNumstat(numstat).map((file) => file.path)).toEqual([
        "server/README.md",
        "web/README.md",
      ]);
      const patch = yield* checkpoints.diffCheckpoints({
        cwd: rootPath,
        fromCheckpointRef: baseline,
        toCheckpointRef: completed,
        ignoreWhitespace: false,
        filePaths: ["web/README.md"],
      });
      expect(patch).toContain("b/web/README.md");
      expect(patch).not.toContain("b/server/README.md");
      yield* checkpoints.restoreCheckpoint({ cwd: rootPath, checkpointRef: baseline });
      expect(yield* fs.readFileString(path.join(rootPath, "web", "README.md"))).toBe("initial\n");
      expect(yield* fs.readFileString(path.join(rootPath, "server", "README.md"))).toBe(
        "initial\n",
      );
    }),
  );
  it.effect("preflights all repository refs before restoring any files", () =>
    Effect.gen(function* () {
      const rootPath = yield* makeTemp;
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const checkpoints = yield* CheckpointStore.CheckpointStore;
      yield* initRepo(path.join(rootPath, "web"));
      yield* initRepo(path.join(rootPath, "server"));
      yield* service.prepareCopy({
        requestId: "checkpoint-preflight",
        project: projectFor(),
        rootPath,
        strategy: "reuse",
      });
      const ref = checkpointRefForThreadTurn(ThreadId.make("partial-ref-thread"), 0);
      yield* checkpoints.captureCheckpoint({ cwd: path.join(rootPath, "web"), checkpointRef: ref });
      yield* fs.writeFileString(path.join(rootPath, "web", "README.md"), "keep this work\n");
      expect(yield* checkpoints.restoreCheckpoint({ cwd: rootPath, checkpointRef: ref })).toBe(
        false,
      );
      expect(yield* fs.readFileString(path.join(rootPath, "web", "README.md"))).toBe(
        "keep this work\n",
      );
    }),
  );
  it.effect(
    "clones all project repositories and an explicitly selected subset into one parent",
    () =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const webSource = path.join(parent, "web-source");
        const serverSource = path.join(parent, "server-source");
        yield* initRepo(webSource);
        yield* initRepo(serverSource);
        cloneSources.set("https://example.test/team/web.git", webSource);
        cloneSources.set("https://example.test/team/server.git", serverSource);
        const project = makeProject(
          projectFor().resources.map((resource) => ({
            ...resource,
            remoteUrl: `https://example.test/team/${resource.id}.git`,
          })),
        );
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const copy = yield* service.prepareCopy({
          requestId: "clone-all",
          rootPath: path.join(parent, "new", "nested", "all"),
          project,
          strategy: "clone",
        });
        expect(copy.ownership).toBe("managed");
        expect(copy.repositories).toHaveLength(2);
        for (const cwd of [
          copy.rootPath,
          ...copy.repositories.map((repository) => repository.path),
        ])
          expect(yield* fs.exists(`${cwd}.t3-setup-pending`)).toBe(true);
        expect(yield* fs.exists(path.join(copy.rootPath, "web", "README.md"))).toBe(true);
        expect(yield* fs.exists(path.join(copy.rootPath, "server", "README.md"))).toBe(true);
        const subset = yield* service.prepareCopy({
          requestId: "clone-subset",
          rootPath: path.join(parent, "subset"),
          project,
          strategy: "clone",
          resourceIds: ["server"],
        });
        expect(subset.repositories.map((repository) => repository.resourceId)).toEqual(["server"]);
        expect(yield* fs.exists(path.join(subset.rootPath, "web"))).toBe(false);
        yield* fs.remove(`${copy.rootPath}.t3-setup-pending`);
        yield* fs.remove(`${copy.repositories[0]!.path}.t3-setup-pending`);
        yield* service.prepareCopy({
          requestId: "clone-all",
          rootPath: copy.rootPath,
          project,
          strategy: "clone",
        });
        expect(yield* fs.exists(`${copy.rootPath}.t3-setup-pending`)).toBe(false);
        expect(yield* fs.exists(`${copy.repositories[0]!.path}.t3-setup-pending`)).toBe(false);
      }),
  );
  it.effect("retries a partial clone without duplicating completed repositories", () =>
    Effect.gen(function* () {
      const parent = yield* makeTemp;
      const path = yield* Path.Path;
      const webSource = path.join(parent, "web-source");
      const serverSource = path.join(parent, "server-source");
      yield* initRepo(webSource);
      yield* initRepo(serverSource);
      cloneSources.set("https://example.test/retry/web.git", webSource);
      cloneSources.set(
        "https://example.test/retry/server.git",
        path.join(parent, "missing-source"),
      );
      const project = makeProject(
        projectFor().resources.map((resource) => ({
          ...resource,
          remoteUrl: `https://example.test/retry/${resource.id}.git`,
        })),
      );
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const request = {
        requestId: "clone-retry",
        rootPath: path.join(parent, "copy"),
        project,
        strategy: "clone" as const,
      };
      expect((yield* Effect.result(service.prepareCopy(request)))._tag).toBe("Failure");
      const failedCopy = yield* service.preparation({ requestId: request.requestId });
      expect(failedCopy?.state).toBe("failed");
      expect(failedCopy?.repositories).toHaveLength(1);
      const webHead = yield* git(path.join(request.rootPath, "web"), ["rev-parse", "HEAD"]);
      cloneSources.set("https://example.test/retry/server.git", serverSource);
      const copy = yield* service.prepareCopy(request);
      expect(copy.state).toBe("ready");
      expect(copy.repositories).toHaveLength(2);
      expect(yield* git(path.join(request.rootPath, "web"), ["rev-parse", "HEAD"])).toBe(webHead);
    }),
  );
  it.effect("resumes a release after the durable archive and folder rename were committed", () =>
    Effect.gen(function* () {
      const parent = yield* makeTemp;
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const crypto = yield* Crypto.Crypto;
      const runner = yield* ProcessRunner.ProcessRunner;
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const receipts = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      const rootPath = path.join(parent, "resumable");
      const copy = yield* service.prepareCopy({
        requestId: "prepare-release-retry",
        rootPath,
        project: makeProject([]),
        strategy: "clone",
      });
      const review = yield* service.status({ workingCopyId: copy.id });
      const archivePath = path.join(parent, "recovery.tar");
      const archive = yield* runner.run({
        command: "tar",
        args: ["-cf", archivePath, "-C", parent, "resumable"],
      });
      expect(archive.code).toBe(0);
      const archiveDigest = Hex.encode(
        yield* crypto.digest("SHA-256", yield* fs.readFile(archivePath)),
      );
      yield* (yield* LibraryRecoveryPublisher.LibraryRecoveryPublisher).publish({
        archivePath,
        sha256: archiveDigest,
        manifest: {
          version: 1,
          projectId: copy.projectId,
          projectRevision: copy.projectRevision,
          copyId: copy.id,
          environmentId,
          title: "Legacy recovery",
          rootBasename: "resumable",
          manifestFile: "loom-working-copy.json",
        },
      });
      const removalPath = path.join(parent, "resumable.loom-released-persisted");
      const receipt = yield* receipts.get(copy.id);
      yield* receipts.put({
        ...receipt,
        copy: {
          ...receipt.copy,
          recovery: {
            sha256: archiveDigest,
            byteLength: Number((yield* fs.stat(archivePath)).size),
            archiveKey: "recovery/retry",
            verifiedAt: "2026-10-15T00:00:00Z",
          },
        },
        releaseRequestId: "release-retry",
        releaseReviewToken: review.reviewToken,
        removalPath,
        archivePath,
        archiveDigest,
      });
      yield* fs.rename(rootPath, removalPath);
      expect(
        (yield* Effect.result(
          service.release({
            requestId: "release-retry",
            workingCopyId: copy.id,
            reviewToken: "changed-review",
          }),
        ))._tag,
      ).toBe("Failure");
      const released = yield* service.release({
        requestId: "release-retry",
        workingCopyId: copy.id,
        reviewToken: review.reviewToken!,
      });
      expect(released.state).toBe("released");
      expect(yield* fs.exists(removalPath)).toBe(false);
      expect(yield* fs.exists(archivePath)).toBe(false);
      const reopened = yield* service.reopenCopy({
        requestId: "reopen-legacy-tar",
        workingCopyId: copy.id,
      });
      expect(reopened.id).toBe(copy.id);
      expect(reopened.rootPath).toBe(rootPath);
      expect(yield* fs.exists(path.join(rootPath, ".git"))).toBe(true);
      expect(yield* fs.exists(archivePath)).toBe(false);
    }),
  );
  it.effect("pins old project context while new threads reuse the copy with updated metadata", () =>
    Effect.gen(function* () {
      const rootPath = yield* makeTemp;
      yield* initRepo(rootPath);
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const receipts = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      const originalProject = projectFor(true);
      const copy = yield* service.prepareCopy({
        requestId: "context-revision",
        project: originalProject,
        rootPath,
        strategy: "reuse",
      });
      const binding: LibraryThreadBinding = {
        projectId: copy.projectId,
        projectRevision: 1,
        workingCopyId: copy.id,
        environmentId,
        resourceIds: [],
      };
      const original = yield* service.resolveBinding({ binding });
      const oldThread = ThreadId.make("old-context-thread");
      yield* receipts.bind(oldThread, original, originalProject);
      const updatedProject = {
        ...originalProject,
        revision: 2,
        title: "Updated title",
        brief: "Updated project direction",
        resources: [
          ...originalProject.resources,
          {
            id: "reference",
            title: "Reference",
            kind: "link" as const,
            url: "https://example.test/design",
            remoteUrl: null,
            relativePath: "",
            defaultBranch: null,
          },
        ],
      };
      const updated = yield* service.resolveBinding({
        binding: { ...binding, projectRevision: 2 },
        project: updatedProject,
      });
      const newThread = ThreadId.make("new-context-thread");
      yield* receipts.bind(newThread, updated, updatedProject);
      expect((yield* receipts.getBoundProject(oldThread))?.brief).toBe(originalProject.brief);
      expect((yield* receipts.getBoundProject(newThread))?.brief).toBe("Updated project direction");
      expect(updated.binding.workingCopyId).toBe(copy.id);
      expect((yield* receipts.get(copy.id)).copy.projectRevision).toBe(1);
      expect((yield* Effect.result(receipts.bind(oldThread, updated, updatedProject)))._tag).toBe(
        "Failure",
      );
      const moved = {
        ...updatedProject,
        revision: 3,
        resources: [
          {
            ...originalProject.resources[0]!,
            remoteUrl: "https://example.test/different/repo.git",
          },
        ],
      };
      expect(
        (yield* Effect.result(
          service.resolveBinding({ binding: { ...binding, projectRevision: 3 }, project: moved }),
        ))._tag,
      ).toBe("Failure");
    }),
  );
  it.effect(
    "lets only proven migrated worktrees reach recovery when their checkout is missing",
    () =>
      Effect.gen(function* () {
        const rootPath = yield* makeTemp;
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        yield* initRepo(rootPath);
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const copy = yield* service.prepareCopy({
          requestId: "legacy-worktree-recovery",
          project: projectFor(true),
          rootPath,
          strategy: "reuse",
        });
        const resolved = yield* service.resolveBinding({
          binding: {
            projectId: copy.projectId,
            projectRevision: copy.projectRevision,
            workingCopyId: copy.id,
            environmentId,
            resourceIds: ["root"],
          },
        });
        const cwd = path.join(rootPath, "missing-parent", "old-worktree");
        const threadId = ThreadId.make("legacy-missing-worktree");
        const receipt = yield* store.get(copy.id);
        yield* store.put({ ...receipt, legacyThreadIds: [threadId] });
        yield* store.bind(threadId, {
          ...resolved,
          cwd,
          repositoryPaths: [cwd],
          legacyWorktreeRoot: rootPath,
        });
        expect(
          yield* store.validateThreadCwd({
            threadId,
            localProjectId: resolved.localProjectId,
            cwd,
          }),
        ).toBe(cwd);
        expect(yield* fs.exists(cwd)).toBe(false);
        expect(
          (yield* Effect.result(
            store.validateThreadCwd({
              threadId,
              localProjectId: resolved.localProjectId,
              cwd: rootPath,
            }),
          ))._tag,
        ).toBe("Failure");
        const ordinary = ThreadId.make("ordinary-missing-copy");
        yield* store.bind(ordinary, { ...resolved, cwd, repositoryPaths: [cwd] });
        expect(
          (yield* Effect.result(
            store.validateThreadCwd({
              threadId: ordinary,
              localProjectId: resolved.localProjectId,
              cwd,
            }),
          ))._tag,
        ).toBe("Failure");
        const redirected = path.join(rootPath, "missing-parent");
        const other = yield* makeTemp;
        yield* fs.symlink(other, redirected);
        expect(
          (yield* Effect.result(
            store.validateThreadCwd({ threadId, localProjectId: resolved.localProjectId, cwd }),
          ))._tag,
        ).toBe("Failure");
      }),
  );
  it.effect.each([true, false])(
    "keeps native projects usable for new root and worktree threads after borrowing, root resource=%s",
    (rootResource) =>
      Effect.gen(function* () {
        const rootPath = yield* makeTemp;
        const worktreePath = yield* makeTemp;
        const path = yield* Path.Path;
        const nativeCwd = rootResource ? rootPath : path.join(rootPath, "web");
        yield* initRepo(nativeCwd);
        if (!rootResource) yield* initRepo(path.join(rootPath, "server"));
        const projects = yield* ProjectService.ProjectService;
        const nativeProject = (yield* projects.bootstrap({
          commandId: CommandId.make(`native-project:${rootPath}`),
          projectId: ProjectId.make(`native-project:${rootPath}`),
          title: "Existing native project",
          workspaceRoot: nativeCwd,
        })).project;
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const receipts = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const copy = yield* service.prepareCopy({
          requestId: `borrow-native:${rootPath}`,
          project: projectFor(rootResource),
          rootPath,
          strategy: "reuse",
        });
        const receipt = yield* receipts.get(copy.id);
        expect([
          receipt.rootLocalProjectId,
          ...copy.repositories.map((repository) => repository.localProjectId),
        ]).toContain(nativeProject.id);
        for (const cwd of [nativeCwd, worktreePath]) {
          const threadId = ThreadId.make(`new-native-thread:${cwd}`);
          expect(receipt.legacyThreadIds).not.toContain(threadId);
          expect(yield* receipts.getBinding(threadId)).toBeNull();
          expect(
            yield* receipts.validateThreadCwd({
              threadId,
              localProjectId: nativeProject.id,
              cwd,
            }),
          ).toBe(cwd);
        }
      }),
  );
  it.effect("blocks an orphan conversation before its first provider launch", () =>
    Effect.gen(function* () {
      const rootPath = yield* makeTemp;
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const receipts = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      yield* initRepo(rootPath);
      const copy = yield* service.prepareCopy({
        requestId: "orphan-gate",
        project: projectFor(true),
        rootPath,
        strategy: "reuse",
      });
      const resolved = yield* service.resolveBinding({
        binding: {
          projectId: copy.projectId,
          projectRevision: copy.projectRevision,
          workingCopyId: copy.id,
          environmentId,
          resourceIds: [],
        },
      });
      const threadId = ThreadId.make("orphan-created-thread");
      const rejected = yield* receipts
        .validateThreadCwd({
          threadId,
          localProjectId: resolved.localProjectId,
          cwd: rootPath,
        })
        .pipe(Effect.flip);
      expect(rejected.message).toBe(
        "This conversation is not linked to its Library files, so it cannot run in this folder. Start a new conversation from the Library project instead.",
      );
      yield* receipts.bind(threadId, resolved);
      expect(
        yield* receipts.validateThreadCwd({
          threadId,
          localProjectId: resolved.localProjectId,
          cwd: rootPath,
        }),
      ).toBe(rootPath);
    }),
  );
  it.effect(
    "makes a repository-free project checkpointable and archives its Git recovery refs before release",
    () =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const rootPath = path.join(parent, "discussion");
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const checkpoints = yield* CheckpointStore.CheckpointStore;
        const receipts = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const copy = yield* service.prepareCopy({
          requestId: "standalone-project",
          project: makeProject([]),
          rootPath,
          strategy: "clone",
        });
        expect(copy.repositories).toEqual([]);
        expect(yield* checkpoints.isGitRepository(rootPath)).toBe(true);
        const ref = checkpointRefForThreadTurn(ThreadId.make("discussion-checkpoint"), 0);
        yield* checkpoints.captureCheckpoint({ cwd: rootPath, checkpointRef: ref });
        const checkpointCommit = yield* git(rootPath, ["rev-parse", ref]);
        const reviewed = yield* service.status({ workingCopyId: copy.id });
        expect(reviewed.blockers).toEqual([]);
        const released = yield* service.release({
          requestId: "release-standalone",
          workingCopyId: copy.id,
          reviewToken: reviewed.reviewToken!,
        });
        expect(released.state).toBe("released");
        expect(yield* fs.exists(rootPath)).toBe(false);
        const receipt = yield* receipts.get(copy.id);
        expect(receipt.archiveDigest).toMatch(/^[0-9a-f]{64}$/);
        const restorePath = path.join(parent, "restore");
        yield* fs.makeDirectory(restorePath);
        const runner = yield* ProcessRunner.ProcessRunner;
        const extraction = yield* runner.run({
          command: "tar",
          args: ["-xf", yield* recoveryArchivePath(receipt.archiveDigest!), "-C", restorePath],
        });
        expect(extraction.code).toBe(0);
        expect(yield* git(path.join(restorePath, "discussion"), ["rev-parse", ref])).toBe(
          checkpointCommit,
        );
        const manifest = yield* decodeUnknownJson(
          yield* fs.readFileString(path.join(restorePath, "loom-working-copy.json")),
        );
        expect(manifest).toMatchObject({
          version: 1,
          project: makeProject([]),
          copy: { id: copy.id },
          rootCheckpointRepository: true,
        });
        expect(
          yield* service.release({
            requestId: "release-standalone",
            workingCopyId: copy.id,
            reviewToken: reviewed.reviewToken!,
          }),
        ).toEqual(released);
      }),
  );
  it.effect("refuses a stale release review after working files change", () =>
    Effect.gen(function* () {
      const parent = yield* makeTemp;
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const rootPath = path.join(parent, "new-project");
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const copy = yield* service.prepareCopy({
        requestId: "stale-review",
        project: makeProject([]),
        rootPath,
        strategy: "clone",
      });
      const review = yield* service.status({ workingCopyId: copy.id });
      yield* fs.writeFileString(path.join(rootPath, "notes.md"), "work to preserve");
      const released = yield* service
        .release({
          requestId: "release-stale",
          workingCopyId: copy.id,
          reviewToken: review.reviewToken!,
        })
        .pipe(Effect.flip);
      expect(released).toMatchObject({
        reason: "blocked",
        detail: "These files changed since they were reviewed. Review them again, then retry.",
      });
      expect(yield* fs.readFileString(path.join(rootPath, "notes.md"))).toBe("work to preserve");
    }),
  );
  it.effect("names why new files cannot be prepared", () =>
    Effect.gen(function* () {
      const rootPath = yield* makeTemp;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.writeFileString(path.join(rootPath, "keep.txt"), "existing");
      const request = {
        requestId: "clone-over-existing",
        project: makeProject([]),
        rootPath,
        strategy: "clone" as const,
      };
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      expect((yield* service.prepareCopy(request).pipe(Effect.flip)).message).toBe(
        "A folder already exists at this location. Choose an empty location for new files, or add the existing folder instead.",
      );
      const hostOnly = yield* LibraryWorkspace.LibraryWorkspace.pipe(
        Effect.provide(
          Layer.fresh(LibraryWorkspace.layer).pipe(
            Layer.provide(
              ConfigProvider.layer(ConfigProvider.fromUnknown({ LOOM_EXECUTION_ENABLED: "false" })),
            ),
          ),
        ),
      );
      expect(
        (yield* hostOnly
          .prepareCopy({ ...request, requestId: "host-only", rootPath: path.join(rootPath, "new") })
          .pipe(Effect.flip)).message,
      ).toBe(
        "This computer hosts your Library but does not run work. Choose another computer for these files.",
      );
      expect(yield* fs.readFileString(path.join(rootPath, "keep.txt"))).toBe("existing");
      expect(yield* fs.exists(path.join(rootPath, "new"))).toBe(false);
    }),
  );
  it.effect("rejects resources escaping the parent without mutating the folder", () =>
    Effect.gen(function* () {
      const rootPath = yield* makeTemp;
      const fs = yield* FileSystem.FileSystem;
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const project = makeProject([
        {
          id: "unsafe",
          title: "Unsafe",
          relativePath: "../outside",
          remoteUrl: null,
          defaultBranch: null,
        },
      ]);
      const result = yield* Effect.result(
        service.prepareCopy({ requestId: "unsafe-resource", rootPath, project, strategy: "reuse" }),
      );
      expect(result._tag).toBe("Failure");
      expect(yield* fs.readDirectory(rootPath)).toEqual([]);
    }),
  );
  it.effect("leaves a managed working copy intact when remote recovery verification fails", () =>
    Effect.gen(function* () {
      const parent = yield* makeTemp;
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      const rootPath = path.join(parent, "failed-recovery");
      const copy = yield* service.prepareCopy({
        requestId: "failed-recovery-prepare",
        project: makeProject([]),
        rootPath,
        strategy: "clone",
      });
      const notes = path.join(rootPath, "notes.txt");
      yield* fs.writeFileString(notes, "dirty work to preserve\n");
      const review = yield* service.status({ workingCopyId: copy.id });
      const config = yield* ServerConfig.ServerConfig;
      const archiveDirectory = path.join(config.stateDir, "project-library", "archives");
      yield* fs.makeDirectory(archiveDirectory, { recursive: true });
      const unrelatedArchive = path.join(archiveDirectory, "unrelated.tar.gz");
      yield* fs.writeFileString(unrelatedArchive, "another recovery archive");
      const previousArchives = yield* fs.readDirectory(archiveDirectory);
      publisherFailures.add(copy.id);
      const failure = yield* service
        .release({
          requestId: "failed-recovery-release",
          workingCopyId: copy.id,
          reviewToken: review.reviewToken!,
        })
        .pipe(Effect.flip);
      publisherFailures.delete(copy.id);
      expect(failure.reason).toBe("archive-unverified");
      expect(yield* fs.exists(path.join(rootPath, ".git"))).toBe(true);
      expect(yield* fs.readFileString(notes)).toBe("dirty work to preserve\n");
      const receipt = yield* store.get(copy.id);
      expect(receipt.copy.state).toBe("ready");
      expect(receipt.removalPath).toBeNull();
      expect(receipt.copy.recovery).toBeUndefined();
      expect((yield* fs.readDirectory(archiveDirectory)).toSorted()).toEqual(
        previousArchives.toSorted(),
      );
      expect(yield* fs.readFileString(unrelatedArchive)).toBe("another recovery archive");
      expect(
        (yield* service.release({
          requestId: "failed-recovery-release",
          workingCopyId: copy.id,
          reviewToken: review.reviewToken!,
        })).state,
      ).toBe("released");
      yield* service.reopenCopy({ requestId: "failed-recovery-reopen", workingCopyId: copy.id });
      expect(yield* fs.readFileString(notes)).toBe("dirty work to preserve\n");
    }),
  );
  it.effect("bounds staging archive writes before an oversized recovery is published", () =>
    Effect.gen(function* () {
      const parent = yield* makeTemp;
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      const rootPath = path.join(parent, "oversized-recovery");
      const copy = yield* service.prepareCopy({
        requestId: "oversized-recovery-prepare",
        project: makeProject([]),
        rootPath,
        strategy: "clone",
      });
      const bytes = yield* (yield* Crypto.Crypto).randomBytes(64 * 1024);
      const ignoredPath = path.join(rootPath, "local-only.bin");
      yield* fs.writeFileString(path.join(rootPath, ".gitignore"), "local-only.bin\n");
      yield* fs.writeFile(ignoredPath, bytes);
      const review = yield* service.status({ workingCopyId: copy.id });
      const config = yield* ServerConfig.ServerConfig;
      const archiveDirectory = path.join(config.stateDir, "project-library", "archives");
      const previousArchives = (yield* fs.exists(archiveDirectory))
        ? yield* fs.readDirectory(archiveDirectory)
        : [];
      const removedSizes: bigint[] = [];
      const limited = yield* LibraryWorkspace.LibraryWorkspace.pipe(
        Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          remove: (filePath, options) =>
            Effect.gen(function* () {
              if (
                path.dirname(filePath) === archiveDirectory &&
                (yield* fs.stat(filePath)).type === "File"
              ) {
                removedSizes.push((yield* fs.stat(filePath)).size);
              }
              yield* fs.remove(filePath, options);
            }),
        }),
      );
      recoveryArchiveLimit.bytes = 1024;
      const failure = yield* limited
        .release({
          requestId: "oversized-recovery-release",
          workingCopyId: copy.id,
          reviewToken: review.reviewToken!,
        })
        .pipe(
          Effect.flip,
          Effect.ensuring(
            Effect.sync(() => {
              recoveryArchiveLimit.bytes = undefined;
            }),
          ),
        );
      expect(failure.reason).toBe("archive-too-large");
      expect(removedSizes).toHaveLength(1);
      expect(removedSizes[0]).toBeLessThanOrEqual(1024n);
      expect((yield* fs.readDirectory(archiveDirectory)).toSorted()).toEqual(
        previousArchives.toSorted(),
      );
      expect(yield* fs.readFile(ignoredPath)).toEqual(bytes);
      expect(yield* fs.exists(path.join(rootPath, ".git"))).toBe(true);
      const receipt = yield* store.get(copy.id);
      expect(receipt.copy.state).toBe("ready");
      expect(receipt.copy.recovery).toBeUndefined();
      expect(receipt.removalPath).toBeNull();
    }),
  );
  it.effect("imports receipts and pinned bindings atomically and preserves existing metadata", () =>
    Effect.gen(function* () {
      const rootPath = yield* makeTemp;
      yield* initRepo(rootPath);
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      const project = projectFor(true);
      const copy = yield* service.prepareCopy({
        requestId: "import-atomic-prepare",
        project,
        rootPath,
        strategy: "reuse",
      });
      const resolved = yield* service.resolveBinding({
        binding: {
          projectId: copy.projectId,
          projectRevision: copy.projectRevision,
          workingCopyId: copy.id,
          environmentId,
          resourceIds: [],
        },
      });
      const receipt = yield* store.get(copy.id);
      const existingThread = ThreadId.make("import-existing-thread");
      yield* store.bind(existingThread, resolved, project);
      const staged = { ...receipt, copy: { ...receipt.copy, id: "import-staged-copy" } };
      expect(
        (yield* store
          .importBindings({
            receipts: [
              staged,
              { ...receipt, copy: { ...receipt.copy, rootPath: `${rootPath}/changed` } },
            ],
            bindings: [],
          })
          .pipe(Effect.flip)).reason,
      ).toBe("blocked");
      expect((yield* store.get(staged.copy.id).pipe(Effect.flip)).reason).toBe("not-found");
      const newThread = ThreadId.make("import-staged-thread");
      expect(
        (yield* store
          .importBindings({
            receipts: [staged],
            bindings: [
              { threadId: newThread, resolved, project },
              {
                threadId: existingThread,
                resolved: { ...resolved, cwd: `${rootPath}/changed` },
                project,
              },
            ],
          })
          .pipe(Effect.flip)).reason,
      ).toBe("blocked");
      expect(yield* store.getBinding(newThread)).toBeNull();
      expect((yield* store.get(staged.copy.id).pipe(Effect.flip)).reason).toBe("not-found");
      const legacy = ThreadId.make("legacy-import-thread");
      yield* store.importBindings({
        receipts: [
          { ...receipt, fingerprint: "ignored-incoming-metadata", legacyThreadIds: [legacy] },
        ],
        bindings: [
          { threadId: existingThread, resolved, project },
          { threadId: newThread, resolved, project },
        ],
      });
      yield* store.importBindings({
        receipts: [receipt],
        bindings: [{ threadId: newThread, resolved, project }],
      });
      expect((yield* store.get(copy.id)).fingerprint).toBe(receipt.fingerprint);
      expect((yield* store.get(copy.id)).legacyThreadIds).toContain(legacy);
      expect(yield* store.getBoundProject(newThread)).toEqual(project);
    }),
  );
  it.effect(
    "reuses a compatible superset copy while checkpoints honor each thread's pinned resource scope",
    () =>
      Effect.gen(function* () {
        const rootPath = yield* makeTemp;
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        yield* initRepo(path.join(rootPath, "web"));
        yield* initRepo(path.join(rootPath, "server"));
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const checkpoints = yield* CheckpointStore.CheckpointStore;
        const original = projectFor();
        const copy = yield* service.prepareCopy({
          requestId: "scope-revision-prepare",
          project: original,
          rootPath,
          strategy: "reuse",
        });
        const binding = {
          projectId: copy.projectId,
          projectRevision: 1,
          workingCopyId: copy.id,
          environmentId,
          resourceIds: [],
        };
        const oldThread = ThreadId.make("scope-revision-old");
        yield* store.bind(oldThread, yield* service.resolveBinding({ binding }), original);
        const updated = {
          ...original,
          revision: 2,
          resources: original.resources.filter((resource) => resource.id === "web"),
        };
        const current = yield* service.resolveBinding({
          binding: { ...binding, projectRevision: 2 },
          project: updated,
        });
        expect(current.repositoryPaths).toEqual([path.join(rootPath, "web")]);
        const newThread = ThreadId.make("scope-revision-new");
        yield* store.bind(newThread, current, updated);
        const oldRef = checkpointRefForThreadTurn(oldThread, 0);
        const baseline = checkpointRefForThreadTurn(newThread, 0);
        const latest = checkpointRefForThreadTurn(newThread, 1);
        yield* checkpoints.captureCheckpoint({ cwd: rootPath, checkpointRef: oldRef });
        yield* checkpoints.captureCheckpoint({ cwd: rootPath, checkpointRef: baseline });
        expect(yield* git(path.join(rootPath, "server"), ["rev-parse", oldRef])).not.toBe("");
        const runner = yield* ProcessRunner.ProcessRunner;
        expect(
          (yield* runner.run({
            command: "git",
            args: ["show-ref", "--verify", baseline],
            cwd: path.join(rootPath, "server"),
          })).code,
        ).not.toBe(0);
        yield* fs.writeFileString(path.join(rootPath, "web", "README.md"), "new web work\n");
        yield* fs.writeFileString(
          path.join(rootPath, "server", "README.md"),
          "independent server work\n",
        );
        yield* checkpoints.captureCheckpoint({ cwd: rootPath, checkpointRef: latest });
        expect(
          parseTurnDiffFilesFromNumstat(
            yield* checkpoints.diffCheckpoints({
              cwd: rootPath,
              fromCheckpointRef: baseline,
              toCheckpointRef: latest,
              ignoreWhitespace: false,
              format: "numstat",
            }),
          ).map((file) => file.path),
        ).toEqual(["web/README.md"]);
        expect(
          yield* checkpoints.restoreCheckpoint({ cwd: rootPath, checkpointRef: baseline }),
        ).toBe(true);
        expect(yield* fs.readFileString(path.join(rootPath, "web", "README.md"))).toBe("initial\n");
        expect(yield* fs.readFileString(path.join(rootPath, "server", "README.md"))).toBe(
          "independent server work\n",
        );
      }),
  );
  it.effect(
    "requires a fresh discussion copy when a nongit parent loses all repository resources",
    () =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const rootPath = path.join(parent, "existing");
        yield* initRepo(path.join(rootPath, "web"));
        yield* initRepo(path.join(rootPath, "server"));
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const project = projectFor();
        const copy = yield* service.prepareCopy({
          requestId: "empty-context-existing",
          project,
          rootPath,
          strategy: "reuse",
        });
        const updated = { ...project, revision: 2, resources: [] };
        expect(
          (yield* service
            .resolveBinding({
              binding: {
                projectId: copy.projectId,
                projectRevision: 2,
                workingCopyId: copy.id,
                environmentId,
                resourceIds: [],
              },
              project: updated,
            })
            .pipe(Effect.flip)).reason,
        ).toBe("context-copy-required");
        expect(yield* fs.exists(path.join(rootPath, ".git"))).toBe(false);
        const discussion = yield* service.prepareCopy({
          requestId: "empty-context-fresh",
          project: updated,
          rootPath: path.join(parent, "discussion"),
          strategy: "clone",
        });
        const resolved = yield* service.resolveBinding({
          binding: {
            projectId: discussion.projectId,
            projectRevision: 2,
            workingCopyId: discussion.id,
            environmentId,
            resourceIds: [],
          },
          project: updated,
        });
        expect(resolved.cwd).toBe(discussion.rootPath);
        expect(resolved.repositoryPaths).toEqual([]);
        expect(yield* fs.exists(path.join(discussion.rootPath, ".git"))).toBe(true);
      }),
  );
  it.effect(
    "unregisters borrowed folders without invalidating old bindings and re-registers the same copy",
    () =>
      Effect.gen(function* () {
        const rootPath = yield* makeTemp;
        yield* initRepo(rootPath);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const project = projectFor(true);
        const copy = yield* service.prepareCopy({
          requestId: "unregister-borrowed",
          project,
          rootPath,
          strategy: "reuse",
        });
        const resolved = yield* service.resolveBinding({
          binding: {
            projectId: copy.projectId,
            projectRevision: 1,
            workingCopyId: copy.id,
            environmentId,
            resourceIds: [],
          },
        });
        const threadId = ThreadId.make("unregistered-existing-thread");
        yield* store.bind(threadId, resolved, project);
        const review = yield* service.status({ workingCopyId: copy.id });
        yield* fs.writeFileString(path.join(rootPath, "README.md"), "ongoing conversation work\n");
        const request = {
          requestId: "remove-borrowed-registration",
          workingCopyId: copy.id,
          reviewToken: review.reviewToken!,
        };
        const removed = yield* service.unregister(request);
        expect(removed).toMatchObject({ state: "ready", registered: false });
        expect(yield* service.unregister(request)).toEqual(removed);
        expect(yield* fs.readFileString(path.join(rootPath, "README.md"))).toBe(
          "ongoing conversation work\n",
        );
        expect(yield* store.getBinding(threadId)).toEqual(resolved);
        expect(
          yield* store.validateThreadCwd({
            threadId,
            localProjectId: resolved.localProjectId,
            cwd: resolved.cwd,
          }),
        ).toBe(resolved.cwd);
        expect(
          (yield* service.resolveBinding({ binding: resolved.binding }).pipe(Effect.flip)).reason,
        ).toBe("invalid");
        const reactivation = {
          requestId: "review-borrowed-again",
          project,
          rootPath,
          strategy: "reuse" as const,
        };
        const restored = yield* service.prepareCopy(reactivation);
        expect(restored).toMatchObject({ id: copy.id, registered: true, state: "ready" });
        expect(yield* service.prepareCopy(reactivation)).toEqual(restored);
        expect((yield* service.preparation({ requestId: reactivation.requestId }))?.id).toBe(
          copy.id,
        );
        expect((yield* store.get(copy.id)).unregisterRequests).toHaveLength(1);
        expect((yield* service.unregister(request).pipe(Effect.flip)).reason).toBe(
          "request-conflict",
        );
        expect(yield* service.resolveBinding({ binding: resolved.binding })).toEqual(resolved);
      }),
  );
  it.effect(
    "unregisters missing borrowed folders using registration review without filesystem mutation",
    () =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const rootPath = (yield* Path.Path).join(parent, "missing-borrowed");
        yield* initRepo(rootPath);
        const fs = yield* FileSystem.FileSystem;
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const copy = yield* service.prepareCopy({
          requestId: "unregister-missing",
          project: projectFor(true),
          rootPath,
          strategy: "reuse",
        });
        yield* fs.remove(rootPath, { recursive: true });
        const reviewed = yield* service.status({ workingCopyId: copy.id });
        expect(reviewed.blockers).toEqual([]);
        expect(reviewed.reviewToken).not.toBeNull();
        expect(
          (yield* service.unregister({
            requestId: "unregister-missing-registration",
            workingCopyId: copy.id,
            reviewToken: reviewed.reviewToken!,
          })).registered,
        ).toBe(false);
        expect(yield* fs.exists(rootPath)).toBe(false);
      }),
  );
  it.effect(
    "archives dirty files, local commits and checkpoint objects before managed removal",
    () =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* runForkMigrationSet(LibraryAssetMigrations);
        const recoveryPublisher = yield* LibraryRecoveryPublisher.LibraryRecoveryPublisher.pipe(
          Effect.provide(
            LibraryRecoveryPublisher.layer.pipe(Layer.provide(LibraryRecoveryStore.layer)),
          ),
        );
        const service = yield* LibraryWorkspace.LibraryWorkspace.pipe(
          Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
          Effect.provideService(
            LibraryRecoveryPublisher.LibraryRecoveryPublisher,
            recoveryPublisher,
          ),
        );
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const checkpoints = yield* CheckpointStore.CheckpointStore;
        const rootPath = path.join(parent, "dirty-managed");
        const copy = yield* service.prepareCopy({
          requestId: "dirty-managed-prepare",
          project: makeProject([]),
          rootPath,
          strategy: "clone",
        });
        yield* git(rootPath, ["config", "user.name", "Test"]);
        yield* git(rootPath, ["config", "user.email", "test@example.com"]);
        yield* fs.writeFileString(path.join(rootPath, "notes.txt"), "local commit\n");
        yield* git(rootPath, ["add", "."]);
        yield* git(rootPath, ["commit", "-m", "Local work"]);
        const commit = yield* git(rootPath, ["rev-parse", "HEAD"]);
        yield* fs.writeFileString(path.join(rootPath, "notes.txt"), "uncommitted work\n");
        yield* fs.writeFileString(path.join(rootPath, "draft.txt"), "untracked work\n");
        const dependency = "installed local dependency\n".repeat(32 * 1024);
        yield* fs.makeDirectory(path.join(rootPath, "node_modules", "local"), { recursive: true });
        yield* fs.writeFileString(
          path.join(rootPath, "node_modules", "local", "index.js"),
          dependency,
        );
        const ref = checkpointRefForThreadTurn(ThreadId.make("dirty-managed-checkpoint"), 1);
        yield* checkpoints.captureCheckpoint({ cwd: rootPath, checkpointRef: ref });
        const checkpoint = yield* git(rootPath, ["rev-parse", ref]);
        const uncompressedPath = path.join(parent, "baseline.tar");
        expect(
          (yield* (yield* ProcessRunner.ProcessRunner).run({
            command: "tar",
            args: ["-cf", uncompressedPath, "-C", parent, "dirty-managed"],
          })).code,
        ).toBe(0);
        const uncompressedBytes = Number((yield* fs.stat(uncompressedPath)).size);
        const review = yield* service.status({ workingCopyId: copy.id });
        expect(review.blockers).toEqual([]);
        yield* service.release({
          requestId: "dirty-managed-release",
          workingCopyId: copy.id,
          reviewToken: review.reviewToken!,
        });
        expect(yield* fs.exists(rootPath)).toBe(false);
        const restored = path.join(parent, "restored");
        yield* fs.makeDirectory(restored);
        const receipt = yield* store.get(copy.id);
        const canonical = yield* recoveryArchivePath(receipt.archiveDigest!);
        const archiveBytes = yield* fs.readFile(canonical);
        expect([archiveBytes[0], archiveBytes[1]]).toEqual([0x1f, 0x8b]);
        expect(archiveBytes.length).toBeLessThan(uncompressedBytes / 10);
        yield* Effect.logInfo("Recovery compression fixture", {
          uncompressedBytes,
          compressedBytes: archiveBytes.length,
        });
        expect(yield* fs.exists(receipt.archivePath!)).toBe(false);
        expect(yield* fs.exists(receipt.archivePath!.replace(/\.tar\.gz$/, ".tar"))).toBe(false);
        expect(
          (yield* (yield* ProcessRunner.ProcessRunner).run({
            command: "tar",
            args: ["-xf", canonical, "-C", restored],
          })).code,
        ).toBe(0);
        const recovered = path.join(restored, "dirty-managed");
        expect(yield* fs.readFileString(path.join(recovered, "notes.txt"))).toBe(
          "uncommitted work\n",
        );
        expect(yield* fs.readFileString(path.join(recovered, "draft.txt"))).toBe(
          "untracked work\n",
        );
        expect(yield* git(recovered, ["rev-parse", "HEAD"])).toBe(commit);
        expect(yield* git(recovered, ["rev-parse", ref])).toBe(checkpoint);
        const reopened = yield* service.reopenCopy({
          requestId: "dirty-managed-reopen",
          workingCopyId: copy.id,
        });
        expect(reopened.id).toBe(copy.id);
        expect(reopened.state).toBe("ready");
        expect(reopened.keepOnComputer).toBe(true);
        expect(yield* fs.readFileString(path.join(rootPath, "notes.txt"))).toBe(
          "uncommitted work\n",
        );
        expect(yield* fs.readFileString(path.join(rootPath, "draft.txt"))).toBe("untracked work\n");
        expect(yield* git(rootPath, ["rev-parse", "HEAD"])).toBe(commit);
        expect(yield* git(rootPath, ["rev-parse", ref])).toBe(checkpoint);
        expect(
          yield* fs.readFileString(path.join(rootPath, "node_modules", "local", "index.js")),
        ).toBe(dependency);
        expect(yield* fs.exists(receipt.archivePath!)).toBe(false);
      }).pipe(
        Effect.provide(layerMemory),
        Effect.provideService(HostProcess.Environment, { LOOM_LIBRARY_AUTHORITY: "true" }),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Local authority recovery uses no network")),
        ),
      ),
  );
  it.effect.each([
    "settled",
    "archived",
    "keep",
    "legacy",
    "borrowed",
    "active",
    "unsettled",
    "pending",
    "dirty",
    "unpushed",
    "missing-thread",
    "unbound",
    "another-unsettled",
    "pending-history",
    "missing-legacy-thread",
    "legacy-unbound",
    "root-unbound",
    "component-pending-history",
    "goal",
    "process",
    "process-unknown",
  ] as const)("automatic cleanup respects %s work", (scenario) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* makeTemp;
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      const rootPath = path.join(parent, "files");
      const project = makeProject([]);
      if (scenario === "borrowed") yield* fs.makeDirectory(rootPath);
      const copy = yield* service.prepareCopy({
        requestId: `cleanup-${scenario}`,
        project,
        rootPath,
        strategy: scenario === "borrowed" ? "reuse" : "clone",
      });
      expect(copy.keepOnComputer).toBe(scenario === "borrowed");
      const archived = yield* archiveFor(project);
      const thread: OrchestrationV2ThreadShell = {
        ...archived.projection.thread,
        id: ThreadId.make(`cleanup-thread-${scenario}`),
        projectId: copy.rootLocalProjectId!,
        latestRunId: null,
        activeRunId: scenario === "active" ? RunId.make("active-run") : null,
        status: "idle",
        pendingRuntimeRequest: null,
        latestVisibleMessage: null,
        latestUserMessageAt: null,
        hasActionableProposedPlan: false,
        itemCount: 0,
        visibleItemCount: 0,
        settledOverride: scenario === "unsettled" ? null : "settled",
        archivedAt: scenario === "archived" ? archived.projection.updatedAt : null,
      };
      if (scenario === "keep") {
        const kept = yield* service.setCopyRetention({
          workingCopyId: copy.id,
          keepOnComputer: true,
        });
        expect(kept.keepOnComputer).toBe(true);
        expect((yield* store.get(copy.id)).copy.keepOnComputer).toBe(true);
      }
      if (scenario === "missing-legacy-thread") {
        const receipt = yield* store.get(copy.id);
        yield* store.put({ ...receipt, legacyThreadIds: [ThreadId.make("unknown-legacy-thread")] });
      }
      if (scenario === "legacy") {
        const receipt = yield* store.get(copy.id);
        const { keepOnComputer: _retention, ...older } = receipt.copy;
        yield* store.put({ ...receipt, copy: older });
      }
      if (scenario === "borrowed")
        expect(
          (yield* service
            .setCopyRetention({ workingCopyId: copy.id, keepOnComputer: false })
            .pipe(Effect.flip)).reason,
        ).toBe("not-managed");
      if (scenario === "dirty")
        yield* fs.writeFileString(path.join(rootPath, "draft.txt"), "keep draft");
      if (scenario === "unpushed") {
        const receipt = yield* store.get(copy.id);
        yield* store.put({
          ...receipt,
          rootCheckpointRepository: false,
          copy: {
            ...receipt.copy,
            repositories: [
              {
                resourceId: "local",
                path: rootPath,
                localProjectId: copy.rootLocalProjectId!,
                head: null,
                branch: "main",
              },
            ],
          },
        });
      }
      if (scenario !== "borrowed" && scenario !== "unbound") {
        yield* store.bind(
          thread.id,
          {
            cwd: rootPath,
            localProjectId: copy.rootLocalProjectId!,
            repositoryPaths: [],
            binding: {
              projectId: copy.projectId,
              projectRevision: copy.projectRevision,
              workingCopyId: copy.id,
              environmentId,
              resourceIds: [],
            },
          },
          project,
        );
      }
      if (scenario === "missing-thread") {
        const resolved = yield* service.resolveBinding({
          binding: {
            projectId: copy.projectId,
            projectRevision: copy.projectRevision,
            workingCopyId: copy.id,
            environmentId,
            resourceIds: [],
          },
        });
        yield* store.bind(ThreadId.make("absent-cleanup-thread"), resolved, project);
      }
      const threads = yield* Ref.make<readonly OrchestrationV2ThreadShell[]>([thread]);
      if (
        scenario === "legacy-unbound" ||
        scenario === "root-unbound" ||
        scenario === "component-pending-history"
      ) {
        const receipt = yield* store.get(copy.id);
        const other = {
          ...thread,
          id: ThreadId.make("related-cleanup-thread"),
          projectId: ProjectId.make("related-local-project"),
          worktreePath: null,
        };
        yield* Ref.set(threads, [thread, other]);
        if (scenario === "legacy-unbound")
          yield* store.put({ ...receipt, legacyThreadIds: [other.id] });
        if (scenario === "root-unbound")
          yield* store.put({
            ...receipt,
            copy: { ...receipt.copy, rootLocalProjectId: other.projectId },
          });
        if (scenario === "component-pending-history") {
          yield* store.put({
            ...receipt,
            copy: {
              ...receipt.copy,
              repositories: [
                {
                  resourceId: "component",
                  path: rootPath,
                  localProjectId: other.projectId,
                  head: null,
                  branch: null,
                },
              ],
            },
          });
          yield* store.bind(
            other.id,
            {
              cwd: rootPath,
              localProjectId: other.projectId,
              repositoryPaths: [rootPath],
              binding: {
                projectId: copy.projectId,
                projectRevision: copy.projectRevision,
                workingCopyId: copy.id,
                environmentId,
                resourceIds: ["component"],
              },
            },
            project,
          );
        }
      }
      if (scenario === "pending")
        yield* Ref.set(threads, [
          { ...thread, pendingBackgroundTasks: [{ kind: "subagent", taskId: "working-child" }] },
        ]);
      if (scenario === "goal")
        yield* Ref.set(threads, [
          { ...thread, goal: { objective: "Finish work", status: "active" } },
        ]);
      if (scenario === "another-unsettled") {
        const other = {
          ...thread,
          id: ThreadId.make("another-cleanup-thread"),
          settledOverride: null,
        };
        yield* store.bind(other.id, (yield* store.getBinding(thread.id))!, project);
        yield* Ref.set(threads, [thread, other]);
      }
      const child =
        scenario === "process"
          ? yield* (yield* ChildProcessSpawner.ChildProcessSpawner).spawn(
              ChildProcess.make(
                process.execPath,
                ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
                { cwd: rootPath },
              ),
            )
          : undefined;
      if (child !== undefined)
        expect(yield* child.stdout.pipe(Stream.decodeText(), Stream.runHead)).toEqual(
          Option.some("ready"),
        );
      const cleaner = yield* LibraryWorkspace.LibraryWorkspace.pipe(
        Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
        Effect.provideService(ProjectionStore.ProjectionStoreV2, {
          ...(yield* ProjectionStore.ProjectionStoreV2),
          getShellSnapshot: () =>
            Ref.get(threads).pipe(
              Effect.map((current) => ({
                schemaVersion: 1,
                snapshotSequence: 0,
                threads: current,
                archivedThreads: [],
              })),
            ),
        }),
        Effect.provideService(
          HostProcess.Platform,
          scenario === "process-unknown" ? "win32" : HostProcess.Platform.defaultValue(),
        ),
      );
      yield* cleaner.cleanupTemporaryCopies((threadId) =>
        Effect.succeed(
          scenario !== "pending-history" &&
            !(scenario === "component-pending-history" && threadId === "related-cleanup-thread"),
        ),
      );
      if (child !== undefined) expect(yield* child.isRunning).toBe(true);
      const shouldRemove = scenario === "settled" || scenario === "archived";
      expect(yield* fs.exists(rootPath)).toBe(!shouldRemove);
      expect((yield* store.get(copy.id)).copy.state).toBe(shouldRemove ? "released" : "ready");
      if (shouldRemove) {
        expect((yield* store.get(copy.id)).copy.recovery?.sha256).toMatch(/^[a-f0-9]{64}$/);
        const reopened = yield* cleaner.reopenCopy({
          requestId: `reopen-${scenario}`,
          workingCopyId: copy.id,
        });
        expect(reopened.state).toBe("ready");
        expect(reopened.keepOnComputer).toBe(true);
        yield* cleaner.cleanupTemporaryCopies(() => Effect.succeed(true));
        expect(yield* fs.exists(rootPath)).toBe(true);
      }
    }),
  );

  it.effect.each([
    "published",
    "unpublished-branch",
    "unpublished-tag",
    "deleted-remote-branch",
    "unreachable-remote",
  ] as const)("automatic cleanup verifies fresh publication for %s copies", (scenario) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* makeTemp;
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      const rootPath = path.join(parent, "files");
      const remote = path.join(parent, "remote");
      yield* initRepo(remote);
      const remoteUrl = `https://example.com/publication/${scenario}.git`;
      cloneSources.set(remoteUrl, remote);
      const project = makeProject([
        { id: "root", title: "Root", relativePath: ".", remoteUrl, defaultBranch: "main" },
      ]);
      const copy = yield* service.prepareCopy({
        requestId: `publication-${scenario}`,
        project,
        rootPath,
        strategy: "clone",
      });
      const resolved = yield* service.resolveBinding({
        binding: {
          projectId: copy.projectId,
          projectRevision: copy.projectRevision,
          workingCopyId: copy.id,
          environmentId,
          resourceIds: ["root"],
        },
      });
      yield* git(rootPath, ["remote", "set-url", "origin", remote]);
      if (scenario === "unpublished-branch" || scenario === "deleted-remote-branch") {
        yield* git(rootPath, ["switch", "-c", "sibling"]);
        yield* git(rootPath, ["commit", "--allow-empty", "-m", "Sibling work"]);
        if (scenario === "deleted-remote-branch") {
          yield* git(rootPath, ["push", "origin", "sibling"]);
          yield* git(remote, ["update-ref", "-d", "refs/heads/sibling"]);
          expect(yield* git(rootPath, ["rev-parse", "refs/remotes/origin/sibling"])).toBe(
            yield* git(rootPath, ["rev-parse", "HEAD"]),
          );
        }
        yield* git(rootPath, ["switch", "main"]);
      }
      if (scenario === "unpublished-tag")
        yield* git(rootPath, ["tag", "-a", "local-only", "-m", "Local tag"]);
      const archived = yield* archiveFor(project);
      const thread: OrchestrationV2ThreadShell = {
        ...archived.projection.thread,
        id: ThreadId.make(`publication-thread-${scenario}`),
        projectId: copy.rootLocalProjectId!,
        latestRunId: null,
        activeRunId: null,
        status: "idle",
        pendingRuntimeRequest: null,
        latestVisibleMessage: null,
        latestUserMessageAt: null,
        hasActionableProposedPlan: false,
        itemCount: 0,
        visibleItemCount: 0,
        settledOverride: "settled",
        archivedAt: null,
      };
      yield* store.bind(thread.id, resolved, project);
      if (scenario === "unreachable-remote")
        yield* git(rootPath, ["remote", "set-url", "origin", path.join(parent, "missing.git")]);
      const cleaner = yield* LibraryWorkspace.LibraryWorkspace.pipe(
        Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
        Effect.provideService(ProjectionStore.ProjectionStoreV2, {
          ...(yield* ProjectionStore.ProjectionStoreV2),
          getShellSnapshot: () =>
            Effect.succeed({
              schemaVersion: 1,
              snapshotSequence: 0,
              threads: [thread],
              archivedThreads: [],
            }),
        }),
      );
      yield* cleaner.cleanupTemporaryCopies(() => Effect.succeed(true));
      const shouldRemove = scenario === "published";
      expect(yield* fs.exists(rootPath)).toBe(!shouldRemove);
      expect((yield* store.get(copy.id)).copy.state).toBe(shouldRemove ? "released" : "ready");
    }),
  );

  it.effect.each(["keep", "pending-history"] as const)(
    "honors %s while automatic cleanup is publishing recovery",
    (protection) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const parent = yield* makeTemp;
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const rootPath = path.join(parent, "keep-during-cleanup");
        const project = makeProject([]);
        const copy = yield* service.prepareCopy({
          requestId: `keep-during-cleanup-${protection}`,
          project,
          rootPath,
          strategy: "clone",
        });
        const archive = yield* archiveFor(project);
        const thread: OrchestrationV2ThreadShell = {
          ...archive.projection.thread,
          id: ThreadId.make(`keep-during-cleanup-thread-${protection}`),
          projectId: copy.rootLocalProjectId!,
          latestRunId: null,
          activeRunId: null,
          status: "idle",
          pendingRuntimeRequest: null,
          latestVisibleMessage: null,
          latestUserMessageAt: null,
          hasActionableProposedPlan: false,
          itemCount: 0,
          visibleItemCount: 0,
          settledOverride: "settled",
        };
        const resolved = yield* service.resolveBinding({
          binding: {
            projectId: copy.projectId,
            projectRevision: copy.projectRevision,
            workingCopyId: copy.id,
            environmentId,
            resourceIds: [],
          },
        });
        yield* store.bind(thread.id, resolved, project);
        const publishing = yield* Deferred.make<void>();
        const proceed = yield* Deferred.make<void>();
        const acknowledged = yield* Ref.make(true);
        const publisher = yield* LibraryRecoveryPublisher.LibraryRecoveryPublisher;
        const cleaner = yield* LibraryWorkspace.LibraryWorkspace.pipe(
          Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
          Effect.provideService(ProjectionStore.ProjectionStoreV2, {
            ...(yield* ProjectionStore.ProjectionStoreV2),
            getShellSnapshot: () =>
              Effect.succeed({
                schemaVersion: 1,
                snapshotSequence: 0,
                threads: [thread],
                archivedThreads: [],
              }),
          }),
          Effect.provideService(LibraryRecoveryPublisher.LibraryRecoveryPublisher, {
            ...publisher,
            publish: (input) =>
              publisher.publish(input).pipe(
                Effect.tap(() => Deferred.succeed(publishing, undefined)),
                Effect.tap(() => Deferred.await(proceed)),
              ),
          }),
        );
        const cleanup = yield* Effect.forkChild(
          cleaner.cleanupTemporaryCopies(() => Ref.get(acknowledged)),
        );
        yield* Deferred.await(publishing);
        const keep =
          protection === "keep"
            ? yield* Effect.forkChild(
                cleaner.setCopyRetention({ workingCopyId: copy.id, keepOnComputer: true }),
                { startImmediately: true },
              )
            : undefined;
        if (protection === "pending-history") yield* Ref.set(acknowledged, false);
        yield* Deferred.succeed(proceed, undefined);
        yield* Fiber.join(cleanup);
        if (keep !== undefined) expect((yield* Fiber.join(keep)).keepOnComputer).toBe(true);
        expect(yield* fs.exists(rootPath)).toBe(true);
        if (protection === "keep") expect((yield* store.get(copy.id)).removalPath).toBeNull();
        else {
          expect((yield* store.get(copy.id)).copy.state).toBe("ready");
          yield* Ref.set(acknowledged, true);
          yield* cleaner.cleanupTemporaryCopies(() => Ref.get(acknowledged));
          expect(yield* fs.exists(rootPath)).toBe(false);
          expect((yield* store.get(copy.id)).copy.state).toBe("released");
        }
      }),
  );

  it.effect("publishes retention on this computer and rejects another computer's copies", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const parent = yield* makeTemp;
      const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      const published = yield* Ref.make<readonly { readonly copy: LibraryWorkingCopy }[]>([]);
      const publisher = Layer.mock(LibraryPublisher.LibraryPublisher)({
        enabled: true,
        info: Effect.succeed({
          environmentId,
          authorityId: "central-library",
          authorityEpoch: 2,
          assets: "local",
        }),
        registerCopy: (input) =>
          Ref.update(published, (copies) => [...copies, input]).pipe(Effect.as(input.copy)),
      });
      const service = yield* LibraryWorkspace.LibraryWorkspace.pipe(
        Effect.provide(Layer.fresh(LibraryWorkspace.layer).pipe(Layer.provide(publisher))),
      );
      const copy = yield* service.prepareCopy({
        requestId: "retention-publication",
        project: makeProject([]),
        rootPath: path.join(parent, "files"),
        strategy: "clone",
      });
      const kept = yield* service.setCopyRetention({
        workingCopyId: copy.id,
        keepOnComputer: true,
      });
      expect(kept.updatedAt).toBeDefined();
      expect((yield* Ref.get(published)).at(-1)).toMatchObject({
        authorityId: "central-library",
        authorityEpoch: 2,
        copy: { id: copy.id, environmentId, keepOnComputer: true },
      });
      const receipt = yield* store.get(copy.id);
      yield* store.put({
        ...receipt,
        copy: { ...receipt.copy, environmentId: EnvironmentId.make("other-computer") },
      });
      expect(
        (yield* service
          .setCopyRetention({ workingCopyId: copy.id, keepOnComputer: false })
          .pipe(Effect.flip)).reason,
      ).toBe("invalid");
      expect((yield* store.get(copy.id)).copy.keepOnComputer).toBe(true);
    }),
  );

  it.effect.each(["before-removal", "after-commit", "after-removal"] as const)(
    "retains only durably referenced recovery cache after a failed %s release receipt",
    (stage) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const parent = yield* makeTemp;
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const rootPath = path.join(parent, `release-persistence-${stage}`);
        const copy = yield* service.prepareCopy({
          requestId: `release-persistence-prepare-${stage}`,
          project: makeProject([]),
          rootPath,
          strategy: "clone",
        });
        yield* fs.writeFileString(path.join(rootPath, "local.txt"), "local-only work");
        const review = yield* service.status({ workingCopyId: copy.id });
        let failReceipt = true;
        let stagingPath: string | null = null;
        const interrupted = yield* LibraryWorkspace.LibraryWorkspace.pipe(
          Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
          Effect.provideService(LibraryWorkspaceStore.LibraryWorkspaceStore, {
            ...store,
            put: (receipt) =>
              Effect.gen(function* () {
                if (receipt.copy.id === copy.id && receipt.archivePath !== null)
                  stagingPath = receipt.archivePath;
                if (
                  failReceipt &&
                  receipt.copy.id === copy.id &&
                  (stage !== "after-removal"
                    ? receipt.removalPath !== null && receipt.copy.state === "ready"
                    : receipt.copy.state === "released")
                ) {
                  if (stage === "after-commit") yield* store.put(receipt);
                  return yield* new LibraryError({ reason: "io" });
                }
                yield* store.put(receipt);
              }),
          }),
        );
        const request = {
          requestId: `release-persistence-${stage}`,
          workingCopyId: copy.id,
          reviewToken: review.reviewToken!,
        };
        expect((yield* interrupted.release(request).pipe(Effect.flip)).reason).toBe("io");
        expect(yield* fs.exists(rootPath)).toBe(stage !== "after-removal");
        expect(stagingPath).not.toBeNull();
        const cache = stagingPath!;
        expect(yield* fs.exists(cache)).toBe(stage !== "before-removal");
        const pending = yield* store.get(copy.id);
        expect(pending.copy.state).toBe("ready");
        expect(pending.archivePath).toBe(stage === "before-removal" ? null : cache);
        failReceipt = false;
        expect((yield* interrupted.release(request)).state).toBe("released");
        expect(yield* fs.exists(rootPath)).toBe(false);
        expect(yield* fs.exists(cache)).toBe(false);
        const reopened = yield* interrupted.reopenCopy({
          requestId: `release-persistence-reopen-${stage}`,
          workingCopyId: copy.id,
        });
        expect(reopened.rootPath).toBe(rootPath);
        expect(yield* fs.readFileString(path.join(rootPath, "local.txt"))).toBe("local-only work");
        expect(yield* fs.exists(cache)).toBe(false);
      }),
  );

  it.effect("retries reopening after files were restored but receipt persistence failed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* makeTemp;
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      const rootPath = path.join(parent, "reopen-retry");
      const copy = yield* service.prepareCopy({
        requestId: "reopen-retry-prepare",
        project: makeProject([]),
        rootPath,
        strategy: "clone",
      });
      yield* fs.writeFileString(path.join(rootPath, "notes.txt"), "saved local files");
      const review = yield* service.status({ workingCopyId: copy.id });
      yield* service.release({
        requestId: "reopen-retry-release",
        workingCopyId: copy.id,
        reviewToken: review.reviewToken!,
      });
      let failReady = true;
      const interrupted = yield* LibraryWorkspace.LibraryWorkspace.pipe(
        Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
        Effect.provideService(LibraryWorkspaceStore.LibraryWorkspaceStore, {
          ...store,
          put: (receipt) =>
            receipt.copy.id === copy.id && receipt.copy.state === "ready" && failReady
              ? Effect.fail(new LibraryError({ reason: "io" }))
              : store.put(receipt),
        }),
      );
      expect(
        (yield* interrupted
          .reopenCopy({ requestId: "reopen-retry-first", workingCopyId: copy.id })
          .pipe(Effect.flip)).reason,
      ).toBe("io");
      expect((yield* store.get(copy.id)).copy.state).toBe("released");
      expect(yield* fs.readFileString(path.join(rootPath, "notes.txt"))).toBe("saved local files");
      const pending = yield* store.get(copy.id);
      yield* fs.remove(pending.archivePath!);
      yield* fs.writeFileString(path.join(rootPath, "notes.txt"), "edited after restore");
      failReady = false;
      const restored = yield* interrupted.reopenCopy({
        requestId: "reopen-retry-second",
        workingCopyId: copy.id,
      });
      expect(restored.state).toBe("ready");
      expect(restored.keepOnComputer).toBe(true);
      expect(yield* fs.readFileString(path.join(rootPath, "notes.txt"))).toBe(
        "edited after restore",
      );
      expect(yield* fs.exists(pending.archivePath!)).toBe(false);
    }),
  );

  it.effect("refuses reopening over an existing folder and rejects corrupted recovery data", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* makeTemp;
      const service = yield* LibraryWorkspace.LibraryWorkspace;
      const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      const rootPath = path.join(parent, "recovery-guard");
      const copy = yield* service.prepareCopy({
        requestId: "reopen-guard",
        project: makeProject([]),
        rootPath,
        strategy: "clone",
      });
      const review = yield* service.status({ workingCopyId: copy.id });
      yield* service.release({
        requestId: "remove-guard",
        workingCopyId: copy.id,
        reviewToken: review.reviewToken!,
      });
      yield* fs.makeDirectory(rootPath);
      yield* fs.writeFileString(path.join(rootPath, "other.txt"), "other folder");
      expect(
        (yield* service
          .reopenCopy({ requestId: "reopen-existing", workingCopyId: copy.id })
          .pipe(Effect.flip)).message,
      ).toBe(
        `The folder at ${rootPath} is missing or is not the one Loom prepared. Put the original folder back, or move the folder that is there now, then retry.`,
      );
      expect(yield* fs.readFileString(path.join(rootPath, "other.txt"))).toBe("other folder");
      yield* fs.remove(rootPath, { recursive: true });
      const receipt = yield* store.get(copy.id);
      yield* fs.writeFileString(receipt.archivePath!, "corrupted");
      expect(
        (yield* service
          .reopenCopy({ requestId: "reopen-corrupted", workingCopyId: copy.id })
          .pipe(Effect.flip)).reason,
      ).toBe("archive-unverified");
      expect(yield* fs.exists(rootPath)).toBe(false);
    }),
  );

  it.effect(
    "preserves content edits during recovery publishing even when Git status paths are unchanged",
    () =>
      Effect.gen(function* () {
        const parent = yield* makeTemp;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const service = yield* LibraryWorkspace.LibraryWorkspace;
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const rootPath = path.join(parent, "changed-during-publish");
        const copy = yield* service.prepareCopy({
          requestId: "publish-edit-prepare",
          project: makeProject([]),
          rootPath,
          strategy: "clone",
        });
        const notes = path.join(rootPath, "notes.txt");
        yield* fs.writeFileString(notes, "reviewed work\n");
        const review = yield* service.status({ workingCopyId: copy.id });
        publisherEdits.set(copy.id, { path: notes, contents: "newer work\n" });
        const failed = yield* service
          .release({
            requestId: "publish-edit-release",
            workingCopyId: copy.id,
            reviewToken: review.reviewToken!,
          })
          .pipe(Effect.flip);
        publisherEdits.delete(copy.id);
        expect(failed).toMatchObject({
          reason: "blocked",
          detail: "These files changed since they were reviewed. Review them again, then retry.",
        });
        expect(yield* fs.readFileString(notes)).toBe("newer work\n");
        expect((yield* store.get(copy.id)).copy.state).toBe("ready");
        expect(yield* fs.exists(rootPath)).toBe(true);
        const pending = yield* store.get(copy.id);
        expect(pending.removalPath).not.toBeNull();
        expect(yield* fs.exists(pending.archivePath!)).toBe(true);
        expect(
          (yield* service.reopenCopy({
            requestId: "reopen-before-release-committed",
            workingCopyId: copy.id,
          })).state,
        ).toBe("ready");
        expect(yield* fs.exists(pending.archivePath!)).toBe(true);
        expect(yield* fs.readFileString(notes)).toBe("newer work\n");
      }),
  );

  it.effect.each([
    {
      slug: "archived",
      owner: "archived",
      lookup: (old: LibraryProject) => Effect.succeed({ ...old, archived: true }),
    },
    {
      slug: "missing",
      owner: "no longer in the Library",
      lookup: (_old: LibraryProject) => Effect.fail(new LibraryError({ reason: "not-found" })),
    },
  ])(
    "moves a folder whose project is $owner and keeps its old conversations running",
    ({ slug, lookup }) =>
      Effect.gen(function* () {
        const { rootPath, old, next } = yield* takenFolder(slug);
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const library = new Map<string, Effect.Effect<LibraryProject, LibraryError>>([
          [old.id, lookup(old)],
        ]);
        const service = yield* withOwnerLookup(
          (projectId) => library.get(projectId) ?? Effect.die(`unexpected lookup ${projectId}`),
        );
        const oldCopy = yield* service.prepareCopy({
          requestId: `takeover-old-${slug}`,
          project: old,
          rootPath,
          strategy: "reuse",
        });
        const resolved = yield* service.resolveBinding({
          binding: {
            projectId: old.id,
            projectRevision: old.revision,
            workingCopyId: oldCopy.id,
            environmentId,
            resourceIds: [],
          },
        });
        const threadId = ThreadId.make(`takeover-old-thread-${slug}`);
        yield* store.bind(threadId, resolved, old);
        expect((yield* service.inspectFolder({ rootPath })).registration).toEqual({
          workingCopyId: oldCopy.id,
          projectId: old.id,
          projectTitle: "Old app",
          ownership: "borrowed",
        });

        const request = {
          requestId: `takeover-new-${slug}`,
          project: next,
          rootPath,
          strategy: "reuse" as const,
        };
        const copy = yield* service.prepareCopy(request);
        expect(copy).toMatchObject({ projectId: next.id, state: "ready" });
        expect(copy.registered).not.toBe(false);
        expect((yield* store.get(oldCopy.id)).copy).toMatchObject({
          registered: false,
          state: "ready",
        });
        expect((yield* service.inspectFolder({ rootPath })).registration?.projectId).toBe(next.id);
        expect(yield* service.prepareCopy(request)).toEqual(copy);
        expect(
          yield* store.validateThreadCwd({
            threadId,
            localProjectId: resolved.localProjectId,
            cwd: resolved.cwd,
          }),
        ).toBe(resolved.cwd);
        // The old conversation keeps both repositories; the folder itself now has the new layout.
        expect(
          (yield* store.repositoriesForRoot(rootPath, threadId))?.map(
            (repository) => repository.relativePath,
          ),
        ).toEqual(["web", "server"]);
        expect(
          (yield* store.repositoriesForRoot(rootPath))?.map(
            (repository) => repository.relativePath,
          ),
        ).toEqual(["web"]);

        // Restoring the old project does not let it take the folder back from a current one.
        library.set(old.id, Effect.succeed(old));
        library.set(next.id, Effect.succeed(next));
        const reclaimed = yield* service
          .prepareCopy({ ...request, requestId: `takeover-back-${slug}`, project: old })
          .pipe(Effect.flip);
        expect(reclaimed).toMatchObject({
          reason: "blocked",
          detail: "This folder already belongs to New app. Add it to that project instead.",
        });
        expect((yield* store.get(oldCopy.id)).copy.registered).toBe(false);
      }),
  );

  it.effect("reuses a folder its project still holds without asking the Library", () =>
    Effect.gen(function* () {
      const { rootPath, old, next } = yield* takenFolder("held");
      const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      let lookups = 0;
      const service = yield* withOwnerLookup((projectId) => {
        lookups += 1;
        return projectId === old.id
          ? Effect.succeed({ ...old, archived: true })
          : Effect.die(`unexpected lookup ${projectId}`);
      });
      const oldCopy = yield* service.prepareCopy({
        requestId: "held-old",
        project: old,
        rootPath,
        strategy: "reuse",
      });
      yield* service.prepareCopy({
        requestId: "held-new",
        project: next,
        rootPath,
        strategy: "reuse",
      });
      // Builds before one-owner folders could leave two current projects holding one folder.
      const retired = yield* store.get(oldCopy.id);
      yield* store.put({ ...retired, copy: { ...retired.copy, registered: true } });
      lookups = 0;
      const reused = yield* service.prepareCopy({
        requestId: "held-old-conversation",
        project: old,
        rootPath,
        strategy: "reuse",
      });
      expect(reused.id).toBe(oldCopy.id);
      expect(lookups).toBe(0);
    }),
  );

  it.effect("keeps a folder whose project is current, unknown or holds Loom's files", () =>
    Effect.gen(function* () {
      const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      const refused = Effect.fnUntraced(function* (
        slug: string,
        lookup: (old: LibraryProject) => Effect.Effect<LibraryProject, LibraryError>,
        options: { readonly managed?: boolean; readonly library?: boolean } = {},
      ) {
        const { rootPath, old, next } = yield* takenFolder(slug);
        const service =
          options.library === false
            ? yield* LibraryWorkspace.LibraryWorkspace
            : yield* withOwnerLookup((projectId) =>
                projectId === old.id ? lookup(old) : Effect.die(`unexpected lookup ${projectId}`),
              );
        const oldCopy = yield* service.prepareCopy({
          requestId: `kept-old-${slug}`,
          project: old,
          rootPath,
          strategy: "reuse",
        });
        if (options.managed) {
          const receipt = yield* store.get(oldCopy.id);
          yield* store.put({ ...receipt, copy: { ...receipt.copy, ownership: "managed" } });
        }
        const failure = yield* service
          .prepareCopy({
            requestId: `kept-new-${slug}`,
            project: next,
            rootPath,
            strategy: "reuse",
          })
          .pipe(Effect.flip);
        expect((yield* store.get(oldCopy.id)).copy.registered).not.toBe(false);
        expect((yield* service.inspectFolder({ rootPath })).registration?.projectId).toBe(old.id);
        expect(failure.reason).toBe("blocked");
        return failure.detail;
      });
      expect(
        yield* refused("current", (old) => Effect.succeed({ ...old, title: "Current owner" })),
      ).toBe("This folder already belongs to Current owner. Add it to that project instead.");
      expect(
        yield* refused("unreachable", () => Effect.fail(new LibraryError({ reason: "io" }))),
      ).toBe(reconnectDetail);
      expect(yield* refused("no-library", () => Effect.die("no Library"), { library: false })).toBe(
        reconnectDetail,
      );
      const managedDetail =
        "This folder holds files Loom created for Old app. Review and remove them from that project before adding the folder to another one. Restore that project first if it is archived.";
      expect(
        yield* refused("managed", (old) => Effect.succeed({ ...old, archived: true }), {
          managed: true,
        }),
      ).toBe(managedDetail);
      // A current project is the more useful one to name; without the Library, the files decide.
      expect(
        yield* refused(
          "managed-current",
          (old) => Effect.succeed({ ...old, title: "Current owner" }),
          { managed: true },
        ),
      ).toBe("This folder already belongs to Current owner. Add it to that project instead.");
      expect(
        yield* refused(
          "managed-unreachable",
          () => Effect.fail(new LibraryError({ reason: "io" })),
          {
            managed: true,
          },
        ),
      ).toBe(managedDetail);
      expect(
        yield* refused("managed-no-library", () => Effect.die("no Library"), {
          managed: true,
          library: false,
        }),
      ).toBe(managedDetail);
    }),
  );

  it.effect(
    "reports every project holding a folder and takes it only when all of them have gone",
    () =>
      Effect.gen(function* () {
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const library = new Map<string, Effect.Effect<LibraryProject, LibraryError>>();
        const service = yield* withOwnerLookup(
          (projectId) => library.get(projectId) ?? Effect.die(`unexpected lookup ${projectId}`),
        );
        // Builds before one-owner folders could leave a folder registered to two projects.
        const heldTwice = Effect.fnUntraced(function* (
          slug: string,
          ownership: "borrowed" | "managed" = "borrowed",
        ) {
          const { rootPath, old, next } = yield* takenFolder(slug);
          library.set(old.id, Effect.succeed({ ...old, archived: true }));
          const oldCopy = yield* service.prepareCopy({
            requestId: `twice-old-${slug}`,
            project: old,
            rootPath,
            strategy: "reuse",
          });
          const nextCopy = yield* service.prepareCopy({
            requestId: `twice-next-${slug}`,
            project: next,
            rootPath,
            strategy: "reuse",
          });
          const retired = yield* store.get(oldCopy.id);
          yield* store.put({
            ...retired,
            copy: {
              ...retired.copy,
              registered: true,
              ownership,
              updatedAt: "2099-01-01T00:00:00.000Z",
            },
          });
          const third = { ...next, id: `project:third-${slug}`, title: "Third app" };
          const addThird = service.prepareCopy({
            requestId: `twice-third-${slug}`,
            project: third,
            rootPath,
            strategy: "reuse",
          });
          return { rootPath, old, next, third, oldCopy, nextCopy, addThird };
        });
        const registered = (copyId: string) =>
          store.get(copyId).pipe(Effect.map((receipt) => receipt.copy.registered !== false));

        // The newest holder is archived, which is all older computers reported.
        const shared = yield* heldTwice("shared");
        library.set(shared.next.id, Effect.succeed(shared.next));
        const inspection = yield* service.inspectFolder({ rootPath: shared.rootPath });
        expect(inspection.registrations).toEqual([
          {
            workingCopyId: shared.oldCopy.id,
            projectId: shared.old.id,
            projectTitle: "Old app",
            ownership: "borrowed",
          },
          {
            workingCopyId: shared.nextCopy.id,
            projectId: shared.next.id,
            projectTitle: "New app",
            ownership: "borrowed",
          },
        ]);
        expect(inspection.registration).toEqual(inspection.registrations?.[0]);
        expect(yield* Effect.flip(shared.addThird)).toMatchObject({
          reason: "blocked",
          detail: "This folder already belongs to New app. Add it to that project instead.",
        });
        expect(yield* registered(shared.oldCopy.id)).toBe(true);
        expect(yield* registered(shared.nextCopy.id)).toBe(true);

        // The Library cannot answer for one holder: a current other is still named, and with none
        // the folder stays put until the Library answers.
        const partly = yield* heldTwice("partly");
        library.set(partly.old.id, Effect.fail(new LibraryError({ reason: "io" })));
        library.set(partly.next.id, Effect.succeed(partly.next));
        expect(yield* Effect.flip(partly.addThird)).toMatchObject({
          reason: "blocked",
          detail: "This folder already belongs to New app. Add it to that project instead.",
        });
        library.set(partly.next.id, Effect.succeed({ ...partly.next, archived: true }));
        expect(yield* Effect.flip(partly.addThird)).toMatchObject({
          reason: "blocked",
          detail: reconnectDetail,
        });
        expect(yield* registered(partly.oldCopy.id)).toBe(true);
        expect(yield* registered(partly.nextCopy.id)).toBe(true);

        const gone = yield* heldTwice("gone");
        library.set(gone.next.id, Effect.fail(new LibraryError({ reason: "not-found" })));
        expect(yield* gone.addThird).toMatchObject({ projectId: gone.third.id, state: "ready" });
        expect(yield* registered(gone.oldCopy.id)).toBe(false);
        expect(yield* registered(gone.nextCopy.id)).toBe(false);
        const taken = yield* service.inspectFolder({ rootPath: gone.rootPath });
        expect(taken.registrations?.map((registration) => registration.projectId)).toEqual([
          gone.third.id,
        ]);

        // Older clients judge by one holder, so the one with Loom's files is the one they see.
        const managed = yield* heldTwice("managed", "managed");
        library.set(managed.next.id, Effect.succeed(managed.next));
        const held = yield* store.get(managed.nextCopy.id);
        yield* store.put({
          ...held,
          copy: { ...held.copy, updatedAt: "2100-01-01T00:00:00.000Z" },
        });
        const managedInspection = yield* service.inspectFolder({ rootPath: managed.rootPath });
        expect(
          managedInspection.registrations?.map((registration) => registration.projectId),
        ).toEqual([managed.next.id, managed.old.id]);
        expect(managedInspection.registration).toMatchObject({
          projectId: managed.old.id,
          ownership: "managed",
        });
        expect(yield* Effect.flip(managed.addThird)).toMatchObject({
          reason: "blocked",
          detail: "This folder already belongs to New app. Add it to that project instead.",
        });
        expect(yield* registered(managed.oldCopy.id)).toBe(true);
        expect(yield* registered(managed.nextCopy.id)).toBe(true);
      }),
  );

  it.effect(
    "asks the Library about every holder at once, so a slow answer is waited out once",
    () =>
      Effect.gen(function* () {
        const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
        const { rootPath, old, next } = yield* takenFolder("together");
        const asked = new Map([
          [old.id, yield* Deferred.make<void>()],
          [next.id, yield* Deferred.make<void>()],
        ]);
        const answer = yield* Deferred.make<void>();
        let slow = false;
        const service = yield* withOwnerLookup((projectId) => {
          const project = projectId === old.id ? { ...old, archived: true } : next;
          const gate = asked.get(projectId);
          if (!slow || gate === undefined) return Effect.succeed(project);
          // Every check waits until each holder has been asked, which checks made in turn never reach.
          return Deferred.succeed(gate, undefined).pipe(
            Effect.andThen(Deferred.await(answer)),
            Effect.as(project),
          );
        });
        const oldCopy = yield* service.prepareCopy({
          requestId: "together-old",
          project: old,
          rootPath,
          strategy: "reuse",
        });
        yield* service.prepareCopy({
          requestId: "together-next",
          project: next,
          rootPath,
          strategy: "reuse",
        });
        const retired = yield* store.get(oldCopy.id);
        yield* store.put({ ...retired, copy: { ...retired.copy, registered: true } });
        slow = true;
        const adding = yield* service
          .prepareCopy({
            requestId: "together-third",
            project: { ...next, id: "project:third-together", title: "Third app" },
            rootPath,
            strategy: "reuse",
          })
          .pipe(Effect.flip, Effect.forkChild({ startImmediately: true }));
        yield* Effect.forEach(asked.values(), (gate) => Deferred.await(gate), { discard: true });
        yield* Deferred.succeed(answer, undefined);
        expect((yield* Fiber.join(adding)).detail).toBe(
          "This folder already belongs to New app. Add it to that project instead.",
        );
      }),
  );

  it.effect("reviews a borrowed folder for removal without reading its files", () =>
    Effect.gen(function* () {
      const rootPath = yield* makeTemp;
      const parent = yield* makeTemp;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* initRepo(rootPath);
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const spawned: string[] = [];
      const service = yield* LibraryWorkspace.LibraryWorkspace.pipe(
        Effect.provide(Layer.fresh(LibraryWorkspace.layer)),
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((command) => {
            if (command._tag === "StandardCommand") spawned.push(command.command);
            return spawner.spawn(command);
          }),
        ),
      );
      const copy = yield* service.prepareCopy({
        requestId: "borrowed-review-without-contents",
        project: projectFor(true),
        rootPath,
        strategy: "reuse",
      });
      spawned.length = 0;
      const review = yield* service.status({ workingCopyId: copy.id });
      yield* fs.writeFileString(path.join(rootPath, "README.md"), "edited after review\n");
      expect((yield* service.status({ workingCopyId: copy.id })).reviewToken).toBe(
        review.reviewToken,
      );
      expect(spawned).not.toContain("tar");
      expect(
        (yield* service.unregister({
          requestId: "unregister-without-contents",
          workingCopyId: copy.id,
          reviewToken: review.reviewToken!,
        })).registered,
      ).toBe(false);
      // A managed folder is still reviewed by its contents, which the spy above records.
      const managed = yield* service.prepareCopy({
        requestId: "managed-review-reads-contents",
        project: makeProject([]),
        rootPath: path.join(parent, "managed"),
        strategy: "clone",
      });
      yield* service.status({ workingCopyId: managed.id });
      expect(spawned).toContain("tar");
    }),
  );
});
