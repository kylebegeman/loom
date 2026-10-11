// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as DateTime from "effect/DateTime";
import {
  ModelPreviewError,
  type PythonCadInfo,
  pythonInstallCommands,
  MANAGED_PYTHON_VERSION,
  TESTED_BUILD123D_VERSION,
} from "@t3tools/contracts/fork";
import type { ProcessRunner } from "../../../processRunner.ts";
import { RUNNER_SOURCE, RUNNER_VERSION } from "./runnerSource.ts";
import { PythonResponse, type PythonCommand } from "./protocol.ts";
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(PythonResponse));
const failure = (reason: ModelPreviewError["reason"], message: string) =>
  new ModelPreviewError({ reason, message });
const now = Effect.map(DateTime.now, DateTime.toEpochMillis);
/** Workspace Python receives no provider tokens or unrelated host environment secrets. */
export const pythonEnvironment = (environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const allowed = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ];
  return Object.fromEntries(
    allowed.flatMap((name) => (environment[name] === undefined ? [] : [[name, environment[name]]])),
  );
};
export const makePythonEnvironment = (deps: {
  stateDir: string;
  getPythonPath: () => string | null;
  runner: ProcessRunner["Service"];
}) =>
  Effect.gen(function* () {
    const platform = yield* HostProcess.Platform;
    const hostEnvironment = yield* HostProcess.Environment;
    const homeDirectory = yield* HostProcess.HomeDirectory;
    const fs = yield* FileSystem.FileSystem,
      path = yield* Path.Path;
    const directory = path.join(deps.stateDir, "fork", "model-preview-3d", "python");
    const venv = path.join(directory, "venv");
    const interpreterOf = (folder: string) =>
      platform === "win32"
        ? path.join(folder, "Scripts", "python.exe")
        : path.join(folder, "bin", "python");
    const helper = path.join(directory, `runner-${RUNNER_VERSION}.py`);
    const lock = yield* Semaphore.make(1),
      helperLock = yield* Semaphore.make(1);
    let cached: { at: number; info: PythonCadInfo } | null = null;
    let settingUp = false;
    const reset = () => {
      cached = null;
    };
    const ensureRunner = Effect.fn("PythonCad.ensureRunner")(function* () {
      yield* fs.makeDirectory(directory, { recursive: true });
      if (!(yield* fs.exists(helper))) yield* fs.writeFileString(helper, RUNNER_SOURCE);
      return helper;
    }, helperLock.withPermit);
    const uvPath = Effect.fn("PythonCad.uvPath")(function* () {
      const candidates = [
        ...new Set([
          ...(hostEnvironment.PATH ?? "")
            .split(path.sep === "\\" ? ";" : ":")
            .filter(Boolean)
            .map((dir) => path.join(dir, platform === "win32" ? "uv.exe" : "uv")),
          path.join(homeDirectory, ".local", "bin", "uv"),
          "/opt/homebrew/bin/uv",
        ]),
      ];
      for (const candidate of candidates) if (yield* fs.exists(candidate)) return candidate;
      return null;
    });
    const run = Effect.fn("PythonCad.run")(function* (input: {
      command: PythonCommand;
      interpreter: string;
      request?: Readonly<Record<string, unknown>>;
      cwd?: string;
      timeoutSeconds?: number;
    }) {
      const runnerPath = yield* ensureRunner();
      const resultPath = path.join(directory, `result-${NodeCrypto.randomUUID()}.json`);
      yield* Effect.addFinalizer(() => fs.remove(resultPath, { force: true }).pipe(Effect.ignore));
      const result = yield* deps.runner
        .run({
          command: input.interpreter,
          args: ["-I", "-X", "utf8", runnerPath, input.command],
          stdin: json({ ...input.request, resultPath }),
          cwd: input.cwd,
          env: pythonEnvironment(hostEnvironment),
          extendEnv: false,
          timeout: `${input.timeoutSeconds ?? 10} seconds`,
          timeoutBehavior: "timedOutResult",
          maxOutputBytes: 512 * 1024,
          outputMode: "truncate",
        })
        .pipe(Effect.mapError((cause) => failure("command-failed", cause.message)));
      if (result.timedOut) return yield* failure("timeout", "The Python CAD command timed out.");
      if (!(yield* fs.exists(resultPath)))
        return yield* failure(
          "command-failed",
          result.stderr.trim().slice(-8192) || "The Python CAD runner did not return a result.",
        );
      const info = yield* fs.stat(resultPath);
      if (Number(info.size) > 1024 * 1024)
        return yield* failure("too-large", "The Python CAD result exceeded its size limit.");
      const response = yield* decode(yield* fs.readFileString(resultPath)).pipe(
        Effect.mapError(() =>
          failure("command-failed", "The Python CAD runner returned an invalid result."),
        ),
      );
      if (result.code !== 0 && response.ok)
        return yield* failure("command-failed", "The Python CAD process failed.");
      return {
        ...response,
        log: [
          ...result.stdout
            .split(/\r?\n/)
            .filter(Boolean)
            .map((text) => ({ level: "echo" as const, text: text.slice(0, 8192) })),
          ...result.stderr
            .split(/\r?\n/)
            .filter(Boolean)
            .map((text) => ({ level: "trace" as const, text: text.slice(0, 8192) })),
          ...response.log,
        ].slice(-500),
      };
    }, Effect.scoped);
    const probe = (interpreter: string) => run({ command: "probe", interpreter });
    const info = Effect.fn("PythonCad.info")(function* (refresh = false) {
      const time = yield* now;
      if (!refresh && cached && time - cached.at < 60000 && !settingUp) return cached.info;
      const managed = deps.getPythonPath() === null;
      const interpreter = deps.getPythonPath() ?? interpreterOf(venv);
      const uv = yield* uvPath();
      const base = {
        managed,
        path: interpreter,
        uv,
        installCommands: pythonInstallCommands(venv),
        pythonVersion: null,
        build123dVersion: null,
        detail: null,
      } satisfies Omit<PythonCadInfo, "state">;
      if (settingUp) return { ...base, state: "setting-up" as const };
      let value: PythonCadInfo;
      if (managed && !(yield* fs.exists(interpreter)))
        value = { ...base, path: null, state: "not-set-up" };
      else {
        const response = yield* probe(interpreter).pipe(Effect.result);
        if (response._tag === "Failure")
          value = { ...base, state: "broken", detail: response.failure.message };
        else
          value = {
            ...base,
            state: response.success.build123d ? "ready" : "missing-build123d",
            pythonVersion: response.success.python ?? null,
            build123dVersion: response.success.build123d ?? null,
          };
      }
      cached = { at: time, info: value };
      return value;
    });
    const requireReady = Effect.fn("PythonCad.requireReady")(function* () {
      const value = yield* info();
      if (value.state !== "ready" || !value.path)
        return yield* failure(
          "python-missing",
          value.detail ??
            "Set up Python CAD in Loom settings or choose an interpreter with build123d installed.",
        );
      return { ...value, path: value.path };
    });
    const inspectionInterpreter = Effect.fn("PythonCad.inspectionInterpreter")(function* () {
      const preferred = deps.getPythonPath() ?? interpreterOf(venv);
      for (const interpreter of new Set([preferred, "python3", "python"])) {
        const result = yield* probe(interpreter).pipe(Effect.option);
        if (result._tag === "Some") return interpreter;
      }
      return yield* failure(
        "python-missing",
        "Python 3 is required to read Python CAD parameters.",
      );
    });
    const setup = Effect.fn("PythonCad.setup")(
      function* (input: { action: "install" | "remove" }) {
        settingUp = true;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            settingUp = false;
            reset();
          }),
        );
        if (input.action === "remove") {
          yield* fs.remove(venv, { recursive: true, force: true });
          if (yield* fs.exists(directory))
            for (const name of yield* fs.readDirectory(directory))
              if (/^runner-[a-f0-9]+\.py$/.test(name))
                yield* fs.remove(path.join(directory, name), { force: true });
        } else {
          const uv = yield* uvPath();
          if (!uv)
            return yield* failure(
              "python-missing",
              "Install uv to set up Loom's Python CAD environment.",
            );
          const pending = path.join(directory, `venv-pending-${NodeCrypto.randomUUID()}`);
          yield* fs.makeDirectory(directory, { recursive: true });
          yield* Effect.addFinalizer(() =>
            fs.remove(pending, { recursive: true, force: true }).pipe(Effect.ignore),
          );
          const interpreter = interpreterOf(pending);
          for (const args of [
            ["venv", "--no-config", "--python", MANAGED_PYTHON_VERSION, pending],
            [
              "pip",
              "install",
              "--no-config",
              "--python",
              interpreter,
              "--only-binary",
              ":all:",
              `build123d==${TESTED_BUILD123D_VERSION}`,
            ],
          ]) {
            const result = yield* deps.runner
              .run({
                command: uv,
                args,
                timeout: "15 minutes",
                env: { ...pythonEnvironment(hostEnvironment), UV_NO_PROGRESS: "1" },
                extendEnv: false,
                maxOutputBytes: 256 * 1024,
                outputMode: "truncate",
              })
              .pipe(Effect.mapError((cause) => failure("command-failed", cause.message)));
            if (result.code !== 0)
              return yield* failure(
                "command-failed",
                result.stderr.trim().slice(-8192) || "Python CAD setup failed.",
              );
          }
          const ready = yield* probe(interpreter);
          if (ready.build123d !== TESTED_BUILD123D_VERSION)
            return yield* failure(
              "command-failed",
              "The new Python CAD environment did not pass its version check.",
            );
          const backup = path.join(directory, `venv-backup-${NodeCrypto.randomUUID()}`);
          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const existing = yield* fs.exists(venv);
              if (existing) yield* fs.rename(venv, backup);
              yield* fs
                .rename(pending, venv)
                .pipe(
                  Effect.onError(() =>
                    existing ? fs.rename(backup, venv).pipe(Effect.ignore) : Effect.void,
                  ),
                );
              if (existing) yield* fs.remove(backup, { recursive: true, force: true });
            }),
          );
        }
        settingUp = false;
        reset();
        return yield* info(true);
      },
      (effect) => lock.withPermit(Effect.scoped(effect)),
    );
    return { info, run, requireReady, inspectionInterpreter, setup, reset, ensureRunner };
  });
export type PythonEnvironment = Effect.Success<ReturnType<typeof makePythonEnvironment>>;
