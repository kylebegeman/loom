import { makeStorageRemovalRecorder } from "../project-lifecycle/StorageCleanupAccounting.ts";
import { LibraryError } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ServerConfig from "../../config.ts";
import type * as ProcessRunner from "../../processRunner.ts";
import {
  type GitCloneProgressLine,
  parseGitCloneProgressLine,
} from "../../project/gitCloneProgress.ts";

/** Download progress for a thread's setup card. `fetch` covers the download, `checkout` the files. */
export interface LibraryCloneProgress {
  readonly stage: "fetch" | "checkout";
  readonly percent: number | null;
  readonly detail: string | null;
}

/** One remote's object cache on this computer, shared by every copy of that remote. */
export interface LibraryGitMirror {
  /** sha256 hex of the normalized remote URL. */
  readonly key: string;
  readonly path: string;
  readonly remoteUrl: string | null;
  readonly bytes: number;
  readonly lastUsedAt: string | null;
}

export class LibraryGitFetch extends Context.Service<
  LibraryGitFetch,
  {
    /**
     * Clones `remoteUrl` into `path`, an empty or missing folder, through this computer's mirror
     * of the remote. Git failures come back as a non-zero `code`, as `runner.run` reports them.
     */
    readonly cloneRepository: (input: {
      readonly remoteUrl: string;
      readonly branch: string | null;
      readonly path: string;
      readonly onProgress?: ((progress: LibraryCloneProgress) => Effect.Effect<void>) | undefined;
    }) => Effect.Effect<ProcessRunner.ProcessRunOutput, LibraryError>;
    /** Refreshes the remote's mirror in the background, creating it only when `create` is set. */
    readonly warmMirror: (input: {
      readonly remoteUrl: string;
      readonly create: boolean;
    }) => Effect.Effect<void>;
    readonly mirrorKey: (remoteUrl: string) => Effect.Effect<string>;
    readonly mirrors: Effect.Effect<ReadonlyArray<LibraryGitMirror>, LibraryError>;
    readonly mirrorLocations: Effect.Effect<
      ReadonlyArray<{ readonly key: string; readonly path: string }>,
      LibraryError
    >;
    /** Removes a mirror unused since `unusedSince`, returning the bytes freed, or null when kept. */
    readonly removeMirror: (input: {
      readonly key: string;
      readonly unusedSince: string;
    }) => Effect.Effect<number | null, LibraryError>;
  }
>()("t3/fork/project-library/LibraryGitFetch") {}

const MIRRORS_DIRECTORY = "git-mirrors";
const MIRROR_SUFFIX = ".git";
const PARTIAL_SUFFIX = ".partial";
const MIRROR_KEY = /^[0-9a-f]{64}$/;
const LAST_USED_FILE = "loom-last-used";
const GIT_STEP_TIMEOUT = "10 minutes";
const FORCE_KILL_AFTER = "1 second";
const STDERR_TAIL_CHARS = 64 * 1024;
const STDOUT_LIMIT_CHARS = 64 * 1024;
const PROGRESS_INTERVAL_MS = 250;

const isLibraryError = Schema.is(LibraryError);
const mapIo = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
    ),
  );

const succeeded = (result: ProcessRunner.ProcessRunOutput) => result.code === 0 && !result.timedOut;
// Option-shaped remotes only ever reach git behind `--`, which the direct clone provides.
const mirrorable = (remoteUrl: string) => !remoteUrl.startsWith("-") && !remoteUrl.includes("\0");
const branchArguments = (branch: string | null) => (branch === null ? [] : ["--branch", branch]);
const gitDirectory = (directory: string) => `--git-dir=${directory}`;

/** Git reports a download as three sub-stages; fold them into one rising `fetch` percent. */
const libraryProgress = (line: GitCloneProgressLine): LibraryCloneProgress => {
  if (line.stage === "checkout")
    return { stage: "checkout", percent: line.percent, detail: line.detail };
  const percent =
    line.percent === null
      ? null
      : line.stage === "receiving"
        ? Math.floor(line.percent * 0.9)
        : line.stage === "resolving"
          ? 90 + Math.floor(line.percent / 10)
          : null;
  return { stage: "fetch", percent, detail: line.detail };
};

const progressReporter = (onProgress: (progress: LibraryCloneProgress) => Effect.Effect<void>) => {
  const stages = new Map<
    LibraryCloneProgress["stage"],
    { readonly at: number; readonly peak: number | null; readonly last: LibraryCloneProgress }
  >();
  // Runs for every redraw git prints, so a span per line would swamp traces.
  return Effect.fnUntraced(function* (line: string) {
    const parsed = parseGitCloneProgressLine(line);
    if (parsed === null) return;
    const next = libraryProgress(parsed);
    const previous = stages.get(next.stage);
    const peak = previous?.peak ?? null;
    const progress = {
      ...next,
      percent: next.percent === null || peak === null ? next.percent : Math.max(next.percent, peak),
    };
    const now = yield* Clock.currentTimeMillis;
    if (previous !== undefined) {
      if (previous.last.percent === progress.percent && previous.last.detail === progress.detail)
        return;
      if (parsed.percent !== 100 && now - previous.at < PROGRESS_INTERVAL_MS) return;
    }
    stages.set(next.stage, { at: now, peak: progress.percent ?? peak, last: progress });
    yield* onProgress(progress);
  });
};

const make = Effect.gen(function* () {
  const accountStorageRemoval = yield* makeStorageRemovalRecorder;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const config = yield* ServerConfig.ServerConfig;
  const hostEnvironment = yield* HostProcess.Environment;
  const scope = yield* Effect.scope;
  const locks = yield* KeyedLock.make<string>();
  const warming = yield* Semaphore.make(1);
  const mirrorsDirectory = path.join(config.baseDir, MIRRORS_DIRECTORY);
  // Keep the host's credential helpers; only suppress interactive prompts.
  const gitEnvironment = { ...hostEnvironment, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
  const mirrorPath = (key: string) => path.join(mirrorsDirectory, `${key}${MIRROR_SUFFIX}`);
  const partialPath = (key: string) => path.join(mirrorsDirectory, `${key}${PARTIAL_SUFFIX}`);
  const removeDirectory = (directory: string) =>
    fs.remove(directory, { recursive: true, force: true });

  const runGit = Effect.fn("LibraryGitFetch.git")(function* (
    args: ReadonlyArray<string>,
    onLine?: (line: string) => Effect.Effect<void>,
  ) {
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    let stdout = "";
    let stdoutTruncated = false;
    let stderr = "";
    let stderrTruncated = false;
    let partialLine = "";
    /** Keeps the tail for failure classification and returns the complete progress lines. */
    const takeStderr = (text: string, final = false) => {
      stderr += text;
      if (stderr.length > 2 * STDERR_TAIL_CHARS) {
        stderr = stderr.slice(-STDERR_TAIL_CHARS);
        stderrTruncated = true;
      }
      if (onLine === undefined) return [];
      const lines = `${partialLine}${text}`.split(/[\r\n]/);
      partialLine = final ? "" : (lines.pop() ?? "");
      return lines;
    };
    const report = (lines: ReadonlyArray<string>) =>
      onLine === undefined ? Effect.void : Effect.forEach(lines, onLine, { discard: true });
    const exitCode = yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner
          .spawn(
            ChildProcess.make("git", args, {
              env: gitEnvironment,
              extendEnv: true,
              stdin: "ignore",
              forceKillAfter: FORCE_KILL_AFTER,
            }),
          )
          .pipe(
            // Synchronous spawn throws arrive as defects.
            Effect.catchDefect((cause) => Effect.fail(new LibraryError({ reason: "io", cause }))),
          );
        yield* Effect.all(
          [
            Stream.runForEach(child.stdout, (chunk) =>
              Effect.sync(() => {
                if (stdout.length < STDOUT_LIMIT_CHARS)
                  stdout += stdoutDecoder.decode(chunk, { stream: true });
                else stdoutTruncated = true;
              }),
            ),
            Stream.runForEach(child.stderr, (chunk) =>
              report(takeStderr(stderrDecoder.decode(chunk, { stream: true }))),
            ),
          ],
          { concurrency: "unbounded" },
        );
        yield* report(takeStderr(stderrDecoder.decode(), true));
        return yield* child.exitCode;
      }),
    ).pipe(Effect.timeoutOption(GIT_STEP_TIMEOUT));
    return {
      stdout,
      stderr: stderr.slice(-STDERR_TAIL_CHARS),
      code: Option.getOrNull(exitCode),
      timedOut: Option.isNone(exitCode),
      stdoutTruncated,
      stderrTruncated: stderrTruncated || stderr.length > STDERR_TAIL_CHARS,
      stdoutInvalidUtf8: false,
      stderrInvalidUtf8: false,
    } satisfies ProcessRunner.ProcessRunOutput;
  }, mapIo);

  const mirrorKey = Effect.fn("LibraryGitFetch.mirrorKey")(function* (remoteUrl: string) {
    const bytes = new TextEncoder().encode(normalizeGitRemoteUrl(remoteUrl));
    return Hex.encode(yield* crypto.digest("SHA-256", bytes).pipe(Effect.orDie));
  });

  const recordUse = Effect.fn("LibraryGitFetch.recordUse")(
    function* (mirror: string) {
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* fs.writeFileString(path.join(mirror, LAST_USED_FILE), `${now}\n`);
    },
    Effect.catch((error) => Effect.logWarning("Loom could not record a Git mirror's use", error)),
  );

  const readLastUsed = (mirror: string) =>
    fs.readFileString(path.join(mirror, LAST_USED_FILE)).pipe(
      Effect.map((text) => text.trim()),
      Effect.map((text) => (Number.isNaN(Date.parse(text)) ? null : text)),
      Effect.orElseSucceed(() => null),
    );

  const directoryBytes = Effect.fn("LibraryGitFetch.directoryBytes")(function* (directory: string) {
    const entries = yield* fs.readDirectory(directory, { recursive: true });
    const sizes = yield* Effect.forEach(
      entries,
      (entry) =>
        fs.stat(path.join(directory, entry)).pipe(
          Effect.map((info) => (info.type === "File" ? Number(info.size) : 0)),
          // Git can replace packs while the walk runs.
          Effect.orElseSucceed(() => 0),
        ),
      { concurrency: 16 },
    );
    return sizes.reduce((total, size) => total + size, 0);
  });

  const isReadableMirror = (mirror: string) =>
    runGit([gitDirectory(mirror), "rev-parse", "--is-bare-repository"]).pipe(
      Effect.map((result) => succeeded(result) && result.stdout.trim() === "true"),
    );

  /** Builds the mirror beside its final name so a half-made one is never used. */
  const createMirror = Effect.fn("LibraryGitFetch.createMirror")(
    function* (key: string, remoteUrl: string, onLine?: (line: string) => Effect.Effect<void>) {
      const partial = partialPath(key);
      yield* fs.makeDirectory(mirrorsDirectory, { recursive: true });
      yield* removeDirectory(partial);
      // Heads and tags only: `--mirror` would also pull every pull-request ref.
      const cloned = yield* runGit(
        [
          "-c",
          "clone.defaultRemoteName=origin",
          "clone",
          "--bare",
          "--progress",
          "--",
          remoteUrl,
          partial,
        ],
        onLine,
      );
      if (!succeeded(cloned)) return cloned;
      for (const setting of [
        ["remote.origin.fetch", "+refs/heads/*:refs/heads/*"],
        ["--add", "remote.origin.fetch", "+refs/tags/*:refs/tags/*"],
      ]) {
        const configured = yield* runGit([gitDirectory(partial), "config", ...setting]);
        if (!succeeded(configured)) return configured;
      }
      const mirror = mirrorPath(key);
      yield* removeDirectory(mirror);
      yield* fs.rename(partial, mirror);
      // A fresh mirror counts as used, so cleanup does not take it before its first copy.
      yield* recordUse(mirror);
      return cloned;
    },
    (effect, key) =>
      effect.pipe(Effect.ensuring(removeDirectory(partialPath(key)).pipe(Effect.ignore))),
    mapIo,
  );

  /** Brings a mirror up to date, or creates it when asked. Null when there is nothing to do. */
  const refreshMirror = Effect.fn("LibraryGitFetch.refreshMirror")(function* (input: {
    readonly key: string;
    readonly remoteUrl: string;
    readonly create: boolean;
    /** Lets git repack in the foreground; clones skip that so they never wait on a repack. */
    readonly maintain: boolean;
    readonly onLine?: ((line: string) => Effect.Effect<void>) | undefined;
  }) {
    const mirror = mirrorPath(input.key);
    if (!(yield* fs.exists(mirror)))
      return input.create ? yield* createMirror(input.key, input.remoteUrl, input.onLine) : null;
    // The newest caller's URL is the one this computer's credentials work for today.
    let result = yield* runGit([
      gitDirectory(mirror),
      "config",
      "remote.origin.url",
      input.remoteUrl,
    ]);
    if (succeeded(result))
      result = yield* runGit(
        [
          ...(input.maintain
            ? ["-c", "gc.autoDetach=false", "-c", "maintenance.autoDetach=false"]
            : ["-c", "gc.auto=0", "-c", "maintenance.auto=false"]),
          gitDirectory(mirror),
          "fetch",
          "--prune",
          "--progress",
          "origin",
        ],
        input.onLine,
      );
    if (!succeeded(result) && !result.timedOut && !(yield* isReadableMirror(mirror)))
      yield* removeDirectory(mirror);
    return result;
  }, mapIo);

  const cloneViaMirror = Effect.fn("LibraryGitFetch.cloneViaMirror")(function* (
    input: { readonly remoteUrl: string; readonly branch: string | null; readonly path: string },
    key: string,
    onLine?: (line: string) => Effect.Effect<void>,
  ) {
    const mirror = mirrorPath(key);
    const refreshed = yield* refreshMirror({
      key,
      remoteUrl: input.remoteUrl,
      create: true,
      maintain: false,
      onLine,
    });
    if (refreshed !== null && !succeeded(refreshed)) return refreshed;
    const ref = input.branch === null ? "HEAD" : `refs/heads/${input.branch}`;
    const found = yield* runGit([
      gitDirectory(mirror),
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^{commit}`,
    ]);
    if (!succeeded(found)) {
      // An upstream default-branch rename strands the mirror's HEAD; a new mirror reads it again.
      if (input.branch === null) yield* removeDirectory(mirror);
      return found;
    }
    const cloned = yield* runGit(
      [
        "-c",
        "clone.defaultRemoteName=origin",
        "clone",
        "--local",
        "--progress",
        ...branchArguments(input.branch),
        "--",
        mirror,
        input.path,
      ],
      onLine,
    );
    if (!succeeded(cloned)) {
      if (!cloned.timedOut) yield* removeDirectory(mirror);
      return cloned;
    }
    const origin = yield* runGit([
      gitDirectory(path.join(input.path, ".git")),
      "remote",
      "set-url",
      "origin",
      input.remoteUrl,
    ]);
    if (!succeeded(origin)) return origin;
    yield* recordUse(mirror);
    return cloned;
  }, mapIo);

  const targetState = Effect.fn("LibraryGitFetch.targetState")(function* (target: string) {
    if (!(yield* fs.exists(target))) return "missing" as const;
    const info = yield* fs.stat(target);
    return info.type === "Directory" && (yield* fs.readDirectory(target)).length === 0
      ? ("empty" as const)
      : ("occupied" as const);
  });

  const clearTarget = Effect.fn("LibraryGitFetch.clearTarget")(function* (
    target: string,
    state: "missing" | "empty",
  ) {
    if (!(yield* fs.exists(target))) return;
    if (state === "missing") return yield* removeDirectory(target);
    for (const name of yield* fs.readDirectory(target))
      yield* removeDirectory(path.join(target, name));
  });

  /** Hardlinks cannot cross volumes, and `clone --local` refuses to copy instead. */
  const sharesMirrorVolume = Effect.fn("LibraryGitFetch.sharesMirrorVolume")(function* (
    target: string,
  ) {
    yield* fs.makeDirectory(mirrorsDirectory, { recursive: true });
    let existing = target;
    while (!(yield* fs.exists(existing))) {
      const parent = path.dirname(existing);
      if (parent === existing) return false;
      existing = parent;
    }
    const [mirrors, folder] = yield* Effect.all([fs.stat(mirrorsDirectory), fs.stat(existing)]);
    return mirrors.dev === folder.dev;
  });

  const cloneRepository: LibraryGitFetch["Service"]["cloneRepository"] = Effect.fn(
    "LibraryGitFetch.cloneRepository",
  )(function* (input) {
    const target = yield* targetState(input.path);
    const reporter = () =>
      input.onProgress === undefined ? undefined : progressReporter(input.onProgress);
    if (target !== "occupied" && mirrorable(input.remoteUrl)) {
      const key = yield* mirrorKey(input.remoteUrl);
      const viaMirror = yield* sharesMirrorVolume(input.path).pipe(
        Effect.flatMap((shared) =>
          shared
            ? locks.withLock(key, cloneViaMirror(input, key, reporter()))
            : Effect.succeed(null),
        ),
        Effect.result,
      );
      if (Result.isSuccess(viaMirror) && viaMirror.success !== null) {
        if (succeeded(viaMirror.success)) return viaMirror.success;
        yield* Effect.logDebug("Loom is cloning without this computer's Git mirror", {
          key,
          code: viaMirror.success.code,
          timedOut: viaMirror.success.timedOut,
        });
      } else if (Result.isFailure(viaMirror))
        yield* Effect.logWarning("Loom is cloning without this computer's Git mirror", {
          key,
          error: viaMirror.failure,
        });
      yield* clearTarget(input.path, target);
    }
    const cloned = yield* runGit(
      ["clone", "--progress", ...branchArguments(input.branch), "--", input.remoteUrl, input.path],
      reporter(),
    );
    if (!succeeded(cloned) && target !== "occupied") yield* clearTarget(input.path, target);
    return cloned;
  }, mapIo);

  const warmMirror: LibraryGitFetch["Service"]["warmMirror"] = Effect.fn(
    "LibraryGitFetch.warmMirror",
  )(function* (input) {
    if (!mirrorable(input.remoteUrl)) return;
    const key = yield* mirrorKey(input.remoteUrl);
    yield* refreshMirror({
      key,
      remoteUrl: input.remoteUrl,
      create: input.create,
      maintain: true,
    }).pipe(
      Effect.flatMap((result) =>
        result === null || succeeded(result)
          ? Effect.logDebug("Loom refreshed a Git mirror", { key })
          : Effect.logWarning("Loom could not refresh a Git mirror", {
              key,
              code: result.code,
              timedOut: result.timedOut,
            }),
      ),
      (refresh) => locks.withLock(key, refresh),
      warming.withPermit,
      Effect.catch((error) =>
        Effect.logWarning("Loom could not refresh a Git mirror", { key, error }),
      ),
      Effect.forkIn(scope),
    );
  });

  const mirrorLocations = Effect.gen(function* () {
    if (!(yield* fs.exists(mirrorsDirectory))) return [];
    const keys = (yield* fs.readDirectory(mirrorsDirectory))
      .filter((name) => name.endsWith(MIRROR_SUFFIX))
      .map((name) => name.slice(0, -MIRROR_SUFFIX.length))
      .filter((key) => MIRROR_KEY.test(key))
      .toSorted();
    return keys.map((key) => ({ key, path: mirrorPath(key) }));
  }).pipe(mapIo);
  const mirrors: LibraryGitFetch["Service"]["mirrors"] = Effect.gen(function* () {
    return yield* Effect.forEach(yield* mirrorLocations, ({ key }) =>
      Effect.gen(function* () {
        const mirror = mirrorPath(key);
        const remote = yield* runGit([
          gitDirectory(mirror),
          "config",
          "--get",
          "remote.origin.url",
        ]);
        const remoteUrl = remote.stdout.trim();
        return {
          key,
          path: mirror,
          remoteUrl: succeeded(remote) && remoteUrl.length > 0 ? remoteUrl : null,
          bytes: yield* directoryBytes(mirror),
          lastUsedAt: yield* readLastUsed(mirror),
        } satisfies LibraryGitMirror;
      }),
    );
  }).pipe(Effect.withSpan("LibraryGitFetch.mirrors"), mapIo);

  const removeMirror: LibraryGitFetch["Service"]["removeMirror"] = Effect.fn(
    "LibraryGitFetch.removeMirror",
  )(function* (input) {
    const cutoff = Date.parse(input.unusedSince);
    if (!MIRROR_KEY.test(input.key) || Number.isNaN(cutoff))
      return yield* new LibraryError({ reason: "invalid" });
    return yield* locks.withLock(
      input.key,
      Effect.gen(function* () {
        const mirror = mirrorPath(input.key);
        if (!(yield* fs.exists(mirror))) return 0;
        const lastUsedAt = yield* readLastUsed(mirror);
        if (lastUsedAt !== null && Date.parse(lastUsedAt) > cutoff) return null;
        const bytes = yield* directoryBytes(mirror);
        yield* accountStorageRemoval(
          {
            id: `git-mirror:${input.key}:${lastUsedAt ?? "unused"}`,
            kind: "git-mirror",
            path: mirror,
            reason: "Unused Git mirror removed.",
            paths: () => Effect.succeed([mirror]),
          },
          fs.remove(mirror, { recursive: true }),
        );
        return bytes;
      }),
    );
  }, mapIo);

  // A crash mid-creation leaves a partial mirror that no later clone of that remote may reclaim.
  yield* Effect.gen(function* () {
    if (!(yield* fs.exists(mirrorsDirectory))) return;
    for (const name of yield* fs.readDirectory(mirrorsDirectory)) {
      if (!name.endsWith(PARTIAL_SUFFIX)) continue;
      const key = name.slice(0, -PARTIAL_SUFFIX.length);
      yield* locks.withLock(key, removeDirectory(partialPath(key)));
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Loom could not remove unfinished Git mirrors", error),
    ),
    Effect.forkIn(scope),
  );

  return LibraryGitFetch.of({
    cloneRepository,
    warmMirror,
    mirrorKey,
    mirrorLocations,
    mirrors,
    removeMirror,
  });
});

export const layer = Layer.effect(LibraryGitFetch, make);
