import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { DesktopUpdates } from "../../updates/DesktopUpdates.ts";

export const makeIdleWindowLifetime = Effect.fn("DesktopIdleInstall.windowLifetime")(
  function* (input: {
    readonly updates: Pick<
      DesktopUpdates["Service"],
      "getState" | "isInstallActive" | "subscribe"
    > | null;
    readonly canQuit: Effect.Effect<boolean>;
    readonly quit: Effect.Effect<void>;
  }) {
    const closed = yield* Ref.make(false);
    const holdClose = Effect.gen(function* () {
      if (input.updates === null) return false;
      const hold =
        (yield* input.updates.getState).installWhenIdle === true ||
        (yield* input.updates.isInstallActive);
      yield* Ref.set(closed, hold);
      return hold;
    });
    const changes =
      input.updates === null ? Stream.empty : (yield* input.updates.subscribe).changes;
    const watch = Stream.runForEach(changes, (state) =>
      Effect.gen(function* () {
        if (
          !(yield* Ref.get(closed)) ||
          state.installWhenIdle === true ||
          (yield* input.updates!.isInstallActive) ||
          !(yield* input.canQuit)
        )
          return;
        yield* Ref.set(closed, false);
        yield* input.quit;
      }),
    );
    yield* watch.pipe(Effect.forkScoped);
    return { holdClose, opened: Ref.set(closed, false) };
  },
);
