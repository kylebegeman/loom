// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import type * as NodeWorkerThreads from "node:worker_threads";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { partMatrix } from "@t3tools/contracts/fork";
import {
  runCheckWorker,
  runAssemblyWorker,
  runBoundsWorker,
  checkWorkerUrl,
} from "./workerHost.ts";
import { cubeSoup, binaryStl } from "./fixtures.ts";
import type { CheckRequest } from "./protocol.ts";
const request = (): CheckRequest => ({
  format: "stl",
  files: [{ name: "cube.stl", bytes: binaryStl(cubeSoup()) }],
  orientation: null,
  params: { nozzleMm: 0.4, overhangAngleDegrees: 45, firstLayerMm: 0.2 },
  seed: 42,
  limits: { maxTriangles: 3000000, thicknessBudgetMs: 15000 },
});
const spin = new URL("../__fixtures__/check/spin-worker.mjs", import.meta.url);
it.effect("runs the real source worker and reports malformed input as a typed reply", () =>
  Effect.gen(function* () {
    const result = yield* runCheckWorker(request());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.core.summary).toMatchObject({ triangles: 12, watertight: true });
    const malformed = {
      ...request(),
      files: [{ name: "broken.stl", bytes: new Uint8Array([1, 2, 3]) }],
    };
    expect(yield* runCheckWorker(malformed)).toMatchObject({ ok: false, reason: "command-failed" });
  }),
);
it.effect("interruption awaits worker exit and missing builds are unavailable", () =>
  Effect.gen(function* () {
    let worker!: NodeWorkerThreads.Worker;
    let ready!: () => void;
    const online = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const fiber = yield* runCheckWorker(request(), {
      workerUrl: spin,
      onWorker: (w) => {
        worker = w;
        w.once("online", ready);
      },
    }).pipe(Effect.forkChild);
    yield* Effect.promise(() => online);
    const exit = new Promise<number>((resolve) => worker.once("exit", resolve));
    yield* Fiber.interrupt(fiber);
    expect(yield* Effect.promise(() => exit)).toBe(1);
    expect(
      (yield* Effect.flip(
        runCheckWorker(request(), { workerUrl: new URL("./missing-worker.mjs", import.meta.url) }),
      )).reason,
    ).toBe("unavailable");
  }).pipe(Effect.scoped),
);
it.live("hard timeout terminates a busy worker", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      runCheckWorker(request(), { workerUrl: spin, timeoutMs: 25 }),
    );
    expect(failure.reason).toBe("timeout");
  }),
);

it.effect("dispatches precise placement bounds and assembly pairs through the shared worker", () =>
  Effect.gen(function* () {
    const part = (id: string, x: number) => ({
      id,
      format: "stl" as const,
      files: [{ name: "cube.stl", bytes: binaryStl(cubeSoup()) }],
      geometryRevision: id,
      matrix: partMatrix([x, 0, 0], [0, 0, 0]),
    });
    const bounds = yield* runBoundsWorker({
      kind: "bounds",
      part: part("a", 7),
      limits: { maxTriangles: 100 },
    });
    expect(bounds).toMatchObject({
      ok: true,
      bounds: { min: [7, 0, 0], max: [17, 10, 10] },
      triangles: 12,
    });
    const result = yield* runAssemblyWorker({
      kind: "assembly",
      parts: [part("a", 0), part("b", 11)],
      pairs: [{ a: "a", b: "b", clearanceId: "fit", requiredMm: 2 }],
      limits: { maxTriangles: 100, intersections: 10000, distances: 10000 },
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.core.pairs[0]).toMatchObject({
        status: "clear",
        clearance: "tight",
        minDistanceMm: 1,
      });
  }),
);

it.effect(
  "bundled file workers resolve shared chunk imports and preserve missing executable builds",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-check-worker-"))),
        (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
      );
      const moduleUrl = NodeURL.pathToFileURL(NodePath.join(root, "server-chunk.mjs")).href;
      const workerUrl = checkWorkerUrl(moduleUrl);
      expect(workerUrl.protocol).toBe("file:");
      expect(checkWorkerUrl(new URL("./workerHost.ts", import.meta.url).href).pathname).toMatch(
        /\/check\/model-check-worker\.ts$/,
      );
      yield* Effect.promise(() => NodeFSP.mkdir(new URL(".", workerUrl), { recursive: true }));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, "shared.mjs"), "export const triangles = 12;\n"),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          workerUrl,
          'import {triangles} from "../../../shared.mjs"; import {parentPort} from "node:worker_threads"; parentPort.once("message",() => {parentPort.postMessage({ok:true,bounds:{min:[0,0,0],max:[10,10,10]},triangles});parentPort.close();});\n',
        ),
      );
      const result = yield* runBoundsWorker(
        {
          kind: "bounds",
          part: {
            id: "cube",
            format: "stl",
            files: [],
            geometryRevision: "g1",
            matrix: partMatrix([0, 0, 0], [0, 0, 0]),
          },
          limits: { maxTriangles: 100 },
        },
        { workerUrl },
      );
      expect(result).toMatchObject({ ok: true, triangles: 12 });
      yield* Effect.promise(() => NodeFSP.rm(workerUrl));
      expect(
        (yield* Effect.flip(runCheckWorker(request(), { workerUrl: checkWorkerUrl(moduleUrl) })))
          .reason,
      ).toBe("unavailable");
    }).pipe(Effect.scoped),
);
