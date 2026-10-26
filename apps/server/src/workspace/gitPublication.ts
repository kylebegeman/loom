import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const lines = (output: string) => output.trim().split("\n").filter(Boolean);

/**
 * Whether deleting a repository loses nothing: every commit any ref, stash, note or reflog entry
 * reaches, and every tag, is on one of `remoteUrls`. Remote refs are fetched into a scratch
 * repository that borrows this one's objects, so the repository itself is only read and a
 * review of its files stays valid. `readGit` runs Git in the repository.
 */
export const proveRepositoryPublication = Effect.fn("Workspace.proveRepositoryPublication")(
  function* <E, R>(
    readGit: (args: ReadonlyArray<string>) => Effect.Effect<string, E, R>,
    remoteUrls: ReadonlyArray<string>,
  ) {
    if (remoteUrls.length === 0)
      return { published: false as const, reason: "no publication remote" };
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "loom-publication-" });
        const objects = (yield* readGit([
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "objects",
        ])).trim();
        yield* readGit(["init", "--bare", "--quiet", scratch]);
        yield* fs.writeFileString(
          path.join(scratch, "objects", "info", "alternates"),
          `${objects}\n`,
        );
        const inScratch = (args: ReadonlyArray<string>) =>
          readGit([`--git-dir=${scratch}`, ...args]);
        for (const [index, remoteUrl] of remoteUrls.entries())
          yield* inScratch([
            "fetch",
            "--no-tags",
            "--no-write-fetch-head",
            "--no-auto-maintenance",
            "--quiet",
            "--",
            remoteUrl,
            `+refs/heads/*:refs/publication/${index}/heads/*`,
            `+refs/tags/*:refs/publication/${index}/tags/*`,
          ]);
        const publishedObjects = new Set(
          lines(yield* inScratch(["for-each-ref", "--format=%(objectname)", "refs/publication/"])),
        );
        if (publishedObjects.size === 0)
          return { published: false as const, reason: "no published revisions" };
        // Loom's own checkpoint refs record states of these files, not work of their own.
        const local = lines(yield* readGit(["for-each-ref", "--format=%(objectname) %(refname)"]))
          .map((line) => line.split(" "))
          .filter(([, name]) => !name?.startsWith("refs/t3/"));
        if (
          local.some(([sha, name]) => name?.startsWith("refs/tags/") && !publishedObjects.has(sha!))
        )
          return { published: false as const, reason: "local tags have unpublished revisions" };
        const tips = lines(
          yield* readGit([
            "rev-list",
            "--no-walk",
            "--exclude=refs/t3/*",
            "--all",
            "--reflog",
            "HEAD",
          ]),
        );
        const unpublished = (yield* inScratch([
          "rev-list",
          "--max-count=1",
          ...new Set(tips),
          "--not",
          ...publishedObjects,
        ])).trim();
        if (unpublished !== "")
          return {
            published: false as const,
            reason: "branches, stashes or earlier revisions have unpublished commits",
          };
        const head = (yield* readGit(["rev-parse", "--verify", "HEAD^{commit}"])).trim();
        return { published: true as const, head };
      }),
    );
  },
);

export const proveGitPublication = Effect.fn("Workspace.proveGitPublication")(function* <E, R>(
  readGit: (args: string[]) => Effect.Effect<string, E, R>,
) {
  const remotes = (yield* readGit(["remote"])).trim().split("\n").filter(Boolean);
  if (remotes.length === 0) return { published: false as const, reason: "no publication remote" };
  // Tracking refs can be stale, and custom fetch mappings can omit published branches.
  // Limit the proof to namespaces refreshed by this check, including pruning deletions.
  for (const [index, remote] of remotes.entries())
    yield* readGit([
      "fetch",
      "--prune",
      "--no-tags",
      // Rechecks must not invalidate the reviewed archive or overwrite the user's fetch state.
      "--no-write-fetch-head",
      "--no-auto-maintenance",
      "--",
      remote,
      `+refs/heads/*:refs/t3/publication/${index}/heads/*`,
      `+refs/tags/*:refs/t3/publication/${index}/tags/*`,
    ]);
  const local = (yield* readGit([
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    "refs/heads",
    "refs/tags",
  ]))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" "));
  const published = yield* readGit([
    "for-each-ref",
    "--format=%(objectname)",
    ...remotes.map((_, index) => `refs/t3/publication/${index}/`),
  ]);
  const publishedObjects = new Set(published.trim().split("\n").filter(Boolean));
  if (publishedObjects.size === 0)
    return { published: false as const, reason: "no published revisions" };
  if (local.some(([name, sha]) => name?.startsWith("refs/tags/") && !publishedObjects.has(sha!)))
    return { published: false as const, reason: "local tags have unpublished revisions" };
  const head = (yield* readGit(["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  const localHeads = local
    .filter(([name]) => name?.startsWith("refs/heads/"))
    .map(([, sha]) => sha!);
  // Remote tips may have advanced. Reachability still proves older local commits published.
  const unpublished = (yield* readGit([
    "rev-list",
    "--max-count=1",
    ...new Set([head, ...localHeads]),
    "--not",
    ...publishedObjects,
  ])).trim();
  if (unpublished !== "")
    return {
      published: false as const,
      reason: "local branches or current revision have unpublished commits",
    };
  return { published: true as const, head };
});
