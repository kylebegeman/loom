import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

const WRITER_PERMITS = 1024;

export class UpdateFence extends Context.Service<
  UpdateFence,
  {
    readonly write: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    readonly acquire: Effect.Effect<Effect.Effect<void>>;
  }
>()("t3/fork/machine-updates/UpdateFence") {}

const make = Effect.gen(function* () {
  const permits = yield* Semaphore.make(WRITER_PERMITS);
  return UpdateFence.of({
    write: permits.withPermits(1),
    acquire: Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* restore(permits.take(WRITER_PERMITS));
        const released = yield* Ref.make(false);
        return Ref.getAndSet(released, true).pipe(
          Effect.flatMap((already) => (already ? Effect.void : permits.release(WRITER_PERMITS))),
          Effect.asVoid,
        );
      }),
    ),
  });
});

export const layer = Layer.effect(UpdateFence, make);
