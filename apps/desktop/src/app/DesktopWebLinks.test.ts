// @effect-diagnostics nodeBuiltinImport:off - Stands in for an Electron webContents.
import { assert, describe, it } from "@effect/vitest";
import * as NodeEvents from "node:events";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { WEB_LINK_OPEN_CHANNEL } from "../ipc/channels.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopWebLinks from "./DesktopWebLinks.ts";

// fork: client-computer: `localEnvironmentEnabled: false` makes this a client computer.
const makeWindow = ({
  localEnvironmentEnabled = true,
  dialog = (_options: Electron.MessageBoxOptions) => Effect.void,
} = {}) => {
  const sent: Array<string> = [];
  const revealed: Array<unknown> = [];
  const webContents = Object.assign(new NodeEvents.EventEmitter(), {
    isDestroyed: () => false,
    send: (channel: string, url: string) => {
      if (channel === WEB_LINK_OPEN_CHANNEL) sent.push(url);
    },
  });
  const window = { webContents } as unknown as Electron.BrowserWindow;
  const reload = () =>
    webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  const layer = DesktopWebLinks.layer.pipe(
    Layer.provide(
      Layer.succeed(
        ElectronWindow.ElectronWindow,
        ElectronWindow.ElectronWindow.of({
          currentMainOrFirst: Effect.succeedSome(window),
          reveal: (target: Electron.BrowserWindow) => Effect.sync(() => void revealed.push(target)),
        } as unknown as ElectronWindow.ElectronWindow["Service"]),
      ),
    ),
    Layer.provide(
      Layer.mergeAll(
        DesktopAppSettings.layerTest({
          ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
          localEnvironmentEnabled,
        }),
        Layer.mock(ElectronApp.ElectronApp, { whenReady: Effect.void }),
        Layer.mock(ElectronDialog.ElectronDialog, {
          showMessageBox: (options) =>
            dialog(options).pipe(Effect.as({ response: 0, checkboxChecked: false })),
        }),
      ),
    ),
  );
  return { sent, revealed, layer, reload };
};

describe("DesktopWebLinks", () => {
  it.effect("holds links until the renderer listens, then delivers them in order", () => {
    const { sent, revealed, layer } = makeWindow();
    return Effect.gen(function* () {
      const webLinks = yield* DesktopWebLinks.DesktopWebLinks;
      yield* webLinks.receive("https://example.com/first");
      yield* webLinks.receive("https://example.com/second");
      assert.deepStrictEqual(sent, []);

      yield* webLinks.setRendererReady(true);
      assert.deepStrictEqual(sent, ["https://example.com/first", "https://example.com/second"]);
      assert.strictEqual(revealed.length, 1);

      yield* webLinks.receive("https://example.com/third");
      assert.deepStrictEqual(sent.at(-1), "https://example.com/third");

      yield* webLinks.setRendererReady(false);
      yield* webLinks.receive("https://example.com/fourth");
      assert.strictEqual(sent.length, 3);
    }).pipe(Effect.provide(layer));
  });

  it.effect("holds links that arrive while the web app reloads until it listens again", () => {
    const { sent, layer, reload } = makeWindow();
    return Effect.gen(function* () {
      const webLinks = yield* DesktopWebLinks.DesktopWebLinks;
      yield* webLinks.setRendererReady(true);
      reload();
      yield* webLinks.receive("https://example.com/during-reload");
      assert.deepStrictEqual(sent, []);

      yield* webLinks.setRendererReady(true);
      assert.deepStrictEqual(sent, ["https://example.com/during-reload"]);
    }).pipe(Effect.provide(layer));
  });

  // fork: client-computer
  it.effect("tells a client computer once that it cannot open files instead of holding them", () =>
    Effect.gen(function* () {
      const shown: Array<string> = [];
      const opened = yield* Deferred.make<void>();
      const dismissed = yield* Deferred.make<void>();
      const { sent, layer } = makeWindow({
        localEnvironmentEnabled: false,
        dialog: (options) =>
          Effect.sync(() => void shown.push(options.message)).pipe(
            Effect.andThen(Deferred.succeed(opened, undefined)),
            Effect.andThen(Deferred.await(dismissed)),
          ),
      });
      yield* Effect.gen(function* () {
        const webLinks = yield* DesktopWebLinks.DesktopWebLinks;
        yield* webLinks.receive("https://example.com/page");
        const first = yield* Effect.forkChild(webLinks.receive("file:///Users/k/one.html"));
        yield* Deferred.await(opened);
        yield* webLinks.receive("file:///Users/k/two.html");
        yield* webLinks.receive("file:///Users/k/three.html");
        yield* Deferred.succeed(dismissed, undefined);
        yield* Fiber.join(first);
        assert.strictEqual(shown.length, 1);

        // Web and prompt links still wait for the web app, which can send them to another computer.
        yield* webLinks.setRendererReady(true);
        assert.deepStrictEqual(sent, ["https://example.com/page"]);
      }).pipe(Effect.provide(layer));
    }),
  );
});
