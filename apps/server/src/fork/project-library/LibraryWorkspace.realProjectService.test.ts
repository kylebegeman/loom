import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId, EnvironmentId } from "@t3tools/contracts";
import { type LibraryProject } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as RuntimeLayer from "../../orchestration-v2/runtimeLayer.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as ProjectEnrichmentService from "../../project/ProjectEnrichmentService.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";
import * as Workspace from "./LibraryWorkspace.ts";
import * as Store from "./LibraryWorkspaceStore.ts";

const config = ServerConfig.layerTest(process.cwd(), { prefix: "library-real-project-service-" });
const realProjects = RuntimeLayer.layerProjectService.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(ThreadCommandExecutor.layer),
  Layer.provide(
    Layer.mock(ProjectEnrichmentService.ProjectEnrichmentService)({
      getAvailable: () =>
        Effect.succeed({
          repositoryIdentity: null,
          repositoryIdentityResolved: true,
          faviconPath: null,
        }),
      peek: () =>
        Effect.succeed({
          repositoryIdentity: null,
          repositoryIdentityResolved: true,
          faviconPath: null,
        }),
      invalidate: () => Effect.void,
    }),
  ),
  Layer.provide(ServerSettings.layerTest()),
);
const dependencies = Layer.mergeAll(
  realProjects,
  Store.layer,
  ProjectionStore.layer,
  ProcessRunner.layer,
  Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
    getEnvironmentId: Effect.succeed(EnvironmentId.make("real-project-service-host")),
  }),
).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(config),
  Layer.provideMerge(NodeServices.layer),
);
const layer = Workspace.layer.pipe(Layer.provideMerge(dependencies));
const project: LibraryProject = {
  id: "library-real-project",
  title: "Real project service",
  brief: "",
  revision: 1,
  resources: ["web", "server"].map((name) => ({
    id: name,
    title: name,
    relativePath: name,
    remoteUrl: null,
    defaultBranch: "main",
  })),
  archived: false,
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: "2026-10-15T00:00:00Z",
};
const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  const result = yield* (yield* ProcessRunner.ProcessRunner).run({ command: "git", args, cwd });
  expect(result.code).toBe(0);
});

it.layer(layer)("Library workspace with real project services", (it) => {
  it.effect(
    "materializes migrated component records when an existing borrowed copy is reused",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem,
          path = yield* Path.Path;
        const rootPath = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "library-migrated-copy-" }),
        );
        const repository = path.join(rootPath, "web");
        yield* fs.makeDirectory(repository);
        yield* git(repository, ["init", "--initial-branch=main"]);
        const workspace = yield* Workspace.LibraryWorkspace,
          store = yield* Store.LibraryWorkspaceStore,
          projects = yield* ProjectService.ProjectService;
        const root = yield* projects.bootstrap({
          commandId: CommandId.make("migration-root"),
          projectId: ProjectId.make("legacy-root"),
          title: "Existing parent",
          workspaceRoot: rootPath,
        });
        const migratedId = ProjectId.make("legacy-migrated-component");
        const seed = {
          id: "migrated-copy",
          projectId: project.id,
          projectRevision: 1,
          environmentId: EnvironmentId.make("real-project-service-host"),
          rootPath,
          rootLocalProjectId: root.project.id,
          repositories: [
            {
              resourceId: "web",
              path: repository,
              localProjectId: migratedId,
              head: null,
              branch: "main",
            },
          ],
          ownership: "borrowed" as const,
          state: "ready" as const,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        };
        yield* store.put({
          requestId: "imported-migration",
          fingerprint: "migration-proof",
          project: { ...project, resources: [project.resources[0]!] },
          copy: seed,
          rootLocalProjectId: root.project.id,
          rootCheckpointRepository: false,
          legacyThreadIds: [],
          rootIdentity: null,
          releaseRequestId: null,
          releaseReviewToken: null,
          removalPath: null,
          archivePath: null,
          archiveDigest: null,
        });
        expect(Option.isNone(yield* projects.getById(migratedId))).toBe(true);
        const copy = yield* workspace.prepareCopy({
          requestId: "reuse-migrated",
          project: { ...project, resources: [project.resources[0]!] },
          rootPath,
          strategy: "reuse",
        });
        expect(copy.id).toBe(seed.id);
        expect(copy.repositories[0]?.localProjectId).toBe(migratedId);
        expect(Option.isSome(yield* projects.getById(migratedId))).toBe(true);
      }),
  );
  it.effect(
    "prepares borrowed nested repositories and a managed context root without reacquiring their held lease",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const parent = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "real-project-copy-" }),
        );
        const rootPath = path.join(parent, "borrowed");
        for (const name of ["web", "server"]) {
          const repository = path.join(rootPath, name);
          yield* fs.makeDirectory(repository, { recursive: true });
          yield* git(repository, ["init", "--initial-branch=main"]);
        }
        const workspace = yield* Workspace.LibraryWorkspace;
        const projects = yield* ProjectService.ProjectService;
        const receipts = yield* Store.LibraryWorkspaceStore;
        const request = {
          requestId: "real-borrowed-copy",
          project,
          rootPath,
          strategy: "reuse" as const,
        };
        const copy = yield* workspace.prepareCopy(request);
        expect(copy.state).toBe("ready");
        expect(copy.repositories).toHaveLength(2);
        expect(yield* workspace.prepareCopy(request)).toEqual(copy);
        expect(Option.isSome(yield* projects.getByWorkspaceRoot(rootPath))).toBe(true);
        for (const repository of copy.repositories)
          expect(Option.isSome(yield* projects.getById(repository.localProjectId))).toBe(true);
        expect((yield* receipts.get(copy.id)).rootLocalProjectId).not.toBeNull();
        const discussion = yield* workspace.prepareCopy({
          requestId: "real-discussion-copy",
          project: { ...project, resources: [] },
          rootPath: path.join(parent, "discussion"),
          strategy: "clone",
        });
        expect(discussion.state).toBe("ready");
        expect(Option.isSome(yield* projects.getByWorkspaceRoot(discussion.rootPath))).toBe(true);
        expect(yield* fs.exists(path.join(discussion.rootPath, ".git"))).toBe(true);
      }),
  );
});
