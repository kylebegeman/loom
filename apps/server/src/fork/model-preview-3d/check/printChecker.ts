// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as DateTime from "effect/DateTime";
import type * as Scope from "effect/Scope";
import {
  ModelPreviewError,
  PRINT_CHECK_VERSION,
  PRINT_CHECK_MAX_TRIANGLES,
  activeBed,
  fitBed,
  modelFormatOf,
  type ModelFileRef,
  type ModelWorkspace,
  type ModelPreviewSettings,
  type PrinterLibrary,
  type PrintCheckOptions,
  type PrintCheckResult,
  type ScadRenderInput,
  type ScadRenderResult,
} from "@t3tools/contracts/fork";
import { makeSharedJobs } from "../../sharedJobs.ts";
import { isContained } from "../signedFiles.ts";
import { finalizeReport } from "./report.ts";
import { read3mfParts } from "./readFiles.ts";
import { makeCheckCoordinator, type CheckCoordinator } from "./coordinator.ts";
import { runCheckWorker } from "./workerHost.ts";
import type { CheckFile, CheckRequest, PrintCheckCore } from "./protocol.ts";
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isModelPreviewError = Schema.is(ModelPreviewError);
const GltfBuffers = Schema.Struct({
  buffers: Schema.optionalKey(
    Schema.Array(Schema.Struct({ uri: Schema.optionalKey(Schema.String) })),
  ),
});
const decodeBuffers = Schema.decodeUnknownEffect(Schema.fromJsonString(GltfBuffers));
const failure = (reason: ModelPreviewError["reason"], message: string) =>
  new ModelPreviewError({ reason, message });
type Input = { file: ModelFileRef; requestId?: string } & PrintCheckOptions;
type CompletedCheck = { core: PrintCheckCore; geometryRevision: string; checkedAt: string };
type Resolved = { root: string; absolute: string; info: FileSystem.File.Info };
export const makePrintChecker = Effect.fn("ModelPrintCheck.make")(function* (deps: {
  resolveFile: (file: ModelFileRef) => Effect.Effect<Resolved, ModelPreviewError>;
  metadata: (info: FileSystem.File.Info) => { revision: string };
  getWorkspace: (file: ModelFileRef) => Effect.Effect<ModelWorkspace, ModelPreviewError>;
  getSettings: () => ModelPreviewSettings;
  getPrinterLibrary?: () => Effect.Effect<PrinterLibrary, ModelPreviewError>;
  renderScad: (input: ScadRenderInput) => Effect.Effect<ScadRenderResult, ModelPreviewError>;
  protectStem: (stem: string) => Effect.Effect<unknown, never, Scope.Scope>;
  cacheDir: string;
  runWorker?: typeof runCheckWorker;
  coordinator?: CheckCoordinator;
}) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    coordinator = deps.coordinator ?? (yield* makeCheckCoordinator),
    scadSlot = yield* Semaphore.make(1),
    manifestLock = yield* Semaphore.make(1),
    jobs = yield* makeSharedJobs<CompletedCheck, ModelPreviewError>(),
    renders = yield* makeSharedJobs<ScadRenderResult, ModelPreviewError>();
  const cache = new Map<string, CompletedCheck>();
  const manifests = new Map<string, { revision: string; uris: readonly string[] }>();
  const manifestUris = Effect.fn("ModelPrintCheck.manifest")(
    function* (absolute: string, format: CheckRequest["format"], revision: string) {
      if (format !== "gltf" && format !== "glb") return [] as readonly string[];
      const existing = manifests.get(absolute);
      if (existing?.revision === revision) {
        manifests.delete(absolute);
        manifests.set(absolute, existing);
        return existing.uris;
      }
      let text: string;
      if (format === "gltf") text = yield* fs.readFileString(absolute);
      else {
        const handle = yield* fs.open(absolute),
          readExact = Effect.fnUntraced(function* (count: number) {
            const bytes = new Uint8Array(count);
            let at = 0;
            while (at < count) {
              const read = yield* handle.read(bytes.subarray(at));
              if (!read) return yield* failure("command-failed", "This glTF file is damaged.");
              at += read;
            }
            return bytes;
          });
        const header = yield* readExact(20),
          view = new DataView(header.buffer),
          length = view.getUint32(12, true);
        if (
          view.getUint32(0, true) !== 0x46546c67 ||
          view.getUint32(4, true) !== 2 ||
          view.getUint32(16, true) !== 0x4e4f534a ||
          length > 64 * 1024 * 1024
        )
          return yield* failure("command-failed", "This glTF file is damaged.");
        text = new TextDecoder().decode(yield* readExact(length)).trimEnd();
      }
      const manifest = yield* decodeBuffers(text).pipe(
        Effect.mapError(() => failure("command-failed", "This glTF file is damaged.")),
      );
      const uris = [
        ...new Set(
          (manifest.buffers ?? []).flatMap((buffer) =>
            buffer.uri && !buffer.uri.startsWith("data:") ? [buffer.uri] : [],
          ),
        ),
      ];
      if (uris.length > 512)
        return yield* failure("too-large", "This glTF references too many buffer files.");
      manifests.set(absolute, { revision, uris });
      while (manifests.size > 64) manifests.delete(manifests.keys().next().value!);
      return uris;
    },
    (effect) => manifestLock.withPermit(Effect.scoped(effect)),
  );
  const bufferFile = Effect.fn("ModelPrintCheck.bufferPath")(function* (
    absolute: string,
    root: string,
    encodedUri: string,
  ) {
    const uri = yield* Effect.try({
      try: () => decodeURIComponent(encodedUri),
      catch: () => failure("invalid-path", "This glTF buffer path is invalid."),
    });
    if (
      uri.includes("\\") ||
      uri.includes("\0") ||
      uri.includes("?") ||
      uri.includes("#") ||
      path.isAbsolute(uri) ||
      uri.split("/").includes("..") ||
      /^[a-z][a-z0-9+.-]*:/i.test(uri)
    )
      return yield* failure(
        "invalid-path",
        "glTF buffers must be relative files inside the model directory.",
      );
    const directory = path.dirname(absolute),
      target = yield* fs.realPath(path.resolve(directory, uri));
    if (!isContained(root, target) || !isContained(directory, target))
      return yield* failure("invalid-path", "This glTF buffer points outside the model directory.");
    const info = yield* fs.stat(target);
    if (info.type !== "File") return yield* failure("invalid-path", "Choose a glTF buffer file.");
    return { target, info };
  });
  const bufferRevisions = Effect.fn("ModelPrintCheck.bufferRevisions")(function* (
    absolute: string,
    format: CheckRequest["format"],
    root: string,
    revision: string,
  ) {
    const uris = yield* manifestUris(absolute, format, revision);
    return yield* Effect.forEach(uris, (uri) =>
      bufferFile(absolute, root, uri).pipe(
        Effect.map(({ info }) => [uri, deps.metadata(info).revision] as const),
      ),
    );
  });
  const getFiles = Effect.fn("ModelPrintCheck.readFiles")(function* (
    absolute: string,
    format: CheckRequest["format"],
    root: string,
    maxBytes: number,
  ) {
    if (format === "3mf") return yield* read3mfParts(absolute, maxBytes);
    const bytes = Uint8Array.from(yield* fs.readFile(absolute)),
      files: CheckFile[] = [{ name: path.basename(absolute), bytes }];
    if (format !== "gltf" && format !== "glb") return files;
    const info = yield* fs.stat(absolute),
      uris = yield* manifestUris(absolute, format, deps.metadata(info).revision);
    let total = bytes.length;
    for (const uri of uris) {
      const { target, info } = yield* bufferFile(absolute, root, uri);
      const count = Number(info.size);
      total += count;
      if (count > maxBytes || total > maxBytes * 2)
        return yield* failure("too-large", "This glTF and its buffers are too large to check.");
      files.push({ name: uri, bytes: Uint8Array.from(yield* fs.readFile(target)) });
    }
    return files;
  });
  const work = Effect.fn("ModelPrintCheck.check")(function* (input: Input) {
    const initial = yield* deps.resolveFile(input.file),
      kind = modelFormatOf(input.file.path);
    if (!kind) return yield* failure("unsupported-format", "Choose a printable mesh file.");
    const settings = deps.getSettings(),
      maxBytes = input.allowLarge ? 512 * 1024 * 1024 : settings.maxFileMegabytes * 1024 * 1024;
    if (Number(initial.info.size) > maxBytes)
      return yield* failure(
        "too-large",
        `This file exceeds the ${settings.maxFileMegabytes} MB model limit.`,
      );
    let revision: string,
      format: CheckRequest["format"],
      renderedPath: string | null = null;
    if (kind === "scad" || kind === "build123d" || kind === "step") {
      const renderKey = json([initial.absolute, input.overrides ?? {}, input.parameterSet ?? null]),
        rendered = yield* renders.run(
          renderKey,
          scadSlot.withPermit(
            deps.renderScad({
              file: input.file,
              overrides: input.overrides ?? {},
              parameterSet: input.parameterSet ?? null,
              variantId: "loom-print-check",
            }),
          ),
        );
      if (rendered.status === "cancelled")
        return { status: "cancelled", report: null } satisfies PrintCheckResult;
      if (rendered.status !== "ok" || !rendered.mesh || !rendered.meshFormat)
        return yield* failure("command-failed", "Could not render the model for print checks.");
      revision = rendered.mesh.revision;
      format = rendered.meshFormat;
      const stem = path.join(deps.cacheDir, revision);
      yield* deps.protectStem(stem);
      renderedPath = `${stem}.${format}`;
    } else {
      format = kind;
      revision = deps.metadata(initial.info).revision;
    }
    const library = deps.getPrinterLibrary ? yield* deps.getPrinterLibrary() : undefined;
    const selectedBed = activeBed(settings.buildPlate, { library });
    const printerNozzle = selectedBed.nozzlesMm[0];
    const workspace = yield* deps.getWorkspace(input.file),
      orientation = workspace.orientation?.quaternion ?? null,
      nozzle = printerNozzle ?? settings.nozzleDiameterMm,
      dependencies = yield* bufferRevisions(initial.absolute, format, initial.root, revision),
      keyFor = (revision: string, dependencies: readonly (readonly [string, string])[]) =>
        NodeCrypto.createHash("sha256")
          .update(
            json([
              PRINT_CHECK_VERSION,
              revision,
              format,
              orientation,
              nozzle,
              settings.overhangAngleDegrees,
              settings.firstLayerHeightMm,
              dependencies,
            ]),
          )
          .digest("hex"),
      key = keyFor(revision, dependencies);
    let completed = cache.get(key),
      cached = !!completed && !input.force;
    if (completed && cached) {
      cache.delete(key);
      cache.set(key, completed);
    } else {
      completed = yield* jobs.run(
        key,
        coordinator.withPermit(
          Effect.gen(function* () {
            // The shared lease owns IO too: concurrent callers never duplicate large buffers.
            let files: CheckFile[] = [],
              readRevision = revision,
              readDependencies = dependencies;
            if (renderedPath)
              files = yield* getFiles(renderedPath, format, deps.cacheDir, maxBytes);
            else
              for (let attempt = 0; attempt < 2; attempt++) {
                const before = yield* deps.resolveFile(input.file);
                readRevision = deps.metadata(before.info).revision;
                readDependencies = yield* bufferRevisions(
                  before.absolute,
                  format,
                  before.root,
                  readRevision,
                );
                if (Number(before.info.size) > maxBytes)
                  return yield* failure(
                    "too-large",
                    `This file exceeds the ${settings.maxFileMegabytes} MB model limit.`,
                  );
                files = yield* getFiles(before.absolute, format, before.root, maxBytes);
                const after = yield* fs.stat(before.absolute);
                const nextDependencies = yield* bufferRevisions(
                  before.absolute,
                  format,
                  before.root,
                  deps.metadata(after).revision,
                );
                if (
                  readRevision === deps.metadata(after).revision &&
                  json(readDependencies) === json(nextDependencies)
                )
                  break;
                if (attempt === 1)
                  return yield* failure(
                    "command-failed",
                    "The model changed while reading. Check it again.",
                  );
              }
            const finalKey = keyFor(readRevision, readDependencies),
              request: CheckRequest = {
                format,
                files,
                orientation,
                params: {
                  nozzleMm: nozzle,
                  overhangAngleDegrees: settings.overhangAngleDegrees,
                  firstLayerMm: settings.firstLayerHeightMm,
                },
                seed: Number.parseInt(finalKey.slice(0, 8), 16),
                limits: { maxTriangles: PRINT_CHECK_MAX_TRIANGLES, thicknessBudgetMs: 15000 },
              };
            const reply = yield* (deps.runWorker ?? runCheckWorker)(request);
            if (!reply.ok) return yield* failure(reply.reason, reply.message);
            const result: CompletedCheck = {
              core: reply.core,
              geometryRevision: readRevision,
              checkedAt: DateTime.formatIso(yield* DateTime.now),
            };
            cache.delete(finalKey);
            cache.set(finalKey, result);
            while (cache.size > 64) cache.delete(cache.keys().next().value!);
            return result;
          }).pipe(
            Effect.mapError((cause) =>
              isModelPreviewError(cause)
                ? cause
                : failure("command-failed", "Could not read this model for print checks."),
            ),
          ),
        ),
      );
    }
    const core = completed.core;
    const bed = activeBed(deps.getSettings().buildPlate, { library }),
      { fit } = fitBed(core.summary.sizeMm, bed);
    return {
      status: "ok",
      report: finalizeReport(core, {
        geometryRevision: completed.geometryRevision,
        checkedAt: completed.checkedAt,
        cached,
        settings: {
          nozzleMm: nozzle,
          nozzleSource: printerNozzle === undefined ? "setting" : "printer",
          overhangAngleDegrees: settings.overhangAngleDegrees,
          firstLayerMm: settings.firstLayerHeightMm,
          minWallMm: 2 * nozzle,
        },
        bed: {
          id: bed.id,
          label: bed.label,
          fit: fit.status,
          overMm: fit.status === "too-big" ? fit.overMm : null,
        },
      }),
    } satisfies PrintCheckResult;
  });
  const checkPrint = Effect.fn("ModelPrintCheck.request")((input: Input) =>
    coordinator.request(
      input,
      work(input).pipe(
        Effect.mapError((cause) =>
          isModelPreviewError(cause)
            ? cause
            : failure("command-failed", "Could not read this model for print checks."),
        ),
      ),
    ),
  );
  const cancelPrintCheck = coordinator.cancel;
  return { checkPrint, cancelPrintCheck };
});
