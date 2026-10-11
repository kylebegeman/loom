import * as NodeWorkerThreads from "node:worker_threads";
import { CheckFailure, weld } from "./mesh.ts";
import { readStl } from "./readStl.ts";
import { readObj } from "./readObj.ts";
import { read3mf } from "./read3mf.ts";
import { readGltf } from "./readGltf.ts";
import { runPrintChecks } from "./printChecks.ts";
import { readPart, runAssemblyChecks } from "./assemblyChecks.ts";
import type { WorkerReply, WorkerRequest } from "./protocol.ts";
NodeWorkerThreads.parentPort?.once("message", (request: WorkerRequest) => {
  const started = performance.now();
  let reply: WorkerReply;
  try {
    if ("kind" in request) {
      if (request.kind === "bounds") {
        const soup = readPart(request.part, request.limits.maxTriangles),
          mesh = weld(soup);
        reply = { ok: true, bounds: mesh.bounds, triangles: mesh.triangles.length / 3 };
      } else reply = { ok: true, core: runAssemblyChecks(request) };
    } else {
      const parsedAt = performance.now(),
        soup =
          request.format === "stl"
            ? readStl(request.files, request.limits)
            : request.format === "obj"
              ? readObj(request.files, request.limits)
              : request.format === "3mf"
                ? read3mf(request.files, request.limits)
                : readGltf(request.files, request.limits),
        parseMs = performance.now() - parsedAt;
      const weldedAt = performance.now(),
        mesh = weld(soup, request.orientation),
        weldMs = performance.now() - weldedAt,
        core = runPrintChecks(
          mesh,
          request.params,
          request.seed,
          request.limits.thicknessBudgetMs,
          request.orientation,
        );
      reply = {
        ok: true,
        core: {
          ...core,
          durationMs: performance.now() - started,
          stages: [{ name: "parse", ms: parseMs }, { name: "weld", ms: weldMs }, ...core.stages],
        },
      };
    }
  } catch (cause) {
    reply = {
      ok: false,
      reason: cause instanceof CheckFailure ? cause.reason : "command-failed",
      message: cause instanceof CheckFailure ? cause.message : "Could not analyse this mesh.",
    };
  }
  // Node worker messages do not use browser origins.
  NodeWorkerThreads.parentPort?.postMessage(reply);
  NodeWorkerThreads.parentPort?.close();
});
