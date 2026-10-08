// @effect-diagnostics nodeBuiltinImport:off - Runs stream output live and are cancelled by process tree.
import * as NodeChildProcess from "node:child_process";
import * as Effect from "effect/Effect";
import * as ProcessRunner from "../../processRunner.ts";
import { ancestorsOf, parseProcessTable, withDescendants } from "../project-lifecycle/leases.ts";

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
        timeout: `${options.timeoutSeconds ?? 10} seconds`,
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

export interface RunningProcess {
  readonly pid: number;
  /** Exit code, or null when killed by a signal or it never started. */
  readonly exit: Effect.Effect<number | null>;
  /** Feeds text to the process's stdin; closes it with `null`. */
  readonly write: (text: string | null) => void;
}

/** Output may keep flowing briefly after exit while grandchildren close their pipes. */
const PIPE_DRAIN_MS = 2_000;

/**
 * Starts a long-running command whose combined output arrives through `onOutput` as decoded
 * text. Spawn failures arrive as output and an exit of null.
 */
export const spawnRun = (input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin?: boolean;
  readonly onOutput: (text: string) => void;
}) =>
  Effect.sync((): RunningProcess => {
    const child = NodeChildProcess.spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdio: [input.stdin ? "pipe" : "ignore", "pipe", "pipe"],
      detached: false,
      shell: false,
    });
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new TextDecoder();
      stream?.on("data", (chunk: Uint8Array) => {
        const text = decoder.decode(chunk, { stream: true });
        if (text) input.onOutput(text);
      });
      stream?.on("end", () => {
        const rest = decoder.decode();
        if (rest) input.onOutput(rest);
      });
    }
    child.stdin?.on("error", () => undefined);
    const exited = new Promise<number | null>((resolve) => {
      child.once("error", (cause) => {
        input.onOutput(`Could not start ${input.command}: ${cause.message}\n`);
        resolve(null);
      });
      child.once("exit", (code) => {
        if (child.stdout === null || child.stdout.readableEnded) return resolve(code);
        // @effect-diagnostics-next-line globalTimers:off - a plain Node callback, not Effect code.
        const timer = setTimeout(() => resolve(code), PIPE_DRAIN_MS);
        child.once("close", () => {
          clearTimeout(timer);
          resolve(code);
        });
      });
    });
    return {
      pid: child.pid ?? -1,
      exit: Effect.promise(() => exited),
      write: (text) => {
        if (child.stdin === null || child.stdin.destroyed) return;
        if (text === null) child.stdin.end();
        else child.stdin.write(text);
      },
    };
  });

const signal = (pid: number, name: NodeJS.Signals | 0) => {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
  }
};

const KILL_AFTER_MS = 15_000;
const POLL_MS = 250;

/**
 * SIGTERM to a process we started and everything below it, then SIGKILL to whatever is still
 * alive 15 seconds later. Never this server or its ancestors. Returns pids still alive.
 */
export const terminateTree = (exec: Exec, pid: number, killAfterMs = KILL_AFTER_MS) =>
  Effect.gen(function* () {
    if (pid <= 1) return [];
    const ps = yield* exec("ps", ["-Ao", "pid=,ppid=,lstart="], {
      env: { ...process.env, LC_ALL: "C" },
    });
    const table = succeeded(ps) ? parseProcessTable(ps.stdout) : new Map();
    const protectedPids = ancestorsOf(table, process.pid);
    const tree = [...withDescendants(table, [pid])].filter(
      (candidate) => !protectedPids.has(candidate),
    );
    const targets = tree.length > 0 ? tree : [pid];
    for (const target of targets) signal(target, "SIGTERM");
    let alive = targets;
    for (let waited = 0; waited < killAfterMs && alive.length > 0; waited += POLL_MS) {
      yield* Effect.sleep(`${POLL_MS} millis`);
      alive = alive.filter((target) => signal(target, 0));
    }
    for (const target of alive) signal(target, "SIGKILL");
    yield* Effect.sleep(`${POLL_MS} millis`);
    return alive.filter((target) => signal(target, 0));
  });
