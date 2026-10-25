// @effect-diagnostics nodeBuiltinImport:off - Fixtures exercise the filesystem deletion boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProcessRunner from "../../processRunner.ts";
import { LANE_TMP_MAX_AGE_MS, pruneLaneTmp } from "./tmpCleanup.ts";

it.effect("removes only old, closed entries in the lane tmp directory", () =>
  Effect.gen(function* () {
    const spacePath = yield* Effect.acquireRelease(
      Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "lane-tmp-test-"))),
      (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
    );
    const tmp = NodePath.join(spacePath, "tmp");
    yield* Effect.promise(async () => {
      await NodeFSP.mkdir(tmp);
      for (const name of ["old", "busy", "unknown", "checkout", "recent"])
        await NodeFSP.writeFile(NodePath.join(tmp, name), name);
      await NodeFSP.symlink(NodePath.join(tmp, "old"), NodePath.join(tmp, "link"));
      await NodeFSP.mkdir(NodePath.join(tmp, "changed"));
      await NodeFSP.writeFile(NodePath.join(tmp, "changed", "child"), "keep");
      await NodeFSP.mkdir(NodePath.join(spacePath, "build"));
      await NodeFSP.writeFile(NodePath.join(spacePath, "build", "keep"), "keep");
    });
    const stat = yield* Effect.promise(() => NodeFSP.stat(NodePath.join(tmp, "old")));
    const now = stat.ctimeMs + LANE_TMP_MAX_AGE_MS + 1000;
    yield* TestClock.setTime(now);
    yield* Effect.promise(() =>
      NodeFSP.utimes(NodePath.join(tmp, "recent"), now / 1000, now / 1000),
    );
    const removed = yield* pruneLaneTmp({
      spacePath,
      protectedPaths: [NodePath.join(tmp, "checkout")],
      lsofPath: "lsof",
    }).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, {
        run: ({ args }) =>
          Effect.promise(async () => {
            if (args.at(-1)?.endsWith("changed"))
              await NodeFSP.utimes(NodePath.join(tmp, "changed", "child"), now / 1000, now / 1000);
            return {
              code: ChildProcessSpawner.ExitCode(args.at(-1)?.endsWith("busy") ? 0 : 1),
              stdout: args.at(-1)?.endsWith("busy") ? "123\n" : "",
              stderr: args.at(-1)?.endsWith("unknown") ? "permission denied" : "",
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            };
          }),
      }),
    );
    expect(removed).toBe(1);
    expect((yield* Effect.promise(() => NodeFSP.readdir(tmp))).sort()).toEqual([
      "busy",
      "changed",
      "checkout",
      "link",
      "recent",
      "unknown",
    ]);
    expect(
      yield* Effect.promise(() =>
        NodeFSP.readFile(NodePath.join(spacePath, "build", "keep"), "utf8"),
      ),
    ).toBe("keep");
  }).pipe(Effect.scoped),
);
