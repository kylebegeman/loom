import { assert, expect, it } from "@effect/vitest"; // fork: checkpoint-capable
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { OrchestrationProjectShell } from "@t3tools/contracts"; // fork: project-root-worktree
import { LibraryError } from "@t3tools/contracts/fork"; // fork: checkpoint-capable
import * as LibraryWorkspaceStore from "../fork/project-library/LibraryWorkspaceStore.ts"; // fork: checkpoint-capable

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path"; // fork: project-root-worktree

import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitManager from "./GitManager.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts"; // fork: project-root-worktree

// fork: project-lifecycle
const layerConfig = ServerConfig.layerTest(process.cwd(), { prefix: "t3-git-workflow-" }).pipe(
  Layer.provide(NodeServices.layer),
);

// fork: checkpoint-capable
function layer(input: {
  readonly detect: VcsDriverRegistry.VcsDriverRegistry["Service"]["detect"];
}) {
  return GitWorkflowService.layer.pipe(
    Layer.provide(layerConfig), // fork: project-lifecycle
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        detect: input.detect,
      }),
    ),
    Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
    Layer.provide(Layer.mock(GitManager.GitManager)({})),
    Layer.provide(NodeServices.layer), // fork: project-lifecycle
  );
}

it.layer(NodeServices.layer)("GitWorkflowService", (it) => {
  // fork: checkpoint-capable
  it.effect(
    "reports checkpoint capability for a registered nongit parent without enabling Git workflows",
    () =>
      Effect.gen(function* () {
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const local = yield* workflow.localStatus({ cwd: "/registered-project" });
        const full = yield* workflow.status({ cwd: "/registered-project" });
        expect(local).toMatchObject({
          isRepo: false,
          checkpointCapable: true,
          hasPrimaryRemote: false,
          refName: null,
        });
        expect(full).toMatchObject({
          isRepo: false,
          checkpointCapable: true,
          hasUpstream: false,
          pr: null,
        });
        expect(yield* workflow.isRepository("/registered-project")).toBe(false);
        expect(yield* workflow.remoteStatus({ cwd: "/registered-project" })).toBeNull();
        expect(
          (yield* workflow.localStatus({ cwd: "/ordinary-folder" })).checkpointCapable,
        ).toBeUndefined();
      }).pipe(
        Effect.provide(
          layer({ detect: () => Effect.succeed(null) }).pipe(
            Layer.provide(
              Layer.mock(LibraryWorkspaceStore.LibraryWorkspaceStore)({
                repositoriesForRoot: (cwd) =>
                  Effect.succeed(
                    cwd === "/registered-project"
                      ? [{ path: "/registered-project/web", relativePath: "web" }]
                      : null,
                  ),
              }),
            ),
          ),
        ),
      ),
  );
  // fork: checkpoint-capable
  it.effect("keeps empty registrations unavailable and reports receipt failures explicitly", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      expect(
        (yield* workflow.localStatus({ cwd: "/empty-registration" })).checkpointCapable,
      ).toBeUndefined();
      const failure = yield* workflow.status({ cwd: "/broken-registration" }).pipe(Effect.flip);
      expect(failure).toMatchObject({
        _tag: "GitManagerError",
        operation: "GitWorkflowService.checkpointCapability",
        cwd: "/broken-registration",
      });
    }).pipe(
      Effect.provide(
        layer({ detect: () => Effect.succeed(null) }).pipe(
          Layer.provide(
            Layer.mock(LibraryWorkspaceStore.LibraryWorkspaceStore)({
              repositoriesForRoot: (cwd) =>
                cwd === "/broken-registration"
                  ? Effect.fail(new LibraryError({ reason: "io" }))
                  : Effect.succeed([]),
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("finds a name among the refs of every namespace", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-ref-named-" });
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      for (const args of [
        ["init", "-b", "main"],
        ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
        ["update-ref", "refs/remotes/upstream/feature/topic", "HEAD"],
        ["symbolic-ref", "refs/remotes/origin/alias", "refs/heads/main"],
        ["update-ref", "refs/mirror/origin/mirrored", "HEAD"],
      ]) {
        yield* driver.execute({ operation: "test.setupRepo", cwd, args });
      }
      const found = yield* Effect.forEach(
        ["main", "feature/topic", "alias", "mirrored", "t3/renamed", "feature/*"],
        (refName) => workflow.hasRefNamed({ cwd, refName }),
      );
      assert.deepEqual(found, [true, true, true, true, false, false]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        GitWorkflowService.layer.pipe(
          Layer.provide(
            Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
              resolve: () => Effect.succeed({ kind: "git" } as VcsDriverRegistry.VcsDriverHandle),
            }),
          ),
          Layer.provide(Layer.mock(GitManager.GitManager)({})),
          Layer.provideMerge(GitVcsDriver.layer),
          Layer.provideMerge(VcsProcess.layer),
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-ref-named-" }).pipe(
              Layer.provide(NodeServices.layer),
            ),
          ),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );

  // fork: project-root-worktree
  const projectRoots: string[] = [];
  it.effect("keeps a project's own folder when it is named as the worktree to remove", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fileSystem.realPath(
        yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-project-root-worktree-" }),
      );
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      const repo = path.join(base, "repo");
      yield* fileSystem.makeDirectory(repo);
      const git = (args: ReadonlyArray<string>) =>
        driver.execute({ operation: "test.setupRepo", cwd: repo, args });
      yield* git(["init", "-b", "main"]);
      yield* git([
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "--allow-empty",
        "-m",
        "i",
      ]);
      const worktree = (name: string) =>
        git(["worktree", "add", "-b", name, path.join(base, name)]).pipe(
          Effect.as(path.join(base, name)),
        );

      // The project was opened through a symlink, and its resolved folder is recorded as the
      // thread's worktree.
      const linked = yield* worktree("linked");
      const projectLink = path.join(base, "project-link");
      yield* fileSystem.symlink(linked, projectLink);
      const own = yield* workflow
        .removeWorktree({ cwd: projectLink, path: linked, force: true })
        .pipe(Effect.flip);
      expect(own).toMatchObject({ _tag: "GitCommandError", command: "worktree-guard" });
      expect(own.detail).toContain("holds a project's own folder");
      expect(yield* fileSystem.exists(path.join(linked, ".git"))).toBe(true);

      // Another project lives inside the worktree.
      const holding = yield* worktree("holding");
      projectRoots.push(path.join(holding, "app"));
      yield* fileSystem.makeDirectory(path.join(holding, "app"));
      expect(
        (yield* workflow
          .removeWorktree({ cwd: repo, path: holding, force: true })
          .pipe(Effect.flip)).command,
      ).toBe("worktree-guard");
      expect(yield* fileSystem.exists(path.join(holding, "app"))).toBe(true);

      const separate = yield* worktree("separate");
      yield* workflow.removeWorktree({ cwd: repo, path: separate, force: true });
      expect(yield* fileSystem.exists(separate)).toBe(false);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        GitWorkflowService.layer.pipe(
          Layer.provide(layerConfig),
          Layer.provide(
            Layer.mock(ProjectStore.ProjectStoreV2)({
              listShells: () =>
                Effect.succeed(
                  projectRoots.map(
                    (workspaceRoot) => ({ workspaceRoot }) as OrchestrationProjectShell,
                  ),
                ),
            }),
          ),
          Layer.provide(
            Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
              resolve: () => Effect.succeed({ kind: "git" } as VcsDriverRegistry.VcsDriverHandle),
            }),
          ),
          Layer.provide(Layer.mock(GitManager.GitManager)({})),
          Layer.provideMerge(GitVcsDriver.layer),
          Layer.provideMerge(VcsProcess.layer),
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-project-root-worktree-" }).pipe(
              Layer.provide(NodeServices.layer),
            ),
          ),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );
  // fork: project-root-worktree end
});
