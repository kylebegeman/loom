import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { ThreadId } from "@t3tools/contracts";
import {
  ModelPreviewError,
  type AssemblyPart,
  type AssemblyReadResult,
} from "@t3tools/contracts/fork";
import { makeAssemblyChecker } from "./checker.ts";
import { binaryStl, cubeSoup } from "../check/fixtures.ts";
import { runAssemblyChecks, readPart } from "../check/assemblyChecks.ts";
import { weld } from "../check/mesh.ts";
const part = (
  id: string,
  position: readonly [number, number, number],
  visible = true,
): AssemblyPart => ({
  id,
  path: `${id}.stl`,
  name: id,
  position,
  rotation: [0, 0, 0],
  parameters: {},
  parameterSet: null,
  color: null,
  visible,
  explode: null,
});
const snapshot: AssemblyReadResult = {
  path: "board.loom-assembly.json",
  revision: "r1",
  readOnly: false,
  parts: [],
  assembly: {
    enclosure: null,
    format: "loom-assembly",
    version: 1,
    units: "mm",
    name: "board",
    parts: [part("a", [0, 0, 0]), part("b", [11, 0, 0], false)],
    clearances: [{ id: "fit", a: "a", b: "b", requiredMm: 2, label: null }],
  },
};
const file = { threadId: ThreadId.make("assembly"), path: snapshot.path };
it.effect(
  "checks hidden clearance pairs, caches by geometry and placement, and skips missing parts explicitly",
  () =>
    Effect.gen(function* () {
      let current = snapshot,
        revision = "g1",
        runs = 0,
        missing = false;
      const service = yield* makeAssemblyChecker({
        assembly: () => Effect.succeed(current),
        geometry: (_file, p) =>
          missing && p.id === "b"
            ? Effect.fail(new ModelPreviewError({ reason: "not-found", message: "Deleted" }))
            : Effect.succeed({
                format: "stl",
                files: [{ name: "part.stl", bytes: binaryStl(cubeSoup()) }],
                geometryRevision: revision,
              }),
        runWorker: (request) =>
          Effect.sync(() => {
            runs++;
            return { ok: true as const, core: runAssemblyChecks(request) };
          }),
      });
      const first = yield* service.checkAssembly({ file });
      expect(first.report?.pairs[0]?.clearance).toBe("tight");
      expect(first.report?.parts).toHaveLength(2);
      expect((yield* service.checkAssembly({ file })).report?.cached).toBe(true);
      expect(runs).toBe(1);
      revision = "g2";
      yield* service.checkAssembly({ file });
      expect(runs).toBe(2);
      current = {
        ...snapshot,
        revision: "r2",
        assembly: {
          ...snapshot.assembly,
          parts: [snapshot.assembly.parts[0]!, part("b", [15, 0, 0], false)],
        },
      };
      expect((yield* service.checkAssembly({ file })).report?.pairs[0]?.clearance).toBe("ok");
      expect(runs).toBe(3);
      missing = true;
      const partial = yield* service.checkAssembly({ file, force: true });
      expect(partial.report?.complete).toBe(false);
      expect(partial.report?.skipped).toEqual([{ id: "b", reason: "Deleted" }]);
    }).pipe(Effect.scoped),
);
it.effect("cancels one fit-check lease while another retains the same worker", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>(),
      prepared = yield* Deferred.make<void>(),
      release = yield* Deferred.make<void>();
    let runs = 0,
      reads = 0;
    const service = yield* makeAssemblyChecker({
      assembly: () => Effect.sync(() => snapshot),
      geometry: () =>
        Effect.gen(function* () {
          if (++reads === 4) yield* Deferred.succeed(prepared, undefined);
          return {
            format: "stl" as const,
            files: [{ name: "part.stl", bytes: binaryStl(cubeSoup()) }],
            geometryRevision: "g",
          };
        }),
      runWorker: (request) =>
        Effect.gen(function* () {
          runs++;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return { ok: true as const, core: runAssemblyChecks(request) };
        }),
    });
    const a = yield* service.checkAssembly({ file, requestId: "panel" }).pipe(Effect.forkChild);
    yield* Deferred.await(started);
    const b = yield* service.checkAssembly({ file, requestId: "agent" }).pipe(Effect.forkChild);
    yield* Deferred.await(prepared);
    yield* Effect.yieldNow;
    yield* service.cancelAssemblyCheck({ file, requestId: "panel" });
    expect(yield* Fiber.join(a)).toEqual({ status: "cancelled", report: null });
    yield* Deferred.succeed(release, undefined);
    expect((yield* Fiber.join(b)).status).toBe("ok");
    expect(runs).toBe(1);
  }).pipe(Effect.scoped),
);
it.effect("bounds cache ignores translation but includes rotation", () =>
  Effect.gen(function* () {
    let runs = 0;
    const service = yield* makeAssemblyChecker({
      assembly: () => Effect.succeed(snapshot),
      geometry: () =>
        Effect.succeed({
          format: "stl",
          files: [{ name: "part.stl", bytes: binaryStl(cubeSoup([4, 2, 1])) }],
          geometryRevision: "g",
        }),
      runBounds: (request) =>
        Effect.sync(() => {
          runs++;
          const mesh = weld(readPart(request.part, request.limits.maxTriangles));
          return { ok: true as const, bounds: mesh.bounds, triangles: mesh.triangles.length / 3 };
        }),
    });
    expect((yield* service.boundsOf(file, part("a", [1, 2, 3]))).min).toEqual([1, 2, 3]);
    expect((yield* service.boundsOf(file, part("a", [4, 5, 6]))).max).toEqual([8, 7, 7]);
    expect(runs).toBe(1);
    yield* service.boundsOf(file, { ...part("a", [0, 0, 0]), rotation: [0, 0, 90] });
    expect(runs).toBe(2);
  }).pipe(Effect.scoped),
);

it.effect(
  "cached report and placement bounds reuse revision probes without rereading mesh bytes",
  () =>
    Effect.gen(function* () {
      let loads = 0;
      let revision = "g1";
      const service = yield* makeAssemblyChecker({
        assembly: () => Effect.succeed(snapshot),
        geometryRevision: () => Effect.succeed(revision),
        geometry: () =>
          Effect.sync(() => {
            loads++;
            return {
              format: "stl" as const,
              files: [{ name: "part.stl", bytes: binaryStl(cubeSoup()) }],
              geometryRevision: revision,
            };
          }),
        runWorker: (request) =>
          Effect.sync(() => ({ ok: true as const, core: runAssemblyChecks(request) })),
        runBounds: (request) =>
          Effect.sync(() => ({
            ok: true as const,
            bounds: weld(readPart(request.part, request.limits.maxTriangles)).bounds,
            triangles: 12,
          })),
      });
      yield* service.checkAssembly({ file });
      expect(loads).toBe(2);
      expect((yield* service.checkAssembly({ file })).report?.cached).toBe(true);
      expect(loads).toBe(2);
      yield* service.boundsOf(file, snapshot.assembly.parts[0]!);
      expect(loads).toBe(3);
      yield* service.boundsOf(file, snapshot.assembly.parts[0]!);
      expect(loads).toBe(3);
      revision = "g2";
      yield* service.checkAssembly({ file });
      expect(loads).toBe(5);
    }).pipe(Effect.scoped),
);
