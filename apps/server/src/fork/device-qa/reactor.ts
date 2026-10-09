import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../../serverActivation.ts";
import { DeviceQaService } from "./DeviceQaService.ts";

export const EXPIRY_SWEEP_INTERVAL = "6 hours";

/** Every thread the projection still knows, active or archived. */
const knownThreads = (threads: ThreadManagementService["Service"]) =>
  Effect.all([
    threads.getShellSnapshot({ location: "active" }),
    threads.getShellSnapshot({ location: "archive" }),
  ]).pipe(
    Effect.map(
      (snapshots) =>
        new Set(
          snapshots.flatMap((snapshot) =>
            [...snapshot.threads, ...snapshot.archivedThreads].map((thread) => thread.id as string),
          ),
        ),
    ),
  );

/**
 * Removes a deleted thread's evidence, catches up on threads deleted while the server was down,
 * and runs the evidence expiry sweep at startup and every six hours.
 */
export const startDeviceQaCleanup = Effect.gen(function* () {
  const deviceQa = yield* DeviceQaService;
  const threads = yield* ThreadManagementService;

  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      event.type === "thread.deleted"
        ? deviceQa.forgetThread(event.payload.id).pipe(Effect.ignore({ log: true }))
        : Effect.void,
    ).pipe(
      Effect.catchCause((cause) => Effect.logWarning("Device QA cleanup stream failed", { cause })),
    ),
  );

  // A failed thread read skips the catch-up rather than treating every thread as deleted,
  // and never stops the sweep that follows.
  const catchUp = knownThreads(threads).pipe(
    Effect.flatMap(deviceQa.forgetMissingThreads),
    Effect.catchCause((cause) => Effect.logWarning("Device QA catch-up skipped", { cause })),
  );
  yield* forkParked(
    catchUp.pipe(
      Effect.andThen(
        deviceQa.sweepExpired.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Device QA expiry sweep failed", { cause }),
          ),
          Effect.repeat(Schedule.spaced(EXPIRY_SWEEP_INTERVAL)),
        ),
      ),
    ),
  );
});

export const DeviceQaCleanupLive = Layer.effectDiscard(startDeviceQaCleanup);
