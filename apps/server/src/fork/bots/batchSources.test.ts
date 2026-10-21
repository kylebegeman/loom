import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ServerConfig from "../../config.ts";
import { PullRequestService } from "../../pullRequest/PullRequestService.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";
import { BATCH_LABEL_MAX, cutLabel, makeBatchSources, splitLines } from "./batchSources.ts";

const layerGit = Layer.mergeAll(GitVcsDriver.layerVcs, GitVcsDriver.layer).pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-bot-batch-sources-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const projectId = ProjectId.make("project-a");

const sources = makeBatchSources.pipe(
  Effect.provideService(PullRequestService, {} as PullRequestService["Service"]),
  Effect.provideService(WorkspaceEntries, {} as WorkspaceEntries["Service"]),
);

/** A repository with tracked sources, an untracked file, and a merge stopped on two conflicts. */
const makeRepo = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-bot-batch-repo-" });
  const git = (...args: ReadonlyArray<string>) =>
    driver.execute({ operation: "test.git", cwd, args, timeoutMs: 10_000, allowNonZeroExit: true });
  const write = (file: string, text: string) =>
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(path.dirname(path.join(cwd, file)), { recursive: true });
      yield* fileSystem.writeFileString(path.join(cwd, file), text);
    });
  yield* git("init", "-q", "-b", "main");
  yield* git("config", "user.email", "test@test.com");
  yield* git("config", "user.name", "Test");
  yield* write("src/a.ts", "a\n");
  yield* write("src/nested/b.ts", "b\n");
  yield* write("src/c.md", "c\n");
  yield* git("add", ".");
  yield* git("commit", "-q", "-m", "base");
  yield* git("checkout", "-q", "-b", "other");
  yield* write("src/a.ts", "other\n");
  yield* write("src/c.md", "other\n");
  yield* git("commit", "-q", "-am", "other");
  yield* git("checkout", "-q", "main");
  yield* write("src/a.ts", "main\n");
  yield* write("src/c.md", "main\n");
  yield* git("commit", "-q", "-am", "main");
  yield* git("merge", "-q", "other");
  yield* write("src/untracked.ts", "u\n");
  return cwd;
});

describe("batch sources", () => {
  it("splits pasted lines, dropping blanks and exact duplicates", () => {
    expect(splitLines(" a.ts \r\n\nb.ts\na.ts\n")).toEqual(["a.ts", "b.ts"]);
    expect(cutLabel("x".repeat(BATCH_LABEL_MAX + 5))).toHaveLength(BATCH_LABEL_MAX);
  });

  it.effect("lists tracked files for a glob and the conflicted files of a merge", () =>
    Effect.gen(function* () {
      const cwd = yield* makeRepo;
      const { resolve } = yield* sources;
      const checkout = { projectId, cwd };

      const glob = yield* resolve({ type: "glob", pattern: "src/**/*.ts" }, checkout);
      expect(glob.items.map((item) => item.value)).toEqual(["src/a.ts", "src/nested/b.ts"]);
      expect(glob.summary).toBe("src/**/*.ts, 2 files");

      const conflicts = yield* resolve({ type: "conflicts" }, checkout);
      expect(conflicts.items.map((item) => item.value)).toEqual(["src/a.ts", "src/c.md"]);

      const none = yield* Effect.flip(resolve({ type: "glob", pattern: "lib/*.ts" }, checkout));
      expect(none.message).toBe("No tracked file matches lib/*.ts.");
      const magic = yield* Effect.flip(resolve({ type: "glob", pattern: ":(top)*" }, checkout));
      expect(magic.message).toMatch(/^Use a plain glob pattern/u);
      const noProject = yield* Effect.flip(resolve({ type: "conflicts" }, null));
      expect(noProject.message).toBe("Choose a project for a file source.");
    }).pipe(Effect.scoped, Effect.provide(layerGit)),
  );
});
