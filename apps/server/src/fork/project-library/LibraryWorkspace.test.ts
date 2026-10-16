import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, EnvironmentId, type Project, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryProject,
  type LibraryThreadBinding,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { expect } from "vite-plus/test";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as LibraryWorkspace from "./LibraryWorkspace.ts";
import * as LibraryWorkspaceStore from "./LibraryWorkspaceStore.ts";
import * as LibraryRecoveryPublisher from "./LibraryRecoveryPublisher.ts";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { parseTurnDiffFilesFromNumstat } from "../../checkpointing/Diffs.ts";

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
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 2,
  pr: null,
};
const broadcasterLayer = Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
  refreshLocalStatus: (cwd) => Effect.sync(() => (vcsCalls.push(`local:${cwd}`), vcsStatus)),
  getStatus: (input) => Effect.sync(() => (vcsCalls.push(`get:${input.cwd}`), vcsStatus)),
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
      return LibraryRecoveryPublisher.LibraryRecoveryPublisher.of({
        configured: true,
        publish: (input) =>
          Effect.gen(function* () {
            if (publisherFailures.has(input.manifest.copyId))
              return yield* new LibraryError({ reason: "archive-unverified" });
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

it.layer(layerTest)("LibraryWorkspace", (it) => {
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
            repository.error ??
              `${repository.branch} ${repository.behind} ${repository.uncommittedFiles}`,
          ]),
        ),
      ).toEqual({ web: "main 2 1", server: "missing" });
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
      expect(yield* fs.exists(archivePath)).toBe(true);
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
      const rejected = yield* Effect.result(
        receipts.validateThreadCwd({
          threadId,
          localProjectId: resolved.localProjectId,
          cwd: rootPath,
        }),
      );
      expect(rejected._tag).toBe("Failure");
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
          args: ["-xf", receipt.archivePath!, "-C", restorePath],
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
      const released = yield* Effect.result(
        service.release({
          requestId: "release-stale",
          workingCopyId: copy.id,
          reviewToken: review.reviewToken!,
        }),
      );
      expect(released._tag).toBe("Failure");
      expect(yield* fs.readFileString(path.join(rootPath, "notes.md"))).toBe("work to preserve");
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
        const service = yield* LibraryWorkspace.LibraryWorkspace;
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
        const ref = checkpointRefForThreadTurn(ThreadId.make("dirty-managed-checkpoint"), 1);
        yield* checkpoints.captureCheckpoint({ cwd: rootPath, checkpointRef: ref });
        const checkpoint = yield* git(rootPath, ["rev-parse", ref]);
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
        expect(
          (yield* (yield* ProcessRunner.ProcessRunner).run({
            command: "tar",
            args: ["-xf", receipt.archivePath!, "-C", restored],
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
        expect(failed.reason).toBe("blocked");
        expect(yield* fs.readFileString(notes)).toBe("newer work\n");
        expect((yield* store.get(copy.id)).copy.state).toBe("ready");
        expect(yield* fs.exists(rootPath)).toBe(true);
      }),
  );
});
