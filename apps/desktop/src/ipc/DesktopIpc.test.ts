// fork: server-weight: upstream deleted this file; it keeps the fork's untraced sync read test.
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema"; // fork: server-weight
import * as Tracer from "effect/Tracer"; // fork: server-weight
import { vi } from "vite-plus/test";

import * as DesktopIpc from "./DesktopIpc.ts";

function makeIpcMain(
  overrides: Partial<DesktopIpc.DesktopIpcMain> = {},
): DesktopIpc.DesktopIpcMain {
  return {
    removeHandler: vi.fn(),
    handle: vi.fn(),
    removeAllListeners: vi.fn(),
    on: vi.fn(),
    ...overrides,
  };
}

describe("DesktopIpc", () => {
  // fork: server-weight
  it.effect("records no spans for an untraced sync read, including nested ones", () =>
    Effect.gen(function* () {
      const ended: Array<string> = [];
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          const end = span.end.bind(span);
          span.end = (endTime, exit) => {
            end(endTime, exit);
            ended.push(span.name);
          };
          return span;
        },
      });
      const listeners = new Map<string, DesktopIpc.DesktopIpcSyncListener>();
      const ipc = DesktopIpc.make(
        makeIpcMain({ on: (channel, listener) => void listeners.set(channel, listener) }),
      );
      const read = (untraced: boolean) =>
        DesktopIpc.makeSyncIpcMethod({
          channel: untraced ? "desktop.test.untraced" : "desktop.test.traced",
          result: Schema.Number,
          untraced,
          handler: () => Effect.succeed(7).pipe(Effect.withSpan("desktop.test.nested")),
        });
      const invoke = (channel: string) => {
        const event: DesktopIpc.DesktopIpcSyncEvent = { returnValue: undefined };
        listeners.get(channel)!(event);
        return event.returnValue;
      };

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* ipc.handleSync(read(true));
          yield* ipc.handleSync(read(false));
          ended.length = 0;

          assert.strictEqual(invoke("desktop.test.untraced"), 7);
          assert.deepEqual(ended, []);

          assert.strictEqual(invoke("desktop.test.traced"), 7);
          assert.deepEqual(ended, [
            "desktop.test.nested",
            "desktop.ipc.method",
            "desktop.ipc.invokeSync",
          ]);
        }),
      ).pipe(Effect.withTracer(tracer));
    }),
  );
});
