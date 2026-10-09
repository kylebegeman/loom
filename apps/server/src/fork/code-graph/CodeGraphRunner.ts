// @effect-diagnostics nodeBuiltinImport:off - Graphify runs as a child stopped by its own pid.
import * as NodeChildProcess from "node:child_process";
import { TESTED_GRAPHIFY_VERSION } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Everything Loom ever asks Graphify to do. Its installers, hooks, watchers and MCP server
 * edit agent configuration and repositories, so argv is only ever built from this union.
 */
export type GraphifyInvocation =
  | { readonly _tag: "version" }
  | {
      readonly _tag: "extract";
      readonly root: string;
      readonly outDir: string;
      readonly force: boolean;
    }
  | { readonly _tag: "update"; readonly root: string; readonly force: boolean };

/** Arguments after the configured command. */
export const buildArgv = (invocation: GraphifyInvocation): ReadonlyArray<string> => {
  switch (invocation._tag) {
    case "version":
      return ["--version"];
    case "extract":
      // --code-only is local tree-sitter extraction: no LLM, no API key, no network.
      return [
        "extract",
        invocation.root,
        "--code-only",
        ...(invocation.force ? ["--force"] : []),
        "--out",
        invocation.outDir,
      ];
    case "update":
      return ["update", invocation.root, ...(invocation.force ? ["--force"] : [])];
  }
};

const CREDENTIAL_NAMES = new Set([
  "OPENAI_BASE_URL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
]);

/**
 * The child's environment: LLM credentials removed, so no Graphify default can spend money,
 * output redirected out of the repository, and unbuffered output so progress streams.
 * GRAPHIFY_OUT is read once at import, so it must be set here, not later.
 */
export const graphifyEnvironment = (env: NodeJS.ProcessEnv, outDir: string): NodeJS.ProcessEnv => {
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (CREDENTIAL_NAMES.has(name) || name.endsWith("_API_KEY")) continue;
    scrubbed[name] = value;
  }
  return {
    ...scrubbed,
    GRAPHIFY_OUT: outDir,
    GRAPHIFY_NO_TIPS: "1",
    PYTHONUNBUFFERED: "1",
  };
};

/** `graphify 0.9.83` and similar; null when the output names no version. */
export const parseGraphifyVersion = (output: string) =>
  /(\d+\.\d+(?:\.\d+)?[\w.+-]*)/.exec(output)?.[1] ?? null;

export const isTestedVersion = (version: string) => version === TESTED_GRAPHIFY_VERSION;

/** Graphify refuses to replace graph.json with a smaller graph unless forced. */
export const isShrinkRefusal = (lines: ReadonlyArray<string>) =>
  lines.some((line) => line.includes("Refusing to overwrite"));

export const KEPT_OUTPUT_LINES = 200;

export interface GraphifyProcess {
  /** Exit code; null when it was killed, timed out or could not start. */
  readonly exit: Effect.Effect<number | null>;
  /** Stops this process only, SIGTERM then SIGKILL. */
  readonly stop: Effect.Effect<void>;
  /** The last KEPT_OUTPUT_LINES lines of stdout and stderr. */
  readonly lines: () => ReadonlyArray<string>;
}

/**
 * Starts Graphify with streamed output. `onLine` gets every complete, non-empty line. A spawn
 * failure arrives as a line and an exit of null.
 */
export const startGraphify = (input: {
  readonly command: ReadonlyArray<string>;
  readonly invocation: GraphifyInvocation;
  readonly cwd?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly onLine?: (line: string) => void;
}) =>
  Effect.sync((): GraphifyProcess => {
    const [executable, ...prefix] = input.command;
    const kept: string[] = [];
    const push = (line: string) => {
      const trimmed = line.trimEnd();
      if (trimmed === "") return;
      kept.push(trimmed);
      if (kept.length > KEPT_OUTPUT_LINES) kept.shift();
      input.onLine?.(trimmed);
    };
    const child = NodeChildProcess.spawn(
      executable ?? "graphify",
      [...prefix, ...buildArgv(input.invocation)],
      { cwd: input.cwd, env: input.env, stdio: ["ignore", "pipe", "pipe"], shell: false },
    );
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new TextDecoder();
      let partial = "";
      stream?.on("data", (chunk: Uint8Array) => {
        const parts = (partial + decoder.decode(chunk, { stream: true })).split(/\r?\n|\r/);
        partial = parts.pop() ?? "";
        parts.forEach(push);
      });
      stream?.on("end", () => push(partial));
    }
    const alive = () => child.exitCode === null && child.signalCode === null;
    const exited = new Promise<number | null>((resolve) => {
      child.once("error", (cause) => {
        push(`Could not start ${executable}: ${cause.message}`);
        resolve(null);
      });
      child.once("close", (code) => resolve(code));
    });
    // @effect-diagnostics-next-line globalTimersInEffect:off - stops a Node child process.
    const timer = setTimeout(() => {
      if (!alive()) return;
      push(`Stopped after ${Math.round(input.timeoutMs / 60_000)} minutes.`);
      child.kill("SIGKILL");
    }, input.timeoutMs);
    void exited.then(() => clearTimeout(timer));

    const exit = Effect.promise(() => exited);
    return {
      exit,
      lines: () => kept,
      stop: Effect.gen(function* () {
        if (alive()) child.kill("SIGTERM");
        const done = yield* exit.pipe(Effect.timeoutOption("5 seconds"));
        if (Option.isNone(done)) {
          if (alive()) child.kill("SIGKILL");
          yield* exit;
        }
      }),
    };
  });
