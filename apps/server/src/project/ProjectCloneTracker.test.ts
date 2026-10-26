import { SourceControlProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import {
  OrchestrationDispatchCommandError,
  ProjectId,
  projectCloneProgressSummary,
  SourceControlRepositoryError,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts"; // fork: file-placement
import * as VcsProcess from "../vcs/VcsProcess.ts"; // fork: file-placement
import * as SourceControlRepositoryService from "../sourceControl/SourceControlRepositoryService.ts";
import * as ProjectCloneTracker from "./ProjectCloneTracker.ts";
import { parseGitCloneProgressLine } from "./gitCloneProgress.ts";

const projectId = ProjectId.make("project-1");
const startInput = {
  projectId,
  title: "t3code",
  createdAt: "2026-01-01T00:00:00.000Z",
  remoteUrl: "git@github.com:octocat/t3code.git",
  destinationPath: "/workspace/t3code",
};

const trackerLayer = (
  repositories: Partial<SourceControlRepositoryService.SourceControlRepositoryService["Service"]>,
  baseDir: string | { readonly prefix: string } = { prefix: "t3-clone-tracker-" },
) =>
  ProjectCloneTracker.layer.pipe(
    Layer.provide(
      Layer.mock(SourceControlRepositoryService.SourceControlRepositoryService)(repositories),
    ),
    Layer.provide(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))), // fork: file-placement
    Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
    Layer.provide(NodeServices.layer),
  );

function makeHarness(options?: {
  readonly clone?: SourceControlRepositoryService.SourceControlRepositoryService["Service"]["cloneRepository"];
  readonly prepare?: SourceControlRepositoryService.SourceControlRepositoryService["Service"]["prepareClone"];
  readonly baseDir?: string;
}) {
  const cloneCalls: Array<string> = [];
  const created: Array<{ projectId: ProjectId; workspaceRoot: string }> = [];
  const cloned: Array<ProjectId> = [];
  const discarded: Array<string> = [];
  const hooks: ProjectCloneTracker.ProjectCloneHooks = {
    createProject: (input) =>
      Effect.sync(() => {
        created.push({ projectId: input.projectId, workspaceRoot: input.workspaceRoot });
      }),
    onCloned: (input) => Effect.sync(() => void cloned.push(input.projectId)),
  };
  const clone: SourceControlRepositoryService.SourceControlRepositoryService["Service"]["cloneRepository"] =
    options?.clone ??
    ((input) =>
      Effect.succeed({
        cwd: input.destinationPath ?? "",
        remoteUrl: input.remoteUrl ?? "",
        repository: null,
      }));
  const layer = trackerLayer(
    {
      prepareClone:
        options?.prepare ??
        ((input) =>
          Effect.succeed({
            destinationPath: input.destinationPath ?? "",
            remoteUrl: input.remoteUrl ?? "",
            cloneUrl: input.remoteUrl ?? "",
            repository: null,
          })),
      cloneRepository: (input, cloneOptions) =>
        Effect.sync(() => void cloneCalls.push(input.destinationPath ?? "")).pipe(
          Effect.andThen(clone(input, cloneOptions)),
        ),
      discardClone: (destination) => Effect.sync(() => void discarded.push(destination)),
    },
    options?.baseDir,
  );
  return { layer, hooks, created, cloned, discarded, cloneCalls };
}

describe("ProjectCloneTracker", () => {
  it.effect("creates the project first and reports the clone through the stream", () => {
    const release = Deferred.makeUnsafe<void>();
    const harness = makeHarness({
      clone: (input, options) =>
        Effect.gen(function* () {
          yield* (
            options?.onProgress?.({ stage: "receiving", percent: 40, detail: "1 MiB" }) ??
              Effect.void
          );
          yield* Deferred.await(release);
          return {
            cwd: input.destinationPath ?? "",
            remoteUrl: input.remoteUrl ?? "",
            repository: null,
          };
        }),
    });
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      const collected = yield* tracker.stream.pipe(
        Stream.takeUntil((clones) => clones[0]?.phase === "done"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      const result = yield* tracker.start(startInput, harness.hooks);
      expect(result.cwd).toBe("/workspace/t3code");
      expect(harness.created).toEqual([{ projectId, workspaceRoot: "/workspace/t3code" }]);

      yield* Effect.yieldNow;
      const running = yield* tracker.get(projectId);
      expect(running).toMatchObject({ phase: "running", stage: "receiving", percent: 40 });

      yield* Deferred.succeed(release, undefined);
      const lists = yield* Fiber.join(collected);
      const final = lists.at(-1)?.[0];
      expect(final).toMatchObject({ phase: "done", percent: 100 });
      expect(harness.cloned).toEqual([projectId]);

      yield* TestClock.adjust("31 seconds");
      expect(yield* tracker.get(projectId)).toBeNull();
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("flags a clone stalled when git goes quiet and clears it when git speaks", () => {
    const release = Deferred.makeUnsafe<void>();
    const resumed = Deferred.makeUnsafe<void>();
    const harness = makeHarness({
      clone: (input, options) =>
        Effect.gen(function* () {
          const report = options?.onProgress ?? (() => Effect.void);
          yield* report({ stage: "receiving", percent: 24, detail: "168.80 MiB | 20.69 MiB/s" });
          yield* Deferred.await(resumed);
          yield* report({ stage: "receiving", percent: 25, detail: "170.00 MiB | 1.00 MiB/s" });
          yield* Deferred.await(release);
          return {
            cwd: input.destinationPath ?? "",
            remoteUrl: input.remoteUrl ?? "",
            repository: null,
          };
        }),
    });
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      yield* tracker.start(startInput, harness.hooks);
      yield* Effect.yieldNow;
      expect((yield* tracker.get(projectId))?.stalled).toBe(false);

      yield* TestClock.adjust("19 seconds");
      expect((yield* tracker.get(projectId))?.stalled).toBe(false);
      yield* TestClock.adjust("1 second");
      const stalled = yield* tracker.get(projectId);
      expect(stalled).toMatchObject({ stalled: true, percent: 24 });
      expect(projectCloneProgressSummary(stalled!)).toBe("Receiving objects · 24% · Stalled");

      yield* Deferred.succeed(resumed, undefined);
      yield* Effect.yieldNow;
      expect(yield* tracker.get(projectId)).toMatchObject({ stalled: false, percent: 25 });

      yield* TestClock.adjust("20 seconds");
      expect((yield* tracker.get(projectId))?.stalled).toBe(true);
      yield* Deferred.succeed(release, undefined);
      yield* Effect.yieldNow;
      expect(yield* tracker.get(projectId)).toMatchObject({ phase: "done", stalled: false });
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("keeps a failed clone with git's own explanation and retries it", () => {
    let attempts = 0;
    const harness = makeHarness({
      clone: (input) =>
        Effect.suspend(() => {
          attempts += 1;
          return attempts === 1
            ? Effect.fail(
                new SourceControlRepositoryError({
                  operation: "cloneRepository",
                  provider: SourceControlProviderKind.make("unknown"),
                  detail: "fatal: repository not found",
                }),
              )
            : Effect.succeed({
                cwd: input.destinationPath ?? "",
                remoteUrl: input.remoteUrl ?? "",
                repository: null,
              });
        }),
    });
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      yield* tracker.start(startInput, harness.hooks);
      yield* Effect.yieldNow;
      const failed = yield* tracker.get(projectId);
      expect(failed).toMatchObject({ phase: "failed", error: "fatal: repository not found" });

      expect(yield* tracker.retry(projectId)).toBe(true);
      expect(harness.discarded).toEqual(["/workspace/t3code"]);
      yield* Effect.yieldNow;
      expect((yield* tracker.get(projectId))?.phase).toBe("done");
      expect(attempts).toBe(2);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("cancel interrupts the clone and removes the partial checkout", () => {
    const harness = makeHarness({ clone: () => Effect.never });
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      yield* tracker.start(startInput, harness.hooks);
      yield* Effect.yieldNow;

      expect(yield* tracker.cancel(projectId)).toBe(true);
      expect((yield* tracker.get(projectId))?.phase).toBe("cancelled");
      expect(harness.discarded).toEqual(["/workspace/t3code"]);
      expect(yield* tracker.cancel(projectId)).toBe(false);
      expect(yield* tracker.retry(projectId)).toBe(true);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("a cancel that lands after git finished keeps the checkout", () => {
    const gate = Deferred.makeUnsafe<void>();
    const harness = makeHarness();
    const hooks: ProjectCloneTracker.ProjectCloneHooks = {
      ...harness.hooks,
      onCloned: () => Deferred.await(gate),
    };
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      yield* tracker.start(startInput, hooks);
      yield* Effect.yieldNow;
      expect((yield* tracker.get(projectId))?.phase).toBe("done");
      expect(yield* tracker.cancel(projectId)).toBe(false);
      expect(harness.discarded).toEqual([]);
      yield* Deferred.succeed(gate, undefined);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("hands git the credential-bearing URL while snapshots carry the redacted one", () => {
    const cloneUrls: Array<string> = [];
    const harness = makeHarness({
      clone: (input) =>
        Effect.sync(() => {
          cloneUrls.push(input.remoteUrl ?? "");
          return { cwd: input.destinationPath ?? "", remoteUrl: "", repository: null };
        }),
    });
    const layer = trackerLayer({
      prepareClone: (input) =>
        Effect.succeed({
          destinationPath: input.destinationPath ?? "",
          remoteUrl: "https://github.com/octocat/t3code.git",
          cloneUrl: "https://user:s3cret@github.com/octocat/t3code.git",
          repository: null,
        }),
      cloneRepository: (input) =>
        Effect.sync(() => {
          cloneUrls.push(input.remoteUrl ?? "");
          return { cwd: input.destinationPath ?? "", remoteUrl: "", repository: null };
        }),
      discardClone: () => Effect.void,
    });
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      const result = yield* tracker.start(startInput, harness.hooks);
      yield* Effect.yieldNow;
      expect(result.remoteUrl).toBe("https://github.com/octocat/t3code.git");
      expect(cloneUrls).toEqual(["https://user:s3cret@github.com/octocat/t3code.git"]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("discard forgets a project's clone when the project is deleted", () => {
    const harness = makeHarness({ clone: () => Effect.never });
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      yield* tracker.start(startInput, harness.hooks);
      yield* Effect.yieldNow;
      yield* tracker.discard(projectId);
      expect(yield* tracker.get(projectId)).toBeNull();
      expect(harness.discarded).toEqual(["/workspace/t3code"]);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("releases the claim when project creation fails", () => {
    const harness = makeHarness();
    const hooks: ProjectCloneTracker.ProjectCloneHooks = {
      ...harness.hooks,
      createProject: () =>
        Effect.fail(new OrchestrationDispatchCommandError({ message: "workspace root exists" })),
    };
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      const error = yield* Effect.flip(tracker.start(startInput, hooks));
      expect(error.message).toContain("workspace root exists");
      expect(yield* tracker.get(projectId)).toBeNull();
      yield* tracker.start(startInput, harness.hooks);
      yield* Effect.yieldNow;
      expect((yield* tracker.get(projectId))?.phase).toBe("done");
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("does not create a project when the clone cannot be prepared", () => {
    const harness = makeHarness();
    const layer = trackerLayer({
      prepareClone: () =>
        Effect.fail(
          new SourceControlRepositoryError({
            operation: "cloneRepository",
            provider: SourceControlProviderKind.make("unknown"),
            detail: "Destination path already exists and is not empty.",
          }),
        ),
    });
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      const error = yield* Effect.flip(tracker.start(startInput, harness.hooks));
      expect(error.message).toContain("not empty");
      expect(harness.created).toEqual([]);
      expect(yield* tracker.get(projectId)).toBeNull();
    }).pipe(Effect.provide(layer));
  });

  it.effect("an omitted destination registers a matching checkout without cloning", () => {
    const harness = makeHarness({
      prepare: (input) =>
        Effect.succeed({
          destinationPath: "/projects/t3code",
          remoteUrl: input.remoteUrl ?? "",
          cloneUrl: input.remoteUrl ?? "",
          repository: null,
          reuse: { path: "/projects/t3code", projectId: null },
        }),
    });
    const { destinationPath: _omitted, ...input } = startInput;
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      const result = yield* tracker.start(input, harness.hooks);
      expect(result).toMatchObject({
        projectId,
        cwd: "/projects/t3code",
        destinationPath: "/projects/t3code",
        reused: true,
      });
      expect(harness.created).toEqual([{ projectId, workspaceRoot: "/projects/t3code" }]);
      expect(harness.cloned).toEqual([projectId]);
      expect(harness.cloneCalls).toEqual([]);
      expect(yield* tracker.get(projectId)).toBeNull();
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("an omitted destination that is already a project opens that project", () => {
    const existing = ProjectId.make("project-existing");
    const harness = makeHarness({
      prepare: (input) =>
        Effect.succeed({
          destinationPath: "/projects/t3code",
          remoteUrl: input.remoteUrl ?? "",
          cloneUrl: input.remoteUrl ?? "",
          repository: null,
          reuse: { path: "/projects/t3code", projectId: existing },
        }),
    });
    const { destinationPath: _omitted, ...input } = startInput;
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      const result = yield* tracker.start(input, harness.hooks);
      expect(result).toMatchObject({ projectId: existing, reused: true });
      expect(harness.created).toEqual([]);
      expect(harness.cloneCalls).toEqual([]);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("an omitted destination clones into the folder the server claimed", () => {
    const prepared: Array<{ readonly title: string | undefined }> = [];
    const harness = makeHarness({
      prepare: (input, options) =>
        Effect.sync(() => {
          prepared.push({ title: options?.title });
          return {
            destinationPath: "/projects/t3code",
            remoteUrl: input.remoteUrl ?? "",
            cloneUrl: input.remoteUrl ?? "",
            repository: null,
            claimed: true as const,
          };
        }),
    });
    const { destinationPath: _omitted, ...input } = startInput;
    return Effect.gen(function* () {
      const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      const result = yield* tracker.start(input, harness.hooks);
      expect(result).toMatchObject({ destinationPath: "/projects/t3code", reused: false });
      expect(prepared).toEqual([{ title: "t3code" }]);
      yield* Effect.yieldNow;
      expect(harness.cloneCalls).toEqual(["/projects/t3code"]);
      expect((yield* tracker.get(projectId))?.phase).toBe("done");
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("a clone cut short by a restart comes back as interrupted and can be retried", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-clone-restart-" });
      const destinationPath = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-clone-restart-dest-",
      });
      const input = { ...startInput, destinationPath };
      const running = Deferred.makeUnsafe<void>();
      const first = makeHarness({
        baseDir,
        clone: () => Deferred.succeed(running, undefined).pipe(Effect.andThen(Effect.never)),
      });
      yield* Effect.gen(function* () {
        const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
        yield* tracker.start(input, first.hooks);
        yield* Deferred.await(running);
      }).pipe(Effect.provide(first.layer));

      const second = makeHarness({ baseDir });
      yield* Effect.gen(function* () {
        const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
        expect(yield* tracker.get(projectId)).toMatchObject({
          phase: "failed",
          destinationPath,
          remoteUrl: startInput.remoteUrl,
          error: "The clone was interrupted when Loom stopped. Retry it or remove the project.",
        });
        expect(yield* tracker.retry(projectId, second.hooks)).toBe(true);
        yield* Effect.yieldNow;
        expect((yield* tracker.get(projectId))?.phase).toBe("done");
        expect(second.cloneCalls).toEqual([destinationPath]);
        expect(second.cloned).toEqual([projectId]);
      }).pipe(Effect.provide(second.layer));

      const third = makeHarness({ baseDir });
      yield* Effect.gen(function* () {
        const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
        expect(yield* tracker.get(projectId)).toBeNull();
      }).pipe(Effect.provide(third.layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("a finished clone whose receipt outlived it is not offered for removal", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-clone-restart-" });
      const destinationPath = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-clone-restart-dest-",
      });
      const running = Deferred.makeUnsafe<void>();
      const first = makeHarness({
        baseDir,
        clone: () => Deferred.succeed(running, undefined).pipe(Effect.andThen(Effect.never)),
      });
      yield* Effect.gen(function* () {
        const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
        yield* tracker.start({ ...startInput, destinationPath }, first.hooks);
        yield* Deferred.await(running);
        // git finished and the user started working, but the receipt was never removed.
        const git = yield* GitVcsDriver.GitVcsDriver;
        const run = (args: ReadonlyArray<string>) =>
          git.execute({ operation: "test.git", cwd: destinationPath, args });
        yield* run(["init", "--quiet"]);
        yield* fileSystem.writeFileString(`${destinationPath}/notes.md`, "work\n");
        yield* run(["add", "notes.md"]);
        yield* run(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
        yield* fileSystem.writeFileString(`${destinationPath}/draft.md`, "unsaved\n");
      }).pipe(Effect.provide(first.layer));

      const second = makeHarness({ baseDir });
      yield* Effect.gen(function* () {
        const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
        expect(yield* tracker.get(projectId)).toBeNull();
      }).pipe(Effect.provide(second.layer));
      expect(yield* fileSystem.readFileString(`${destinationPath}/draft.md`)).toBe("unsaved\n");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        GitVcsDriver.layer.pipe(
          Layer.provide(VcsProcess.layer),
          Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-clone-git-" })),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );

  it.effect("a deleted project's clone does not come back after a restart", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-clone-restart-" });
      const destinationPath = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-clone-restart-dest-",
      });
      const first = makeHarness({ baseDir, clone: () => Effect.never });
      yield* Effect.gen(function* () {
        const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
        yield* tracker.start({ ...startInput, destinationPath }, first.hooks);
        yield* tracker.discard(projectId);
      }).pipe(Effect.provide(first.layer));
      const second = makeHarness({ baseDir });
      yield* Effect.gen(function* () {
        const tracker = yield* ProjectCloneTracker.ProjectCloneTracker;
        expect(yield* tracker.get(projectId)).toBeNull();
      }).pipe(Effect.provide(second.layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("parseGitCloneProgressLine", () => {
  it("parses git's transfer counters and ignores other output", () => {
    expect(
      parseGitCloneProgressLine("Receiving objects:  45% (4500/10000), 12.30 MiB | 5.00 MiB/s"),
    ).toEqual({ stage: "receiving", percent: 45, detail: "12.30 MiB | 5.00 MiB/s" });
    expect(parseGitCloneProgressLine("Resolving deltas: 100% (700/700), done.")).toEqual({
      stage: "resolving",
      percent: 100,
      detail: null,
    });
    expect(parseGitCloneProgressLine("remote: Compressing objects:  12% (3/25)")).toEqual({
      stage: "counting",
      percent: 12,
      detail: null,
    });
    expect(parseGitCloneProgressLine("Updating files:  78% (2104/2700)")).toEqual({
      stage: "checkout",
      percent: 78,
      detail: null,
    });
    expect(parseGitCloneProgressLine("remote: Enumerating objects: 10, done.")).toEqual({
      stage: "counting",
      percent: null,
      detail: null,
    });
    expect(parseGitCloneProgressLine("Cloning into 't3code'...")).toBeNull();
    expect(parseGitCloneProgressLine("fatal: repository not found")).toBeNull();
  });
});
