import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Deferred from "effect/Deferred";
import * as Semaphore from "effect/Semaphore";
import type { ThreadId } from "@t3tools/contracts";

/** Deliver canvas actions to one editor, in order, and await its acknowledgement. */
export const makeEditorBridge = <Action, Result, Error>(options: {
  resolve: (threadId: ThreadId, path: string) => Effect.Effect<unknown, Error>;
  failure: (message: string) => Error;
  panelAction: (command: Action) => boolean;
}) =>
  Effect.gen(function* () {
    type Event = { requestId: string; path: string; command: Action };
    const bus = yield* PubSub.sliding<{ listener: number; event: Event }>(64);
    const listeners = new Map<string, Set<number>>();
    const lanes = new Map<string, { lock: Semaphore.Semaphore; count: number }>();
    const pending = new Map<string, { key: string; result: Deferred.Deferred<Result, Error> }>();
    const keyOf = (threadId: ThreadId, path: string) => JSON.stringify([threadId, path]);
    let sequence = 0,
      listenerSequence = 0,
      outstanding = 0;
    const events = (threadId: ThreadId, path?: string) =>
      Stream.unwrap(
        Effect.gen(function* () {
          if (path) yield* options.resolve(threadId, path);
          const key = keyOf(threadId, path ?? ""),
            subscription = yield* PubSub.subscribe(bus);
          const listener = ++listenerSequence;
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const owners = listeners.get(key) ?? new Set<number>();
              owners.add(listener);
              listeners.set(key, owners);
            }),
            () =>
              Effect.sync(() => {
                const owners = listeners.get(key);
                owners?.delete(listener);
                if (!owners?.size) listeners.delete(key);
              }),
          );
          return Stream.fromSubscription(subscription).pipe(
            Stream.filter((v) => v.listener === listener),
            Stream.map((v) => v.event),
          );
        }),
      );
    const request = (input: { threadId: ThreadId; path: string; command: Action }) =>
      Effect.gen(function* () {
        yield* options.resolve(input.threadId, input.path);
        const key = keyOf(input.threadId, input.path);
        const destination = keyOf(
          input.threadId,
          options.panelAction(input.command) ? "" : input.path,
        );
        if (outstanding >= 32)
          return yield* Effect.fail(options.failure("Too many editor actions are pending."));
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            outstanding++;
            const lane = lanes.get(destination) ?? { lock: Semaphore.makeUnsafe(1), count: 0 };
            lane.count++;
            lanes.set(destination, lane);
            return lane;
          }),
          (lane) =>
            lane.lock.withPermit(
              Effect.gen(function* () {
                // The most recently connected editor owns the action; other clients do not replay it.
                const listener = Array.from(listeners.get(destination) ?? []).at(-1);
                if (listener === undefined)
                  return yield* Effect.fail(
                    options.failure(
                      "Open this thread on a connected Loom client before controlling its editor.",
                    ),
                  );
                const requestId = String(++sequence),
                  result = yield* Deferred.make<Result, Error>();
                pending.set(requestId, { key, result });
                return yield* Effect.gen(function* () {
                  yield* PubSub.publish(bus, {
                    listener,
                    event: { requestId, path: input.path, command: input.command },
                  });
                  return yield* Deferred.await(result).pipe(
                    Effect.timeout("30 seconds"),
                    Effect.catchTags({
                      TimeoutError: () =>
                        Effect.fail(
                          options.failure(
                            "The editor did not acknowledge this action. Check that it is connected and loaded.",
                          ),
                        ),
                    }),
                  );
                }).pipe(Effect.ensuring(Effect.sync(() => pending.delete(requestId))));
              }),
            ),
          (lane) =>
            Effect.sync(() => {
              outstanding--;
              if (--lane.count === 0) lanes.delete(destination);
            }),
        );
      });
    const completeWith = <R>(
      input: { threadId: ThreadId; path: string; requestId: string; error?: string | undefined },
      build: Effect.Effect<Result, Error, R>,
    ) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const item = pending.get(input.requestId);
          if (!item || item.key !== keyOf(input.threadId, input.path))
            return yield* Effect.fail(options.failure("That editor request is no longer active."));
          // Claim before doing work, so duplicate or expired captures never create files.
          pending.delete(input.requestId);
          const result = yield* build.pipe(
            Effect.tapError((error) => Deferred.fail(item.result, error)),
          );
          if (input.error) yield* Deferred.fail(item.result, options.failure(input.error));
          else yield* Deferred.succeed(item.result, result);
          return result;
        }),
      );
    const complete = (input: {
      threadId: ThreadId;
      path: string;
      requestId: string;
      result: Result;
      error?: string | undefined;
    }) => completeWith(input, Effect.succeed(input.result));
    return { events, request, complete, completeWith };
  });
