import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue"; // fork: client-computer

import type { DesktopUpdateState } from "@t3tools/contracts"; // fork: client-computer
import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopApplicationMenu from "./DesktopApplicationMenu.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts"; // fork: client-computer
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import { createInitialDesktopUpdateState } from "../updates/updateMachine.ts"; // fork: client-computer
import * as DesktopWindow from "./DesktopWindow.ts";

const environmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "linux",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/repo",
  isPackaged: false,
  resourcesPath: "/repo/resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const layerElectronApp = Layer.succeed(ElectronApp.ElectronApp, {
  metadata: Effect.die("unexpected metadata read"),
  name: Effect.succeed("T3 Code"),
  systemLocale: Effect.succeed("en-US"),
  whenReady: Effect.void,
  requestSingleInstanceLock: Effect.succeed(true),
  quit: Effect.void,
  exit: () => Effect.void,
  relaunch: () => Effect.void,
  setPath: () => Effect.void,
  setName: () => Effect.void,
  setAboutPanelOptions: () => Effect.void,
  setAppUserModelId: () => Effect.void,
  getAppMetrics: Effect.succeed([]),
  setAsDefaultProtocolClient: () => Effect.succeed(true),
  setDesktopName: () => Effect.void,
  setDockIcon: () => Effect.void,
  appendCommandLineSwitch: () => Effect.void,
  onBeforeQuitForUpdate: () => Effect.void,
  removeCommandLineSwitch: () => Effect.void,
  on: () => Effect.void,
} satisfies ElectronApp.ElectronApp["Service"]);

const layerElectronDialog = Layer.succeed(ElectronDialog.ElectronDialog, {
  pickFolder: () => Effect.succeedNone,
  pickFiles: () => Effect.succeed([]),
  showMessageBox: () => Effect.succeed({ response: 0, checkboxChecked: false }),
  showErrorBox: () => Effect.void,
} satisfies ElectronDialog.ElectronDialog["Service"]);

const layerDesktopUpdates = Layer.succeed(DesktopUpdates.DesktopUpdates, {
  getState: Effect.die("unexpected getState"),
  isActionActive: Effect.succeed(false),
  isInstallActive: Effect.succeed(false),
  subscribe: Effect.die("unexpected subscribe"),
  emitState: Effect.void,
  disabledReason: Effect.succeedNone,
  configure: Effect.void,
  setChannel: () => Effect.die("unexpected setChannel"),
  check: () => Effect.die("unexpected check"),
  download: Effect.die("unexpected download"),
  install: Effect.die("unexpected install"),
  installPrepared: () => Effect.die("unexpected installPrepared"),
  setInstallWhenIdle: () => Effect.die("unexpected setInstallWhenIdle"), // fork: machine-updates
} satisfies DesktopUpdates.DesktopUpdates["Service"]);

const layerDesktopWindow = (selectedAction: Deferred.Deferred<string>) =>
  Layer.succeed(DesktopWindow.DesktopWindow, {
    createMain: Effect.die("unexpected createMain"),
    ensureMain: Effect.die("unexpected ensureMain"),
    revealOrCreateMain: Effect.die("unexpected revealOrCreateMain"),
    activate: Effect.void,
    createMainIfBackendReady: Effect.void,
    showConnectingSplash: Effect.void,
    showSplash: () => Effect.succeedNone, // fork: restart-compaction
    handleBackendReady: () => Effect.void,
    handleBackendNotReady: Effect.void,
    flushMainWindowBounds: Effect.void,
    prepareCaptureReveal: Effect.void,
    dispatchMenuAction: (action) => Deferred.succeed(selectedAction, action).pipe(Effect.asVoid),
    dispatchSnapShotEvent: () => Effect.void,
    zoomMain: (direction) =>
      Deferred.succeed(selectedAction, `zoom-${direction}`).pipe(Effect.asVoid),
    runMainContentsCommand: (command) =>
      Deferred.succeed(selectedAction, `main-${command}`).pipe(Effect.asVoid),
    syncAppearance: Effect.void,
  } satisfies DesktopWindow.DesktopWindow["Service"]);

const layerElectronMenu = (
  applicationMenuTemplate: Deferred.Deferred<readonly Electron.MenuItemConstructorOptions[]>,
) =>
  Layer.succeed(ElectronMenu.ElectronMenu, {
    setApplicationMenu: (template) =>
      Deferred.succeed(applicationMenuTemplate, template).pipe(Effect.asVoid),
    popupTemplate: () => Effect.void,
    showContextMenu: () => Effect.succeedNone,
  } satisfies ElectronMenu.ElectronMenu["Service"]);

const configureMenu = (
  selectedAction: Deferred.Deferred<string>,
  applicationMenuTemplate: Deferred.Deferred<readonly Electron.MenuItemConstructorOptions[]>,
  environment: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  // fork: client-computer
  services: {
    readonly updates?: Layer.Layer<DesktopUpdates.DesktopUpdates>;
    readonly dialog?: Layer.Layer<ElectronDialog.ElectronDialog>;
    readonly settings?: Layer.Layer<DesktopAppSettings.DesktopAppSettings>;
  } = {},
) =>
  Effect.gen(function* () {
    const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
    yield* menu.configure;
  }).pipe(
    Effect.provide(
      DesktopApplicationMenu.layer.pipe(
        Layer.provideMerge(layerElectronMenu(applicationMenuTemplate)),
        Layer.provideMerge(layerDesktopWindow(selectedAction)),
        Layer.provideMerge(services.updates ?? layerDesktopUpdates), // fork: client-computer
        Layer.provideMerge(services.dialog ?? layerElectronDialog), // fork: client-computer
        Layer.provideMerge(services.settings ?? DesktopAppSettings.layerTest()), // fork: client-computer
        Layer.provideMerge(layerElectronApp),
        Layer.provideMerge(
          DesktopEnvironment.layer({ ...environmentInput, ...environment }).pipe(
            Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
          ),
        ),
      ),
    ),
  );

// fork: client-computer
const idleUpdate = createInitialDesktopUpdateState(
  "1.2.3",
  { hostArch: "arm64", appArch: "arm64", runningUnderArm64Translation: false },
  "latest",
);
// fork: client-computer
const available: DesktopUpdateState = {
  ...idleUpdate,
  enabled: true,
  status: "available",
  availableVersion: "1.2.4",
};
// fork: client-computer
const downloaded: DesktopUpdateState = {
  ...available,
  status: "downloaded",
  downloadedVersion: "1.2.4",
};

// fork: client-computer
type MenuUpdateEvent = string | Electron.MessageBoxOptions;

// fork: client-computer
const asDialog = (event: MenuUpdateEvent | undefined) => {
  if (typeof event !== "object") throw new Error(`Expected a dialog, got ${String(event)}.`);
  return event;
};

// fork: client-computer
const dialogMessage = (event: MenuUpdateEvent | undefined) => asDialog(event).message;

// fork: client-computer: clicks Check for Updates; next(n) takes the next n update calls and dialogs.
const clickCheckForUpdates = (input: {
  readonly localEnvironmentEnabled: boolean;
  readonly updates: (
    record: (event: MenuUpdateEvent) => Effect.Effect<void>,
  ) => Partial<DesktopUpdates.DesktopUpdates["Service"]>;
}) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<MenuUpdateEvent>();
    const record = (event: MenuUpdateEvent) => Queue.offer(events, event).pipe(Effect.asVoid);
    const applicationMenuTemplate =
      yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();
    yield* configureMenu(
      yield* Deferred.make<string>(),
      applicationMenuTemplate,
      {},
      {
        updates: Layer.mock(DesktopUpdates.DesktopUpdates, {
          disabledReason: Effect.succeedNone,
          ...input.updates(record),
        }),
        dialog: Layer.mock(ElectronDialog.ElectronDialog, {
          showMessageBox: (options) =>
            record(options).pipe(Effect.as({ response: 0, checkboxChecked: false })),
        }),
        settings: DesktopAppSettings.layerTest({
          ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
          localEnvironmentEnabled: input.localEnvironmentEnabled,
        }),
      },
    );
    const help = (yield* Deferred.await(applicationMenuTemplate)).find(
      (item) => item.role === "help",
    );
    const checkForUpdates = Array.isArray(help?.submenu) ? help.submenu[0] : undefined;
    if (typeof checkForUpdates?.click !== "function") {
      throw new Error("Expected Check for Updates to have a click handler.");
    }
    checkForUpdates.click({} as Electron.MenuItem, undefined, {} as KeyboardEvent);
    return (count: number) => Effect.replicateEffect(Queue.take(events), count);
  });

describe("DesktopApplicationMenu", () => {
  it.effect("leaves the accelerator to Chromium instead of injecting a paste", () =>
    Effect.gen(function* () {
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();

      yield* configureMenu(selectedAction, applicationMenuTemplate);

      const template = yield* Deferred.await(applicationMenuTemplate);
      const editMenu = template.find((item) => item.label === "Edit");
      if (!Array.isArray(editMenu?.submenu)) {
        throw new Error("Expected Edit menu submenu to be an array.");
      }
      const pasteAsTextItem = editMenu.submenu.find((item) => item.label === "Paste as Text");
      if (typeof pasteAsTextItem?.click !== "function") {
        throw new Error("Expected Paste as Text menu item to have a click handler.");
      }

      pasteAsTextItem.click(
        {} as Electron.MenuItem,
        {} as Electron.BrowserWindow,
        {
          triggeredByAccelerator: true,
        } as unknown as KeyboardEvent,
      );
      assert.isFalse(yield* Deferred.isDone(selectedAction));
    }),
  );

  it.effect("registers macOS command-plus once and routes it through main-window zoom", () =>
    Effect.gen(function* () {
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();

      yield* configureMenu(selectedAction, applicationMenuTemplate, { platform: "darwin" });

      const template = yield* Deferred.await(applicationMenuTemplate);
      const viewMenu = template.find((item) => item.label === "View");
      assert.isDefined(viewMenu);
      if (!Array.isArray(viewMenu.submenu)) {
        throw new Error("Expected View menu submenu to be an array.");
      }

      assert.isUndefined(
        viewMenu.submenu.find((item) =>
          ["zoom", "reload", "devtools"].some((role) => item.role?.toLowerCase().includes(role)),
        ),
      );

      const shiftedEqual = viewMenu.submenu.filter(
        (item) => item.accelerator === "CmdOrCtrl+Shift+=",
      );
      assert.lengthOf(shiftedEqual, 1);
      assert.lengthOf(
        viewMenu.submenu.filter((item) => item.accelerator === "CmdOrCtrl+numadd"),
        1,
      );
      const zoomIn = shiftedEqual[0];
      assert.isDefined(zoomIn);
      assert.isFalse(zoomIn.visible);
      if (typeof zoomIn.click !== "function") {
        throw new Error("Expected Zoom In menu item to have a click handler.");
      }

      zoomIn.click({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
      assert.equal(yield* Deferred.await(selectedAction), "zoom-in");
    }),
  );

  it.effect("never binds Cmd/Ctrl+W to closing the window", () =>
    Effect.gen(function* () {
      for (const platform of ["darwin", "linux", "win32"] as const) {
        const applicationMenuTemplate =
          yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();
        yield* configureMenu(yield* Deferred.make<string>(), applicationMenuTemplate, {
          platform,
        });

        const items: Electron.MenuItemConstructorOptions[] = [];
        const collect = (template: readonly Electron.MenuItemConstructorOptions[]) => {
          for (const item of template) {
            items.push(item);
            if (Array.isArray(item.submenu)) collect(item.submenu);
          }
        };
        collect(yield* Deferred.await(applicationMenuTemplate));

        assert.isUndefined(
          items.find((item) => item.role === "close"),
          platform,
        );
        // Electron's default windowMenu submenu includes a close role.
        assert.isUndefined(
          items.find((item) => item.role === "windowMenu" && item.submenu === undefined),
          platform,
        );
        assert.isUndefined(
          items.find((item) => item.accelerator?.toLowerCase().endsWith("+w")),
          platform,
        );
      }
    }),
  );

  it.effect("reloads the main window even while a browser page has focus", () =>
    Effect.gen(function* () {
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();

      yield* configureMenu(selectedAction, applicationMenuTemplate);

      const template = yield* Deferred.await(applicationMenuTemplate);
      const viewMenu = template.find((item) => item.label === "View");
      if (!Array.isArray(viewMenu?.submenu)) {
        throw new Error("Expected View menu submenu to be an array.");
      }
      const reload = viewMenu.submenu.find((item) => item.label === "Reload");
      assert.equal(reload?.accelerator, "CmdOrCtrl+R");
      if (typeof reload?.click !== "function") {
        throw new Error("Expected Reload menu item to have a click handler.");
      }

      reload.click({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
      assert.equal(yield* Deferred.await(selectedAction), "main-reload");
    }),
  );

  // fork: client-computer
  it.effect("downloads and installs an update from the menu on a computer without agents", () =>
    Effect.gen(function* () {
      const next = yield* clickCheckForUpdates({
        localEnvironmentEnabled: false,
        updates: (record) => ({
          check: () => record("check").pipe(Effect.as({ checked: true, state: available })),
          download: record("download").pipe(
            Effect.as({ accepted: true, completed: true, state: downloaded }),
          ),
          installPrepared: (version) =>
            record(`install ${version}`).pipe(
              Effect.as({ accepted: true, completed: false, failed: false, state: downloaded }),
            ),
        }),
      });

      const [check, offer, download, ready] = yield* next(4);
      assert.deepStrictEqual(
        [check, dialogMessage(offer), download],
        ["check", "Loom 1.2.4 is available.", "download"],
      );
      const readyDialog = asDialog(ready);
      assert.equal(readyDialog.message, "Loom 1.2.4 is ready to install.");
      assert.deepStrictEqual(readyDialog.buttons, ["Restart and Install", "Later"]);
      assert.notMatch(readyDialog.detail ?? "", /agent/i);
      assert.deepStrictEqual(yield* next(1), ["install 1.2.4"]);
    }),
  );

  // fork: client-computer
  it.effect("offers to install when agents are idle on a computer that runs them", () =>
    Effect.gen(function* () {
      const next = yield* clickCheckForUpdates({
        localEnvironmentEnabled: true,
        updates: (record) => ({
          check: () => record("check").pipe(Effect.as({ checked: true, state: downloaded })),
          setInstallWhenIdle: (armed) =>
            record(`install when idle ${armed}`).pipe(
              Effect.as({ ...downloaded, installWhenIdle: armed }),
            ),
        }),
      });

      const [, ready] = yield* next(2);
      const readyDialog = asDialog(ready);
      assert.deepStrictEqual(readyDialog.buttons, ["Install When Idle", "Restart Now", "Later"]);
      assert.equal(readyDialog.defaultId, 0);
      assert.match(readyDialog.detail ?? "", /agents running on this computer stop/i);
      const [armed, scheduled] = yield* next(2);
      assert.equal(armed, "install when idle true");
      assert.equal(
        dialogMessage(scheduled),
        "Loom 1.2.4 installs once agents on this computer are idle.",
      );
    }),
  );

  // fork: client-computer
  it.effect("does not report a download another action already started as a failure", () =>
    Effect.gen(function* () {
      const next = yield* clickCheckForUpdates({
        localEnvironmentEnabled: true,
        updates: (record) => ({
          check: () => record("check").pipe(Effect.as({ checked: true, state: available })),
          download: record("download").pipe(
            Effect.as({
              accepted: false,
              completed: false,
              state: { ...available, status: "downloading", downloadPercent: 40 },
            }),
          ),
        }),
      });

      const [, , download, notice] = yield* next(4);
      assert.equal(download, "download");
      const noticeDialog = asDialog(notice);
      assert.notEqual(noticeDialog.title, "Update failed");
      assert.equal(noticeDialog.message, "Loom is already downloading an update.");
    }),
  );

  // fork: client-computer
  it.effect("reports a download that fails", () =>
    Effect.gen(function* () {
      const next = yield* clickCheckForUpdates({
        localEnvironmentEnabled: true,
        updates: (record) => ({
          check: () => record("check").pipe(Effect.as({ checked: true, state: available })),
          download: record("download").pipe(
            Effect.as({
              accepted: true,
              completed: false,
              state: { ...available, errorContext: "download", message: "Network is offline." },
            }),
          ),
        }),
      });

      const [, , , failure] = yield* next(4);
      const failureDialog = asDialog(failure);
      assert.equal(failureDialog.title, "Update failed");
      assert.equal(failureDialog.detail, "Network is offline.");
    }),
  );
});
