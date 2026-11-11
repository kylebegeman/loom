import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer"; // fork: server-weight
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({}));

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "./DesktopIpc.ts";

it.effect("answers only the main window's top frame", () =>
  Effect.gen(function* () {
    const mainFrame = {};
    const invoke = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
    const sync = new Map<string, DesktopIpc.DesktopIpcSyncListener>();
    const ipc = yield* DesktopIpc.DesktopIpc.pipe(
      Effect.provide(
        DesktopIpc.layer({
          removeHandler: (channel) => void invoke.delete(channel),
          handle: (channel, listener) => void invoke.set(channel, listener),
          removeAllListeners: (channel) => void sync.delete(channel),
          on: (channel, listener) => void sync.set(channel, listener),
        }).pipe(
          Layer.provide(
            Layer.mock(ElectronWindow.ElectronWindow, {
              main: Effect.succeedSome({
                webContents: { id: 1, mainFrame },
              } as unknown as Electron.BrowserWindow),
            }),
          ),
        ),
      ),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: "token",
        payload: Schema.Void,
        result: Schema.String,
        handler: () => Effect.succeed("secret"),
      }),
    );
    yield* ipc.handleSync({ channel: "token-sync", handler: () => Effect.succeed("secret") });

    const senders = {
      app: { sender: { id: 1 }, senderFrame: mainFrame },
      appSubframe: { sender: { id: 1 }, senderFrame: {} },
      previewGuest: { sender: { id: 2 }, senderFrame: {} },
    };
    const results: Record<string, unknown> = {};
    for (const [name, sender] of Object.entries(senders)) {
      const event = { ...sender, returnValue: "unset" as unknown };
      sync.get("token-sync")!(event);
      results[name] = [
        yield* Effect.promise(() =>
          Promise.resolve(invoke.get("token")!(sender, undefined)).catch(() => "rejected"),
        ),
        event.returnValue,
      ];
    }
    assert.deepEqual(results, {
      app: ["secret", "secret"],
      appSubframe: ["rejected", undefined],
      previewGuest: ["rejected", undefined],
    });
  }).pipe(Effect.scoped),
);

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
    // fork: server-weight: a trusting guard keeps sender checks out of the recorded spans.
    const ipc = DesktopIpc.make(
      {
        removeHandler: vi.fn(),
        handle: vi.fn(),
        removeAllListeners: vi.fn(),
        on: (channel, listener) => void listeners.set(channel, listener),
      },
      () => Effect.succeed(true), // fork: server-weight
    );
    const read = (untraced: boolean) =>
      DesktopIpc.makeSyncIpcMethod({
        channel: untraced ? "desktop.test.untraced" : "desktop.test.traced",
        result: Schema.Number,
        untraced,
        handler: () => Effect.succeed(7).pipe(Effect.withSpan("desktop.test.nested")),
      });
    const invoke = (channel: string) => {
      const event: DesktopIpc.DesktopIpcSyncEvent = { sender: { id: 1 }, returnValue: undefined };
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
