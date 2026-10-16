import type { VcsStatusResult } from "@t3tools/contracts";
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

/**
 * Maps a repository's VCS status to Library health. Without an upstream, VCS status measures
 * `aheadCount` against the default branch, so ahead and behind are left out rather than reported
 * against a branch the repository does not track.
 */
export const toRepositoryHealth = (input: {
  readonly resourceId: string;
  readonly status: VcsStatusResult;
  readonly upstream: string | null;
  readonly head: string | null;
  readonly unpushedCommits: number;
  readonly checkedAt: string;
  readonly fetchedAt: string | null;
}): LibraryRepositoryHealth => {
  if (!input.status.isRepo)
    return unreadableRepositoryHealth(input.resourceId, "not-a-repository", input.checkedAt);
  const { status } = input;
  return {
    resourceId: input.resourceId,
    ...(status.refName ? { branch: status.refName } : {}),
    ...(input.head ? { head: input.head } : {}),
    ...(status.hasUpstream
      ? {
          ...(input.upstream ? { upstream: input.upstream } : {}),
          ahead: status.aheadCount,
          behind: status.behindCount,
        }
      : {}),
    uncommittedFiles: status.workingTree.files.length,
    unpushedCommits: input.unpushedCommits,
    checkedAt: input.checkedAt,
    ...(input.fetchedAt ? { fetchedAt: input.fetchedAt } : {}),
  };
};

/** Parses `git rev-list --left-right --count A...B` output into [ahead, behind]. */
export const parseDivergence = (output: string | null): readonly [number, number] | null => {
  const match = output?.match(/^(\d+)\s+(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
};

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

  // FETCH_HEAD is rewritten on every fetch, so its mtime is the last time remotes were read.
  const lastFetchedAt = (cwd: string) =>
    Effect.gen(function* () {
      const fetchHead = yield* git(cwd, ["rev-parse", "--git-path", "FETCH_HEAD"]);
      if (fetchHead === null) return null;
      const info = yield* fs.stat(path.resolve(cwd, fetchHead));
      return Option.match(info.mtime, {
        onNone: () => null,
        onSome: (mtime) => mtime.toISOString(),
      });
    }).pipe(Effect.orElseSucceed(() => null));

  const readRepository = (
    repository: LibraryWorkingCopy["repositories"][number],
    refreshRemote: boolean,
  ) =>
    Effect.gen(function* () {
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
      const status = yield* (
        refreshRemote
          ? broadcaster.refreshStatus(repository.path)
          : broadcaster
              .refreshLocalStatus(repository.path)
              .pipe(
                Effect.andThen(
                  broadcaster.getStatus({ cwd: repository.path }, { refreshUpstream: false }),
                ),
              )
      ).pipe(Effect.option);
      const checkedAt = yield* now;
      if (Option.isNone(status))
        return unreadableRepositoryHealth(repository.resourceId, "unreadable", checkedAt);
      if (!status.value.isRepo)
        return unreadableRepositoryHealth(repository.resourceId, "not-a-repository", checkedAt);
      const [upstream, head, unpushed, divergence, fetchedAt] = yield* Effect.all(
        [
          git(repository.path, [
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
          ]),
          git(repository.path, ["rev-parse", "--verify", "HEAD"]),
          git(repository.path, ["rev-list", "--count", "HEAD", "--not", "--remotes"]),
          git(repository.path, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
          lastFetchedAt(repository.path),
        ],
        { concurrency: "unbounded" },
      );
      const unpushedCommits = Number.parseInt(unpushed ?? "0", 10);
      const counts = parseDivergence(divergence);
      return toRepositoryHealth({
        resourceId: repository.resourceId,
        // Cached remote counts lag a pull until the broadcaster's background refresh lands, so
        // count against the upstream ref directly. This reads the last fetch and never fetches.
        status:
          counts === null
            ? status.value
            : { ...status.value, hasUpstream: true, aheadCount: counts[0], behindCount: counts[1] },
        upstream,
        head,
        unpushedCommits: Number.isFinite(unpushedCommits) ? unpushedCommits : 0,
        checkedAt,
        fetchedAt,
      });
    });

  return Effect.fn("LibraryCopyHealth.read")(function* (
    copy: LibraryWorkingCopy,
    options?: { readonly refreshRemote?: boolean | undefined },
  ) {
    const repositories = yield* Effect.forEach(
      copy.repositories,
      (repository) => readRepository(repository, options?.refreshRemote === true),
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
