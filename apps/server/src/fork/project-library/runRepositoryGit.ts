import { LibraryError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as ProcessRunner from "../../processRunner.ts";
const FORCE_KILL_AFTER = "1 second";
const STDERR_TAIL_CHARS = 64 * 1024;
const STDOUT_LIMIT_CHARS = 64 * 1024;
export const runRepositoryGit = Effect.fn("LibraryGitFetch.git")(
  function* (
    spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
    args: ReadonlyArray<string>,
    options: {
      readonly env: Record<string, string | undefined>;
      readonly cwd?: string;
      readonly extendEnv: boolean;
      readonly timeout: "10 minutes" | "30 seconds";
      readonly onLine?: ((line: string) => Effect.Effect<void>) | undefined;
    },
  ) {
    const onLine = options.onLine;
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    let stdout = "";
    let stdoutTruncated = false;
    let stderr = "";
    let stderrTruncated = false;
    let partialLine = "";
    let partialLineTruncated = false;
    /** Keeps the tail for failure classification and returns the complete progress lines. */
    const takeStderr = (text: string, final = false) => {
      stderr += text;
      if (stderr.length > 2 * STDERR_TAIL_CHARS) {
        stderr = stderr.slice(-STDERR_TAIL_CHARS);
        stderrTruncated = true;
      }
      if (onLine === undefined) return [];
      const lines = `${partialLine}${text}`.split(/[\r\n]/);
      const pending = final ? "" : (lines.pop() ?? "");
      const complete = lines.filter(
        (line, index) => !(index === 0 && partialLineTruncated) && line.length <= STDERR_TAIL_CHARS,
      );
      partialLineTruncated =
        pending.length > STDERR_TAIL_CHARS || (lines.length === 0 && partialLineTruncated);
      partialLine = pending.slice(-STDERR_TAIL_CHARS);
      return complete;
    };
    const report = (lines: ReadonlyArray<string>) =>
      onLine === undefined ? Effect.void : Effect.forEach(lines, onLine, { discard: true });
    const exitCode = yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner
          .spawn(
            ChildProcess.make("git", args, {
              env: options.env,
              cwd: options.cwd,
              extendEnv: options.extendEnv,
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
                const text = stdoutDecoder.decode(chunk, { stream: true });
                const available = STDOUT_LIMIT_CHARS - stdout.length;
                stdout += text.slice(0, available);
                if (text.length > available) stdoutTruncated = true;
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
    ).pipe(Effect.timeoutOption(options.timeout));
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
  },
  (effect) => effect.pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause }))),
);
