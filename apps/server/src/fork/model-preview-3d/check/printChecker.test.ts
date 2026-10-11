import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@t3tools/contracts";
import {
  DEFAULT_MODEL_PREVIEW_SETTINGS,
  EMPTY_MODEL_WORKSPACE,
  ModelPreviewError,
} from "@t3tools/contracts/fork";
import { makePrintChecker } from "./printChecker.ts";
import { runPrintChecks } from "./printChecks.ts";
import { weld } from "./mesh.ts";
import { cubeSoup, binaryStl } from "./fixtures.ts";
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-print-check-" }),
    file = { threadId: ThreadId.make("check"), path: "cube.stl" };
  yield* fs.writeFile(path.join(root, file.path), binaryStl(cubeSoup()));
  let settings = DEFAULT_MODEL_PREVIEW_SETTINGS,
    workspace = EMPTY_MODEL_WORKSPACE,
    count = 0,
    reads = 0,
    changeDuringRead = false;
  const started = yield* Deferred.make<void>(),
    release = yield* Deferred.make<void>(),
    stopped = yield* Deferred.make<void>(),
    prepared = yield* Deferred.make<void>();
  let block = false,
    preparations = 0;
  const checker = yield* makePrintChecker({
    resolveFile: (f) =>
      fs.stat(path.join(root, f.path)).pipe(
        Effect.map((info) => ({ root, absolute: path.join(root, f.path), info })),
        Effect.mapError(() => new ModelPreviewError({ reason: "not-found", message: "Missing." })),
      ),
    metadata: (info) => ({ revision: `${info.size}:${Option.getOrNull(info.mtime)?.getTime()}` }),
    getWorkspace: () =>
      Effect.gen(function* () {
        if (++preparations === 2) yield* Deferred.succeed(prepared, undefined);
        return workspace;
      }),
    getSettings: () => settings,
    renderScad: () =>
      fs.writeFile(path.join(root, "step-preview.stl"), binaryStl(cubeSoup())).pipe(
        Effect.mapError(
          () =>
            new ModelPreviewError({ reason: "command-failed", message: "Failed to write mesh." }),
        ),
        Effect.as({
          status: "ok" as const,
          mesh: {
            revision: "step-preview",
            relativeUrl: "",
            sizeBytes: 684,
            expiresAt: 0,
            modifiedAt: "",
          },
          meshFormat: "stl" as const,
          cached: false,
          durationMs: 0,
          log: [],
          summary: null,
        }),
      ),
    protectStem: () => Effect.void,
    cacheDir: root,
    runWorker: (request) =>
      Effect.gen(function* () {
        count++;
        if (block)
          yield* Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
          );
        return {
          ok: true as const,
          core: runPrintChecks(weld(cubeSoup(), request.orientation), request.params, request.seed),
        };
      }),
  }).pipe(
    Effect.provideService(FileSystem.FileSystem, {
      ...fs,
      readFile: (name) =>
        fs.readFile(name).pipe(
          Effect.tap(() =>
            Effect.gen(function* () {
              reads++;
              if (changeDuringRead) {
                changeDuringRead = false;
                yield* fs.writeFile(name, binaryStl(cubeSoup([20, 20, 20])));
                yield* fs.utimes(name, 100, 100);
              }
            }),
          ),
        ),
    }),
  );
  return {
    checker,
    fs,
    path,
    root,
    reads: () => reads,
    changeDuringRead: () => {
      changeDuringRead = true;
    },
    file,
    started,
    release,
    stopped,
    prepared,
    block: () => {
      block = true;
    },
    count: () => count,
    setSettings: (value: typeof settings) => {
      settings = value;
    },
    setWorkspace: (value: typeof workspace) => {
      workspace = value;
    },
  };
});
const layer = Layer.mergeAll(NodeServices.layer);
it.effect("caches geometry, forces reruns and excludes bed choice from the key", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    expect((yield* t.checker.checkPrint({ file: t.file })).report?.cached).toBe(false);
    expect((yield* t.checker.checkPrint({ file: t.file })).report?.cached).toBe(true);
    expect(t.reads()).toBe(1);
    t.setSettings({
      ...DEFAULT_MODEL_PREVIEW_SETTINGS,
      buildPlate: {
        ...DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate,
        preset: "custom",
        customMm: [5, 5, 5],
      },
    });
    expect((yield* t.checker.checkPrint({ file: t.file })).report?.verdict).toBe("blocked");
    expect(t.count()).toBe(1);
    yield* t.checker.checkPrint({ file: t.file, force: true });
    expect(t.count()).toBe(2);
    for (const patch of [
      { nozzleDiameterMm: 0.6 },
      { overhangAngleDegrees: 50 },
      { firstLayerHeightMm: 0.3 },
    ]) {
      t.setSettings({
        ...DEFAULT_MODEL_PREVIEW_SETTINGS,
        buildPlate: { ...DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate, preset: "custom" },
        ...patch,
      });
      yield* t.checker.checkPrint({ file: t.file });
    }
    expect(t.count()).toBe(5);
    t.setWorkspace({
      ...EMPTY_MODEL_WORKSPACE,
      orientation: { quaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], sourceRevision: "old" },
    });
    yield* t.checker.checkPrint({ file: t.file });
    expect(t.count()).toBe(6);
  }).pipe(Effect.provide(layer), Effect.scoped),
);
it.effect("shares a worker and cancelling one caller retains the other lease", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    t.block();
    const a = yield* t.checker
      .checkPrint({ file: t.file, requestId: "panel" })
      .pipe(Effect.forkChild);
    yield* Deferred.await(t.started);
    const b = yield* t.checker
      .checkPrint({ file: t.file, requestId: "agent" })
      .pipe(Effect.forkChild);
    yield* Deferred.await(t.prepared);
    yield* Effect.yieldNow;
    yield* t.checker.cancelPrintCheck({ file: t.file, requestId: "panel" });
    expect(yield* Fiber.join(a)).toEqual({ status: "cancelled", report: null });
    yield* Deferred.succeed(t.release, undefined);
    expect((yield* Fiber.join(b)).status).toBe("ok");
    expect(t.count()).toBe(1);
  }).pipe(Effect.provide(layer), Effect.scoped),
);
it.effect("cancelling the last lease interrupts its worker", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    t.block();
    const a = yield* t.checker
      .checkPrint({ file: t.file, requestId: "panel" })
      .pipe(Effect.forkChild);
    yield* Deferred.await(t.started);
    yield* t.checker.cancelPrintCheck({ file: t.file, requestId: "panel" });
    yield* Deferred.await(t.stopped);
    expect((yield* Fiber.join(a)).status).toBe("cancelled");
  }).pipe(Effect.provide(layer), Effect.scoped),
);

it.effect(
  "external glTF buffer edits invalidate geometry cache while preserving the model revision",
  () =>
    Effect.gen(function* () {
      const t = yield* setup,
        file = { ...t.file, path: "part.gltf" };
      yield* t.fs.writeFileString(
        t.path.join(t.root, file.path),
        json({ asset: { version: "2.0" }, buffers: [{ uri: "mesh.bin", byteLength: 36 }] }),
      );
      yield* t.fs.writeFile(t.path.join(t.root, "mesh.bin"), new Uint8Array(36));
      const first = yield* t.checker.checkPrint({ file });
      expect(first.report?.cached).toBe(false);
      expect((yield* t.checker.checkPrint({ file })).report?.cached).toBe(true);
      const before = t.reads();
      yield* t.fs.writeFile(t.path.join(t.root, "mesh.bin"), new Uint8Array(36).fill(1));
      yield* t.fs.utimes(t.path.join(t.root, "mesh.bin"), 200, 200);
      const next = yield* t.checker.checkPrint({ file });
      expect(next.report?.cached).toBe(false);
      expect(next.report?.geometryRevision).toBe(first.report?.geometryRevision);
      expect(t.count()).toBe(2);
      expect(t.reads()).toBe(before + 2);
    }).pipe(Effect.provide(layer), Effect.scoped),
);

it.effect(
  "retries source edits during reads, respects allowLarge and renders STEP while rejecting unsafe buffers",
  () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.changeDuringRead();
      const changed = yield* t.checker.checkPrint({ file: t.file });
      expect(t.reads()).toBe(2);
      expect(changed.report?.geometryRevision).toContain(":100000");
      t.setSettings({ ...DEFAULT_MODEL_PREVIEW_SETTINGS, maxFileMegabytes: 0.0001 });
      expect((yield* Effect.flip(t.checker.checkPrint({ file: t.file, force: true }))).reason).toBe(
        "too-large",
      );
      expect(
        (yield* t.checker.checkPrint({ file: t.file, force: true, allowLarge: true })).status,
      ).toBe("ok");
      yield* t.fs.writeFileString(t.path.join(t.root, "part.step"), "step");
      expect(
        (yield* t.checker.checkPrint({ file: { ...t.file, path: "part.step" }, allowLarge: true }))
          .status,
      ).toBe("ok");
      for (const uri of ["https://example.test/a.bin", "../outside.bin", "%2e%2e/outside.bin"]) {
        yield* t.fs.writeFileString(t.path.join(t.root, "part.gltf"), json({ buffers: [{ uri }] }));
        expect(
          (yield* Effect.flip(
            t.checker.checkPrint({ file: { ...t.file, path: "part.gltf" }, allowLarge: true }),
          )).reason,
        ).toBe("invalid-path");
      }
    }).pipe(Effect.provide(layer), Effect.scoped),
);
