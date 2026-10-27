import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ElectronApp from "../electron/ElectronApp.ts"; // fork: client-computer
import * as ElectronDialog from "../electron/ElectronDialog.ts"; // fork: client-computer
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { WEB_LINK_OPEN_CHANNEL } from "../ipc/channels.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts"; // fork: client-computer

export const isWebLink = (value: string) => {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
};

export const isWebPageFile = (path: string) => /\.x?html?$/i.test(path);

export class DesktopWebLinks extends Context.Service<
  DesktopWebLinks,
  {
    readonly receive: (url: string) => Effect.Effect<void>;
    readonly setRendererReady: (ready: boolean) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopWebLinks") {}

const make = Effect.gen(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  // fork: client-computer: the web app opens a file only through this computer's own
  // environment, which a client computer does not run, so say so once instead of holding it.
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  let refusingFiles = false;
  const refuseFile = Effect.suspend(() => {
    if (refusingFiles) return Effect.void;
    refusingFiles = true;
    return electronApp.whenReady.pipe(
      Effect.andThen(
        electronDialog.showMessageBox({
          type: "info",
          message: "This computer can't open web page files",
          detail:
            "Loom opens files with the agents on this computer, and Run agents on this computer is off. Turn it on in Settings to open files here.",
          buttons: ["OK"],
        }),
      ),
      Effect.ignore,
      Effect.ensuring(Effect.sync(() => void (refusingFiles = false))),
    );
  });
  const pending: Array<string> = [];
  let listening: Electron.WebContents | null = null;
  let detachListening: (() => void) | null = null;

  const stopListening = () => {
    detachListening?.();
    detachListening = null;
    listening = null;
  };

  const flush = Effect.gen(function* () {
    if (listening === null || pending.length === 0) return;
    const window = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(window) || window.value.webContents !== listening) return;
    if (listening.isDestroyed()) {
      stopListening();
      return;
    }
    for (const url of pending.splice(0)) listening.send(WEB_LINK_OPEN_CHANNEL, url);
    yield* electronWindow.reveal(window.value);
  });

  const startListening = Effect.gen(function* () {
    const window = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(window) || window.value.webContents.isDestroyed()) return;
    const webContents = window.value.webContents;
    if (listening === webContents) return;
    stopListening();
    listening = webContents;
    const onNavigation = (
      event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ) => {
      if (event.isMainFrame && !event.isSameDocument) stopListening();
    };
    webContents.on("did-start-navigation", onNavigation);
    webContents.on("render-process-gone", stopListening);
    webContents.once("destroyed", stopListening);
    detachListening = () => {
      webContents.removeListener("did-start-navigation", onNavigation);
      webContents.removeListener("render-process-gone", stopListening);
      webContents.removeListener("destroyed", stopListening);
    };
  });

  return DesktopWebLinks.of({
    receive: Effect.fn("DesktopWebLinks.receive")(function* (url) {
      // fork: client-computer
      if (url.startsWith("file:") && !(yield* desktopSettings.get).localEnvironmentEnabled) {
        return yield* refuseFile;
      }
      pending.push(url);
      yield* flush;
    }),
    setRendererReady: Effect.fn("DesktopWebLinks.setRendererReady")(function (ready) {
      return ready ? startListening : Effect.sync(stopListening);
    }, Effect.andThen(flush)),
  });
});

export const layer = Layer.effect(DesktopWebLinks, make);
