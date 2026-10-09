// @effect-diagnostics nodeBuiltinImport:off - Flow runs and recordings are children stopped by their own pid.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ProcessRunner from "../../processRunner.ts";

export interface ExecResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecOptions {
  readonly cwd?: string;
  readonly timeoutSeconds?: number;
  readonly maxOutputBytes?: number;
  readonly env?: NodeJS.ProcessEnv;
}

/** Short buffered commands. Null when the command could not run at all. */
export type Exec = (
  command: string,
  args: ReadonlyArray<string>,
  options?: ExecOptions,
) => Effect.Effect<ExecResult | null>;

export const makeExec = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const exec: Exec = (command, args, options = {}) =>
    runner
      .run({
        command,
        args,
        cwd: options.cwd,
        env: options.env,
        timeout: `${options.timeoutSeconds ?? 15} seconds`,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: options.maxOutputBytes ?? 4 * 1024 * 1024,
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((output) => ({
          code: output.timedOut ? null : output.code === null ? null : Number(output.code),
          stdout: output.stdout,
          stderr: output.stderr,
        })),
        Effect.orElseSucceed(() => null),
      );
  return exec;
});

export const succeeded = (result: ExecResult | null): result is ExecResult & { code: 0 } =>
  result !== null && result.code === 0;

/** The most useful text of a failed command, for error messages. */
export const outputOf = (result: ExecResult | null, fallback: string) => {
  const text = (result?.stderr.trim() || result?.stdout.trim() || "").slice(-1000);
  return text === "" ? fallback : text;
};

export interface ChildProcess {
  readonly pid: number;
  /** Exit code, or null when it ended by a signal or never started. */
  readonly exit: Effect.Effect<number | null>;
  /** Signals this process only, never its children: argent's shared tool-server must live on. */
  readonly signal: (name: NodeJS.Signals) => void;
}

/**
 * Starts a long-running command whose combined output arrives through `onOutput` as decoded
 * text. A spawn failure arrives as output and an exit of null.
 */
export const spawnChild = (input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly onOutput: (text: string) => void;
}) =>
  Effect.sync((): ChildProcess => {
    const child = NodeChildProcess.spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new TextDecoder();
      stream?.on("data", (chunk: Uint8Array) => {
        const text = decoder.decode(chunk, { stream: true });
        if (text) input.onOutput(text);
      });
    }
    const exited = new Promise<number | null>((resolve) => {
      child.once("error", (cause) => {
        input.onOutput(`Could not start ${input.command}: ${cause.message}\n`);
        resolve(null);
      });
      child.once("close", (code) => resolve(code));
    });
    return {
      pid: child.pid ?? -1,
      exit: Effect.promise(() => exited),
      signal: (name) => {
        if (child.exitCode === null && child.signalCode === null) child.kill(name);
      },
    };
  });

/**
 * Sends `signal`, then SIGKILL when the process is still running after `graceMs`. Returns its
 * exit code, null when it had to be killed.
 */
export const stopChild = (child: ChildProcess, signal: NodeJS.Signals, graceMs: number) =>
  Effect.gen(function* () {
    child.signal(signal);
    const exit = yield* child.exit.pipe(Effect.timeoutOption(`${graceMs} millis`));
    if (Option.isSome(exit)) return exit.value;
    child.signal("SIGKILL");
    yield* child.exit;
    return null;
  });

/** Runs a command with stdout written to `file` as bytes (`adb exec-out screencap`). */
export const execToFile = (input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly file: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}) =>
  Effect.gen(function* () {
    const fd = yield* Effect.promise(() =>
      NodeFS.promises.open(input.file, "w").then(
        (handle) => handle,
        () => null,
      ),
    );
    if (fd === null) return null;
    let stderr = "";
    const child = yield* Effect.sync(() =>
      NodeChildProcess.spawn(input.command, [...input.args], {
        env: input.env,
        stdio: ["ignore", fd.fd, "pipe"],
        shell: false,
      }),
    );
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8");
    });
    const exited = new Promise<number | null>((resolve) => {
      child.once("error", (cause) => {
        stderr += cause.message;
        resolve(null);
      });
      child.once("close", (code) => resolve(code));
    });
    const code = yield* Effect.promise(() => exited).pipe(
      Effect.timeoutOption(`${input.timeoutMs} millis`),
    );
    if (Option.isNone(code)) {
      child.kill("SIGKILL");
      yield* Effect.promise(() => exited);
    }
    yield* Effect.promise(() => fd.close().catch(() => undefined));
    return {
      code: Option.isSome(code) ? code.value : null,
      stdout: "",
      stderr,
    } satisfies ExecResult;
  });
