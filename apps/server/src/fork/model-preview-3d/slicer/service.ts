import * as HostProcess from "@t3tools/shared/HostProcess";
// @effect-diagnostics nodeBuiltinImport:off -- Slice folder keys and detached host launches are Node adapter work.
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Fiber from "effect/Fiber";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import * as ProcessRunner from "../../../processRunner.ts";
import {
  activeBed,
  listBeds,
  SliceResult,
  SLICER_LABELS,
  type Bed,
  type ImportSlicerProfile,
  type ModelFileRef,
  type ModelPreviewSettings,
  ModelPreviewError,
  type ModelQuaternion,
  type OpenScadInfo,
  type PrintEstimate,
  type SignedFile,
  type SliceInput,
  type SlicerApp,
} from "@t3tools/contracts/fork";
import { parseLog } from "../openscad.ts";
import { pruneList } from "../renderCache.ts";
import { makeSlicerDetection } from "./detect.ts";
import { makeProfiles, profileHash } from "./profiles.ts";
import { meshContentHash, prepareSliceMesh, type SliceMesh } from "./prepare.ts";
import { bambuArgs, readBambuOutput } from "./bambu.ts";
import { prusaArgs, readPrusaOutput } from "./prusa.ts";
const isModelError = Schema.is(ModelPreviewError);
export const SLICER_ADAPTER_VERSION = 1;
export const sliceCacheKey = (input: {
  app: SlicerApp;
  version: string | null;
  executable: string;
  geometry: string;
  orientation: ModelQuaternion | null;
  profiles: readonly string[];
}): string =>
  profileHash([
    SLICER_ADAPTER_VERSION,
    input.app,
    input.version,
    input.executable,
    input.geometry,
    input.orientation,
    input.profiles,
  ]);
export const estimateCost = (
  estimate: PrintEstimate,
  prices: readonly (number | null)[],
  currency: string,
): PrintEstimate => {
  const used = estimate.filaments.filter(
    (filament) => (filament.grams ?? 0) > 0 || (filament.lengthMm ?? 0) > 0,
  );
  const known =
    used.length > 0 &&
    used.every(
      (filament) =>
        filament.grams !== null &&
        prices[filament.slot] !== null &&
        prices[filament.slot] !== undefined,
    );
  return {
    ...estimate,
    currency,
    cost: known
      ? used.reduce((sum, filament) => sum + (filament.grams! / 1000) * prices[filament.slot]!, 0)
      : null,
  };
};
const CachedSlice = Schema.Struct({
  result: SliceResult,
  projectFile: Schema.Literals(["result.3mf", "result.gcode"]),
  layerCount: Schema.Int,
  segmentCount: Schema.Int,
  decimated: Schema.Boolean,
  supportLength: Schema.Array(Schema.Number).check(Schema.isMaxLength(16)),
});
const decodeCache = Schema.decodeUnknownEffect(Schema.fromJsonString(CachedSlice)),
  encodeCache = Schema.encodeEffect(Schema.fromJsonString(CachedSlice));
const noResult = (bedId: string, app: SlicerApp | null = null): SliceResult => ({
  status: "none",
  key: null,
  cached: false,
  durationMs: 0,
  bedId,
  app,
  appVersion: null,
  profiles: null,
  estimate: null,
  orientationApplied: null,
  warnings: [],
  log: [],
  project: null,
  layers: null,
});
const profileNumber = (value: unknown, allowZero = false): number | null => {
  const first = Array.isArray(value) ? value[0] : value,
    parsed = typeof first === "string" || typeof first === "number" ? Number(first) : NaN;
  return Number.isFinite(parsed) && (parsed > 0 || (allowZero && parsed === 0)) ? parsed : null;
};
export const makeSlicer = Effect.fn("Slicer.make")(function* (deps: {
  stateDir: string;
  home: string;
  getSettings: () => ModelPreviewSettings;
  resolveMesh: (
    input: SliceInput,
    cachedOnly: boolean,
  ) => Effect.Effect<SliceMesh | null, ModelPreviewError, Scope.Scope>;
  getOrientation: (file: ModelFileRef) => Effect.Effect<ModelQuaternion | null, ModelPreviewError>;
  sign: (
    root: string,
    absolute: string,
    allowLarge: boolean,
  ) => Effect.Effect<SignedFile, ModelPreviewError>;
  getOpenScad: () => Effect.Effect<OpenScadInfo, ModelPreviewError>;
  resolveBed?: (id: string) => Effect.Effect<Bed | null, ModelPreviewError>;
  material?: (
    id: string | null,
    slot: number,
    bedId: string,
  ) => Effect.Effect<
    { density: number | null; pricePerKg: number | null } | null,
    ModelPreviewError
  >;
}) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    runner = yield* ProcessRunner.ProcessRunner,
    scope = yield* Effect.scope;
  const now = Effect.map(DateTime.now, DateTime.toEpochMillis);
  const directory = path.join(deps.stateDir, "slices");
  yield* fs.makeDirectory(directory, { recursive: true });
  const detector = yield* makeSlicerDetection(deps.home, () => deps.getSettings().slicer);
  const profiles = yield* makeProfiles(deps.stateDir, deps.home, (app) =>
    detector.detect().pipe(
      Effect.map((infos) => infos.find((info) => info.app === app)?.path ?? null),
      Effect.mapError(
        () =>
          new ModelPreviewError({
            reason: "command-failed",
            message: "The slicer could not be detected.",
          }),
      ),
    ),
  );
  const slots = {
    "bambu-studio": yield* Semaphore.make(1),
    "orca-slicer": yield* Semaphore.make(1),
    "prusa-slicer": yield* Semaphore.make(1),
  };
  const lock = yield* Semaphore.make(1),
    jobs = new Map<string, Fiber.Fiber<SliceResult, ModelPreviewError>>();
  for (const name of yield* fs.readDirectory(directory))
    if (name.startsWith("pending-")) {
      const info = yield* fs.stat(path.join(directory, name));
      if (
        Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }) <
        (yield* now) - 86400000
      )
        yield* fs.remove(path.join(directory, name), { recursive: true, force: true });
    }
  const prune = Effect.fn("Slicer.prune")(function* () {
    const entries = [] as { path: string; size: number; modified: number }[];
    for (const name of yield* fs.readDirectory(directory))
      if (/^[a-f0-9]{64}$/.test(name)) {
        const folder = path.join(directory, name),
          info = yield* fs.stat(folder),
          children = yield* fs.readDirectory(folder);
        let size = 0;
        for (const child of children)
          size += Number((yield* fs.stat(path.join(folder, child))).size);
        entries.push({
          path: folder,
          size,
          modified: Option.match(info.mtime, {
            onNone: () => 0,
            onSome: (date) => date.getTime(),
          }),
        });
      }
    for (const filename of pruneList(entries, 100, 2 * 1024 * 1024 * 1024))
      yield* fs.remove(filename, { force: true, recursive: true });
  });
  const rawRun = Effect.fn("Slicer.slice")(function* (input: SliceInput) {
    const settings = deps.getSettings(),
      bedId = input.bedId ?? activeBed(settings.buildPlate).id,
      mapping = settings.slicer.mappings[bedId];
    const bed = deps.resolveBed
      ? yield* deps.resolveBed(bedId)
      : (listBeds(settings.buildPlate, { includeHidden: true }).find((bed) => bed.id === bedId) ??
        null);
    if (!bed || bed.kind === "surface" || bed.volumeMm[2] === null) {
      if (input.cachedOnly) return noResult(bedId);
      return yield* new ModelPreviewError({
        reason: "invalid-parameter",
        message: "Print estimates need a printer. Choose one in the Bed menu.",
      });
    }
    if (!mapping) {
      if (input.cachedOnly) return noResult(bedId);
      return yield* new ModelPreviewError({
        reason: "invalid-parameter",
        message: `Choose a slicer profile for ${bed.label} to estimate print time.`,
      });
    }
    const info = (yield* detector.detect()).find((info) => info.app === mapping.app)!;
    if (!info.path) {
      if (input.cachedOnly) return noResult(bedId, mapping.app);
      return yield* new ModelPreviewError({
        reason: "slicer-missing",
        message: `${SLICER_LABELS[mapping.app]} was not found on this host. Set its path in Loom settings.`,
      });
    }
    if (!info.supported)
      return yield* new ModelPreviewError({
        reason: "unsupported-format",
        message: `This version of ${SLICER_LABELS[mapping.app]} is not supported for slicing.`,
      });
    const mesh = yield* deps.resolveMesh(input, input.cachedOnly ?? false);
    if (!mesh) return noResult(bedId, mapping.app);
    const orientation = yield* deps.getOrientation(input.file);
    const machine = yield* profiles.resolve(
      mapping.app,
      mapping.app === "prusa-slicer" ? "config" : "machine",
      mapping.machine,
    );
    if (mapping.app !== "prusa-slicer" && (!mapping.process || !mapping.filaments.length))
      return yield* new ModelPreviewError({
        reason: "invalid-parameter",
        message: "Choose a process and filament profile in Loom settings.",
      });
    const process = mapping.process
      ? yield* profiles.resolve(mapping.app, "process", mapping.process)
      : null;
    const filaments = yield* Effect.forEach(mapping.filaments, (ref) =>
      profiles.resolve(mapping.app, "filament", ref),
    );
    const geometry =
      mesh.geometryRevision ??
      (yield* meshContentHash(mesh.absolute).pipe(
        Effect.mapError(
          () =>
            new ModelPreviewError({
              reason: "not-found",
              message: "The model was deleted or moved.",
            }),
        ),
      ));
    const key = sliceCacheKey({
        app: mapping.app,
        version: info.version,
        executable: info.path,
        geometry,
        orientation,
        profiles: [machine.hash, process?.hash ?? "", ...filaments.map((profile) => profile.hash)],
      }),
      destination = path.join(directory, key);
    const filamentProfiles =
      mapping.app === "prusa-slicer"
        ? Array.from(
            {
              length: Math.max(
                1,
                Array.isArray(machine.json.filament_diameter)
                  ? machine.json.filament_diameter.length
                  : 1,
              ),
            },
            (_unused, slot) => ({
              json: Object.fromEntries(
                Object.entries(machine.json).map(([key, value]) => [
                  key,
                  Array.isArray(value) ? value[slot] : value,
                ]),
              ),
              userPrice: machine.userPrice,
            }),
          )
        : filaments;
    const materials = yield* Effect.forEach(filamentProfiles, (_ref, slot) =>
      deps.material
        ? deps.material(mapping.materialIds?.[slot] ?? null, slot, bedId)
        : Effect.succeed(null),
    );
    const prices = filamentProfiles.map(
      (profile, slot) =>
        materials[slot]?.pricePerKg ??
        (profile.userPrice ? profileNumber(profile.json.filament_cost, true) : null),
    );
    const supportWeight = (lengths: readonly number[]): number | null => {
      let supportGrams = 0,
        supportKnown = true;
      for (const [slot, length] of lengths.entries()) {
        if (!length) continue;
        const density =
            materials[slot]?.density ??
            profileNumber(filamentProfiles[slot]?.json.filament_density),
          diameter = profileNumber(filamentProfiles[slot]?.json.filament_diameter);
        if (!density || !diameter) supportKnown = false;
        else supportGrams += ((length * Math.PI * (diameter / 2) ** 2) / 1000) * density;
      }
      return supportKnown ? supportGrams : null;
    };
    const decorate = Effect.fnUntraced(function* (
      stored: typeof CachedSlice.Type,
      cached: boolean,
    ): Effect.fn.Return<SliceResult, ModelPreviewError> {
      const result = stored.result;
      return {
        ...result,
        cached,
        estimate: result.estimate
          ? estimateCost(
              { ...result.estimate, supportGrams: supportWeight(stored.supportLength) },
              prices,
              deps.getSettings().slicer.currency,
            )
          : null,
        project: yield* deps.sign(directory, path.join(destination, stored.projectFile), true),
        layers: {
          file: yield* deps.sign(directory, path.join(destination, "layers.bin"), true),
          layerCount: stored.layerCount,
          segmentCount: stored.segmentCount,
          decimated: stored.decimated,
        },
      };
    });
    const cached = yield* fs
      .readFileString(path.join(destination, "result.json"))
      .pipe(Effect.flatMap(decodeCache), Effect.option);
    if (cached._tag === "Some") return yield* decorate(cached.value, true);
    if (input.cachedOnly) return noResult(bedId, mapping.app);
    return yield* slots[mapping.app].withPermit(
      Effect.scoped(
        Effect.gen(function* () {
          const existing = yield* fs
            .readFileString(path.join(destination, "result.json"))
            .pipe(Effect.flatMap(decodeCache), Effect.option);
          if (existing._tag === "Some") return yield* decorate(existing.value, true);
          const started = yield* now;
          const pending = path.join(directory, `pending-${NodeCrypto.randomUUID()}`),
            outputDir = path.join(pending, "out"),
            dataDir = path.join(deps.stateDir, "slicer", `datadir-${mapping.app}`);
          yield* fs.makeDirectory(outputDir, { recursive: true });
          yield* fs.makeDirectory(dataDir, { recursive: true });
          yield* Effect.addFinalizer(() =>
            fs.remove(pending, { recursive: true, force: true }).pipe(Effect.ignore),
          );
          const prepared = yield* prepareSliceMesh(
            mesh,
            orientation,
            pending,
            yield* deps.getOpenScad(),
            settings.slicer.timeoutSeconds,
          );
          const projectFile = mapping.app === "prusa-slicer" ? "result.gcode" : "result.3mf";
          const args =
            mapping.app === "prusa-slicer"
              ? prusaArgs({
                  dataDir,
                  config: machine.filename,
                  output: path.join(outputDir, projectFile),
                  mesh: prepared.filename,
                })
              : bambuArgs({
                  dataDir,
                  outputDir,
                  mesh: prepared.filename,
                  machine: machine.filename,
                  process: process!.filename,
                  filaments: filaments.map((profile) => profile.filename),
                });
          const output = yield* runner.run({
            command: info.path!,
            args,
            cwd: pending,
            timeout: `${settings.slicer.timeoutSeconds} seconds`,
            timeoutBehavior: "timedOutResult",
            outputMode: "truncate",
            maxOutputBytes: 512 * 1024,
          });
          const log = parseLog(output.stdout + "\n" + output.stderr);
          if (output.timedOut)
            return yield* new ModelPreviewError({
              reason: "timeout",
              message: `Slicing took longer than ${Math.round(settings.slicer.timeoutSeconds / 60)} minutes. Raise the timeout in Loom settings.`,
            });
          if (output.code !== 0)
            return {
              ...noResult(bedId, mapping.app),
              status: "error" as const,
              appVersion: info.version,
              durationMs: (yield* now) - started,
              log,
              warnings: ["Slicing failed. See the slicer log."],
            };
          const project = path.join(outputDir, projectFile);
          const parsed =
            mapping.app === "prusa-slicer"
              ? yield* readPrusaOutput(project, settings.slicer.currency)
              : yield* readBambuOutput(
                  project,
                  settings.slicer.currency,
                  machine.modelId,
                  typeof machine.json.printer_model === "string"
                    ? machine.json.printer_model
                    : null,
                );
          const result: SliceResult = {
            status: "ok",
            key,
            cached: false,
            durationMs: (yield* now) - started,
            bedId,
            app: mapping.app,
            appVersion: info.version,
            profiles: {
              machine: mapping.machine.name,
              process: mapping.process?.name ?? null,
              filaments: mapping.filaments.map((ref) => ref.name),
            },
            estimate: {
              ...parsed.estimate,
              supportGrams: supportWeight(parsed.supportLength),
              cost: null,
            },
            orientationApplied: prepared.orientationApplied,
            warnings: [...prepared.warnings, ...parsed.warnings].slice(0, 50),
            log,
            project: null,
            layers: null,
          };
          const stored: typeof CachedSlice.Type = {
            result,
            projectFile,
            layerCount: parsed.layers.layerCount,
            segmentCount: parsed.layers.segmentCount,
            decimated: parsed.layers.decimated,
            supportLength: Array.from(
              { length: parsed.supportLength.length },
              (_unused, slot) => parsed.supportLength[slot] ?? 0,
            ),
          };
          yield* fs.rename(project, path.join(pending, projectFile));
          yield* fs.writeFile(path.join(pending, "layers.bin"), parsed.layers.data);
          yield* fs.writeFileString(
            path.join(pending, "slicer.log"),
            output.stdout + "\n" + output.stderr,
          );
          yield* fs.remove(outputDir, { recursive: true, force: true });
          yield* fs.writeFileString(path.join(pending, "result.json"), yield* encodeCache(stored));
          if (yield* fs.exists(destination))
            yield* fs.remove(destination, { recursive: true, force: true });
          yield* fs.rename(pending, destination);
          yield* prune();
          return yield* decorate(stored, false);
        }),
      ).pipe(
        Effect.mapError((cause) =>
          isModelError(cause)
            ? cause
            : new ModelPreviewError({
                reason: "command-failed",
                message: "The slice could not be saved.",
              }),
        ),
      ),
    );
  });
  const run = (input: SliceInput) =>
    rawRun(input).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ProcessRunner.ProcessRunner, runner),
      Effect.mapError((cause) =>
        isModelError(cause)
          ? cause
          : new ModelPreviewError({
              reason: "command-failed",
              message: "The slicer request failed.",
            }),
      ),
    );
  const slice = Effect.fn("Slicer.request")(function* (input: SliceInput) {
    const id = `${input.file.threadId}:${input.file.path}:${input.variantId ?? ""}`;
    if (input.cachedOnly) return yield* Effect.scoped(run(input));
    const fiber = yield* lock.withPermit(
      Effect.gen(function* () {
        const previous = jobs.get(id);
        if (previous) yield* Fiber.interrupt(previous);
        const fiber = yield* run(input).pipe(Effect.scoped, Effect.forkIn(scope));
        jobs.set(id, fiber);
        return fiber;
      }),
    );
    return yield* Fiber.join(fiber).pipe(
      Effect.onInterrupt(() => Fiber.interrupt(fiber)),
      Effect.ensuring(
        Effect.sync(() => {
          if (jobs.get(id) === fiber) jobs.delete(id);
        }),
      ),
    );
  });
  const openSlice = Effect.fn("Slicer.open")(function* (key: string) {
    if (!/^[a-f0-9]{64}$/.test(key))
      return yield* new ModelPreviewError({
        reason: "invalid-path",
        message: "Choose a saved slice.",
      });
    const cached = yield* fs.readFileString(path.join(directory, key, "result.json")).pipe(
      Effect.flatMap(decodeCache),
      Effect.mapError(
        () =>
          new ModelPreviewError({
            reason: "not-found",
            message: "This slice is no longer cached.",
          }),
      ),
    );
    const info = (yield* detector.detect()).find((info) => info.app === cached.result.app);
    if (!info?.path)
      return yield* new ModelPreviewError({
        reason: "slicer-missing",
        message: "The slicer was not found on this host.",
      });
    const file = path.join(directory, key, cached.projectFile);
    const platform = yield* HostProcess.Platform;
    if (platform === "darwin") {
      const bundle = info.path.includes(".app/")
        ? info.path.slice(0, info.path.indexOf(".app/") + 4)
        : info.path;
      const opened = yield* runner.run({
        command: "open",
        args: ["-a", bundle, file],
        timeout: "10 seconds",
      });
      if (opened.code !== 0)
        return yield* new ModelPreviewError({
          reason: "command-failed",
          message: "The slicer could not be opened.",
        });
    } else
      yield* Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve, reject) => {
            const child = NodeChildProcess.spawn(info.path!, [file], {
              detached: true,
              stdio: "ignore",
              windowsHide: true,
            });
            child.once("error", reject);
            child.once("spawn", () => {
              child.unref();
              resolve();
            });
          }),
        catch: () =>
          new ModelPreviewError({
            reason: "command-failed",
            message: "The slicer could not be opened.",
          }),
      });
  });
  const clearCache = Effect.fn("Slicer.clearCache")(function* () {
    yield* Effect.forEach([...jobs.values()], Fiber.interrupt, { discard: true });
    jobs.clear();
    yield* fs.remove(directory, { recursive: true, force: true });
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* profiles.clearCache();
  });
  return {
    slice,
    slicerProfiles: profiles.list,
    importSlicerProfile: (input: ImportSlicerProfile) => profiles.importProfile(input),
    openSlice,
    status: detector.detect,
    clearCache,
  };
});
