import { describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { expect } from "vite-plus/test";
import * as ServerConfig from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as LibraryGitFetch from "./LibraryGitFetch.ts";

const testLayer = LibraryGitFetch.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "library-git-fetch-test-" })),
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provideMerge(NodeServices.layer),
);

const git = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const result = yield* runner.run({ command: "git", args, cwd, timeout: "1 minute" });
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.trim();
});

/** A bare upstream reached over `file://`, so git uses its real transport and prints progress. */
const makeRemote = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.realPath(
    yield* fs.makeTempDirectoryScoped({ prefix: "library-git-fetch-" }),
  );
  const work = path.join(root, "work");
  const bare = path.join(root, "remote.git");
  const commit = Effect.fnUntraced(function* (name: string) {
    yield* fs.writeFileString(path.join(work, name), `${name}\n`);
    yield* git(work, ["add", "."]);
    yield* git(work, ["-c", "commit.gpgsign=false", "commit", "-m", name]);
    return yield* git(work, ["rev-parse", "HEAD"]);
  });
  yield* fs.makeDirectory(work);
  yield* git(work, ["init", "--initial-branch=main"]);
  yield* git(work, ["config", "user.email", "test@example.com"]);
  yield* git(work, ["config", "user.name", "Test"]);
  yield* commit("README.md");
  yield* git(root, ["clone", "--bare", "--", work, bare]);
  yield* git(work, ["remote", "add", "origin", bare]);
  return {
    root,
    remoteUrl: `file://${bare}`,
    push: Effect.fnUntraced(function* (name: string) {
      const head = yield* commit(name);
      yield* git(work, ["push", "origin", "main"]);
      return head;
    }),
  };
});

const mirrorPath = Effect.fnUntraced(function* (remoteUrl: string) {
  const fetch = yield* LibraryGitFetch.LibraryGitFetch;
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  return path.join(config.baseDir, "git-mirrors", `${yield* fetch.mirrorKey(remoteUrl)}.git`);
});

const cloneInto = Effect.fnUntraced(function* (
  remoteUrl: string,
  target: string,
  options: {
    readonly branch?: string | null;
    readonly onProgress?: (progress: LibraryGitFetch.LibraryCloneProgress) => Effect.Effect<void>;
  } = {},
) {
  const fetch = yield* LibraryGitFetch.LibraryGitFetch;
  const result = yield* fetch.cloneRepository({
    remoteUrl,
    branch: options.branch === undefined ? "main" : options.branch,
    path: target,
    onProgress: options.onProgress,
  });
  expect(result.code, result.stderr).toBe(0);
  expect(result.timedOut).toBe(false);
});

describe("LibraryGitFetch", () => {
  it.live("creates the mirror on the first clone and keeps the real remote as origin", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const remote = yield* makeRemote();
      const target = path.join(remote.root, "copy");

      yield* cloneInto(remote.remoteUrl, target);

      const mirror = yield* mirrorPath(remote.remoteUrl);
      expect(yield* fs.exists(mirror)).toBe(true);
      expect(yield* git(mirror, ["rev-parse", "--is-bare-repository"])).toBe("true");
      expect(yield* git(target, ["remote", "get-url", "origin"])).toBe(remote.remoteUrl);
      expect(yield* git(target, ["branch", "--show-current"])).toBe("main");
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("brings later upstream commits into the next copy", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const remote = yield* makeRemote();
      yield* cloneInto(remote.remoteUrl, path.join(remote.root, "first"));
      const head = yield* remote.push("second.txt");

      const second = path.join(remote.root, "second");
      yield* cloneInto(remote.remoteUrl, second, { branch: null });

      expect(yield* git(second, ["rev-parse", "HEAD"])).toBe(head);
      expect(yield* git(second, ["branch", "--show-current"])).toBe("main");
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("hardlinks the mirror's packs without alternates or promisor packs", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const remote = yield* makeRemote();
      const target = path.join(remote.root, "copy");
      yield* cloneInto(remote.remoteUrl, target);

      const objects = path.join(target, ".git", "objects");
      expect(yield* fs.exists(path.join(objects, "info", "alternates"))).toBe(false);
      const packs = yield* fs.readDirectory(path.join(objects, "pack"));
      expect(packs.filter((name) => name.endsWith(".promisor"))).toEqual([]);
      const pack = packs.find((name) => name.endsWith(".pack"));
      expect(pack).toBeDefined();
      const copied = yield* fs.stat(path.join(objects, "pack", pack!));
      const mirrored = yield* fs.stat(
        path.join(yield* mirrorPath(remote.remoteUrl), "objects", "pack", pack!),
      );
      expect(copied.dev).toBe(mirrored.dev);
      expect(Option.getOrNull(copied.ino)).toBe(Option.getOrNull(mirrored.ino));
      expect(Option.getOrElse(copied.nlink, () => 0)).toBeGreaterThan(1);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("leaves a complete copy after its mirror is deleted", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const remote = yield* makeRemote();
      yield* remote.push("second.txt");
      const target = path.join(remote.root, "copy");
      yield* cloneInto(remote.remoteUrl, target);

      yield* fs.remove(yield* mirrorPath(remote.remoteUrl), { recursive: true });

      yield* git(target, ["fsck", "--full"]);
      expect(yield* fs.readFileString(path.join(target, "second.txt"))).toBe("second.txt\n");
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("reports rising progress within each stage", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const remote = yield* makeRemote();
      const updates: Array<LibraryGitFetch.LibraryCloneProgress> = [];

      yield* cloneInto(remote.remoteUrl, path.join(remote.root, "copy"), {
        onProgress: (progress) => Effect.sync(() => updates.push(progress)),
      });

      expect(updates.length).toBeGreaterThan(0);
      for (const stage of ["fetch", "checkout"] as const) {
        const percents = updates
          .filter((update) => update.stage === stage)
          .flatMap((update) => (update.percent === null ? [] : [update.percent]));
        expect(percents).toEqual(percents.toSorted((left, right) => left - right));
        for (const percent of percents) expect(percent).toBeLessThanOrEqual(100);
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("clones directly past a broken mirror and rebuilds it on the next clone", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const remote = yield* makeRemote();
      yield* cloneInto(remote.remoteUrl, path.join(remote.root, "first"));
      const mirror = yield* mirrorPath(remote.remoteUrl);
      yield* fs.remove(mirror, { recursive: true });
      yield* fs.makeDirectory(mirror);
      yield* fs.writeFileString(path.join(mirror, "HEAD"), "garbage\n");

      const reserved = path.join(remote.root, "reserved");
      yield* fs.makeDirectory(reserved);
      yield* cloneInto(remote.remoteUrl, reserved);

      expect(yield* git(reserved, ["remote", "get-url", "origin"])).toBe(remote.remoteUrl);
      expect(yield* fs.readFileString(path.join(reserved, "README.md"))).toBe("README.md\n");
      expect(yield* fs.exists(mirror)).toBe(false);

      yield* cloneInto(remote.remoteUrl, path.join(remote.root, "third"));
      expect(yield* git(mirror, ["rev-parse", "--is-bare-repository"])).toBe("true");
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("lists mirrors and removes only those unused since the cutoff", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fetch = yield* LibraryGitFetch.LibraryGitFetch;
      const remote = yield* makeRemote();
      yield* cloneInto(remote.remoteUrl, path.join(remote.root, "copy"));
      const key = yield* fetch.mirrorKey(remote.remoteUrl);

      const [mirror, ...others] = yield* fetch.mirrors;
      expect(others).toEqual([]);
      expect(mirror).toMatchObject({
        key,
        path: yield* mirrorPath(remote.remoteUrl),
        remoteUrl: remote.remoteUrl,
      });
      expect(mirror!.bytes).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(mirror!.lastUsedAt ?? ""))).toBe(false);

      expect(
        yield* fetch.removeMirror({ key, unusedSince: "2000-01-01T00:00:00.000Z" }),
      ).toBeNull();
      expect(yield* fs.exists(mirror!.path)).toBe(true);
      expect(
        (yield* Effect.flip(
          fetch.removeMirror({ key: "../git-mirrors", unusedSince: "2999-01-01T00:00:00.000Z" }),
        )).reason,
      ).toBe("invalid");

      expect(yield* fetch.removeMirror({ key, unusedSince: "2999-01-01T00:00:00.000Z" })).toBe(
        mirror!.bytes,
      );
      expect(yield* fs.exists(mirror!.path)).toBe(false);
      expect(yield* fetch.mirrors).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );
});
