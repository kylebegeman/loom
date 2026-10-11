// @effect-diagnostics nodeBuiltinImport:off
import type * as NodeWorkerThreads from "node:worker_threads";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { runCheckWorker } from "./workerHost.ts";
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
