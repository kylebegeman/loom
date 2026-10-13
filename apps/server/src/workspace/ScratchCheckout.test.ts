// fork: mini-native-retention
import * as NodeServices from "@effect/platform-node/NodeServices";
import { GitCommandError, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  archiveScratchCheckout,
  restoreScratchCheckout,
  scratchArchivePaths,
} from "./ScratchCheckout.ts";

const layer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "scratch-archive-" })),
  Layer.provideMerge(NodeServices.layer),
);
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const managed = yield* fs
    .makeTempDirectoryScoped()
    .pipe(Effect.flatMap((directory) => fs.realPath(directory)));
  const root = `${managed}/scratch`;
  const cwd = `${root}/test-thread`;
  yield* fs.makeDirectory(cwd, { recursive: true });
  const input = {
    scratchRoot: root,
    worktreePath: cwd,
    projectId: ProjectId.make("scratch"),
    threadId: ThreadId.make("thread-1"),
  };
  const command = (args: string[]) => git.execute({ operation: "scratch-test", cwd, args });
  return { fs, git, root, cwd, input, command };
});

describe("Scratch checkout archives", () => {
  it.live("restores local commits, all checkpoint refs and private repository metadata", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.command(["init", "-b", "main"]);
      yield* f.command(["config", "user.name", "Archive test"]);
      yield* f.command(["config", "user.email", "archive@example.test"]);
      yield* f.fs.writeFileString(`${f.cwd}/proof.txt`, "unpublished work\n");
      yield* f.command(["add", "."]);
      yield* f.command(["commit", "-m", "local only"]);
      const head = (yield* f.command(["rev-parse", "HEAD"])).stdout.trim();
      yield* f.command(["update-ref", "refs/t3/orchestration-v2/checkpoints/test/ordinal/1", head]);
      yield* f.command(["config", "local.private-setting", "keep locally"]);
      const archive = yield* archiveScratchCheckout(f.input);
      expect(archive.kind).toBe("git");
      const paths = scratchArchivePaths(f.input);
      expect(yield* f.fs.exists(`${paths.archive}/repository.bundle`)).toBe(true);
      yield* f.fs.remove(f.cwd, { recursive: true });
      expect(yield* restoreScratchCheckout(f.input)).toBe(true);
      expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("unpublished work\n");
      expect((yield* f.command(["rev-parse", "HEAD"])).stdout.trim()).toBe(head);
      expect(
        (yield* f.command([
          "rev-parse",
          "refs/t3/orchestration-v2/checkpoints/test/ordinal/1",
        ])).stdout.trim(),
      ).toBe(head);
      expect((yield* f.command(["config", "local.private-setting"])).stdout.trim()).toBe(
        "keep locally",
      );
      expect(yield* restoreScratchCheckout(f.input)).toBe(false);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
  it.live("keeps a non-Git Scratch folder containing user data", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.fs.writeFileString(`${f.cwd}/notes.txt`, "do not lose");
      const error = yield* archiveScratchCheckout(f.input).pipe(Effect.flip);
      expect(error.message).toContain("Non-Git");
      expect(yield* f.fs.readFileString(`${f.cwd}/notes.txt`)).toBe("do not lose");
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
  it.live("restores an empty released Scratch folder without inventing a Git repository", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect((yield* archiveScratchCheckout(f.input)).kind).toBe("empty");
      yield* f.fs.remove(f.cwd, { recursive: true });
      expect(yield* restoreScratchCheckout(f.input)).toBe(true);
      expect(yield* f.fs.readDirectory(f.cwd)).toEqual([]);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
  it.live("rejects a symlinked checkout and a linked worktree", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.command(["init", "-b", "main"]);
      yield* f.command([
        "-c",
        "user.name=Archive test",
        "-c",
        "user.email=archive@example.test",
        "commit",
        "--allow-empty",
        "-m",
        "initial",
      ]);
      const linked = `${f.root}/linked`;
      yield* f.command(["worktree", "add", "-b", "linked", linked]);
      expect(
        (yield* archiveScratchCheckout({ ...f.input, worktreePath: linked }).pipe(Effect.flip))
          .message,
      ).toContain("independent");
      const link = `${f.root}/alias`;
      yield* f.fs.symlink(f.cwd, link);
      expect(
        (yield* archiveScratchCheckout({ ...f.input, worktreePath: link }).pipe(Effect.flip))
          .message,
      ).toContain("canonical");
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
  it.live("does not restore a corrupt bundle or overwrite a recreated checkout", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.command(["init", "-b", "main"]);
      yield* f.command([
        "-c",
        "user.name=Archive test",
        "-c",
        "user.email=archive@example.test",
        "commit",
        "--allow-empty",
        "-m",
        "initial",
      ]);
      yield* archiveScratchCheckout(f.input);
      const bundle = `${scratchArchivePaths(f.input).archive}/repository.bundle`;
      yield* f.fs.writeFileString(bundle, "corrupt");
      yield* f.fs.remove(f.cwd, { recursive: true });
      const error = yield* restoreScratchCheckout(f.input).pipe(Effect.flip);
      expect(error.message).toContain("checksum");
      expect(yield* f.fs.exists(f.cwd)).toBe(false);
      yield* f.fs.makeDirectory(f.cwd);
      yield* f.fs.writeFileString(`${f.cwd}/new-data`, "keep");
      expect(yield* restoreScratchCheckout(f.input)).toBe(false);
      expect(yield* f.fs.readFileString(`${f.cwd}/new-data`)).toBe("keep");
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
  it.live("retains a same-filesystem Linux bind mount and escaped mountpoint", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const mounted = `${f.cwd}/mounted data`;
      yield* f.fs.makeDirectory(mounted);
      yield* f.fs.writeFileString(`${mounted}/outside-data`, "protected");
      const fakeMount = `24 1 0:1 / ${mounted.replaceAll(" ", "\\040")} rw - ext4 /dev/test rw\n`;
      const error = yield* archiveScratchCheckout(f.input).pipe(
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(FileSystem.FileSystem, {
          ...f.fs,
          readFileString: (file, encoding) =>
            file === "/proc/self/mountinfo"
              ? Effect.succeed(fakeMount)
              : f.fs.readFileString(file, encoding),
        }),
        Effect.flip,
      );
      expect(error.message).toContain("mounted filesystem");
      expect(yield* f.fs.readFileString(`${mounted}/outside-data`)).toBe("protected");
    }).pipe(Effect.provide(layer), Effect.scoped),
  );

  it.live("retains Scratch when its sibling archive parent is owned by another user", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const path = yield* Path.Path;
      const uid = yield* HostProcess.UserId;
      const parent = path.dirname(f.root);
      const error = yield* archiveScratchCheckout(f.input).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...f.fs,
          stat: (file) =>
            f.fs
              .stat(file)
              .pipe(
                Effect.map((info) =>
                  file === parent ? { ...info, uid: Option.some((uid ?? 0) + 1) } : info,
                ),
              ),
        }),
        Effect.flip,
      );
      expect(error.message).toContain("root ownership or filesystem changed");
      expect(yield* f.fs.exists(f.cwd)).toBe(true);
      expect(yield* f.fs.exists(scratchArchivePaths(f.input).archive)).toBe(false);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
  it.live("requires the process UID and retains foreign Git metadata", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const uid = yield* HostProcess.UserId;
      const error = yield* archiveScratchCheckout(f.input).pipe(
        Effect.provideService(HostProcess.UserId, (uid ?? 0) + 1),
        Effect.flip,
      );
      expect(error.message).toContain("not owned by this process");
      yield* f.command(["init", "-b", "main"]);
      yield* f.command([
        "-c",
        "user.name=Archive test",
        "-c",
        "user.email=archive@example.test",
        "commit",
        "--allow-empty",
        "-m",
        "initial",
      ]);
      const foreign = yield* archiveScratchCheckout(f.input).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...f.fs,
          stat: (file) =>
            f.fs
              .stat(file)
              .pipe(
                Effect.map((info) =>
                  file === `${f.cwd}/.git/config`
                    ? { ...info, uid: Option.some((uid ?? 0) + 1) }
                    : info,
                ),
              ),
        }),
        Effect.flip,
      );
      expect(foreign.message).toContain("ownership");
      expect(yield* f.fs.exists(`${f.cwd}/.git/config`)).toBe(true);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
  it.live("never replaces an unregistered directory at a recovery archive path", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const archive = scratchArchivePaths(f.input).archive;
      yield* f.fs.makeDirectory(archive, { recursive: true });
      yield* f.fs.writeFileString(`${archive}/unrelated-data`, "keep");
      const error = yield* archiveScratchCheckout(f.input).pipe(Effect.flip);
      expect(error.message).toContain("not owned by this thread");
      expect(yield* f.fs.readFileString(`${archive}/unrelated-data`)).toBe("keep");
      expect(yield* f.fs.exists(f.cwd)).toBe(true);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
  it.live("keeps unexpected Git cause details private in cleanup errors", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.command(["init", "-b", "main"]);
      yield* f.command([
        "-c",
        "user.name=Archive test",
        "-c",
        "user.email=archive@example.test",
        "commit",
        "--allow-empty",
        "-m",
        "initial",
      ]);
      const cause = new GitCommandError({
        operation: "fixture",
        command: "git",
        cwd: f.cwd,
        detail: "private-token-in-a-remote-url",
      });
      const error = yield* archiveScratchCheckout(f.input).pipe(
        Effect.provideService(GitVcsDriver.GitVcsDriver, {
          ...f.git,
          execute: () => Effect.fail(cause),
        }),
        Effect.flip,
      );
      expect(error.message).toBe("Scratch checkout recovery could not be completed safely.");
      expect(error.message).not.toContain("private-token");
      expect(error.cause).toBe(cause);
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
});
