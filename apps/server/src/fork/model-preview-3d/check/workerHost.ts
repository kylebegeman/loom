// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeWorkerThreads from "node:worker_threads";
import * as Effect from "effect/Effect";
import { ModelPreviewError } from "@t3tools/contracts/fork";
import type { CheckReply, CheckRequest } from "./protocol.ts";
let bundledSource: URL | undefined;
const source = () =>
  Effect.tryPromise({
    try: async () => {
      if (import.meta.url.endsWith(".ts"))
        return new URL("./model-check-worker.ts", import.meta.url);
      if (bundledSource) return bundledSource;
      const bytes = await NodeFSP.readFile(
        new URL("./fork/model-preview-3d/check/model-check-worker.mjs", import.meta.url),
      );
      bundledSource = new URL(`data:text/javascript;base64,${bytes.toString("base64")}`);
      return bundledSource;
    },
    catch: () =>
      new ModelPreviewError({
        reason: "unavailable",
        message: "Print checks are not available in this build.",
      }),
  });
/** One worker owns one check. Termination is awaited on success, timeout and interruption. */
export const runCheckWorker = (
  request: CheckRequest,
  options: {
    timeoutMs?: number;
    workerUrl?: URL;
    onWorker?: (worker: NodeWorkerThreads.Worker) => void;
  } = {},
) =>
  Effect.gen(function* () {
    const workerUrl = options.workerUrl ?? (yield* source());
    if (workerUrl.protocol === "file:")
      yield* Effect.tryPromise({
        try: () => NodeFSP.access(workerUrl),
        catch: () =>
          new ModelPreviewError({
            reason: "unavailable",
            message: "Print checks are not available in this build.",
          }),
      });
    const worker = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          new NodeWorkerThreads.Worker(workerUrl, {
            resourceLimits: { maxOldGenerationSizeMb: 512 },
          }),
        catch: () =>
          new ModelPreviewError({
            reason: "unavailable",
            message: "Print checks are not available in this build.",
          }),
      }),
      (w) => Effect.promise(() => w.terminate()).pipe(Effect.asVoid),
    );
    options.onWorker?.(worker);
    const reply = Effect.callback<CheckReply, ModelPreviewError>((resume) => {
      const message = (value: CheckReply) => resume(Effect.succeed(value)),
        error = () =>
          resume(
            Effect.fail(
              new ModelPreviewError({
                reason: "command-failed",
                message: "The print check stopped unexpectedly.",
              }),
            ),
          ),
        exit = (code: number) =>
          resume(
            Effect.fail(
              new ModelPreviewError({
                reason: "command-failed",
                message: `The print check stopped unexpectedly (exit code ${code}).`,
              }),
            ),
          );
      worker.once("message", message);
      worker.once("error", error);
      worker.once("exit", exit);
      try {
        const buffers = request.files.map((file) => file.bytes.buffer as ArrayBuffer);
        worker.postMessage(request, [...new Set(buffers)]);
      } catch {
        error();
      }
      return Effect.sync(() => {
        worker.off("message", message);
        worker.off("error", error);
        worker.off("exit", exit);
      });
    });
    return yield* reply.pipe(
      Effect.timeoutOrElse({
        duration: options.timeoutMs ?? 60000,
        orElse: () =>
          Effect.fail(
            new ModelPreviewError({
              reason: "timeout",
              message: "The print check took longer than 60 seconds and was stopped.",
            }),
          ),
      }),
    );
  }).pipe(Effect.scoped);
