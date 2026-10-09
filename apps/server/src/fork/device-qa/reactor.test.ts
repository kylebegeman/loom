import { describe, expect, it } from "@effect/vitest";
import { ThreadId, type OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { DeviceQaService } from "./DeviceQaService.ts";
import { startDeviceQaCleanup } from "./reactor.ts";

function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}

const snapshot = (ids: ReadonlyArray<string>, archived: ReadonlyArray<string>) =>
  Effect.succeed({
    schemaVersion: 1,
    snapshotSequence: 0,
    threads: ids.map((id) => ({ id })),
    archivedThreads: archived.map((id) => ({ id })),
  } as never);

describe("startDeviceQaCleanup", () => {
  it.live("forgets deleted threads, catches up on missing ones, then sweeps expired evidence", () =>
    Effect.gen(function* () {
      const forgotten = yield* Deferred.make<string>();
      const known = yield* Deferred.make<ReadonlySet<string>>();
      const swept = yield* Deferred.make<void>();
      const order: Array<string> = [];
      const deviceQa = partial<DeviceQaService["Service"]>({
        forgetThread: (threadId) => Deferred.succeed(forgotten, threadId).pipe(Effect.asVoid),
        forgetMissingThreads: (threads) =>
          Effect.sync(() => order.push("catch-up")).pipe(
            Effect.andThen(Deferred.succeed(known, threads)),
            Effect.as(0),
          ),
        sweepExpired: Effect.sync(() => order.push("sweep")).pipe(
          Effect.andThen(Deferred.succeed(swept, undefined)),
          Effect.as(0),
        ),
      });
      const threads = partial<ThreadManagementService["Service"]>({
        streamDomainEvents: Stream.make(
          { type: "thread.archived", payload: { id: ThreadId.make("kept") } },
          { type: "thread.deleted", payload: { id: ThreadId.make("gone") } },
        ) as unknown as ThreadManagementService["Service"]["streamDomainEvents"],
        getShellSnapshot: (options) =>
          options?.location === "archive" ? snapshot([], ["old"]) : snapshot(["live"], []),
      });

      yield* startDeviceQaCleanup.pipe(
        Effect.provideService(DeviceQaService, deviceQa),
        Effect.provideService(ThreadManagementService, threads),
      );

      expect(yield* Deferred.await(forgotten)).toBe("gone");
      expect([...(yield* Deferred.await(known))].sort()).toEqual(["live", "old"]);
      yield* Deferred.await(swept);
      expect(order).toEqual(["catch-up", "sweep"]);
    }).pipe(Effect.scoped),
  );

  it.live("skips the catch-up when threads cannot be read, and still sweeps", () =>
    Effect.gen(function* () {
      const swept = yield* Deferred.make<void>();
      let caughtUp = false;
      const deviceQa = partial<DeviceQaService["Service"]>({
        forgetMissingThreads: () => Effect.sync(() => (caughtUp = true)).pipe(Effect.as(0)),
        sweepExpired: Deferred.succeed(swept, undefined).pipe(Effect.as(0)),
      });
      const threads = partial<ThreadManagementService["Service"]>({
        streamDomainEvents: Stream.empty as unknown as Stream.Stream<OrchestrationV2DomainEvent>,
        getShellSnapshot: () => Effect.die(new Error("projection unavailable")),
      });

      yield* startDeviceQaCleanup.pipe(
        Effect.provideService(DeviceQaService, deviceQa),
        Effect.provideService(ThreadManagementService, threads),
      );
      yield* Deferred.await(swept);
      expect(caughtUp).toBe(false);
    }).pipe(Effect.scoped),
  );
});
