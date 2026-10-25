// @effect-diagnostics nodeBuiltinImport:off - Cleanup needs lstat identities and never follows links.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as ProcessRunner from "../../processRunner.ts";

const MAX_ENTRIES = 100_000;
export const LANE_TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const contains = (parent: string, child: string) => {
  const relative = NodePath.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative))
  );
};

/** A failed age, identity or open-file probe always preserves the entry. */
export const pruneLaneTmp = Effect.fn("ProjectLifecycle.pruneLaneTmp")(function* (input: {
  readonly spacePath: string;
  readonly protectedPaths: ReadonlyArray<string>;
  readonly lsofPath: string;
}) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const now = yield* Clock.currentTimeMillis;
  const root = NodePath.join(input.spacePath, "tmp");
  const candidates = yield* Effect.tryPromise(async () => {
    const rootStat = await NodeFSP.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return [];
    const realRoot = await NodeFSP.realpath(root);
    const protectedPaths = await Promise.all(
      input.protectedPaths.map(async (path) => [
        path,
        await NodeFSP.realpath(path).catch(() => path),
      ]),
    );
    let visited = 0;
    const old = async (path: string): Promise<boolean> => {
      if (++visited > MAX_ENTRIES) return false;
      const stat = await NodeFSP.lstat(path);
      if (
        stat.isSymbolicLink() ||
        stat.dev !== rootStat.dev ||
        Math.max(stat.mtimeMs, stat.ctimeMs, stat.isDirectory() ? 0 : stat.atimeMs) >
          now - LANE_TMP_MAX_AGE_MS
      )
        return false;
      if (!stat.isDirectory()) return stat.isFile();
      for (const child of await NodeFSP.readdir(path)) {
        if (!(await old(NodePath.join(path, child)))) return false;
      }
      return true;
    };
    const entries = [];
    for (const name of await NodeFSP.readdir(root)) {
      const path = NodePath.join(root, name);
      const real = NodePath.join(realRoot, name);
      if (
        protectedPaths
          .flat()
          .some((checkout) =>
            [path, real].some((alias) => contains(alias, checkout) || contains(checkout, alias)),
          )
      )
        continue;
      if (!(await old(path))) continue;
      const stat = await NodeFSP.lstat(path);
      entries.push({ path, stat, stillOld: () => old(path) });
    }
    return entries;
  }).pipe(Effect.orElseSucceed(() => []));
  let removed = 0;
  for (const { path, stat, stillOld } of candidates) {
    const probe = yield* runner
      .run({
        command: input.lsofPath,
        args: ["-nP", "-t", ...(stat.isDirectory() ? ["+D", path] : ["--", path])],
        timeout: "10 seconds",
        maxOutputBytes: 64 * 1024,
      })
      .pipe(Effect.option);
    if (
      probe._tag === "None" ||
      probe.value.code !== 1 ||
      probe.value.stdout.trim() ||
      probe.value.stderr.trim() ||
      probe.value.timedOut ||
      probe.value.stdoutTruncated ||
      probe.value.stderrTruncated
    )
      continue;
    const deleted = yield* Effect.tryPromise(async () => {
      const current = await NodeFSP.lstat(path);
      if (
        current.ino !== stat.ino ||
        current.dev !== stat.dev ||
        current.mtimeMs !== stat.mtimeMs ||
        current.ctimeMs !== stat.ctimeMs
      )
        return false;
      // A writer can change a descendant without updating the top directory timestamp.
      if (!(await stillOld())) return false;
      await NodeFSP.rm(path, { recursive: true });
      return true;
    }).pipe(Effect.orElseSucceed(() => false));
    if (deleted) removed++;
  }
  return removed;
});
