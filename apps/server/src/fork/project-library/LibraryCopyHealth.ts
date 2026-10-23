import type { VcsStatusLocalResult } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryRepositoryHealth,
  LibraryRepositoryHealthError,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ProcessRunner from "../../processRunner.ts";
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";

const HEALTH_CONCURRENCY = 4;
// The status fetch skips a remote it fetched in the last 15 seconds
// (`STATUS_UPSTREAM_REFRESH_INTERVAL`), so a requested check counts a fetch this recent as its own.
const FRESH_FETCH_MS = 30_000;

/**
 * Whether a requested remote check failed to fetch: the repository has an upstream, but its
 * remotes were last fetched before the check could have. The status refresh swallows fetch
 * errors, so FETCH_HEAD's age is the only sign.
 */
export const remoteCheckFailed = (
  upstream: UpstreamTracking | null,
  fetchedAt: string | null,
  checkedAt: string,
) =>
  upstream !== null &&
  (fetchedAt === null || Date.parse(checkedAt) - Date.parse(fetchedAt) > FRESH_FETCH_MS);

/** A repository whose health could not be read, with honest zero counts. */
export const unreadableRepositoryHealth = (
  resourceId: string,
  error: LibraryRepositoryHealthError,
  checkedAt: string,
): LibraryRepositoryHealth => ({
  resourceId,
  uncommittedFiles: 0,
  unpushedCommits: 0,
  checkedAt,
  error,
});

/** The branch's configured upstream. `gone` means it was deleted on its remote. */
export interface UpstreamTracking {
  readonly name: string;
  readonly gone: boolean;
}

/**
 * Maps a repository's local VCS status to Library health. Git decides the upstream and the
 * counts: VCS status measures `aheadCount` against the default branch without an upstream, and
 * a gone upstream has nothing to count against, so neither reports ahead and behind.
 */
export const toRepositoryHealth = (input: {
  readonly resourceId: string;
  readonly status: VcsStatusLocalResult;
  readonly upstream: UpstreamTracking | null;
  readonly divergence: readonly [ahead: number, behind: number] | null;
  readonly head: string | null;
  /** Commits since the head last reported, when that head is still an ancestor of this one. */
  readonly commitsSince?: LibraryRepositoryHealth["commitsSince"] | null;
  /** Null when the count failed. With commits to count, that is unreadable, never zero. */
  readonly unpushedCommits: number | null;
  readonly checkedAt: string;
  readonly fetchedAt: string | null;
  readonly fetchFailed?: boolean;
}): LibraryRepositoryHealth => {
  if (!input.status.isRepo)
    return unreadableRepositoryHealth(input.resourceId, "not-a-repository", input.checkedAt);
  // Tidy and launch ranking trust these counts. A failed query against an existing upstream
  // must not make an unreadable repository look clean or up to date.
  if (
    (input.head && input.unpushedCommits === null) ||
    (input.upstream !== null && !input.upstream.gone && input.divergence === null)
  )
    return unreadableRepositoryHealth(input.resourceId, "unreadable", input.checkedAt);
  const { status, upstream, divergence } = input;
  return {
    resourceId: input.resourceId,
    ...(status.refName ? { branch: status.refName } : {}),
    ...(input.head ? { head: input.head } : {}),
    ...(input.head && input.commitsSince ? { commitsSince: input.commitsSince } : {}),
    ...(upstream?.gone
      ? { upstream: upstream.name, upstreamGone: true }
      : upstream
        ? {
            upstream: upstream.name,
            ...(divergence ? { ahead: divergence[0], behind: divergence[1] } : {}),
          }
        : {}),
    uncommittedFiles: status.workingTree.files.length,
    unpushedCommits: input.unpushedCommits ?? 0,
    checkedAt: input.checkedAt,
    ...(input.fetchedAt ? { fetchedAt: input.fetchedAt } : {}),
    ...(input.fetchFailed ? { fetchFailed: true } : {}),
  };
};

/** Parses `for-each-ref --format=%(upstream:short)%09%(upstream:track,nobracket)` output. */
export const parseUpstreamTracking = (output: string | null): UpstreamTracking | null => {
  const [name, track] = (output ?? "").split("\t");
  return name ? { name, gone: track?.trim() === "gone" } : null;
};

/** Parses `git rev-list --left-right --count A...B` output into [ahead, behind]. */
export const parseDivergence = (output: string | null): readonly [number, number] | null => {
  const match = output?.match(/^(\d+)\s+(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
};

const COMMIT_ID = /^[0-9a-f]{40,64}$/;

/** Reads live health for a copy's repositories on this computer. Never fails. */
export const makeCopyHealthReader = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const git = (cwd: string, args: ReadonlyArray<string>) =>
    runner
      .run({ command: "git", args, cwd, timeout: "30 seconds", maxOutputBytes: 64 * 1024 })
      .pipe(
        Effect.map((result) => (result.code === 0 ? result.stdout.trim() || null : null)),
        Effect.orElseSucceed(() => null),
      );

  // Untraced: commitsSince and lastFetchedAt only run inside readRepository, whose span covers them.
  // Counted only when the earlier head is an ancestor. After a force push, a rebase or a branch
  // switch the range means nothing, so the report says the head moved without a count.
  const commitsSince = Effect.fnUntraced(function* (cwd: string, since: string) {
    if (!COMMIT_ID.test(since)) return null;
    const ancestor = yield* runner
      .run({
        command: "git",
        args: ["merge-base", "--is-ancestor", since, "HEAD"],
        cwd,
        timeout: "30 seconds",
        maxOutputBytes: 1024,
      })
      .pipe(
        Effect.map((result) => result.code === 0),
        Effect.orElseSucceed(() => false),
      );
    if (!ancestor) return null;
    const count = Number.parseInt(
      (yield* git(cwd, ["rev-list", "--count", `${since}..HEAD`])) ?? "",
      10,
    );
    return Number.isFinite(count) ? { head: since, count } : null;
  });

  const modifiedAt = (file: string) =>
    fs.stat(file).pipe(
      Effect.map((info) => Option.getOrNull(info.mtime)?.getTime() ?? null),
      Effect.orElseSucceed(() => null),
    );
  // FETCH_HEAD is rewritten on every fetch, so its mtime is the last time remotes were read. A
  // linked worktree has two: its own, from a `git fetch` run there, and the shared one the
  // status fetch writes through `--git-dir`. The newer one counts.
  const lastFetchedAt = Effect.fnUntraced(
    function* (cwd: string) {
      const [own, common] = yield* Effect.all([
        git(cwd, ["rev-parse", "--git-path", "FETCH_HEAD"]),
        git(cwd, ["rev-parse", "--git-common-dir"]),
      ]);
      const times = yield* Effect.all([
        own === null ? Effect.succeed(null) : modifiedAt(path.resolve(cwd, own)),
        common === null
          ? Effect.succeed(null)
          : modifiedAt(path.resolve(cwd, common, "FETCH_HEAD")),
      ]);
      const latest = Math.max(...times.map((time) => time ?? -Infinity));
      return Number.isFinite(latest) ? DateTime.formatIso(DateTime.makeUnsafe(latest)) : null;
    },
    Effect.orElseSucceed(() => null),
  );

  const readRepository = Effect.fn("LibraryCopyHealth.readRepository")(function* (
    repository: LibraryWorkingCopy["repositories"][number],
    refreshRemote: boolean,
    since: string | undefined,
  ) {
    if (!(yield* fs.exists(repository.path).pipe(Effect.orElseSucceed(() => false))))
      return unreadableRepositoryHealth(repository.resourceId, "missing", yield* now);
    // The copy root can be a Git repository itself, so a folder without its own .git would
    // otherwise report the root's status.
    if (
      !(yield* fs
        .exists(path.join(repository.path, ".git"))
        .pipe(Effect.orElseSucceed(() => false)))
    )
      return unreadableRepositoryHealth(repository.resourceId, "not-a-repository", yield* now);
    // Only a requested refresh fetches. A plain read leaves the shared status cache's remote
    // part alone, so other readers still fetch when theirs is stale. A requested refresh is the
    // app's own status refresh, so it also auto-pulls when the project has auto-pull on.
    const local = broadcaster.refreshLocalStatus(repository.path);
    const status = yield* (
      refreshRemote
        ? broadcaster.refreshStatus(repository.path).pipe(Effect.catch(() => local))
        : local
    ).pipe(Effect.option);
    const checkedAt = yield* now;
    if (Option.isNone(status))
      return unreadableRepositoryHealth(repository.resourceId, "unreadable", checkedAt);
    if (!status.value.isRepo)
      return unreadableRepositoryHealth(repository.resourceId, "not-a-repository", checkedAt);
    const refName = status.value.refName;
    // Counting against the upstream ref reads the last fetch, never fetches, and reflects a
    // pull at once instead of after the broadcaster's background refresh.
    const [tracking, head, unpushed, divergence, fetchedAt] = yield* Effect.all(
      [
        refName
          ? git(repository.path, [
              "for-each-ref",
              "--format=%(upstream:short)%09%(upstream:track,nobracket)",
              `refs/heads/${refName}`,
            ])
          : Effect.succeed(null),
        git(repository.path, ["rev-parse", "--verify", "HEAD"]),
        git(repository.path, ["rev-list", "--count", "HEAD", "--not", "--remotes"]),
        git(repository.path, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
        lastFetchedAt(repository.path),
      ],
      { concurrency: "unbounded" },
    );
    const unpushedCommits = unpushed === null ? Number.NaN : Number.parseInt(unpushed, 10);
    const commits =
      since !== undefined && head !== null && since !== head
        ? yield* commitsSince(repository.path, since)
        : null;
    const upstream = parseUpstreamTracking(tracking);
    return toRepositoryHealth({
      resourceId: repository.resourceId,
      status: status.value,
      upstream,
      divergence: parseDivergence(divergence),
      head,
      commitsSince: commits,
      unpushedCommits: Number.isFinite(unpushedCommits) ? unpushedCommits : null,
      checkedAt,
      fetchedAt,
      fetchFailed: refreshRemote && remoteCheckFailed(upstream, fetchedAt, checkedAt),
    });
  });

  return Effect.fn("LibraryCopyHealth.read")(function* (
    copy: LibraryWorkingCopy,
    options?: {
      readonly refreshRemote?: boolean | undefined;
      /** Each repository's last reported head, so the report can count the commits since. */
      readonly since?: ReadonlyMap<string, string> | undefined;
    },
  ) {
    const repositories = yield* Effect.forEach(
      copy.repositories,
      (repository) =>
        readRepository(
          repository,
          options?.refreshRemote === true,
          options?.since?.get(repository.resourceId),
        ),
      { concurrency: HEALTH_CONCURRENCY },
    );
    return {
      copyId: copy.id,
      environmentId: copy.environmentId,
      repositories,
      checkedAt: yield* now,
    } satisfies LibraryCopyHealth;
  });
});
