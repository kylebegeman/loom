import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ProjectScript,
} from "@t3tools/contracts";
import { type LibraryProject } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { libraryComputerDirectory } from "./enrollment.ts";
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
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as ProjectPlacement from "../../project/ProjectPlacement.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";
import * as Workspace from "./LibraryWorkspace.ts";
import * as LibraryGitFetch from "./LibraryGitFetch.ts";
import * as WorktreeSetupTracker from "../../project/WorktreeSetupTracker.ts";
import * as Store from "./LibraryWorkspaceStore.ts";
import * as LanesRoots from "../project-lifecycle/lanesRoots.ts";

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
  ProjectPlacement.layerWithProjectStore.pipe(
    Layer.provide(LanesRoots.layer),
    Layer.provideMerge(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
    Layer.provideMerge(ServerSettings.layerTest()),
  ),
  ProjectionStore.layer,
  ProcessRunner.layer,
  Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({}),
  Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
    getEnvironmentId: Effect.succeed(EnvironmentId.make("real-project-service-host")),
  }),
).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(config),
  Layer.provideMerge(NodeServices.layer),
);
const layer = Workspace.layer.pipe(
  Layer.provide(Layer.mergeAll(LibraryGitFetch.layer, WorktreeSetupTracker.layer)),
  Layer.provideMerge(dependencies),
);
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
    "prepares and reuses a plain folder through a symlink alias without reacquiring the root lease",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const parent = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "library-folder-alias-" }),
        );
        const rootPath = path.join(parent, "notes");
        const alias = path.join(parent, "alias");
        yield* fs.makeDirectory(rootPath);
        yield* fs.writeFileString(path.join(rootPath, "notes.txt"), "local notes");
        yield* fs.symlink(rootPath, alias);
        const workspace = yield* Workspace.LibraryWorkspace;
        const folderProject = { ...project, resources: [] };
        const copy = yield* workspace.prepareCopy({
          requestId: "alias-folder-first",
          project: folderProject,
          rootPath: alias,
          strategy: "reuse",
        });
        const again = yield* workspace.prepareCopy({
          requestId: "alias-folder-next",
          project: folderProject,
          rootPath,
          strategy: "reuse",
        });
        expect(again.id).toBe(copy.id);
        const resolved = yield* workspace.resolveBinding({
          binding: {
            projectId: folderProject.id,
            projectRevision: folderProject.revision,
            workingCopyId: copy.id,
            environmentId: copy.environmentId,
            resourceIds: [],
          },
        });
        expect(resolved.cwd).toBe(rootPath);
        expect(yield* fs.readFileString(path.join(rootPath, "notes.txt"))).toBe("local notes");
        yield* git(rootPath, ["rev-parse", "--verify", "HEAD"]);
      }),
  );
  it.effect("fills empty settings from the setup and replaces local ones only with consent", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;
      const rootPath = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "library-profile-settings-" }),
      );
      for (const name of ["web", "server"]) {
        yield* fs.makeDirectory(path.join(rootPath, name));
        yield* git(path.join(rootPath, name), ["init", "--initial-branch=main"]);
      }
      const workspace = yield* Workspace.LibraryWorkspace,
        projects = yield* ProjectService.ProjectService;
      const script = (id: string, command: string): ProjectScript => ({
        id,
        name: id,
        command,
        icon: "play",
        runOnWorktreeCreate: false,
      });
      const localScripts = [script("dev", "make dev")];
      const setupScripts = [script("dev", "vp run dev")];
      const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
      const custom = yield* projects.bootstrap({
        commandId: CommandId.make("customized-web"),
        projectId: ProjectId.make("customized-web"),
        title: "Customized web",
        workspaceRoot: path.join(rootPath, "web"),
        scripts: localScripts,
      });
      const setup = {
        ...project,
        profile: { scripts: setupScripts, defaultModelSelection: model },
      };

      const copy = yield* workspace.prepareCopy({
        requestId: "profile-copy",
        project: setup,
        rootPath,
        strategy: "reuse",
      });
      const local = (id: ProjectId) =>
        projects.getById(id).pipe(Effect.map((found) => Option.getOrThrow(found)));
      const web = copy.repositories.find((repository) => repository.resourceId === "web")!;
      const server = copy.repositories.find((repository) => repository.resourceId === "server")!;
      expect(web.localProjectId).toBe(custom.project.id);
      // Empty settings take the setup's values; a local customization is kept.
      expect((yield* local(web.localProjectId)).scripts).toEqual(localScripts);
      expect((yield* local(web.localProjectId)).defaultModelSelection).toEqual(model);
      expect((yield* local(server.localProjectId)).scripts).toEqual(setupScripts);
      expect((yield* local(server.localProjectId)).defaultModelSelection).toEqual(model);

      const review = yield* workspace.profileSettings({ workingCopyId: copy.id });
      expect(review.projects).toEqual([
        {
          localProjectId: web.localProjectId,
          title: "Customized web",
          differences: [{ field: "scripts", local: localScripts, profile: setupScripts }],
        },
      ]);
      expect(review.reviewToken).not.toBeNull();

      // Getting the copy again still leaves the customization alone.
      yield* workspace.prepareCopy({
        requestId: "profile-copy-again",
        project: setup,
        rootPath,
        strategy: "reuse",
      });
      expect((yield* local(web.localProjectId)).scripts).toEqual(localScripts);

      // A token for other differences applies nothing.
      const stale = yield* workspace
        .applyProfile({ workingCopyId: copy.id, reviewToken: "not-what-was-reviewed" })
        .pipe(Effect.flip);
      expect(stale.reason).toBe("invalid");
      expect((yield* local(web.localProjectId)).scripts).toEqual(localScripts);

      const applied = yield* workspace.applyProfile({
        workingCopyId: copy.id,
        reviewToken: review.reviewToken!,
      });
      expect(applied).toEqual({ workingCopyId: copy.id, projects: [], reviewToken: null });
      expect((yield* local(web.localProjectId)).scripts).toEqual(setupScripts);
    }),
  );
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
  it.effect("registers added components without rewriting old working-copy or thread scope", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;
      const rootPath = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "library-evolution-" }),
      );
      for (const name of ["web", "server"]) {
        const cwd = path.join(rootPath, name);
        yield* fs.makeDirectory(cwd);
        yield* git(cwd, ["init", "--initial-branch=main"]);
      }
      const workspace = yield* Workspace.LibraryWorkspace,
        store = yield* Store.LibraryWorkspaceStore;
      const initial = { ...project, resources: project.resources.slice(0, 1) };
      const old = yield* workspace.prepareCopy({
        requestId: "old-resource-set",
        project: initial,
        rootPath,
        strategy: "reuse",
      });
      const evolved = { ...project, revision: 2 };
      const next = yield* workspace.prepareCopy({
        requestId: "new-resource-set",
        project: evolved,
        rootPath,
        strategy: "reuse",
      });
      expect(next.id).not.toBe(old.id);
      expect(next.repositories.map((repo) => repo.resourceId).toSorted()).toEqual([
        "server",
        "web",
      ]);
      expect((yield* store.get(old.id)).copy.projectRevision).toBe(1);
      expect((yield* store.get(old.id)).copy.repositories).toHaveLength(1);
      const resolved = yield* workspace.resolveBinding({
        binding: {
          projectId: initial.id,
          projectRevision: 1,
          workingCopyId: old.id,
          environmentId: old.environmentId,
          resourceIds: ["web"],
        },
        project: initial,
      });
      expect(resolved.cwd).toBe(path.join(rootPath, "web"));
      expect(yield* fs.exists(path.join(rootPath, "server", ".git"))).toBe(true);
    }),
  );
  it.effect(
    "adopts staged source bindings from machine configuration without editing native history",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem,
          path = yield* Path.Path,
          config = yield* ServerConfig.ServerConfig;
        const workspace = yield* Workspace.LibraryWorkspace;
        const parent = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "library-external-enrollment-" }),
        );
        const copy = yield* workspace.prepareCopy({
          requestId: "external-discussion",
          project: { ...project, resources: [] },
          rootPath: path.join(parent, "discussion"),
          strategy: "clone",
        });
        const nativeFile = path.join(config.stateDir, "project-library", "host", "workspaces.json");
        const original = yield* fs.readFileString(nativeFile);
        const fakeHome = path.join(parent, "home");
        const externalDir = path.join(
          libraryComputerDirectory(fakeHome, copy.environmentId),
          "project-library",
          "host",
        );
        yield* fs.makeDirectory(externalDir, { recursive: true });
        const externalFile = path.join(externalDir, "workspaces.json");
        yield* fs.writeFileString(externalFile, original, { mode: 0o600 });
        const adopted = yield* Store.LibraryWorkspaceStore.pipe(
          Effect.provide(Layer.fresh(Store.layer)),
          Effect.provideService(HostProcess.HomeDirectory, fakeHome),
        );
        const receipt = yield* adopted.get(copy.id);
        expect(receipt.copy.rootPath).toBe(copy.rootPath);
        yield* adopted.put({ ...receipt, copy: { ...receipt.copy, registered: false } });
        expect((yield* adopted.get(copy.id)).copy.registered).toBe(false);
        expect(yield* fs.readFileString(nativeFile)).toBe(original);
        expect(yield* fs.readFileString(externalFile)).not.toBe(original);
      }),
  );
});
