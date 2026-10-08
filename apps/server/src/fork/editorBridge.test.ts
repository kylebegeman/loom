import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { ThreadId } from "@t3tools/contracts";
import { makeEditorBridge } from "./editorBridge.ts";
it.effect(
  "requires a listener and validates acknowledgements against the requesting thread and path",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bridge = yield* makeEditorBridge<string, string, string>({
          resolve: () => Effect.void,
          failure: (message) => message,
          panelAction: (command) => command === "open",
        });
        const threadId = ThreadId.make("bridge-thread"),
          input = { threadId, path: "board.glb", command: "fit" };
        expect(yield* bridge.request(input).pipe(Effect.flip)).toContain("connected Loom client");
        const received = yield* Deferred.make<{
          requestId: string;
          path: string;
          command: string;
        }>();
        const reader = yield* bridge.events(threadId, input.path).pipe(
          Stream.tap((event) => Deferred.succeed(received, event)),
          Stream.runDrain,
          Effect.forkChild({ startImmediately: true }),
        );
        const job = yield* bridge.request(input).pipe(Effect.forkChild({ startImmediately: true })),
          event = yield* Deferred.await(received);
        expect(
          yield* bridge
            .complete({
              threadId: ThreadId.make("other"),
              path: input.path,
              requestId: event.requestId,
              result: "ok",
            })
            .pipe(Effect.flip),
        ).toContain("no longer active");
        yield* bridge.complete({
          threadId,
          path: input.path,
          requestId: event.requestId,
          result: "ok",
        });
        expect(yield* Fiber.join(job)).toBe("ok");
        yield* Fiber.interrupt(reader);
      }),
    ),
);

it.effect("serializes actions, delivers to one client and refuses duplicate capture work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const bridge = yield* makeEditorBridge<string, string, string>({
        resolve: () => Effect.void,
        failure: (message) => message,
        panelAction: () => false,
      });
      const threadId = ThreadId.make("ordered-editor"),
        path = "board.glb";
      let otherClientCalls = 0,
        captureWrites = 0;
      const received = yield* Deferred.make<{ requestId: string; path: string; command: string }>();
      const secondReceived = yield* Deferred.make<{
        requestId: string;
        path: string;
        command: string;
      }>();
      const firstReader = yield* bridge.events(threadId, path).pipe(
        Stream.tap(() =>
          Effect.sync(() => {
            otherClientCalls++;
          }),
        ),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true }),
      );
      const reader = yield* bridge.events(threadId, path).pipe(
        Stream.tap((event) =>
          Deferred.succeed(event.command === "first" ? received : secondReceived, event),
        ),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true }),
      );
      const first = yield* bridge
        .request({ threadId, path, command: "first" })
        .pipe(Effect.forkChild({ startImmediately: true }));
      const event = yield* Deferred.await(received);
      const second = yield* bridge
        .request({ threadId, path, command: "second" })
        .pipe(Effect.forkChild({ startImmediately: true }));
      expect(yield* Deferred.isDone(secondReceived)).toBe(false);
      yield* bridge.completeWith(
        { threadId, path, requestId: event.requestId },
        Effect.sync(() => {
          captureWrites++;
          return "first capture";
        }),
      );
      expect(yield* Fiber.join(first)).toBe("first capture");
      expect(
        yield* bridge
          .completeWith(
            { threadId, path, requestId: event.requestId },
            Effect.sync(() => {
              captureWrites++;
              return "duplicate";
            }),
          )
          .pipe(Effect.flip),
      ).toContain("no longer active");
      expect(captureWrites).toBe(1);
      const next = yield* Deferred.await(secondReceived);
      yield* bridge.complete({ threadId, path, requestId: next.requestId, result: "second" });
      expect(yield* Fiber.join(second)).toBe("second");
      expect(otherClientCalls).toBe(0);
      yield* Fiber.interrupt(reader);
      yield* Fiber.interrupt(firstReader);
    }),
  ),
);
