import * as Effect from "effect/Effect";

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
