// @effect-diagnostics nodeBuiltinImport:off - Fingerprints changed files by their stat.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as ProcessRunner from "../../processRunner.ts";

/** Changed files fingerprinted at most; beyond it the tree simply reads as changed. */
const MAX_FINGERPRINT_FILES = 2_000;

/**
 * Paths in `git status --porcelain=v1 -z` output: modified, added, deleted and untracked
 * files, and the new path of a rename or copy.
 */
export const parsePorcelainPaths = (output: string): ReadonlyArray<string> => {
  const entries = output.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    // A rename or copy is followed by its original path.
    if (entry[0] === "R" || entry[0] === "C") i += 1;
  }
  return paths;
};

export const makeGit = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const git = (cwd: string, args: ReadonlyArray<string>) =>
    runner
      .run({
        command: "git",
        args,
        cwd,
        timeout: "15 seconds",
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 4 * 1024 * 1024,
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((output) =>
          !output.timedOut && output.code !== null && Number(output.code) === 0
            ? output.stdout
            : null,
        ),
        Effect.orElseSucceed(() => null),
      );

  /** Uncommitted and untracked files under `cwd`, relative to it, with the raw output. */
  const changes = (cwd: string) =>
    Effect.gen(function* () {
      const [out, prefix] = yield* Effect.all([
        git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]),
        git(cwd, ["rev-parse", "--show-prefix"]),
      ]);
      if (out === null) return null;
      // Porcelain paths are relative to the repository root, Graphify's to the folder it scanned.
      const base = prefix?.trim() ?? "";
      const paths = parsePorcelainPaths(out).flatMap((path) =>
        path.startsWith(base) ? [path.slice(base.length)] : [],
      );
      return { out, paths };
    });

  return {
    /** Null outside a repository or before the first commit. */
    head: (cwd: string) =>
      git(cwd, ["rev-parse", "HEAD"]).pipe(Effect.map((out) => out?.trim() || null)),

    changedFiles: (cwd: string) => changes(cwd).pipe(Effect.map((result) => result?.paths ?? [])),

    /**
     * Identifies the uncommitted state: "" for a clean tree, else a hash over the changed
     * paths and their size and modification time. Null when git cannot tell.
     */
    treeFingerprint: (cwd: string) =>
      Effect.gen(function* () {
        const result = yield* changes(cwd);
        if (result === null) return null;
        if (result.out === "") return "";
        const stats = yield* Effect.promise(() =>
          Promise.all(
            result.paths.slice(0, MAX_FINGERPRINT_FILES).map((path) =>
              NodeFSP.stat(NodePath.join(cwd, path)).then(
                (stat) => `${stat.size}:${stat.mtimeMs}`,
                () => "gone",
              ),
            ),
          ),
        );
        return NodeCrypto.createHash("sha256")
          .update(result.out)
          .update(stats.join("\0"))
          .digest("hex");
      }),
  };
});

export type Git = Effect.Success<typeof makeGit>;
