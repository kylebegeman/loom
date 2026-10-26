import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ProjectPlacement from "./ProjectPlacement.ts";

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
});
