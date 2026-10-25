import { assert, expect, it, vi } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { VcsRepositoryDetectionError } from "@t3tools/contracts";
import type { OrchestrationProjectShell } from "@t3tools/contracts"; // fork: project-root-worktree
import { LibraryError } from "@t3tools/contracts/fork";
import * as LibraryWorkspaceStore from "../fork/project-library/LibraryWorkspaceStore.ts";

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

function layer(input: {
  readonly detect: VcsDriverRegistry.VcsDriverRegistry["Service"]["detect"];
}) {
  return GitWorkflowService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        detect: input.detect,
      }),
    ),
    Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
    Layer.provide(Layer.mock(GitManager.GitManager)({})),
    Layer.provide(NodeServices.layer),
  );
}

it.layer(NodeServices.layer)("GitWorkflowService", (it) => {
  it.effect("reports a non-Git VCS repository as not a Git repository", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const isRepository = yield* workflow.isRepository("/jj-repo");

      assert.equal(isRepository, false);
    }).pipe(
      Effect.provide(
        layer({
          detect: () =>
            Effect.succeed({
              kind: "jj",
              repository: {
                kind: "jj",
                rootPath: "/jj-repo",
                metadataPath: "/jj-repo/.jj",
                freshness: {
                  source: "live-local",
                  observedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
                  expiresAt: Option.none(),
                },
              },
              driver: {} as VcsDriverRegistry.VcsDriverHandle["driver"],
            }),
        }),
      ),
    ),
  );

  it.effect("returns an empty local status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const status = yield* workflow.localStatus({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
      });
    }).pipe(
      Effect.provide(
        layer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("returns an empty full status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const status = yield* workflow.status({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        aheadOfDefaultCount: 0,
        pr: null,
      });
    }).pipe(
      Effect.provide(
        layer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("does not call GitManager status methods when no VCS repository is detected", () => {
    const localStatus = vi.fn();
    const remoteStatus = vi.fn();
    const status = vi.fn();

    const layerTest = GitWorkflowService.layer.pipe(
      Layer.provide(NodeServices.layer),
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          detect: () => Effect.succeed(null),
        }),
      ),
      Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
      Layer.provide(
        Layer.mock(GitManager.GitManager)({
          localStatus,
          remoteStatus,
          status,
        }),
      ),
    );

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      yield* workflow.localStatus({ cwd: "/not-a-repo" });
      yield* workflow.remoteStatus({ cwd: "/not-a-repo" });
      yield* workflow.status({ cwd: "/not-a-repo" });

      assert.equal(localStatus.mock.calls.length, 0);
      assert.equal(remoteStatus.mock.calls.length, 0);
      assert.equal(status.mock.calls.length, 0);
    }).pipe(Effect.provide(layerTest));
  });

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

  it.effect("returns an empty ref list when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const refs = yield* workflow.listRefs({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(refs, {
        refs: [],
        isRepo: false,
        hasPrimaryRemote: false,
        nextCursor: null,
        totalCount: 0,
      });
    }).pipe(
      Effect.provide(
        layer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("structures workflow detection failures without exposing upstream details", () => {
    const cause = new VcsRepositoryDetectionError({
      operation: "VcsDriverRegistry.detect",
      cwd: "/repo",
      detail: "upstream detail must stay in the cause chain",
    });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow.status({ cwd: "/repo" }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitManagerError",
        operation: "GitWorkflowService.status",
        cwd: "/repo",
        detail: "Failed to detect a VCS repository for this Git workflow.",
      });
      expect(error.message).not.toContain(cause.detail);
    }).pipe(
      Effect.provide(
        layer({
          detect: () => Effect.fail(cause),
        }),
      ),
    );
  });

  it.effect("structures command detection failures without exposing upstream details", () => {
    const cause = new VcsRepositoryDetectionError({
      operation: "VcsDriverRegistry.detect",
      cwd: "/repo",
      detail: "upstream command detail must stay in the cause chain",
    });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow.listRefs({ cwd: "/repo" }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitCommandError",
        operation: "GitWorkflowService.listRefs",
        command: "vcs-route",
        cwd: "/repo",
        detail: "Failed to detect a VCS repository for this Git command.",
      });
      expect(error.message).not.toContain(cause.detail);
    }).pipe(
      Effect.provide(
        layer({
          detect: () => Effect.fail(cause),
        }),
      ),
    );
  });

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
