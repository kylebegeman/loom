// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Semaphore from "effect/Semaphore";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import { type ModelFileRef, type ModelPreviewError } from "@t3tools/contracts/fork";
export const makeCheckCoordinator = Effect.gen(function* () {
  const scope = yield* Effect.scope,
    slot = yield* Semaphore.make(1);
  const requests = new Map<string, Fiber.Fiber<unknown, ModelPreviewError>>();
  const request = <A extends { status: "ok" | "cancelled"; report: unknown }, R>(
    input: { file: ModelFileRef; requestId?: string },
    work: Effect.Effect<A, ModelPreviewError, R>,
  ) =>
    Effect.gen(function* () {
      const key = `${input.file.threadId}\0${input.file.path}\0${input.requestId ?? NodeCrypto.randomUUID()}`;
      const fiber = yield* Effect.scoped(work).pipe(Effect.forkIn(scope));
      if (input.requestId) {
        const prior = requests.get(key);
        requests.set(key, fiber);
        if (prior) yield* Fiber.interrupt(prior);
      }
      const exit = yield* Effect.exit(Fiber.join(fiber)).pipe(
        Effect.onInterrupt(() => Fiber.interrupt(fiber)),
        Effect.ensuring(
          Effect.sync(() => {
            if (requests.get(key) === fiber) requests.delete(key);
          }),
        ),
      );
      if (Exit.isSuccess(exit)) return exit.value;
      if (Cause.hasInterrupts(exit.cause)) return { status: "cancelled", report: null } as A;
      return yield* Effect.failCause(exit.cause);
    });
  const cancel = Effect.fn("ModelChecks.cancel")(function* (input: {
    file: ModelFileRef;
    requestId: string;
  }) {
    const fiber = requests.get(`${input.file.threadId}\0${input.file.path}\0${input.requestId}`);
    if (fiber) yield* Fiber.interrupt(fiber);
  });
  return { withPermit: slot.withPermit, request, cancel };
});
export type CheckCoordinator = Effect.Success<typeof makeCheckCoordinator>;
