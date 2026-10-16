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
  readonly unpushedCommits: number;
  readonly checkedAt: string;
  readonly fetchedAt: string | null;
}): LibraryRepositoryHealth => {
  if (!input.status.isRepo)
    return unreadableRepositoryHealth(input.resourceId, "not-a-repository", input.checkedAt);
  const { status, upstream, divergence } = input;
  return {
    resourceId: input.resourceId,
    ...(status.refName ? { branch: status.refName } : {}),
    ...(input.head ? { head: input.head } : {}),
    ...(upstream?.gone
      ? { upstream: upstream.name, upstreamGone: true }
      : upstream
        ? {
            upstream: upstream.name,
            ...(divergence ? { ahead: divergence[0], behind: divergence[1] } : {}),
          }
        : {}),
    uncommittedFiles: status.workingTree.files.length,
    unpushedCommits: input.unpushedCommits,
    checkedAt: input.checkedAt,
    ...(input.fetchedAt ? { fetchedAt: input.fetchedAt } : {}),
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
      // Only a requested refresh fetches. A plain read leaves the shared status cache's remote
      // part alone, so other readers still fetch when theirs is stale.
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
      const unpushedCommits = Number.parseInt(unpushed ?? "0", 10);
      return toRepositoryHealth({
        resourceId: repository.resourceId,
        status: status.value,
        upstream: parseUpstreamTracking(tracking),
        divergence: parseDivergence(divergence),
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
