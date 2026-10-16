import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  ProjectId,
  type VcsStatusLocalResult,
  type VcsStatusResult,
} from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { describe, expect } from "vite-plus/test";
import * as ProcessRunner from "../../processRunner.ts";
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";
import {
  makeCopyHealthReader,
  parseDivergence,
  parseUpstreamTracking,
  toRepositoryHealth,
  type UpstreamTracking,
} from "./LibraryCopyHealth.ts";

const checkedAt = "2026-10-16T12:00:00.000Z";
const clean: VcsStatusLocalResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: true,
  refName: "main",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};
const tracked: UpstreamTracking = { name: "origin/main", gone: false };
const map = (
  status: Partial<VcsStatusLocalResult>,
  extra: {
    upstream?: UpstreamTracking | null;
    divergence?: readonly [number, number] | null;
  } = {},
) =>
  toRepositoryHealth({
    resourceId: "web",
    status: { ...clean, ...status },
    upstream: extra.upstream === undefined ? tracked : extra.upstream,
    divergence: extra.divergence === undefined ? [0, 0] : extra.divergence,
    head: "0123456789abcdef0123456789abcdef01234567",
    unpushedCommits: 0,
    checkedAt,
    fetchedAt: null,
  });

describe("toRepositoryHealth", () => {
  it("counts uncommitted files, including untracked ones reported by status", () => {
    const health = map({
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [
          { path: "src/a.ts", insertions: 2, deletions: 1 },
          { path: "new.txt", insertions: 1, deletions: 0 },
        ],
        insertions: 3,
        deletions: 1,
      },
    });
    expect(health).toMatchObject({ branch: "main", uncommittedFiles: 2, ahead: 0, behind: 0 });
    expect(health.error).toBeUndefined();
  });

  it("reports ahead and behind against the upstream", () => {
    expect(map({}, { divergence: [2, 0] })).toMatchObject({
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
    });
    expect(map({}, { divergence: [0, 3] })).toMatchObject({ ahead: 0, behind: 3 });
  });

  it("omits divergence without an upstream", () => {
    const health = map({}, { upstream: null, divergence: null });
    expect(health.branch).toBe("main");
    expect(health.upstream).toBeUndefined();
    expect(health.ahead).toBeUndefined();
    expect(health.behind).toBeUndefined();
  });

  it("marks a gone upstream and counts nothing against it", () => {
    const health = map({}, { upstream: { name: "origin/feature", gone: true }, divergence: null });
    expect(health).toMatchObject({ upstream: "origin/feature", upstreamGone: true });
    expect(health.ahead).toBeUndefined();
    expect(health.behind).toBeUndefined();
  });

  it("leaves the branch out on a detached head and keeps the commit", () => {
    const health = map({ refName: null }, { upstream: null, divergence: null });
    expect(health.branch).toBeUndefined();
    expect(health.head).toBe("0123456789abcdef0123456789abcdef01234567");
  });

  it("reports a folder that is not a repository", () => {
    expect(map({ isRepo: false })).toEqual({
      resourceId: "web",
      uncommittedFiles: 0,
      unpushedCommits: 0,
      checkedAt,
      error: "not-a-repository",
    });
  });
});

describe("parseUpstreamTracking", () => {
  it("reads the upstream name and whether it is gone", () => {
    expect(parseUpstreamTracking("origin/main\tbehind 2")).toEqual({
      name: "origin/main",
      gone: false,
    });
    expect(parseUpstreamTracking("origin/main")).toEqual({ name: "origin/main", gone: false });
    expect(parseUpstreamTracking("origin/feature\tgone")).toEqual({
      name: "origin/feature",
      gone: true,
    });
    expect(parseUpstreamTracking(null)).toBeNull();
  });
});

describe("parseDivergence", () => {
  it("reads ahead and behind, and nothing without an upstream", () => {
    expect(parseDivergence("2\t5")).toEqual([2, 5]);
    expect(parseDivergence(null)).toBeNull();
    expect(parseDivergence("fatal: no upstream")).toBeNull();
  });
});

const vcsCalls: string[] = [];
const broadcaster = Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
  refreshLocalStatus: (cwd) =>
    Effect.sync(() => {
      vcsCalls.push(`local:${cwd}`);
      return clean;
    }),
  refreshStatus: (cwd) =>
    Effect.sync((): VcsStatusResult => {
      vcsCalls.push(`fetch:${cwd}`);
      return { ...clean, hasUpstream: true, aheadCount: 0, behindCount: 5, pr: null };
    }),
});
const layer = Layer.mergeAll(broadcaster, ProcessRunner.layer).pipe(
  Layer.provideMerge(NodeServices.layer),
);

const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  const result = yield* (yield* ProcessRunner.ProcessRunner).run({ command: "git", args, cwd });
  expect(result.code, result.stderr).toBe(0);
});

const copyWith = (root: string, names: ReadonlyArray<string>): LibraryWorkingCopy => ({
  id: "copy-health",
  projectId: "project-health",
  projectRevision: 1,
  environmentId: EnvironmentId.make("health-host"),
  rootPath: root,
  repositories: names.map((name) => ({
    resourceId: name,
    path: `${root}/${name}`,
    localProjectId: ProjectId.make(`local-${name}`),
    head: null,
    branch: null,
  })),
  ownership: "borrowed",
  state: "ready",
  createdAt: checkedAt,
  updatedAt: checkedAt,
});

it.layer(layer)("makeCopyHealthReader", (it) => {
  it.effect("reads missing and non-repository folders without failing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "copy-health-" }),
      );
      const repo = path.join(root, "web");
      yield* fs.makeDirectory(repo);
      yield* git(repo, ["init", "--initial-branch=main"]);
      yield* fs.makeDirectory(path.join(root, "plain"));
      const read = yield* makeCopyHealthReader;
      const health = yield* read(copyWith(root, ["web", "plain", "gone"]));
      expect(health.copyId).toBe("copy-health");
      const [web, plain, gone] = health.repositories;
      expect(web).toMatchObject({ resourceId: "web", branch: "main" });
      expect(web?.upstream).toBeUndefined();
      // Never fetched, so no fetch time is claimed.
      expect(web?.fetchedAt).toBeUndefined();
      expect(plain).toMatchObject({ resourceId: "plain", error: "not-a-repository" });
      expect(gone).toMatchObject({ resourceId: "gone", error: "missing" });
      expect(vcsCalls.filter((call) => call.includes(root))).toEqual([`local:${repo}`]);
    }),
  );

  it.effect("counts against the upstream ref, so a pull shows at once", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "copy-health-" }),
      );
      const origin = path.join(root, "origin");
      const repo = path.join(root, "web");
      yield* fs.makeDirectory(origin);
      yield* git(origin, ["init", "--initial-branch=main"]);
      const commit = (cwd: string, message: string) =>
        git(cwd, [
          "-c",
          "user.email=test@example.com",
          "-c",
          "user.name=Test",
          "commit",
          "--allow-empty",
          "-m",
          message,
        ]);
      yield* commit(origin, "one");
      yield* git(root, ["clone", "--quiet", origin, repo]);
      yield* commit(origin, "two");
      yield* git(repo, ["fetch", "--quiet"]);
      const read = yield* makeCopyHealthReader;
      const before = yield* read(copyWith(root, ["web"]));
      expect(before.repositories[0]).toMatchObject({
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 1,
      });
      expect(before.repositories[0]?.fetchedAt).toEqual(expect.any(String));
      yield* git(repo, ["pull", "--quiet", "--ff-only"]);
      const after = yield* read(copyWith(root, ["web"]));
      expect(after.repositories[0]).toMatchObject({ ahead: 0, behind: 0 });

      // A branch deleted on its remote keeps its upstream name but has nothing to count against.
      yield* git(repo, ["push", "--quiet", "-u", "origin", "main:feature"]);
      yield* git(origin, ["branch", "-D", "feature"]);
      yield* git(repo, ["fetch", "--quiet", "--prune"]);
      const gone = yield* read(copyWith(root, ["web"]));
      expect(gone.repositories[0]).toMatchObject({
        branch: "main",
        upstream: "origin/feature",
        upstreamGone: true,
      });
      expect(gone.repositories[0]?.behind).toBeUndefined();
    }),
  );

  it.effect("fetches only when asked", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "copy-health-" }),
      );
      const repo = path.join(root, "web");
      yield* fs.makeDirectory(repo);
      yield* git(repo, ["init", "--initial-branch=main"]);
      // The mocked broadcaster does not fetch, so stand in for the FETCH_HEAD a real fetch writes.
      yield* fs.writeFileString(path.join(repo, ".git", "FETCH_HEAD"), "");
      const read = yield* makeCopyHealthReader;
      const health = yield* read(copyWith(root, ["web"]), { refreshRemote: true });
      expect(health.repositories[0]?.fetchedAt).toEqual(expect.any(String));
      expect(vcsCalls.filter((call) => call.includes(root))).toEqual([`fetch:${repo}`]);
    }),
  );
});
