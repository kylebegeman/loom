// fork: project-lifecycle
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProcessRunner from "../processRunner.ts";

class CheckoutProcessUnavailable extends Schema.TaggedError<CheckoutProcessUnavailable>()(
  "CheckoutProcessUnavailable",
  { message: Schema.String },
) {}

/** Recovery reuses the host's runner, or its spawner on filesystem-only service paths. */
export const runCheckoutProcess = Effect.fn("Checkout.runProcess")(function* (
  input: ProcessRunner.ProcessRunInput,
) {
  const existing = yield* Effect.serviceOption(ProcessRunner.ProcessRunner);
  if (Option.isSome(existing)) return yield* existing.value.run(input);
  const spawner = yield* Effect.serviceOption(ChildProcessSpawner.ChildProcessSpawner);
  if (Option.isNone(spawner))
    return yield* new CheckoutProcessUnavailable({
      message: "Checkout recovery requires process access on this host.",
    });
  const runner = yield* ProcessRunner.make().pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner.value),
  );
  return yield* runner.run(input);
});
