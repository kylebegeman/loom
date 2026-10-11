// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import type * as Scope from "effect/Scope";
import {
  ModelPreviewError,
  type ScadRenderInput,
  ScadRenderResult,
  type SignedFile,
  type ModelPreviewSettings,
} from "@t3tools/contracts/fork";
import type { ProjectId } from "@t3tools/contracts";
import { validateLiteral } from "../customizer.ts";
import { cacheKey } from "../renderCache.ts";
import { RUNNER_VERSION } from "./runnerSource.ts";
import { LINEAR_TOLERANCE_MM, ANGULAR_TOLERANCE_RAD } from "./protocol.ts";
import type { PythonEnvironment } from "./environment.ts";
import type { makePythonInspector } from "./inspect.ts";
export type PythonResolved = {
  root: string;
  absolute: string;
  projectId: ProjectId;
  legacyParamsPath: string | null;
  info: FileSystem.File.Info;
};
type Sidecar = { parameterSets: Readonly<Record<string, Readonly<Record<string, unknown>>>> };
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeLog = Schema.decodeEffect(Schema.fromJsonString(ScadRenderResult.fields.log));
const decodeSummary = Schema.decodeEffect(Schema.fromJsonString(ScadRenderResult.fields.summary));
const now = Effect.map(DateTime.now, DateTime.toEpochMillis);
const isModelPreviewError = Schema.is(ModelPreviewError);
const failure = (reason: ModelPreviewError["reason"], message: string) =>
  new ModelPreviewError({ reason, message });
export const makePythonRenderer = (deps: {
  environment: PythonEnvironment;
  inspect: ReturnType<typeof makePythonInspector>;
  cacheDir: string;
  getSettings: () => ModelPreviewSettings;
  metadata: (info: FileSystem.File.Info) => { revision: string };
  readSidecar: (absolute: string) => Effect.Effect<Sidecar, ModelPreviewError>;
  restoreDependencies: (absolute: string) => Effect.Effect<unknown, ModelPreviewError>;
  dependencyMetadata: (
    absolute: string,
  ) => Effect.Effect<readonly (readonly [string, string])[], ModelPreviewError>;
  readDeps: (depfile: string, absolute: string) => Effect.Effect<unknown, ModelPreviewError>;
  persistDependencies: (absolute: string) => Effect.Effect<unknown, ModelPreviewError>;
  saveParams: (
    resolved: PythonResolved,
    input: ScadRenderInput,
  ) => Effect.Effect<unknown, ModelPreviewError>;
  protectStem: (stem: string) => Effect.Effect<unknown, never, Scope.Scope>;
  sign: (
    root: string,
    absolute: string,
    allowLarge: boolean,
  ) => Effect.Effect<SignedFile, ModelPreviewError>;
  prune: () => Effect.Effect<unknown, ModelPreviewError>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem,
      path = yield* Path.Path;
    const run = Effect.fn("PythonCad.render")(function* (
      input: ScadRenderInput,
      resolved: PythonResolved,
      options: {
        tessellate?: boolean;
        exportStep?: boolean;
        snapshot?: boolean;
        cachedOnly?: boolean;
      } = {},
    ) {
      const started = yield* now,
        settings = deps.getSettings();
      const environment = yield* deps.environment.requireReady();
      const isStep = options.tessellate === true;
      if (isStep && (Object.keys(input.overrides).length || input.parameterSet))
        return yield* failure("invalid-parameter", "STEP files do not have editable parameters.");
      const source = isStep
        ? deps.metadata(resolved.info).revision
        : yield* fs.readFileString(resolved.absolute);
      const sidecar = isStep ? { parameterSets: {} } : yield* deps.readSidecar(resolved.absolute);
      const inspected = isStep ? null : yield* deps.inspect(resolved.absolute, source);
      const parsed = inspected?.parameters ?? [];
      const values: Record<string, string> = {};
      if (input.parameterSet) {
        const set = sidecar.parameterSets[input.parameterSet];
        if (!set) return yield* failure("invalid-parameter", "The parameter set no longer exists.");
        for (const parameter of parsed) {
          const value = set[parameter.name];
          if (value === undefined) continue;
          values[parameter.name] =
            parameter.kind === "string"
              ? json(String(value))
              : typeof value === "string"
                ? value
                : json(value);
        }
      }
      Object.assign(values, input.overrides);
      for (const [name, value] of Object.entries(values)) {
        const parameter = parsed.find((p) => p.name === name);
        if (!parameter || !validateLiteral(parameter.kind, value))
          return yield* failure("invalid-parameter", `Invalid value for ${name}.`);
        if (parameter.options && !parameter.options.some((option) => option.value === value))
          return yield* failure("invalid-parameter", `Choose an available value for ${name}.`);
      }
      const format = options.exportStep ? "step" : settings.renderColors ? "3mf" : "stl";
      if (!isStep && !options.snapshot) yield* deps.restoreDependencies(resolved.absolute);
      const initialDependencies =
        isStep || options.snapshot ? [] : yield* deps.dependencyMetadata(resolved.absolute);
      const getHash = (dependencies: typeof initialDependencies) =>
        cacheKey(
          resolved.absolute + "\0" + source,
          input.overrides,
          input.parameterSet,
          json(sidecar),
          `${environment.path} ${environment.pythonVersion} ${environment.build123dVersion} ${RUNNER_VERSION}`,
          `linear ${LINEAR_TOLERANCE_MM} angular ${ANGULAR_TOLERANCE_RAD}`,
          format,
          dependencies,
        );
      let hash = getHash(initialDependencies),
        stem = path.join(deps.cacheDir, hash);
      yield* deps.protectStem(stem);
      const cached = yield* fs.exists(`${stem}.${format}`);
      if (!cached && options.cachedOnly)
        return {
          status: "error",
          mesh: null,
          meshFormat: null,
          cached: false,
          durationMs: (yield* now) - started,
          log: [],
          summary: null,
        } satisfies ScadRenderResult;
      let log: ScadRenderResult["log"] = inspected?.log ?? [],
        summary: ScadRenderResult["summary"] = null;
      if (!cached) {
        const pending = path.join(deps.cacheDir, `pending-${NodeCrypto.randomUUID()}`);
        yield* Effect.addFinalizer(() =>
          Effect.forEach(
            [`.${format}`, ".deps", ".summary.json", ".log"],
            (suffix) => fs.remove(pending + suffix, { force: true }).pipe(Effect.ignore),
            { discard: true },
          ),
        );
        const response = yield* deps.environment
          .run({
            command: isStep ? "tessellate" : options.exportStep ? "export-step" : "render",
            interpreter: environment.path,
            cwd: path.dirname(resolved.absolute),
            timeoutSeconds: settings.renderTimeoutSeconds,
            request: {
              source: resolved.absolute,
              root: resolved.root,
              values,
              format,
              output: `${pending}.${format}`,
              depsPath: `${pending}.deps`,
              linear: LINEAR_TOLERANCE_MM,
              angular: ANGULAR_TOLERANCE_RAD,
            },
          })
          .pipe(
            Effect.catchIf(
              (cause) => isModelPreviewError(cause) && cause.reason === "timeout",
              () =>
                Effect.succeed({
                  ok: false,
                  log: [
                    {
                      level: "error" as const,
                      text: `Render timed out after ${settings.renderTimeoutSeconds} s.`,
                    },
                  ],
                  summary: null,
                }),
            ),
          );
        log = [...log, ...response.log].slice(-500);
        if (!response.ok || !(yield* fs.exists(`${pending}.${format}`)))
          return {
            status: "error",
            mesh: null,
            meshFormat: null,
            cached: false,
            durationMs: (yield* now) - started,
            log: log.some((row) => row.level === "error")
              ? log
              : [...log, { level: "error", text: "Python CAD did not produce a model." }],
            summary: null,
          } satisfies ScadRenderResult;
        summary = response.summary ?? null;
        if (!isStep && !options.snapshot)
          yield* deps.readDeps(`${pending}.deps`, resolved.absolute);
        const finalDependencies =
          isStep || options.snapshot ? [] : yield* deps.dependencyMetadata(resolved.absolute);
        const changed = isStep
          ? source !== deps.metadata(yield* fs.stat(resolved.absolute)).revision
          : source !== (yield* fs.readFileString(resolved.absolute)) ||
            json(sidecar) !== json(yield* deps.readSidecar(resolved.absolute)) ||
            initialDependencies.some(([name, revision]) =>
              finalDependencies.some(
                ([nextName, nextRevision]) => name === nextName && revision !== nextRevision,
              ),
            );
        if (changed)
          return {
            status: "error",
            mesh: null,
            meshFormat: null,
            cached: false,
            durationMs: (yield* now) - started,
            log: [
              ...log,
              {
                level: "error",
                text: "Model inputs changed during rendering. Refresh preview to render the latest version.",
              },
            ],
            summary: null,
          } satisfies ScadRenderResult;
        hash = getHash(finalDependencies);
        stem = path.join(deps.cacheDir, hash);
        yield* deps.protectStem(stem);
        yield* fs.writeFileString(`${pending}.summary.json`, json(summary));
        yield* fs.writeFileString(`${pending}.log`, json(log));
        // Publish the mesh last, so a cache hit always has its log and summary.
        for (const suffix of [".summary.json", ".log", ".deps", `.${format}`])
          if (yield* fs.exists(pending + suffix)) yield* fs.rename(pending + suffix, stem + suffix);
        if (!isStep && !options.snapshot) yield* deps.persistDependencies(resolved.absolute);
      } else {
        log = yield* decodeLog(yield* fs.readFileString(`${stem}.log`));
        summary = yield* decodeSummary(yield* fs.readFileString(`${stem}.summary.json`));
        const time = (yield* now) / 1000;
        yield* fs.utimes(`${stem}.${format}`, time, time);
        if (!isStep && !options.snapshot) yield* deps.readDeps(`${stem}.deps`, resolved.absolute);
      }
      if (
        !input.variantId &&
        !isStep &&
        !options.snapshot &&
        !options.exportStep &&
        !options.cachedOnly
      )
        yield* deps.saveParams(resolved, input);
      const mesh = yield* deps.sign(deps.cacheDir, `${stem}.${format}`, true);
      yield* deps.prune();
      return {
        status: "ok",
        mesh: { ...mesh, revision: hash },
        meshFormat: format === "step" ? null : format,
        cached,
        durationMs: (yield* now) - started,
        log,
        summary,
      } satisfies ScadRenderResult;
    });
    return { run };
  });
