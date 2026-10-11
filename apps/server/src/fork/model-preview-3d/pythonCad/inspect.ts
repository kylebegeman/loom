// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import { ModelPreviewError } from "@t3tools/contracts/fork";
import type { PythonEnvironment } from "./environment.ts";
import type { PythonResponse } from "./protocol.ts";
/** Static AST results are independent of imported modules and the selected CAD environment. */
export const makePythonInspector = (environment: PythonEnvironment) => {
  const cache = new Map<string, PythonResponse>();
  return Effect.fn("PythonCad.inspect")(function* (absolute: string, source: string) {
    const hash = NodeCrypto.createHash("sha256").update(source).digest("hex");
    const existing = cache.get(hash);
    if (existing) return existing;
    const interpreter = yield* environment.inspectionInterpreter();
    const response = yield* environment.run({
      command: "inspect",
      interpreter,
      request: { source: absolute, sourceText: source },
    });
    if (!response.ok)
      return yield* new ModelPreviewError({
        reason: "invalid-parameter",
        message:
          response.log.find((row) => row.level === "error")?.text ??
          "Could not read Python CAD parameters.",
      });
    cache.set(hash, response);
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
    return response;
  });
};
