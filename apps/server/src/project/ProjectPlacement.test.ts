import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as LibraryWorkspaceStore from "../fork/project-library/LibraryWorkspaceStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { markManagedProjectCheckout } from "../workspace/ManagedProjectCheckout.ts";
import * as ProjectPlacement from "./ProjectPlacement.ts";
import { buildRepositoryIdentity } from "./RepositoryIdentityResolver.ts";

const projectRow = (projectId: string, workspaceRoot: string): ProjectStore.ProjectRow => ({
  projectId: ProjectId.make(projectId),
  title: projectId,
  workspaceRoot,
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});

interface Harness {
  readonly baseDir: string;
  readonly home: string;
  readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
  readonly projects?: ReadonlyArray<ProjectStore.ProjectRow>;
  readonly lanes?: ReadonlyArray<string>;
}

const layerGit = GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer));

const layer = (harness: Harness) =>
  ProjectPlacement.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectStore.ProjectStoreV2)({
          list: () => Effect.succeed(harness.projects ?? []),
        }),
        Layer.succeed(ProjectPlacement.LanesRoots, {
          roots: Effect.succeed(harness.lanes ?? []),
        }),
        layerGit,
        Layer.succeed(HostProcess.HomeDirectory, harness.home),
        ProjectPlacement.layerLibraryCopyRoots,
      ),
    ),
    Layer.provideMerge(ServerSettings.layerTest(harness.settings)),
    Layer.provideMerge(ServerConfig.layerTest(harness.baseDir, harness.baseDir)),
  );

const tempDir = Effect.fn("ProjectPlacement.test.tempDir")(function* (prefix: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.realPath(yield* fileSystem.makeTempDirectoryScoped({ prefix }));
});

interface Dirs {
  readonly baseDir: string;
  readonly home: string;
}

const withPlacement = <A, E>(
  harness: (dirs: Dirs) => Omit<Harness, "baseDir" | "home">,
  body: (
    placement: ProjectPlacement.ProjectPlacement["Service"],
    dirs: Dirs,
  ) => Effect.Effect<
    A,
    E,
    | ServerSettings.ServerSettingsService
    | ServerConfig.ServerConfig
    | FileSystem.FileSystem
    | Path.Path
  >,
) =>
  Effect.gen(function* () {
    const dirs = {
      home: yield* tempDir("t3-placement-home-"),
      baseDir: yield* tempDir("t3-placement-base-"),
    };
    return yield* ProjectPlacement.ProjectPlacement.pipe(
      Effect.flatMap((placement) => body(placement, dirs)),
      Effect.provide(layer({ ...dirs, ...harness(dirs) })),
    );
  });

const initRepository = (directory: string, origin: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const git = yield* GitVcsDriver.GitVcsDriver;
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    yield* git.execute({ operation: "test.init", cwd: directory, args: ["init", "--quiet"] });
    yield* git.execute({
      operation: "test.remote",
      cwd: directory,
      args: ["remote", "add", "origin", origin],
    });
  }).pipe(
    Effect.provide(
      layerGit.pipe(
        Layer.provide(ServerConfig.layerTest(directory, { prefix: "t3-placement-config-" })),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

const libraryReceipt = (
  id: string,
  rootPath: string,
  state: LibraryWorkspaceStore.WorkspaceReceipt["copy"]["state"],
): LibraryWorkspaceStore.WorkspaceReceipt => ({
  requestId: id,
  fingerprint: id,
  project: {
    id: `project-${id}`,
    revision: 1,
    title: id,
    brief: "",
    resources: [],
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  copy: {
    id,
    projectId: `project-${id}`,
    projectRevision: 1,
    environmentId: EnvironmentId.make("placement-computer"),
    rootPath,
    repositories: [],
    ownership: "managed",
    state,
    keepOnComputer: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
});

describe("ProjectPlacement", () => {
  it.effect("an empty setting puts projects in <managedRoot>/projects", () =>
    withPlacement(
      () => ({}),
      (placement, { baseDir }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const projects = path.join(baseDir, "projects");
          assert.equal(yield* placement.projectsRoot, projects);
          assert.deepEqual(yield* placement.managedProjectRoots, [projects]);
          assert.equal((yield* placement.folders).projects, projects);
        }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("a set folder is used and earlier folders, including the default, stay managed", () =>
    withPlacement(
      () => ({}),
      (placement, { baseDir, home }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const settings = yield* ServerSettings.ServerSettingsService;
          yield* settings.updateSettings({ projectsDirectory: "~/Developer/active" });
          yield* settings.updateSettings({ projectsDirectory: "~/Developer/next" });
          const next = path.join(home, "Developer", "next");
          assert.equal(yield* placement.projectsRoot, next);
          assert.deepEqual(
            [...(yield* placement.managedProjectRoots)].toSorted(),
            [
              path.join(baseDir, "projects"),
              path.join(home, "Developer", "active"),
              next,
            ].toSorted(),
          );
        }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("a relative setting falls back to the default folder", () =>
    withPlacement(
      () => ({ settings: { projectsDirectory: "Developer/active" } }),
      (placement, { baseDir }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          assert.equal(yield* placement.projectsRoot, path.join(baseDir, "projects"));
        }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("claims add -2 on collision and two concurrent claims get different folders", () =>
    withPlacement(
      () => ({}),
      (placement, { baseDir }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const root = path.join(baseDir, "projects");
          assert.equal(yield* placement.claimFolder("My App"), path.join(root, "my-app"));
          assert.equal(yield* placement.claimFolder("My App"), path.join(root, "my-app-2"));
          const racing = yield* Effect.all(
            [placement.claimFolder("Race"), placement.claimFolder("Race")],
            { concurrency: "unbounded" },
          );
          assert.deepEqual(racing.toSorted(), [path.join(root, "race"), path.join(root, "race-2")]);
        }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("finds checkouts of the same origin in https and ssh forms only", () =>
    withPlacement(
      () => ({}),
      (placement, { baseDir }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const root = path.join(baseDir, "projects");
          yield* initRepository(path.join(root, "loom"), "git@github.com:kyle/loom.git");
          yield* initRepository(path.join(root, "other"), "https://github.com/kyle/other.git");
          const viaHttps = yield* placement.findRepositoryCheckouts(
            "https://github.com/Kyle/loom.git",
          );
          assert.deepEqual(viaHttps, [{ path: path.join(root, "loom"), projectId: null }]);
          assert.deepEqual(
            yield* placement.findRepositoryCheckouts("ssh://git@github.com/kyle/loom"),
            viaHttps,
          );
          assert.deepEqual(
            yield* placement.findRepositoryCheckouts("https://github.com/kyle/missing.git"),
            [],
          );
        }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("finds a registered project outside the Projects folder", () =>
    Effect.gen(function* () {
      const elsewhere = yield* tempDir("t3-placement-elsewhere-");
      yield* initRepository(elsewhere, "https://github.com/kyle/loom.git");
      yield* withPlacement(
        () => ({ projects: [projectRow("loom", elsewhere)] }),
        (placement) =>
          Effect.gen(function* () {
            assert.deepEqual(
              yield* placement.findRepositoryCheckouts("git@github.com:kyle/loom.git"),
              [{ path: elsewhere, projectId: ProjectId.make("loom") }],
            );
          }),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses Loom's data, worktree and lanes folders and other projects", () =>
    Effect.gen(function* () {
      const elsewhere = yield* tempDir("t3-placement-elsewhere-");
      const project = `${elsewhere}/project`;
      yield* withPlacement(
        ({ home }) => ({
          projects: [projectRow("project", project)],
          lanes: [`${home}/Developer/lanes`],
        }),
        (placement, { baseDir, home }) =>
          Effect.gen(function* () {
            const config = yield* ServerConfig.ServerConfig;
            for (const target of [
              `${config.stateDir}/x`,
              baseDir,
              `${config.worktreesDir}/repo/branch`,
              `${home}/Developer/lanes/loom`,
              `${project}/nested`,
              elsewhere,
              home,
              "/",
              "relative/path",
            ]) {
              const refused = yield* placement.assertPlacementAllowed(target).pipe(Effect.flip);
              assert.equal(refused._tag, "ProjectPlacementRefusedError", target);
            }
            assert.equal(
              yield* placement.assertPlacementAllowed(project, { allowReuseOf: project }),
              project,
            );
            assert.equal(
              yield* placement.assertPlacementAllowed("~/Developer/active/loom"),
              `${home}/Developer/active/loom`,
            );
            // `within` refuses only a folder inside a project; `ignore` leaves projects to the caller.
            assert.equal(
              yield* placement.assertPlacementAllowed(elsewhere, { projects: "within" }),
              elsewhere,
            );
            assert.equal(
              (yield* placement
                .assertPlacementAllowed(`${project}/nested`, { projects: "within" })
                .pipe(Effect.flip))._tag,
              "ProjectPlacementRefusedError",
            );
            assert.equal(
              yield* placement.assertPlacementAllowed(`${project}/nested`, { projects: "ignore" }),
              `${project}/nested`,
            );
          }),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("previews the folder a claim would take without creating it", () =>
    withPlacement(
      () => ({}),
      (placement, { baseDir }) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = path.join(baseDir, "projects");
          assert.equal(yield* placement.previewFolder("My App"), path.join(root, "my-app"));
          assert.isFalse(yield* fileSystem.exists(root));
          assert.equal(yield* placement.claimFolder("My App"), path.join(root, "my-app"));
          assert.equal(yield* placement.previewFolder("My App"), path.join(root, "my-app-2"));
          assert.isFalse(yield* fileSystem.exists(path.join(root, "my-app-2")));
        }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does not offer a released folder or a restore stage as a checkout", () =>
    withPlacement(
      () => ({}),
      (placement, { baseDir }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const root = path.join(baseDir, "projects");
          const origin = "https://github.com/kyle/loom.git";
          for (const name of [
            "loom",
            "loom.loom-released-0123456789abcdef",
            "loom.t3-released-0f8fad5b-d9cb-469f-a165-70867728950e",
            "loom.t3-restore-0f8fad5b-d9cb-469f-a165-70867728950e",
            ".loom-restore-a1b2c3",
            ".loom-reopen-a1b2c3",
          ])
            yield* initRepository(path.join(root, name), origin);
          assert.deepEqual(yield* placement.findRepositoryCheckouts(origin), [
            { path: path.join(root, "loom"), projectId: null },
          ]);
        }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses Loom's data folder named in another letter case", () =>
    withPlacement(
      () => ({}),
      (placement) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const { stateDir } = yield* ServerConfig.ServerConfig;
          const variant = path.join(path.dirname(stateDir), path.basename(stateDir).toUpperCase());
          // A case-sensitive volume holds a different, unprotected folder at that name.
          if (!(yield* fileSystem.exists(variant))) return;
          const refused = yield* placement
            .assertPlacementAllowed(path.join(variant, "x"))
            .pipe(Effect.flip);
          assert.equal(refused._tag, "ProjectPlacementRefusedError");
        }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("claims skip a name a receipt or a registered project still holds", () =>
    withPlacement(
      ({ baseDir }) => ({ projects: [projectRow("registered", `${baseDir}/projects/registered`)] }),
      (placement, { baseDir }) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = path.join(baseDir, "projects");
          const released = path.join(root, "app");
          yield* fileSystem.makeDirectory(path.join(released, ".git"), { recursive: true });
          yield* markManagedProjectCheckout(
            released,
            buildRepositoryIdentity({
              rootPath: released,
              remoteName: "origin",
              remoteUrl: "https://github.com/kyle/app.git",
              originUrl: "https://github.com/kyle/app.git",
            }),
          );
          yield* fileSystem.remove(released, { recursive: true });
          assert.equal(yield* placement.previewFolder("App"), path.join(root, "app-2"));
          assert.equal(yield* placement.claimFolder("App"), path.join(root, "app-2"));
          assert.equal(yield* placement.claimFolder("Registered"), path.join(root, "registered-2"));
        }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses to claim a folder when the Projects setting points into Loom's data", () =>
    withPlacement(
      ({ baseDir }) => ({ settings: { projectsDirectory: `${baseDir}/userdata/projects` } }),
      (placement, { baseDir }) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const refused = yield* placement.claimFolder("App").pipe(Effect.flip);
          assert.equal(refused._tag, "ProjectPlacementFolderError");
          assert.isFalse(yield* fileSystem.exists(`${baseDir}/userdata/projects/app`));
        }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("claims skip a name a Library copy still records, even with its folder gone", () =>
    withPlacement(
      () => ({}),
      (placement, { baseDir }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const root = path.join(baseDir, "projects");
          const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore.pipe(
            Effect.provide(LibraryWorkspaceStore.layer),
          );
          yield* store.put(libraryReceipt("missing", path.join(root, "app"), "missing"));
          yield* store.put({
            ...libraryReceipt("releasing", path.join(root, "site"), "ready"),
            releaseRequestId: "release",
            removalPath: path.join(root, "site.loom-released-0123456789abcdef"),
          });
          yield* store.put(libraryReceipt("released", path.join(root, "old"), "released"));
          assert.equal(yield* placement.previewFolder("App"), path.join(root, "app-2"));
          assert.equal(yield* placement.claimFolder("App"), path.join(root, "app-2"));
          assert.equal(yield* placement.claimFolder("Site"), path.join(root, "site-2"));
          assert.equal(yield* placement.claimFolder("Old"), path.join(root, "old"));
        }),
    ).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a Projects folder setting it would refuse as a claim root", () =>
    Effect.gen(function* () {
      const elsewhere = yield* tempDir("t3-placement-elsewhere-");
      const project = `${elsewhere}/project`;
      yield* withPlacement(
        ({ home }) => ({
          projects: [projectRow("project", project)],
          lanes: [`${home}/Developer/lanes`],
        }),
        (placement, { home }) =>
          Effect.gen(function* () {
            const config = yield* ServerConfig.ServerConfig;
            for (const setting of [
              `${config.stateDir}/projects`,
              `${home}/Developer/lanes/projects`,
              `${project}/nested`,
              "~",
              "Developer/active",
            ]) {
              const refused = yield* placement
                .assertProjectsFolderAllowed(setting)
                .pipe(Effect.flip);
              assert.match(refused.message, /^Choose another Projects folder\. /, setting);
            }
            yield* placement.assertProjectsFolderAllowed("");
            yield* placement.assertProjectsFolderAllowed(elsewhere);
            yield* placement.assertProjectsFolderAllowed("~/Developer/active");
          }),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
