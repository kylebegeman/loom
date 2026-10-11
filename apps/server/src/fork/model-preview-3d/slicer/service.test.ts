import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { DEFAULT_MODEL_PREVIEW_SETTINGS, type ModelPreviewSettings } from "@t3tools/contracts/fork";
import { ThreadId } from "@t3tools/contracts";
import { ProcessRunner, type ProcessRunOutput } from "../../../processRunner.ts";
import { estimateCost, makeSlicer, sliceCacheKey } from "./service.ts";
const output = (stdout = ""): ProcessRunOutput => ({
  stdout,
  stderr: "",
  code: 0 as ProcessRunOutput["code"],
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});
const config =
  "nozzle_diameter = 0.4\nlayer_height = 0.2\nfilament_diameter = 1.75\nfilament_density = 1.26\nfilament_cost = 20";
const gcode =
  "G90\nM82\n;Z:0.2\n;TYPE:Support material\nG1 X10 E1\nG1 X20 E2\n; filament used [mm] = 100\n; filament used [g] = 2\n; estimated printing time (normal mode) = 2m\n";
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-slicer-service-" }),
    executable = path.join(root, "PrusaSlicer"),
    mesh = path.join(root, "cube.stl");
  yield* fs.writeFileString(executable, "fixture");
  yield* fs.writeFileString(mesh, "mesh");
  let settings: ModelPreviewSettings = {
      ...DEFAULT_MODEL_PREVIEW_SETTINGS,
      slicer: {
        ...DEFAULT_MODEL_PREVIEW_SETTINGS.slicer,
        paths: { ...DEFAULT_MODEL_PREVIEW_SETTINGS.slicer.paths, "prusa-slicer": executable },
      },
    },
    calls = 0,
    revision = "a";
  const started = yield* Deferred.make<void>(),
    interrupted = yield* Deferred.make<void>();
  let block = false,
    materialPrice: number | null = null;
  const materialBeds: string[] = [];
  const runner = ProcessRunner.of({
    run: (input) =>
      Effect.gen(function* () {
        if (input.args.includes("--help")) return output("PrusaSlicer 2.9.0");
        expect(input.args).toContain("--datadir");
        expect(input.args).toContain("--load");
        expect(input.args).toContain("--binary-gcode");
        calls++;
        if (block) {
          yield* Deferred.succeed(started, undefined);
          return yield* Effect.never;
        }
        const destination = input.args[input.args.indexOf("--output") + 1]!;
        yield* fs.writeFileString(destination, gcode);
        return output();
      }).pipe(
        Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        Effect.orDie,
      ),
  });
  const slicer = yield* makeSlicer({
    stateDir: path.join(root, "state"),
    home: root,
    getSettings: () => settings,
    resolveMesh: () =>
      Effect.succeed({ absolute: mesh, format: "stl" as const, geometryRevision: revision }),
    getOrientation: () => Effect.succeed(null),
    material: (_id, _slot, bedId) => {
      materialBeds.push(bedId);
      return Effect.succeed({ density: 1.26, pricePerKg: materialPrice });
    },
    sign: (_root, absolute) =>
      Effect.succeed({
        relativeUrl: absolute,
        expiresAt: 1000000000,
        sizeBytes: 1,
        modifiedAt: "2026-10-10T00:00:00Z",
        revision: "a",
      }),
    getOpenScad: () =>
      Effect.succeed({
        path: null,
        version: null,
        supportsManifold: false,
        supportsSummary: false,
        isSnapshot: false,
        supportsColors: false,
      }),
  }).pipe(Effect.provideService(ProcessRunner, runner));
  const entry = yield* slicer.importSlicerProfile({
    app: "prusa-slicer",
    kind: "config",
    fileName: "Mine.ini",
    text: config,
  });
  settings = {
    ...settings,
    slicer: {
      ...settings.slicer,
      mappings: {
        "bambu-h2d": {
          app: "prusa-slicer",
          machine: { source: "imported", name: entry.name },
          process: null,
          filaments: [],
        },
      },
    },
  };
  const input = {
    file: { threadId: ThreadId.make("thread"), path: "cube.stl" },
    overrides: {},
    parameterSet: null,
    bedId: "bambu-h2d",
  };
  return {
    slicer,
    input,
    root,
    calls: () => calls,
    reprice: (price: number) => {
      materialPrice = price;
    },
    materialBeds,
    block: () => {
      block = true;
      revision = "b";
    },
    started,
    interrupted,
  };
});
it.effect("publishes verified output, reuses cache and recalculates explicit filament cost", () =>
  Effect.gen(function* () {
    const { slicer, input, calls, reprice, materialBeds } = yield* fixture;
    expect((yield* slicer.slice({ ...input, cachedOnly: true })).status).toBe("none");
    expect(calls()).toBe(0);
    const sliced = yield* slicer.slice(input);
    expect(sliced.status).toBe("ok");
    expect(sliced.cached).toBe(false);
    expect(sliced.estimate).toMatchObject({
      printSeconds: 120,
      totalGrams: 2,
      cost: 0.04,
      supportUsed: true,
    });
    expect(sliced.estimate?.supportGrams).toBeGreaterThan(0);
    expect(sliced.layers?.segmentCount).toBe(2);
    const cached = yield* slicer.slice({ ...input, cachedOnly: true });
    expect(cached.cached).toBe(true);
    expect(cached.key).toBe(sliced.key);
    expect(calls()).toBe(1);
    reprice(30);
    const repriced = yield* slicer.slice({ ...input, cachedOnly: true });
    expect(repriced.estimate?.cost).toBe(0.06);
    expect(calls()).toBe(1);
    expect(materialBeds.every((bed) => bed === "bambu-h2d")).toBe(true);
    yield* slicer.clearCache();
    expect((yield* slicer.slice({ ...input, cachedOnly: true })).status).toBe("none");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("caller interruption stops the host job and leaves no published partial result", () =>
  Effect.gen(function* () {
    const { slicer, input, root, block, started, interrupted } = yield* fixture;
    block();
    const fiber = yield* slicer.slice(input).pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* Fiber.interrupt(fiber);
    yield* Deferred.await(interrupted);
    const fs = yield* FileSystem.FileSystem,
      path = yield* Path.Path;
    expect(yield* fs.readDirectory(path.join(root, "state", "slices"))).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it("cache identity includes geometry, profiles, executable, adapter and orientation", () => {
  const base = {
    app: "bambu-studio" as const,
    version: "2.8.4",
    executable: "/slicer",
    geometry: "mesh",
    orientation: null,
    profiles: ["machine", "process", "filament"],
  };
  expect(sliceCacheKey(base)).toBe(sliceCacheKey({ ...base }));
  expect(sliceCacheKey(base)).not.toBe(sliceCacheKey({ ...base, orientation: [0, 0, 1, 0] }));
  expect(sliceCacheKey(base)).not.toBe(
    sliceCacheKey({ ...base, profiles: ["machine", "other", "filament"] }),
  );
  const estimate = {
    printSeconds: 1,
    layerCount: 1,
    filaments: [
      { slot: 0, type: "PLA", colorHex: null, grams: 20, lengthMm: 10 },
      { slot: 1, type: "PETG", colorHex: null, grams: 10, lengthMm: 5 },
    ],
    totalGrams: 30,
    supportUsed: false,
    supportGrams: 0,
    cost: null,
    currency: "USD",
  };
  expect(estimateCost(estimate, [20, null], "USD").cost).toBeNull();
  expect(estimateCost(estimate, [20, 30], "USD").cost).toBeCloseTo(0.7);
});
