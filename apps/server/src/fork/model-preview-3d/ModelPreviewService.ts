// @effect-diagnostics nodeBuiltinImport:off
import { makeEditorBridge } from "../editorBridge.ts";
import type {
  ModelEditorAction,
  ModelEditorInput,
  ModelEditorResult,
  ModelEditorComplete,
} from "@t3tools/contracts/fork";
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import {
  ModelPreviewError,
  bedFitSummary,
  OverhangStats,
  overhangStats,
  type ModelWorkspaceOperation,
  type ModelWorkspace,
  type ModelVariant,
  type ModelFileRef,
  type ModelPreviewSettingsUpdate,
  type ModelProjection,
  type ScadRenderInput,
  ScadRenderResult,
  type ModelWatchEvent,
  type TurnModels,
  modelFormatOf,
  normalizeQuaternion,
  quaternionMatrix,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Fiber from "effect/Fiber";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as DateTime from "effect/DateTime";
import type { RunId } from "@t3tools/contracts";
import { makeTurnFiles, type TurnCheckpoint } from "../turnFiles.ts";
import { SCAD_INPUT_EXTENSIONS } from "./formats.ts";
import { scadReferences, resolveScadReference } from "./scadIncludes.ts";
import { dependentModels, modelCandidates, capTurnModels } from "./turnModels.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { applyWorkspaceOperation } from "./workspace.ts";
import { makeStore } from "./store.ts";
import { mintToken, verifyToken, resolveTokenPath, isContained } from "./signedFiles.ts";
import { parseCustomizer, validateLiteral, literalValue } from "./customizer.ts";
import {
  detectedInfo,
  parseLog,
  parseSummary,
  renderArgs,
  meshArgs,
  pngArgs,
  DEFAULT_RENDER_PROJECTION,
  type ModelView,
} from "./openscad.ts";
import { cacheKey, pruneList, createStemProtection } from "./renderCache.ts";
import { threeMfScale } from "./threeMfUnits.ts";
import { parseBinaryStl } from "./overhangMesh.ts";
import { makePrintChecker } from "./check/printChecker.ts";

const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const error = (reason: ModelPreviewError["reason"], message: string) =>
  new ModelPreviewError({ reason, message });
const isModelPreviewError = Schema.is(ModelPreviewError);
const isOverhangAngle = Schema.is(OverhangStats.fields.thresholdDegrees);
const mapError = (cause: unknown) =>
  isModelPreviewError(cause)
    ? cause
    : error(
        "command-failed",
        cause instanceof Error ? cause.message : "The model operation failed.",
      );
const checked = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.mapError(mapError));
const Sidecar = Schema.Struct({
  fileFormatVersion: Schema.optional(Schema.String),
  parameterSets: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
});
const decodeUnknownJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeSidecar = Schema.decodeUnknownEffect(Sidecar);
const decodeLog = Schema.decodeEffect(Schema.fromJsonString(ScadRenderResult.fields.log));
const metadata = (info: FileSystem.File.Info) => {
  const modifiedAt = Option.match(info.mtime, {
    onNone: () => "1970-01-01T00:00:00.000Z",
    onSome: (date) => date.toISOString(),
  });
  const sizeBytes = Number(info.size);
  return {
    sizeBytes,
    modifiedAt,
    revision: NodeCrypto.createHash("sha256")
      .update(`${sizeBytes}:${modifiedAt}:${Option.getOrElse(info.ino, () => 0)}`)
      .digest("hex")
      .slice(0, 24),
  };
};
export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const config = yield* ServerConfig,
    queries = yield* ProjectionStore.ProjectionStoreV2,
    projectStore = yield* ProjectStore.ProjectStoreV2,
    entries = yield* WorkspaceEntries;
  const runner = yield* ProcessRunner.ProcessRunner,
    store = yield* makeStore;
  const key = yield* (yield* ServerSecretStore).getOrCreateRandom(
    "loom-model-preview-3d-url-key",
    32,
  );
  const cachePath = path.join(config.stateDir, "fork", "model-preview-3d", "renders");
  yield* fs.makeDirectory(cachePath, { recursive: true });
  const cacheDir = yield* fs.realPath(cachePath);
  const dependencyDir = path.join(config.stateDir, "fork", "model-preview-3d", "dependencies");
  yield* fs.makeDirectory(dependencyDir, { recursive: true });
  let settings = yield* store.getSettings();
  const projects = yield* projectStore.listShells();
  yield* store.sweep(projects.map((p) => p.id));
  const workspaceLock = yield* Semaphore.make(1);
  const workspaceSubscribers = new Map<string, Set<PubSub.PubSub<void>>>();
  const dependencies = new Map<string, string[]>();
  const turnFiles = yield* makeTurnFiles;
  const scadParseCache = new Map<string, { revision: string; refs: readonly string[] }>();
  const depUpdates = yield* PubSub.unbounded<string>();
  const jobs = new Map<string, Fiber.Fiber<ScadRenderResult, ModelPreviewError>>();
  const jobLock = yield* Semaphore.make(1),
    renderSlots = yield* Semaphore.make(Math.max(1, Math.floor(NodeOS.availableParallelism() / 2)));
  const sidecarLock = yield* Semaphore.make(1),
    cacheLock = yield* Semaphore.make(1);
  const imageJobs = new Set<Fiber.Fiber<unknown, ModelPreviewError>>();
  const protection = createStemProtection();
  const protectStem = (stem: string) =>
    Effect.acquireRelease(
      cacheLock.withPermit(Effect.sync(() => protection.acquire(stem))),
      (release) => Effect.sync(release),
    );
  let detection: { at: number; value: ReturnType<typeof detectedInfo> } | null = null;
  const now = Effect.map(DateTime.now, DateTime.toEpochMillis);
  const resolveWorkspace = Effect.fn("ModelPreview.resolveWorkspace")(function* (
    file: ModelFileRef,
  ) {
    const thread = yield* queries.getThread(file.threadId);
    const project = yield* projectStore.get(thread.projectId);
    if (Option.isNone(project))
      return yield* error("workspace-not-found", "This thread has no workspace.");
    const cwd = thread.worktreePath ?? project.value.workspaceRoot;
    const root = yield* fs.realPath(cwd);
    if (
      path.isAbsolute(file.path) ||
      file.path.includes("\\") ||
      file.path.includes("\0") ||
      file.path.split("/").includes("..")
    )
      return yield* error("invalid-path", "Choose a file inside the workspace.");
    const absolute = path.resolve(root, file.path);
    if (!isContained(root, absolute))
      return yield* error("invalid-path", "Choose a file inside the workspace.");
    return {
      root,
      absolute,
      projectId: thread.projectId,
      legacyParamsPath: thread.worktreePath ? null : file.path,
    };
  });
  const resolveFile = Effect.fn("ModelPreview.resolveFile")(function* (file: ModelFileRef) {
    const workspace = yield* resolveWorkspace(file);
    const real = yield* fs
      .realPath(workspace.absolute)
      .pipe(Effect.mapError(() => error("not-found", "The file was deleted or moved.")));
    if (!isContained(workspace.root, real))
      return yield* error("invalid-path", "The file points outside the workspace.");
    const info = yield* fs.stat(real);
    if (info.type !== "File") return yield* error("not-found", "Choose a model file.");
    return { ...workspace, absolute: real, info };
  });
  const containedReference = Effect.fn("ModelPreview.containedReference")(function* (
    root: string,
    absolute: string,
  ) {
    if (!isContained(root, absolute)) return null;
    // Missing inputs still affect their including model, but existing symlinks must stay inside.
    const canonical = yield* fs.realPath(absolute).pipe(Effect.orElseSucceed(() => absolute));
    return isContained(root, canonical) ? canonical : null;
  });
  const scadDependents = Effect.fn("ModelPreview.scadDependents")(function* (
    threadId: ModelFileRef["threadId"],
    root: string,
    changed: readonly string[],
  ) {
    const reverse = new Map<string, Set<string>>();
    const add = (dependency: string, model: string) => {
      if (!isContained(root, dependency) || !isContained(root, model)) return;
      const parents = reverse.get(dependency) ?? new Set<string>();
      parents.add(model);
      reverse.set(dependency, parents);
    };
    for (const [model, inputs] of dependencies)
      if (modelFormatOf(model) === "scad") for (const input of inputs) add(input, model);
    const listing = yield* entries.list({ cwd: root });
    const sources = listing.entries.filter(
      (entry) => entry.kind === "file" && modelFormatOf(entry.path) === "scad",
    );
    const scanned = yield* Effect.forEach(
      sources.slice(0, 500),
      (entry) =>
        Effect.gen(function* () {
          const resolved = yield* resolveFile({ threadId, path: entry.path });
          if (Number(resolved.info.size) > 256 * 1024) return null;
          const revision = metadata(resolved.info).revision;
          let parsed = scadParseCache.get(resolved.absolute);
          if (parsed?.revision !== revision) {
            const source = yield* fs.readFileString(resolved.absolute);
            if (source.length > 256 * 1024) return null;
            parsed = {
              revision,
              refs: scadReferences(source).map((ref) =>
                resolveScadReference(resolved.absolute, ref),
              ),
            };
            if (!scadParseCache.has(resolved.absolute) && scadParseCache.size >= 2000)
              scadParseCache.delete(scadParseCache.keys().next().value!);
            scadParseCache.set(resolved.absolute, parsed);
          }
          for (const input of parsed.refs) {
            const contained = yield* containedReference(root, input);
            if (contained) add(contained, resolved.absolute);
          }
          return resolved.absolute;
        }).pipe(Effect.option),
      { concurrency: 8 },
    );
    const changedAbsolute = yield* Effect.forEach(changed, (file) =>
      containedReference(root, path.resolve(root, file)),
    );
    const changedPaths = new Map<string, string>();
    for (let index = 0; index < changedAbsolute.length; index++) {
      const absolute = changedAbsolute[index];
      if (absolute && !changedPaths.has(absolute)) changedPaths.set(absolute, changed[index]!);
    }
    const result = dependentModels([...changedPaths.keys()], reverse);
    const relative = new Map(
      [...result.models].map(([model, via]) => [
        path.relative(root, model).split(path.sep).join("/"),
        changedPaths.get(via)!,
      ]),
    );
    return {
      models: relative,
      truncated:
        result.truncated ||
        listing.truncated ||
        sources.length > 500 ||
        scanned.some((item) => Option.isNone(item) || item.value === null),
    };
  });
  const modelsForCheckpoint = Effect.fn("ModelPreview.modelsForCheckpoint")(function* (
    threadId: ModelFileRef["threadId"],
    root: string,
    prefix: string,
    checkpoint: TurnCheckpoint,
  ) {
    const changed = turnFiles.workspaceFiles(prefix, checkpoint.files);
    const inputs = changed.filter((file) =>
      SCAD_INPUT_EXTENSIONS.has(path.extname(file).toLowerCase()),
    );
    const dependent = inputs.length
      ? yield* scadDependents(threadId, root, inputs)
      : {
          models: new Map<string, string>(),
          truncated: false,
        };
    const candidates = modelCandidates(changed, dependent.models);
    const valid = yield* Effect.forEach(
      candidates,
      (candidate) =>
        resolveFile({ threadId, path: candidate.path }).pipe(Effect.as(candidate), Effect.option),
      { concurrency: 16 },
    );
    const capped = capTurnModels(valid.flatMap(Option.toArray));
    return {
      threadId,
      runId: checkpoint.runId,
      checkpointId: checkpoint.checkpointId,
      turn: checkpoint.turn,
      models: capped.models,
      truncated: capped.truncated || dependent.truncated,
    } satisfies TurnModels;
  });
  const emptyTurnModels = (threadId: ModelFileRef["threadId"]): TurnModels => ({
    threadId,
    runId: null,
    checkpointId: null,
    turn: null,
    models: [],
    truncated: false,
  });
  const turnModels = Effect.fn("ModelPreview.turnModels")(function* (
    threadId: ModelFileRef["threadId"],
    runId: RunId | null,
  ) {
    const { root } = yield* resolveWorkspace({ threadId, path: "." });
    const prefix = yield* turnFiles.repoPrefix(root);
    if (prefix === null) return emptyTurnModels(threadId);
    const checkpoints = yield* turnFiles.turnCheckpoints(threadId, runId, 20);
    // The workspace index is cached. Refresh once per lookup only when SCAD dependencies matter.
    if (
      checkpoints.some((checkpoint) =>
        turnFiles
          .workspaceFiles(prefix, checkpoint.files)
          .some((file) => SCAD_INPUT_EXTENSIONS.has(path.extname(file).toLowerCase())),
      )
    )
      yield* entries.refresh(root);
    for (const checkpoint of checkpoints) {
      const models = yield* modelsForCheckpoint(threadId, root, prefix, checkpoint);
      if (runId !== null || models.models.length) return models;
    }
    return emptyTurnModels(threadId);
  });
  const turnModelEvents = (threadId: ModelFileRef["threadId"]) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const { root } = yield* resolveWorkspace({ threadId, path: "." });
        const prefix = yield* turnFiles.repoPrefix(root);
        if (prefix === null) return Stream.empty;
        return turnFiles.turnCheckpointEvents(threadId).pipe(
          Stream.mapEffect((checkpoint) =>
            Effect.gen(function* () {
              const changed = turnFiles.workspaceFiles(prefix, checkpoint.files);
              if (
                changed.some((file) => SCAD_INPUT_EXTENSIONS.has(path.extname(file).toLowerCase()))
              )
                yield* entries.refresh(root);
              return yield* modelsForCheckpoint(threadId, root, prefix, checkpoint);
            }),
          ),
          Stream.filter((result) => result.models.length > 0),
        );
      }),
    ).pipe(Stream.mapError(mapError));
  const sign = Effect.fn("ModelPreview.sign")(function* (
    root: string,
    absolute: string,
    allowLarge = false,
    ttlMs = 3600000,
  ) {
    const info = yield* fs.stat(absolute),
      meta = metadata(info);
    if (meta.sizeBytes > settings.maxFileMegabytes * 1024 * 1024 && !allowLarge)
      return yield* error(
        "too-large",
        `This file is ${(meta.sizeBytes / 1024 / 1024).toFixed(1)} MB; the limit is ${settings.maxFileMegabytes} MB.`,
      );
    const expiresAt = (yield* now) + ttlMs;
    const token = mintToken(
      { root, base: path.dirname(absolute), exp: expiresAt, large: allowLarge },
      key,
    );
    return {
      ...meta,
      expiresAt,
      relativeUrl: `/api/loom/model-preview-3d/f/${token}/${encodeURIComponent(path.basename(absolute))}`,
    };
  });
  const sidecarPath = (absolute: string) => absolute.replace(/\.scad$/i, ".json");
  const readSidecar = Effect.fn("ModelPreview.readSidecar")(function* (absolute: string) {
    const target = sidecarPath(absolute);
    if (!(yield* fs.exists(target))) return { fileFormatVersion: "1", parameterSets: {} };
    const real = yield* fs.realPath(target);
    if (!isContained(path.dirname(absolute), real))
      return yield* error(
        "invalid-path",
        "The parameter sidecar points outside the model directory.",
      );
    const raw = yield* decodeUnknownJson(yield* fs.readFileString(target));
    const decoded = yield* decodeSidecar(raw);
    return { ...(raw as Record<string, unknown>), ...decoded };
  });
  const parameters = Effect.fn("ModelPreview.parameters")(function* (file: ModelFileRef) {
    const resolved = yield* resolveFile(file);
    if (modelFormatOf(file.path) !== "scad")
      return yield* error("unsupported-format", "Parameters are available for OpenSCAD files.");
    const source = yield* fs.readFileString(resolved.absolute);
    const parsed = parseCustomizer(source);
    const sidecar = yield* readSidecar(resolved.absolute);
    const previous = yield* store.getParams(
      resolved.projectId,
      resolved.root + "\0" + file.path,
      resolved.legacyParamsPath,
    );
    const setValues = Object.fromEntries(
      Object.entries(sidecar.parameterSets).map(([name, values]) => [
        name,
        Object.fromEntries(
          parsed.flatMap((parameter) => {
            const value = values[parameter.name];
            if (value === undefined) return [];
            const literal =
              parameter.kind === "string"
                ? json(String(value))
                : typeof value === "string"
                  ? value
                  : json(value);
            return validateLiteral(parameter.kind, literal) ? [[parameter.name, literal]] : [];
          }),
        ),
      ]),
    );
    yield* restoreDependencies(resolved.absolute);
    return {
      sourceRevision: NodeCrypto.createHash("sha256")
        .update(source)
        .update(json(yield* dependencyMetadata(resolved.absolute)))
        .digest("hex"),
      parameters: parsed,
      setValues,
      sets: Object.keys(sidecar.parameterSets),
      lastUsed: Object.fromEntries(
        Object.entries(previous.lastUsed).filter(([name, value]) => {
          const parameter = parsed.find((item) => item.name === name);
          return parameter && validateLiteral(parameter.kind, value);
        }),
      ),
      lastUsedSet:
        previous.lastUsedSet && Object.hasOwn(sidecar.parameterSets, previous.lastUsedSet)
          ? previous.lastUsedSet
          : null,
    };
  });
  const status = Effect.fn("ModelPreview.status")(function* (refresh = false) {
    const time = yield* now;
    if (refresh || !detection || time - detection.at > 60000) {
      const candidates = [
        ...new Set(
          [
            settings.openscadPath,
            "openscad",
            "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD",
            "/Applications/OpenSCAD-Nightly.app/Contents/MacOS/OpenSCAD",
            "/Applications/OpenSCAD-Dev.app/Contents/MacOS/OpenSCAD",
            path.join(
              NodeOS.homedir(),
              "Applications",
              "OpenSCAD.app",
              "Contents",
              "MacOS",
              "OpenSCAD",
            ),
          ].filter((v): v is string => v !== null),
        ),
      ];
      let info: ReturnType<typeof detectedInfo> = {
        path: null,
        version: null,
        isSnapshot: false,
        supportsManifold: false,
        supportsColors: false,
        supportsSummary: false,
      };
      for (const candidate of candidates) {
        const version = yield* runner
          .run({ command: candidate, args: ["--version"], timeout: "5 seconds" })
          .pipe(Effect.option);
        if (Option.isNone(version) || version.value.code !== 0) continue;
        const help = yield* runner
          .run({ command: candidate, args: ["--help"], timeout: "5 seconds" })
          .pipe(Effect.option);
        const exportHelp = yield* runner
          .run({ command: candidate, args: ["--help-export"], timeout: "5 seconds" })
          .pipe(Effect.option);
        info = detectedInfo(
          candidate,
          version.value.stdout + version.value.stderr,
          (Option.isSome(help) ? help.value.stdout + help.value.stderr : "") +
            (Option.isSome(exportHelp) && exportHelp.value.code === 0
              ? exportHelp.value.stdout + exportHelp.value.stderr
              : ""),
        );
        break;
      }
      detection = { at: time, value: info };
    }
    return { openscad: detection.value, maxFileBytes: settings.maxFileMegabytes * 1024 * 1024 };
  });
  const validateOverrides = (
    parsed: ReturnType<typeof parseCustomizer>,
    values: Readonly<Record<string, string>>,
  ) =>
    Effect.gen(function* () {
      for (const [name, value] of Object.entries(values)) {
        const parameter = parsed.find((p) => p.name === name);
        if (!parameter || !validateLiteral(parameter.kind, value))
          return yield* error("invalid-parameter", `Invalid value for ${name}.`);
      }
    });
  const prune = Effect.fn("ModelPreview.prune")(function* () {
    const names = (yield* fs.readDirectory(cacheDir)).filter(
      (name) =>
        !name.startsWith("pending-") &&
        ![...protection.stems()].some((stem) => path.join(cacheDir, name).startsWith(stem)),
    );
    const data = yield* Effect.forEach(
      names,
      (name) =>
        fs.stat(path.join(cacheDir, name)).pipe(
          Effect.map((info) => ({
            path: path.join(cacheDir, name),
            size: Number(info.size),
            modified: Option.match(info.mtime, {
              onNone: () => 0,
              onSome: (date) => date.getTime(),
            }),
          })),
        ),
      { concurrency: 16 },
    );
    yield* Effect.forEach(pruneList(data), (p) => fs.remove(p, { force: true }), { discard: true });
  }, cacheLock.withPermit);
  const dependencyRecordPath = (absolute: string) =>
    path.join(
      dependencyDir,
      NodeCrypto.createHash("sha256").update(absolute).digest("hex") + ".json",
    );
  const decodeDependencies = Schema.decodeEffect(
    Schema.fromJsonString(Schema.Array(Schema.String)),
  );
  const restoreDependencies = Effect.fn("ModelPreview.restoreDependencies")(function* (
    absolute: string,
  ) {
    if (dependencies.has(absolute)) return;
    const recorded = yield* fs.readFileString(dependencyRecordPath(absolute)).pipe(
      Effect.flatMap(decodeDependencies),
      Effect.orElseSucceed(() => []),
    );
    dependencies.set(absolute, [...recorded]);
    yield* PubSub.publish(depUpdates, absolute);
  });
  const dependencyMetadata = (absolute: string) =>
    Effect.forEach(
      dependencies.get(absolute) ?? [],
      (dep) =>
        fs.stat(dep).pipe(
          Effect.map((info) => [dep, metadata(info).revision] as const),
          Effect.orElseSucceed(() => [dep, "missing"] as const),
        ),
      { concurrency: 16 },
    );
  const readDeps = Effect.fn("ModelPreview.readDeps")(function* (file: string, absolute: string) {
    const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
    const body = text.replace(/\\\r?\n/g, " ").replace(/^.*?:[ \t]+/, "");
    const names = body.match(/(?:\\.|[^\s])+/g) ?? [];
    const previous = dependencies.get(absolute);
    const candidates = [
      ...new Set(names.map((n) => path.resolve(path.dirname(absolute), n.replace(/\\(.)/g, "$1")))),
    ];
    const canonical = yield* Effect.forEach(
      candidates,
      (candidate) => fs.realPath(candidate).pipe(Effect.orElseSucceed(() => candidate)),
      { concurrency: 16 },
    );
    const next = [...new Set(canonical)].filter((candidate) => candidate !== absolute);
    dependencies.set(absolute, next);
    if (json(previous ?? []) !== json(next)) yield* PubSub.publish(depUpdates, absolute);
  });
  const runRender = Effect.fn("ModelPreview.runRender")(function* (
    input: ScadRenderInput,
    resolved: Effect.Success<ReturnType<typeof resolveFile>>,
  ) {
    const start = yield* now,
      currentSettings = settings;
    const info = (yield* status()).openscad;
    if (!info.path)
      return yield* error(
        "openscad-missing",
        "Install an OpenSCAD development snapshot to preview .scad files.",
      );
    if (currentSettings.backend === "manifold" && !info.supportsManifold)
      return yield* error(
        "command-failed",
        "This OpenSCAD build does not support the Manifold backend. Choose Auto or install a development snapshot.",
      );
    if (currentSettings.renderColors && !info.supportsColors)
      return yield* error(
        "command-failed",
        "This OpenSCAD build does not support model color export. Turn off Render colors or install a development snapshot.",
      );
    const source = yield* fs.readFileString(resolved.absolute),
      parsed = parseCustomizer(source);
    yield* validateOverrides(parsed, input.overrides);
    const sidecar = yield* readSidecar(resolved.absolute);
    if (input.parameterSet && !Object.hasOwn(sidecar.parameterSets, input.parameterSet))
      return yield* error("invalid-parameter", "The parameter set no longer exists.");
    const format = currentSettings.renderColors ? "3mf" : "stl";
    const dependencyRecord = dependencyRecordPath(resolved.absolute);
    yield* restoreDependencies(resolved.absolute);
    const initialDependencies = yield* dependencyMetadata(resolved.absolute);
    const getHash = (deps: typeof initialDependencies) =>
      cacheKey(
        resolved.absolute + "\0" + source,
        input.overrides,
        input.parameterSet,
        json(sidecar),
        info.version,
        currentSettings.backend,
        format,
        deps,
      );
    let hash = getHash(initialDependencies);
    let stem = path.join(cacheDir, hash),
      output = `${stem}.${format}`,
      summaryPath = `${stem}.summary.json`,
      depsPath = `${stem}.deps`;
    // Acquire under the pruning lock before checking the cache. A prune that already
    // selected this output must finish before a new reader can rely on its existence.
    yield* protectStem(stem);
    let cached = yield* fs.exists(output),
      log: ScadRenderResult["log"] = [];
    if (!cached) {
      const pendingStem = path.join(cacheDir, `pending-${NodeCrypto.randomUUID()}`);
      stem = pendingStem;
      output = `${stem}.${format}`;
      summaryPath = `${stem}.summary.json`;
      depsPath = `${stem}.deps`;
      yield* Effect.addFinalizer(() =>
        Effect.forEach(
          [`.${format}`, ".summary.json", ".deps", ".log"],
          (suffix) => fs.remove(pendingStem + suffix, { force: true }).pipe(Effect.ignore),
          { discard: true },
        ),
      );
      const result = yield* runner.run({
        command: info.path,
        args: renderArgs({
          source: resolved.absolute,
          output,
          deps: depsPath,
          summary: summaryPath,
          info,
          settings: currentSettings,
          overrides: input.overrides,
          parameterSet: input.parameterSet,
          sidecar: sidecarPath(resolved.absolute),
        }),
        cwd: path.dirname(resolved.absolute),
        timeout: `${currentSettings.renderTimeoutSeconds} seconds`,
        timeoutBehavior: "timedOutResult",
        outputMode: "truncate",
        maxOutputBytes: 512 * 1024,
      });
      log = parseLog(result.stderr);
      if (
        result.timedOut ||
        result.code !== 0 ||
        log.some((l) => l.level === "error") ||
        !(yield* fs.exists(output))
      ) {
        yield* fs.remove(output, { force: true });
        if (result.timedOut)
          log = [
            ...log,
            {
              level: "error",
              text: `Render timed out after ${currentSettings.renderTimeoutSeconds} s.`,
            },
          ];
        if (!log.some((l) => l.level === "error"))
          log = [...log, { level: "error", text: "OpenSCAD did not produce a mesh." }];
        return {
          status: "error",
          mesh: null,
          meshFormat: null,
          cached: false,
          durationMs: (yield* now) - start,
          log,
          summary: null,
        } satisfies ScadRenderResult;
      }
      yield* readDeps(depsPath, resolved.absolute);
      const finalDependencies = yield* dependencyMetadata(resolved.absolute);
      // OpenSCAD reads live files. Never label an output with inputs edited during the job.
      const changed =
        source !== (yield* fs.readFileString(resolved.absolute)) ||
        json(sidecar) !== json(yield* readSidecar(resolved.absolute)) ||
        initialDependencies.some(([file, revision]) =>
          finalDependencies.some(
            ([nextFile, nextRevision]) => file === nextFile && revision !== nextRevision,
          ),
        );
      if (changed)
        return {
          status: "error",
          mesh: null,
          meshFormat: null,
          cached: false,
          durationMs: (yield* now) - start,
          log: [
            ...log,
            {
              level: "error",
              text: "Model inputs changed during rendering. Refresh preview to render the latest version.",
            },
          ],
          summary: null,
        } satisfies ScadRenderResult;
      yield* fs.writeFileString(dependencyRecord, json(dependencies.get(resolved.absolute) ?? []));
      const finalHash = getHash(finalDependencies);
      if (stem !== path.join(cacheDir, finalHash)) {
        const finalStem = path.join(cacheDir, finalHash);
        yield* protectStem(finalStem);
        for (const suffix of [`.${format}`, ".summary.json", ".deps"]) {
          if (yield* fs.exists(stem + suffix)) yield* fs.rename(stem + suffix, finalStem + suffix);
        }
        hash = finalHash;
        stem = finalStem;
        output = `${stem}.${format}`;
        summaryPath = `${stem}.summary.json`;
        depsPath = `${stem}.deps`;
      }
      yield* fs.writeFileString(`${stem}.log`, json(log));
    } else {
      yield* fs.utimes(output, (yield* now) / 1000, (yield* now) / 1000);
      const text = yield* fs.readFileString(`${stem}.log`).pipe(Effect.orElseSucceed(() => "[]"));
      log = yield* decodeLog(text);
    }
    yield* readDeps(depsPath, resolved.absolute);
    const summary = parseSummary(
      yield* fs.readFileString(summaryPath).pipe(Effect.orElseSucceed(() => "")),
    );
    if (!input.variantId)
      yield* store.saveParams(
        resolved.projectId,
        resolved.root + "\0" + input.file.path,
        input.overrides,
        input.parameterSet,
      );
    const mesh = yield* sign(cacheDir, output, true);
    yield* prune();
    return {
      status: "ok",
      // Cache access timestamps change on reuse; the render key identifies geometry.
      mesh: { ...mesh, revision: hash },
      meshFormat: format,
      cached,
      durationMs: (yield* now) - start,
      log,
      summary,
    } satisfies ScadRenderResult;
  });
  const renderScad = Effect.fn("ModelPreview.renderScad")(function* (input: ScadRenderInput) {
    const resolved = yield* resolveFile(input.file);
    if (modelFormatOf(input.file.path) !== "scad")
      return yield* error("unsupported-format", "Choose an OpenSCAD file.");
    const jobKey = resolved.absolute + (input.variantId ? `\0${input.variantId}` : "");
    const fiber = yield* jobLock.withPermit(
      Effect.gen(function* () {
        const previous = jobs.get(jobKey);
        if (previous) yield* Fiber.interrupt(previous);
        const next = yield* checked(
          renderSlots.withPermit(Effect.scoped(runRender(input, resolved))),
        ).pipe(Effect.forkChild);
        jobs.set(jobKey, next);
        return next;
      }),
    );
    const result = yield* Effect.exit(Fiber.join(fiber)).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (jobs.get(jobKey) === fiber) jobs.delete(jobKey);
        }),
      ),
    );
    if (Exit.isSuccess(result)) return result.value;
    if (Cause.hasInterrupts(result.cause))
      return {
        status: "cancelled",
        mesh: null,
        meshFormat: null,
        cached: false,
        durationMs: 0,
        log: [],
        summary: null,
      } satisfies ScadRenderResult;
    return yield* Effect.failCause(result.cause);
  });
  const nearestDirectory = Effect.fn("ModelPreview.nearestDirectory")(function* (
    directory: string,
  ) {
    let current = directory;
    for (;;) {
      const stat = yield* fs.stat(current).pipe(Effect.option);
      if (Option.isSome(stat) && stat.value.type === "Directory") return current;
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  });
  const watch = (file: ModelFileRef) =>
    Stream.unwrap(
      checked(
        Effect.gen(function* () {
          const workspace = yield* resolveWorkspace(file);
          const absolute = yield* fs
            .realPath(workspace.absolute)
            .pipe(Effect.orElseSucceed(() => workspace.absolute));
          if (!isContained(workspace.root, absolute))
            return yield* error("invalid-path", "The file points outside the workspace.");
          const resolved = { ...workspace, absolute };
          yield* restoreDependencies(absolute);
          const changes = Stream.fromPubSub(depUpdates).pipe(
            Stream.filter((p) => p === resolved.absolute),
          );
          return Stream.concat(Stream.succeed(resolved.absolute), changes).pipe(
            Stream.switchMap(() =>
              Stream.unwrap(
                Effect.gen(function* () {
                  const targets = [
                    resolved.absolute,
                    sidecarPath(resolved.absolute),
                    ...(dependencies.get(resolved.absolute) ?? []),
                  ];
                  const dirs = yield* Effect.forEach(
                    [...new Set(targets.map((p) => path.dirname(p)))],
                    nearestDirectory,
                    { concurrency: 16 },
                  );
                  const directories = [...new Set(dirs)];
                  return Stream.mergeAll(
                    directories.map((dir) =>
                      fs.watch(dir).pipe(
                        Stream.filter((event) =>
                          targets.some((target) =>
                            isContained(path.resolve(dir, event.path), target),
                          ),
                        ),
                        Stream.map((event) => path.resolve(dir, event.path)),
                      ),
                    ),
                    { concurrency: "unbounded" },
                  ).pipe(
                    Stream.debounce("150 millis"),
                    Stream.mapEffect((changed) =>
                      fs.stat(resolved.absolute).pipe(
                        Effect.map(
                          (info) =>
                            ({
                              path: file.path,
                              revision: metadata(info).revision,
                              dependencyChanged: changed !== resolved.absolute,
                            }) satisfies ModelWatchEvent,
                        ),
                        Effect.orElseSucceed(
                          () =>
                            ({
                              path: file.path,
                              revision: null,
                              dependencyChanged: changed !== resolved.absolute,
                            }) satisfies ModelWatchEvent,
                        ),
                      ),
                    ),
                  );
                }),
              ),
            ),
            Stream.mapError(mapError),
          );
        }),
      ),
    );
  const workspaceImagePath = path.join(
    config.stateDir,
    "fork",
    "model-preview-3d",
    "review-images",
  );
  yield* fs.makeDirectory(workspaceImagePath, { recursive: true });
  const workspaceImageDir = yield* fs.realPath(workspaceImagePath);
  const saveImage = Effect.fn("ModelPreview.saveWorkspaceImage")(function* (image: string | null) {
    if (image === null) return null;
    if (image.startsWith("data:image/jpeg;base64,")) {
      const bytes = Buffer.from(image.slice("data:image/jpeg;base64,".length), "base64");
      if (!bytes.length || bytes.length > 37500)
        return yield* error("command-failed", "Invalid review image.");
      const id = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
      const target = path.join(workspaceImageDir, id + ".jpg");
      if (!(yield* fs.exists(target))) yield* fs.writeFile(target, bytes);
      return "loom-image:" + id;
    }
    const id = image.startsWith("loom-image:")
      ? image.slice(11)
      : image.match(/\/([a-f0-9]{64})\.jpg$/)?.[1];
    if (
      !id ||
      !/^[a-f0-9]{64}$/.test(id) ||
      !(yield* fs.exists(path.join(workspaceImageDir, id + ".jpg")))
    )
      return yield* error("command-failed", "The saved review image is unavailable.");
    return "loom-image:" + id;
  });
  const imageUrl = Effect.fn("ModelPreview.workspaceImageUrl")(function* (image: string | null) {
    const ref = yield* saveImage(image);
    if (ref === null) return null;
    // Review images are immutable and retained separately from disposable render outputs.
    return (yield* sign(
      workspaceImageDir,
      path.join(workspaceImageDir, ref.slice(11) + ".jpg"),
      true,
      7 * 24 * 3600000,
    )).relativeUrl;
  });
  const mapWorkspaceImages = (state: ModelWorkspace, transform: typeof saveImage) =>
    Effect.gen(function* () {
      const variants = yield* Effect.forEach(
        state.variants,
        (item) =>
          transform(item.thumbnail).pipe(Effect.map((thumbnail) => ({ ...item, thumbnail }))),
        { concurrency: 8 },
      );
      const annotations = yield* Effect.forEach(
        state.annotations,
        (item) =>
          transform(item.referenceImage).pipe(
            Effect.map((referenceImage) => ({ ...item, referenceImage })),
          ),
        { concurrency: 8 },
      );
      return { ...state, variants, annotations };
    });
  const pruneWorkspaceImages = Effect.fn("ModelPreview.pruneWorkspaceImages")(function* () {
    const states = yield* store.getWorkspaces();
    const retained = new Set<string>();
    for (const state of states) {
      for (const image of [
        ...state.variants.map((item) => item.thumbnail),
        ...state.annotations.map((item) => item.referenceImage),
      ]) {
        if (!image) continue;
        const id = image.startsWith("data:image/jpeg;base64,")
          ? NodeCrypto.createHash("sha256")
              .update(Buffer.from(image.slice("data:image/jpeg;base64,".length), "base64"))
              .digest("hex")
          : image.startsWith("loom-image:")
            ? image.slice(11)
            : image.match(/\/([a-f0-9]{64})\.jpg$/)?.[1];
        if (id) retained.add(id);
      }
    }
    const names = yield* fs.readDirectory(workspaceImageDir);
    yield* Effect.forEach(
      names.filter((name) => /^[a-f0-9]{64}\.jpg$/.test(name) && !retained.has(name.slice(0, -4))),
      (name) => fs.remove(path.join(workspaceImageDir, name), { force: true }),
      { discard: true },
    );
  });
  const getWorkspace = Effect.fn("ModelPreview.getWorkspace")(function* (file: ModelFileRef) {
    const resolved = yield* resolveWorkspace(file);
    return yield* workspaceLock.withPermit(
      Effect.gen(function* () {
        const state = yield* store.getWorkspace(
          resolved.projectId,
          resolved.root + "\0" + file.path,
        );
        return yield* mapWorkspaceImages(state, imageUrl);
      }),
    );
  });
  const updateWorkspaceMany = Effect.fn("ModelPreview.updateWorkspaceMany")(function* (
    file: ModelFileRef,
    operations: readonly ModelWorkspaceOperation[],
  ) {
    const resolved = yield* resolveWorkspace(file);
    const key = resolved.root + "\0" + file.path;
    return yield* workspaceLock.withPermit(
      Effect.gen(function* () {
        const previous = yield* store.getWorkspace(resolved.projectId, key);
        const value = yield* Effect.try({
          try: () => operations.reduce(applyWorkspaceOperation, previous),
          catch: mapError,
        });
        const saved = yield* mapWorkspaceImages(value, saveImage);
        yield* store.saveWorkspace(resolved.projectId, key, saved);
        yield* Effect.forEach(
          workspaceSubscribers.get(resolved.projectId + "\0" + key) ?? [],
          (hub) => PubSub.publish(hub, undefined),
          { discard: true },
        );
        const retained = new Set([
          ...saved.variants.map((item) => item.thumbnail),
          ...saved.annotations.map((item) => item.referenceImage),
        ]);
        if (
          [
            ...previous.variants.map((item) => item.thumbnail),
            ...previous.annotations.map((item) => item.referenceImage),
          ].some((image) => image && !retained.has(image))
        )
          yield* pruneWorkspaceImages().pipe(Effect.ignore);
        return yield* mapWorkspaceImages(saved, imageUrl);
      }),
    );
  });
  yield* pruneWorkspaceImages().pipe(Effect.ignore);
  const editorBridge = yield* makeEditorBridge<
    ModelEditorAction,
    typeof ModelEditorResult.Type,
    ModelPreviewError
  >({
    resolve: (threadId, path) => checked(resolveFile({ threadId, path })),
    failure: (message) => error("command-failed", message),
    panelAction: (command) => ["open", "close", "maximize"].includes(command.action),
  });
  const completeEditor = (input: typeof ModelEditorComplete.Type) =>
    editorBridge.completeWith(
      { ...input, ...(input.error ? { error: input.message } : { error: undefined }) },
      checked(
        Effect.gen(function* () {
          let imagePath: string | undefined;
          if (input.png && !input.error) {
            const bytes = Buffer.from(input.png, "base64");
            if (
              bytes.length > 8 * 1024 * 1024 ||
              bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
            )
              return yield* error("command-failed", "Editor capture must be a PNG under 8 MiB.");
            const directory = path.join(config.stateDir, "fork", "model-preview-3d", "captures");
            yield* fs.makeDirectory(directory, { recursive: true });
            imagePath = path.join(directory, NodeCrypto.randomUUID() + ".png");
            yield* fs.writeFile(imagePath, bytes);
            const files = yield* fs.readDirectory(directory);
            const records = yield* Effect.forEach(
              files.filter((f) => /^[a-f0-9-]{36}\.png$/.test(f)),
              (f) =>
                fs.stat(path.join(directory, f)).pipe(
                  Effect.map((stat) => ({
                    file: f,
                    time: Option.getOrNull(stat.mtime)?.getTime() ?? 0,
                    size: Number(stat.size),
                  })),
                ),
            );
            let total = records.reduce((n, r) => n + r.size, 0),
              count = records.length;
            for (const item of records.toSorted((a, b) => a.time - b.time))
              if (count > 50 || total > 50 * 1024 * 1024) {
                if (path.join(directory, item.file) === imagePath) continue;
                yield* fs.remove(path.join(directory, item.file));
                total -= item.size;
                count--;
              }
          }
          return {
            message: input.message,
            ...(imagePath ? { path: imagePath } : {}),
            ...(input.camera ? { camera: input.camera } : {}),
            ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
            ...(input.state ? { state: input.state } : {}),
            ...(input.measurement ? { measurement: input.measurement } : {}),
            ...(input.wall ? { wall: input.wall } : {}),
          };
        }),
      ),
    );
  const printChecker = yield* makePrintChecker({
    resolveFile: (file) => checked(resolveFile(file)),
    metadata,
    getWorkspace: (file) => checked(getWorkspace(file)),
    getSettings: () => settings,
    renderScad: (input) => checked(renderScad(input)),
    protectStem,
    cacheDir,
  });
  return {
    ...printChecker,
    editorEvents: (file: ModelFileRef) => editorBridge.events(file.threadId, file.path),
    panelEvents: (threadId: ModelFileRef["threadId"]) => editorBridge.events(threadId),
    editorAction: (input: typeof ModelEditorInput.Type) => editorBridge.request(input),
    completeEditorAction: completeEditor,
    getWorkspace: (file: ModelFileRef) => checked(getWorkspace(file)),
    updateWorkspace: (file: ModelFileRef, operation: ModelWorkspaceOperation) =>
      checked(updateWorkspaceMany(file, [operation])),
    watchWorkspace: (file: ModelFileRef) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const resolved = yield* resolveWorkspace(file);
          const key = resolved.projectId + "\0" + resolved.root + "\0" + file.path;
          // Each subscriber coalesces its own workspace updates, so unrelated activity
          // cannot displace the last change and slow clients retain bounded queues.
          const hub = yield* PubSub.sliding<void>(1);
          const queue = yield* PubSub.subscribe(hub);
          const subscribers = workspaceSubscribers.get(key) ?? new Set<PubSub.PubSub<void>>();
          subscribers.add(hub);
          workspaceSubscribers.set(key, subscribers);
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              subscribers.delete(hub);
              if (!subscribers.size) workspaceSubscribers.delete(key);
              yield* PubSub.shutdown(hub);
            }),
          );
          const initial = yield* getWorkspace(file);
          return Stream.concat(
            Stream.succeed(initial),
            Stream.fromSubscription(queue).pipe(Stream.mapEffect(() => getWorkspace(file))),
          );
        }),
      ).pipe(Stream.mapError(mapError)),
    cancelVariant: (file: ModelFileRef, variantId: string) =>
      checked(
        Effect.gen(function* () {
          const resolved = yield* resolveFile(file);
          const job = jobs.get(resolved.absolute + "\0" + variantId);
          if (job) yield* Fiber.interrupt(job);
        }),
      ),
    proposeVariants: (
      file: ModelFileRef,
      variants: ReadonlyArray<{ name: string; values: Readonly<Record<string, string>> }>,
    ) =>
      checked(
        Effect.gen(function* () {
          if (!settings.agentToolEnabled)
            return yield* error(
              "command-failed",
              "Agent model tools are disabled in Loom settings.",
            );
          const data = yield* parameters(file);
          for (const variant of variants) yield* validateOverrides(data.parameters, variant.values);
          const operations: ModelWorkspaceOperation[] = variants.map((candidate) => {
            const item: ModelVariant = {
              id: NodeCrypto.randomUUID(),
              name: candidate.name,
              values: candidate.values,
              sourceRevision: data.sourceRevision,
              thumbnail: null,
              dimensions: null,
              triangles: null,
              renderedRevision: null,
              origin: "agent",
            };
            return { kind: "variant", item };
          });
          return yield* updateWorkspaceMany(file, operations);
        }),
      ),
    status: (refresh?: boolean) => checked(status(refresh)),
    getSettings: () => Effect.succeed(settings),
    updateSettings: (value: ModelPreviewSettingsUpdate) =>
      checked(
        Effect.suspend(() =>
          store.updateSettings({
            ...settings,
            ...value,
            buildPlate: { ...settings.buildPlate, ...value.buildPlate },
          }),
        ).pipe(
          Effect.tap((saved) =>
            Effect.sync(() => {
              settings = saved;
              detection = null;
            }),
          ),
        ),
      ),
    turnModels: (threadId: ModelFileRef["threadId"], runId: RunId | null) =>
      checked(turnModels(threadId, runId)),
    turnModelEvents,
    listModels: (threadId: ModelFileRef["threadId"]) =>
      checked(
        Effect.gen(function* () {
          const { root } = yield* resolveWorkspace({ threadId, path: "." });
          const listing = yield* entries.list({ cwd: root });
          const names = listing.entries.filter((e) => e.kind === "file" && modelFormatOf(e.path));
          const models = yield* Effect.forEach(
            names.slice(0, 2000),
            (e) =>
              resolveFile({ threadId, path: e.path }).pipe(
                Effect.map((file) => ({
                  path: e.path,
                  format: modelFormatOf(e.path)!,
                  ...metadata(file.info),
                })),
                Effect.option,
              ),
            { concurrency: 16 },
          );
          return {
            models: models.flatMap(Option.toArray).toSorted((a, b) => a.path.localeCompare(b.path)),
            truncated: listing.truncated || names.length > 2000,
          };
        }),
      ),
    fileUrl: (file: ModelFileRef, allowLarge = false) =>
      checked(
        Effect.gen(function* () {
          const format = modelFormatOf(file.path);
          if (!format || format === "step" || format === "scad")
            return yield* error("unsupported-format", "This format cannot be loaded as a mesh.");
          const resolved = yield* resolveFile(file);
          return yield* sign(resolved.root, resolved.absolute, allowLarge);
        }),
      ),
    resolveSignedRequest: (token: string, relativePath: string) =>
      checked(
        Effect.gen(function* () {
          const time = yield* now;
          const claims = yield* Effect.try({
            try: () => verifyToken(token, key, time),
            catch: () => error("invalid-path", "Invalid file URL."),
          });
          const candidate = yield* Effect.try({
            try: () => resolveTokenPath(claims, relativePath),
            catch: () => error("invalid-path", "Invalid file path."),
          });
          const real = yield* fs.realPath(candidate);
          if (!isContained(claims.root, real) || !isContained(claims.base, real))
            return yield* error("invalid-path", "Invalid file path.");
          const info = yield* fs.stat(real);
          if (
            info.type !== "File" ||
            (!claims.large && Number(info.size) > settings.maxFileMegabytes * 1024 * 1024)
          )
            return yield* error("too-large", "File unavailable.");
          return { path: real, info };
        }),
      ),
    parameters: (file: ModelFileRef) => checked(parameters(file)),
    renderScad: (input: ScadRenderInput) => checked(renderScad(input)),
    watch,
    saveParameterSet: (
      file: ModelFileRef,
      name: string,
      values: Readonly<Record<string, string>>,
    ) =>
      checked(
        sidecarLock.withPermit(
          Effect.gen(function* () {
            const resolved = yield* resolveFile(file);
            const current = yield* parameters(file);
            yield* validateOverrides(current.parameters, values);
            const sidecar = yield* readSidecar(resolved.absolute);
            const serialized = Object.fromEntries(
              Object.entries(values).map(([key, value]) => [
                key,
                typeof literalValue(value) === "string" ? String(literalValue(value)) : value,
              ]),
            );
            yield* writeFileStringAtomically({
              filePath: sidecarPath(resolved.absolute),
              contents:
                json({
                  ...sidecar,
                  fileFormatVersion: "1",
                  parameterSets: { ...sidecar.parameterSets, [name]: serialized },
                }) + "\n",
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
            );
            return yield* parameters(file);
          }),
        ),
      ),
    clearCache: () =>
      checked(
        jobLock.withPermit(
          Effect.gen(function* () {
            yield* Effect.forEach([...jobs.values(), ...imageJobs], Fiber.interrupt, {
              discard: true,
            });
            jobs.clear();
            imageJobs.clear();
            yield* cacheLock.withPermit(
              Effect.gen(function* () {
                const names = yield* fs.readDirectory(cacheDir);
                yield* Effect.forEach(
                  names,
                  (name) => fs.remove(path.join(cacheDir, name), { force: true }),
                  { discard: true },
                );
              }),
            );
          }),
        ),
      ),
    renderImages: (
      file: ModelFileRef,
      views: ReadonlyArray<ModelView>,
      overrides: Readonly<Record<string, string>>,
      projection: ModelProjection = DEFAULT_RENDER_PROJECTION,
      options: {
        readonly overhangs?: { readonly angle?: number | undefined };
        readonly orientation?: "saved" | "none";
      } = {},
    ) =>
      checked(
        Effect.gen(function* () {
          const fiber = yield* jobLock.withPermit(
            renderSlots
              .withPermit(
                Effect.scoped(
                  Effect.gen(function* () {
                    if (!settings.agentToolEnabled)
                      return yield* error(
                        "command-failed",
                        "Agent rendering is disabled in Loom settings.",
                      );
                    const angle = options.overhangs?.angle ?? settings.overhangAngleDegrees;
                    if (options.overhangs && !isOverhangAngle(angle))
                      return yield* error(
                        "invalid-parameter",
                        "Overhang angles must be whole degrees from 30 to 70.",
                      );
                    const resolved = yield* resolveFile(file),
                      format = modelFormatOf(file.path);
                    if (
                      format !== "scad" &&
                      format !== "stl" &&
                      format !== "3mf" &&
                      format !== "obj"
                    )
                      return yield* error(
                        "unsupported-format",
                        "The agent tool renders SCAD, STL, 3MF and OBJ files.",
                      );
                    const info = (yield* status()).openscad;
                    if (!info.path)
                      return yield* error(
                        "openscad-missing",
                        "OpenSCAD is required to render images.",
                      );
                    if (settings.backend === "manifold" && !info.supportsManifold)
                      return yield* error(
                        "command-failed",
                        "This OpenSCAD build does not support the Manifold backend.",
                      );
                    const runId = NodeCrypto.randomUUID(),
                      imageStem = path.join(cacheDir, runId);
                    yield* protectStem(imageStem);
                    // The PNGs stay for the agent to read; the import wrapper and summary do not.
                    yield* Effect.addFinalizer(() =>
                      Effect.forEach(
                        [".scad", ".summary.json", ".overhangs.stl", ".oriented.stl"],
                        (suffix) =>
                          fs.remove(imageStem + suffix, { force: true }).pipe(Effect.ignore),
                        { discard: true },
                      ),
                    );
                    if (format !== "scad" && Object.keys(overrides).length)
                      return yield* error(
                        "invalid-parameter",
                        "Parameters are available only for SCAD models.",
                      );
                    const saved =
                      options.orientation === "none"
                        ? null
                        : (yield* getWorkspace(file)).orientation;
                    const orientation = saved
                      ? { ...saved, quaternion: normalizeQuaternion(saved.quaternion) }
                      : null;
                    const rotation = orientation ? quaternionMatrix(orientation.quaternion) : null;
                    let source = resolved.absolute;
                    let log: ScadRenderResult["log"] = [];
                    let pngOverrides = overrides;
                    if (format === "scad")
                      yield* validateOverrides(
                        parseCustomizer(yield* fs.readFileString(source)),
                        overrides,
                      );
                    if (format === "scad" && orientation) {
                      const target = imageStem + ".oriented.stl";
                      const result = yield* runner.run({
                        command: info.path,
                        args: meshArgs({ source, output: target, info, settings, overrides }),
                        cwd: path.dirname(resolved.absolute),
                        timeout: `${settings.renderTimeoutSeconds} seconds`,
                        timeoutBehavior: "timedOutResult",
                        outputMode: "truncate",
                        maxOutputBytes: 512 * 1024,
                      });
                      const exportLog = parseLog(result.stderr);
                      log = exportLog;
                      if (result.timedOut)
                        return yield* error(
                          "timeout",
                          `Exporting oriented geometry timed out after ${settings.renderTimeoutSeconds} s.`,
                        );
                      if (
                        result.code !== 0 ||
                        exportLog.some((line) => line.level === "error") ||
                        !(yield* fs.exists(target))
                      )
                        return yield* error(
                          "command-failed",
                          "Could not export the model for its saved orientation.",
                        );
                      source = target;
                      pngOverrides = {};
                    }
                    if (format !== "scad" || orientation) {
                      const imported = source;
                      source = path.join(cacheDir, `${runId}.scad`);
                      const scale = format === "3mf" ? yield* threeMfScale(resolved.absolute) : 1;
                      const matrix = rotation
                        ? json([...rotation.map((row) => [...row, 0]), [0, 0, 0, 1]])
                        : null;
                      yield* fs.writeFileString(
                        source,
                        `${matrix ? `multmatrix(${matrix}) ` : ""}scale(${scale}) import(${json(imported)});\n`,
                      );
                    }
                    let overhangs: OverhangStats | undefined;
                    if (options.overhangs) {
                      const target = imageStem + ".overhangs.stl";
                      const result = yield* runner.run({
                        command: info.path,
                        args: meshArgs({ source, output: target, info, settings, overrides }),
                        cwd: path.dirname(resolved.absolute),
                        timeout: `${settings.renderTimeoutSeconds} seconds`,
                        timeoutBehavior: "timedOutResult",
                        outputMode: "truncate",
                        maxOutputBytes: 512 * 1024,
                      });
                      if (result.timedOut)
                        return yield* error(
                          "timeout",
                          `Exporting overhang geometry timed out after ${settings.renderTimeoutSeconds} s.`,
                        );
                      const exportLog = parseLog(result.stderr);
                      log = [...log, ...exportLog].slice(-500);
                      if (
                        result.code !== 0 ||
                        exportLog.some((line) => line.level === "error") ||
                        !(yield* fs.exists(target))
                      )
                        return yield* error(
                          "command-failed",
                          "Could not export the model for overhang statistics.",
                        );
                      const bytes = yield* fs.readFile(target);
                      overhangs = yield* Effect.try({
                        try: () =>
                          overhangStats(parseBinaryStl(bytes), { thresholdDegrees: angle }),
                        catch: mapError,
                      });
                    }
                    if (overhangs && rotation)
                      overhangs = {
                        ...overhangs,
                        oriented: true,
                        regions: overhangs.regions.map((region) => ({
                          ...region,
                          centre: [
                            rotation[0][0] * region.centre[0] +
                              rotation[1][0] * region.centre[1] +
                              rotation[2][0] * region.centre[2],
                            rotation[0][1] * region.centre[0] +
                              rotation[1][1] * region.centre[1] +
                              rotation[2][1] * region.centre[2],
                            rotation[0][2] * region.centre[0] +
                              rotation[1][2] * region.centre[1] +
                              rotation[2][2] * region.centre[2],
                          ] as const,
                        })),
                      };
                    const summaryPath = path.join(cacheDir, `${runId}.summary.json`);
                    const images = yield* Effect.forEach([...new Set(views)], (view) =>
                      Effect.gen(function* () {
                        const target = path.join(cacheDir, `${runId}-${view}.png`);
                        let completed = false;
                        yield* Effect.addFinalizer(() =>
                          completed
                            ? Effect.void
                            : fs.remove(target, { force: true }).pipe(Effect.ignore),
                        );
                        const args = pngArgs(source, target, view, projection);
                        if (info.supportsSummary)
                          args.splice(
                            args.length - 1,
                            0,
                            "--summary",
                            "all",
                            "--summary-file",
                            summaryPath,
                          );
                        if (info.supportsManifold)
                          args.splice(
                            args.length - 1,
                            0,
                            `--backend=${settings.backend === "cgal" ? "cgal" : "manifold"}`,
                          );
                        args.splice(
                          args.length - 1,
                          0,
                          ...Object.entries(pngOverrides).flatMap(([name, value]) => [
                            "-D",
                            `${name}=${value}`,
                          ]),
                        );
                        const result = yield* runner.run({
                          command: info.path!,
                          args,
                          cwd: path.dirname(resolved.absolute),
                          timeout: `${settings.renderTimeoutSeconds} seconds`,
                          timeoutBehavior: "timedOutResult",
                          outputMode: "truncate",
                          maxOutputBytes: 512 * 1024,
                        });
                        if (result.timedOut)
                          return yield* error(
                            "timeout",
                            `Rendering the ${view} view timed out after ${settings.renderTimeoutSeconds} s.`,
                          );
                        log = [...log, ...parseLog(result.stderr)].slice(-500);
                        if (
                          result.code !== 0 ||
                          parseLog(result.stderr).some((l) => l.level === "error") ||
                          !(yield* fs.exists(target))
                        )
                          return yield* error(
                            "command-failed",
                            `Could not render the ${view} view.`,
                          );
                        completed = true;
                        return { view, path: target };
                      }),
                    );
                    yield* prune();
                    const summary = parseSummary(
                      yield* fs.readFileString(summaryPath).pipe(Effect.orElseSucceed(() => "")),
                    );
                    const box = summary?.boundingBox;
                    const size =
                      box && box.min.length === 3 && box.max.length === 3
                        ? ([
                            box.max[0]! - box.min[0]!,
                            box.max[1]! - box.min[1]!,
                            box.max[2]! - box.min[2]!,
                          ] as const)
                        : null;
                    const fit =
                      size && size.every((mm) => Number.isFinite(mm) && mm >= 0)
                        ? bedFitSummary(size, settings.buildPlate)
                        : null;
                    return {
                      images,
                      log,
                      summary,
                      fit,
                      orientation,
                      ...(overhangs ? { overhangs } : {}),
                    };
                  }),
                ),
              )
              .pipe(
                Effect.mapError(mapError),
                Effect.forkChild,
                Effect.tap((fiber) =>
                  Effect.sync(() => {
                    imageJobs.add(fiber);
                  }),
                ),
              ),
          );
          return yield* Fiber.join(fiber).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                imageJobs.delete(fiber);
              }),
            ),
          );
        }),
      ),
  };
});
export class ModelPreviewService extends Context.Service<
  ModelPreviewService,
  Effect.Success<typeof make>
>()("t3/fork/model-preview-3d/ModelPreviewService") {}
export const layer = Layer.effect(ModelPreviewService, make).pipe(
  Layer.provide(ProcessRunner.layer),
);
