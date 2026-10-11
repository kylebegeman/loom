import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ModelPreviewError } from "@t3tools/contracts/fork";
import * as ProcessRunner from "../../../processRunner.ts";
import { isContained } from "../signedFiles.ts";
import { parseLsTree, safeRepoPath, type TreeEntry } from "./helpers.ts";

const failure = () =>
  new ModelPreviewError({ reason: "command-failed", message: "Git could not read this version." });
export const unavailable = () =>
  new ModelPreviewError({
    reason: "not-found",
    message: "This version is no longer available. The thread was rolled back.",
  });
export const makeHistoryGit = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const prefixes = new Map<string, string | null>();
  const roots = new Map<string, string>();
  const run = (
    root: string,
    args: ReadonlyArray<string>,
    options: { stdin?: string; env?: NodeJS.ProcessEnv } = {},
  ) =>
    runner
      .run({
        command: "git",
        args,
        cwd: root,
        timeout: "30 seconds",
        outputMode: "truncate",
        maxOutputBytes: 4 * 1024 * 1024,
        env: { GIT_LITERAL_PATHSPECS: "1", GIT_LFS_SKIP_SMUDGE: "1", ...options.env },
        extendEnv: true,
        ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      })
      .pipe(Effect.mapError(failure));
  const checked = Effect.fn("ModelHistory.git")(function* (
    root: string,
    args: ReadonlyArray<string>,
    options: { stdin?: string; env?: NodeJS.ProcessEnv } = {},
  ) {
    const result = yield* run(root, args, options);
    if (
      result.code !== 0 ||
      result.timedOut ||
      result.stdoutTruncated ||
      result.stderrTruncated ||
      result.stdoutInvalidUtf8
    )
      return yield* failure();
    return result.stdout;
  });
  const repoPrefix = Effect.fn("ModelHistory.repoPrefix")(function* (root: string) {
    if (prefixes.has(root)) return prefixes.get(root)!;
    const result = yield* run(root, ["rev-parse", "--show-prefix"]);
    const prefix = result.code === 0 && !result.stdoutTruncated ? result.stdout.trimEnd() : null;
    prefixes.set(root, prefix);
    return prefix;
  });
  const repoRoot = Effect.fn("ModelHistory.repoRoot")(function* (root: string) {
    if (roots.has(root)) return roots.get(root)!;
    const value = (yield* checked(root, ["rev-parse", "--show-toplevel"])).trimEnd();
    roots.set(root, value);
    return value;
  });
  const treeOid = Effect.fn("ModelHistory.treeOid")(function* (root: string, ref: string) {
    const result = yield* run(root, ["rev-parse", "--verify", "--quiet", `${ref}^{tree}`]);
    if (result.code === 1) return yield* unavailable();
    if (
      result.code !== 0 ||
      result.stdoutTruncated ||
      result.timedOut ||
      !/^[0-9a-f]{40,64}\s*$/.test(result.stdout)
    )
      return yield* failure();
    return result.stdout.trim();
  });
  const treeOids = Effect.fn("ModelHistory.treeOids")(function* (
    root: string,
    refs: ReadonlyArray<string>,
  ) {
    if (refs.length === 0) return new Map<string, string>();
    const result = yield* run(root, ["rev-parse", ...refs.map((ref) => `${ref}^{tree}`)]);
    const lines = result.stdout.trim().split("\n");
    if (
      result.code === 0 &&
      !result.stdoutTruncated &&
      lines.length === refs.length &&
      lines.every((line) => /^[0-9a-f]{40,64}$/.test(line))
    )
      return new Map(refs.map((ref, i) => [ref, lines[i]!]));
    const individual = yield* Effect.forEach(
      refs,
      (ref) =>
        treeOid(root, ref).pipe(
          Effect.map((oid) => [ref, oid] as const),
          Effect.catchTags({
            ModelPreviewError: (error) =>
              error.reason === "not-found" ? Effect.succeed(null) : Effect.fail(error),
          }),
        ),
      { concurrency: 4 },
    );
    return new Map(individual.filter((entry) => entry !== null));
  });
  const lsTree = Effect.fn("ModelHistory.lsTree")(function* (
    root: string,
    ref: string,
    paths: ReadonlyArray<string>,
    options: { recursive?: boolean } = {},
  ) {
    if (paths.length === 0) return [];
    if (paths.some((value) => !safeRepoPath(value)))
      return yield* new ModelPreviewError({
        reason: "invalid-path",
        message: "Choose files inside the workspace.",
      });
    const output = yield* checked(root, [
      "ls-tree",
      "-z",
      "-l",
      "--full-name",
      ...(options.recursive ? ["-r"] : []),
      ref,
      "--",
      ...paths,
    ]);
    return parseLsTree(output);
  });
  const materialize = Effect.fn("ModelHistory.materializeGit")(function* (
    root: string,
    ref: string,
    entries: ReadonlyArray<TreeEntry>,
    treeFiles: string,
  ) {
    const top = yield* repoRoot(root);
    const index = path.join(path.dirname(treeFiles), "index");
    const env = { GIT_INDEX_FILE: index, GIT_ATTR_SOURCE: ref };
    yield* fs.makeDirectory(treeFiles, { recursive: true });
    if (!(yield* fs.exists(index))) yield* checked(top, ["read-tree", "--empty"], { env });
    if (entries.length === 0) return;
    yield* checked(top, ["update-index", "-z", "--index-info"], {
      env,
      stdin: entries.map((entry) => `${entry.mode} ${entry.oid}\t${entry.path}\0`).join(""),
    });
    yield* checked(
      top,
      ["checkout-index", "--all", "--force", `--prefix=${treeFiles}${path.sep}`],
      { env },
    );
  });
  const hashObjects = Effect.fn("ModelHistory.hashObjects")(function* (
    root: string,
    paths: ReadonlyArray<string>,
  ) {
    const prefix = yield* repoPrefix(root);
    const present = yield* Effect.filter(paths, (relative) =>
      Effect.gen(function* () {
        if (!safeRepoPath(relative)) return false;
        const absolute = path.resolve(root, relative);
        const real = yield* fs.realPath(absolute).pipe(Effect.orElseSucceed(() => null));
        if (real === null || !isContained(root, real)) return false;
        const info = yield* fs.stat(real);
        return info.type === "File";
      }),
    );
    if (present.length === 0) return new Map<string, string>();
    const output = yield* checked(root, ["hash-object", "--", ...present]);
    const oids = output.trim().split("\n");
    if (oids.length !== present.length || oids.some((oid) => !/^[0-9a-f]{40,64}$/.test(oid)))
      return yield* failure();
    return new Map(present.map((relative, i) => [`${prefix ?? ""}${relative}`, oids[i]!]));
  });
  return { repoPrefix, repoRoot, treeOid, treeOids, lsTree, materialize, hashObjects };
});
export type HistoryGit = Effect.Success<typeof makeHistoryGit>;
