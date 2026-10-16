import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ProjectId, type VcsStatusResult } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { describe, expect } from "vite-plus/test";
import * as ProcessRunner from "../../processRunner.ts";
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";
import { makeCopyHealthReader, toRepositoryHealth } from "./LibraryCopyHealth.ts";

const checkedAt = "2026-10-16T12:00:00.000Z";
const clean: VcsStatusResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: true,
  refName: "main",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};
const map = (status: Partial<VcsStatusResult>, extra: { upstream?: string | null } = {}) =>
  toRepositoryHealth({
    resourceId: "web",
    status: { ...clean, ...status },
    upstream: extra.upstream === undefined ? "origin/main" : extra.upstream,
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
    expect(map({ aheadCount: 2 })).toMatchObject({ upstream: "origin/main", ahead: 2, behind: 0 });
    expect(map({ behindCount: 3 })).toMatchObject({ upstream: "origin/main", ahead: 0, behind: 3 });
  });

  it("omits divergence without an upstream instead of reporting the default-branch fallback", () => {
    const health = map({ hasUpstream: false, aheadCount: 4 }, { upstream: null });
    expect(health.branch).toBe("main");
    expect(health.upstream).toBeUndefined();
    expect(health.ahead).toBeUndefined();
    expect(health.behind).toBeUndefined();
  });

  it("leaves the branch out on a detached head and keeps the commit", () => {
    const health = map({ refName: null, hasUpstream: false }, { upstream: null });
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

const vcsCalls: string[] = [];
const broadcaster = Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
  refreshLocalStatus: (cwd) =>
    Effect.sync(() => {
      vcsCalls.push(`local:${cwd}`);
      return clean;
    }),
  getStatus: (input, options) =>
    Effect.sync(() => {
      vcsCalls.push(`get:${input.cwd}:${String(options?.refreshUpstream)}`);
      return { ...clean, behindCount: 1 };
    }),
  refreshStatus: (cwd) =>
    Effect.sync(() => {
      vcsCalls.push(`fetch:${cwd}`);
      return { ...clean, behindCount: 5 };
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
      expect(web).toMatchObject({ resourceId: "web", branch: "main", behind: 1 });
      // Never fetched, so no fetch time is claimed.
      expect(web?.fetchedAt).toBeUndefined();
      expect(plain).toMatchObject({ resourceId: "plain", error: "not-a-repository" });
      expect(gone).toMatchObject({ resourceId: "gone", error: "missing" });
      expect(vcsCalls.filter((call) => call.includes(root))).toEqual([
        `local:${repo}`,
        `get:${repo}:false`,
      ]);
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
      expect(health.repositories[0]).toMatchObject({ behind: 5 });
      expect(health.repositories[0]?.fetchedAt).toEqual(expect.any(String));
      expect(vcsCalls.filter((call) => call.includes(root))).toEqual([`fetch:${repo}`]);
    }),
  );
});
