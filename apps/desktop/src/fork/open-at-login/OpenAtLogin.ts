import type { DesktopOpenAtLoginState, DesktopOpenAtLoginStatus } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../../app/DesktopObservability.ts";

const PREFERENCE_FILE = "open-at-login.json";
const LOGIN_ITEM_SETTINGS_URLS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
  win32: "ms-settings:startupapps",
};

const { logInfo, logWarning } = makeComponentLogger("open-at-login");

export class OpenAtLoginError extends Schema.TaggedError<OpenAtLoginError>()("OpenAtLoginError", {
  detail: Schema.String,
}) {
  override get message() {
    return this.detail;
  }
}

export type LoginItemReading = Pick<
  Electron.LoginItemSettings,
  "openAtLogin" | "status" | "executableWillLaunchAtLogin"
>;

export class LoginItems extends Context.Service<
  LoginItems,
  {
    readonly read: Effect.Effect<LoginItemReading>;
    readonly write: (openAtLogin: boolean) => Effect.Effect<void, OpenAtLoginError>;
    readonly openSettings: (url: string) => Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/fork/open-at-login/OpenAtLogin/LoginItems") {}

// macOS registers the running bundle through SMAppService (mainAppService).
const layerElectronLoginItems = Layer.succeed(
  LoginItems,
  LoginItems.of({
    read: Effect.sync(() => Electron.app.getLoginItemSettings()),
    write: Effect.fn("LoginItems.write")((openAtLogin: boolean) =>
      Effect.try({
        try: () => Electron.app.setLoginItemSettings({ openAtLogin }),
        catch: () =>
          new OpenAtLoginError({ detail: "The system did not accept the login item change." }),
      }),
    ),
    openSettings: Effect.fn("LoginItems.openSettings")((url: string) =>
      Effect.promise(() =>
        Electron.shell.openExternal(url).then(
          () => true,
          () => false,
        ),
      ),
    ),
  }),
);

export function describeLoginItem(
  platform: NodeJS.Platform,
  enabled: boolean,
  reading: LoginItemReading,
): DesktopOpenAtLoginStatus {
  // `status` is macOS 13 and later; older macOS reports only openAtLogin.
  const launches =
    platform === "darwin"
      ? reading.status === undefined
        ? reading.openAtLogin
        : reading.status === "enabled"
      : reading.openAtLogin && reading.executableWillLaunchAtLogin !== false;
  const blocked =
    platform === "darwin"
      ? reading.status === "requires-approval"
      : reading.openAtLogin && reading.executableWillLaunchAtLogin === false;
  if (enabled) return launches ? "on" : blocked ? "needs-approval" : "failed";
  return launches ? "failed" : "off";
}

/** Development builds and apps run from outside Applications never register. */
function isInstalledApp(environment: DesktopEnvironment.DesktopEnvironment["Service"]) {
  if (!environment.isPackaged || environment.isDevelopment) return false;
  if (environment.platform !== "darwin") return true;
  const path = environment.path;
  const folder = path.dirname(path.resolve(environment.resourcesPath, "..", ".."));
  return (
    folder === "/Applications" || folder === path.join(environment.homeDirectory, "Applications")
  );
}

const Preference = Schema.fromJsonString(Schema.Struct({ enabled: Schema.Boolean }));
const decodePreference = Schema.decodeUnknownEffect(Preference);
const encodePreference = Schema.encodeEffect(Preference);

export class OpenAtLogin extends Context.Service<
  OpenAtLogin,
  {
    readonly state: Effect.Effect<DesktopOpenAtLoginState>;
    readonly setEnabled: (
      enabled: boolean,
    ) => Effect.Effect<DesktopOpenAtLoginState, OpenAtLoginError>;
    readonly openSystemSettings: Effect.Effect<boolean>;
    /** Brings the system's login item in line with the preference at startup. */
    readonly reconcile: Effect.Effect<void>;
  }
>()("@t3tools/desktop/fork/open-at-login/OpenAtLogin") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const loginItems = yield* LoginItems;
  const preferencePath = environment.path.join(environment.stateDir, PREFERENCE_FILE);
  const settingsUrl = LOGIN_ITEM_SETTINGS_URLS[environment.platform];
  const manages = settingsUrl !== undefined && isInstalledApp(environment);

  const readEnabled = fs.readFileString(preferencePath).pipe(
    Effect.flatMap(decodePreference),
    Effect.map((preference) => preference.enabled),
    Effect.orElseSucceed(() => true),
  );

  const state = Effect.gen(function* () {
    const enabled = yield* readEnabled;
    if (settingsUrl === undefined) return { enabled, status: "unsupported" as const };
    if (!manages) return { enabled, status: "not-installed" as const };
    return {
      enabled,
      status: describeLoginItem(environment.platform, enabled, yield* loginItems.read),
    };
  }).pipe(Effect.withSpan("desktop.openAtLogin.state"));

  const setEnabled = Effect.fn("desktop.openAtLogin.setEnabled")(function* (enabled: boolean) {
    yield* encodePreference({ enabled }).pipe(
      Effect.flatMap((json) => fs.writeFileString(preferencePath, json)),
      Effect.mapError(() => new OpenAtLoginError({ detail: "Could not save this setting." })),
    );
    if (manages) yield* loginItems.write(enabled);
    return yield* state;
  });

  const reconcile = Effect.gen(function* () {
    if (!manages) return;
    const current = yield* state;
    if (current.status !== "failed") return;
    yield* logInfo("updating the login item", { openAtLogin: current.enabled });
    yield* loginItems.write(current.enabled);
  }).pipe(
    Effect.catchCause((cause) => logWarning("login item update failed", { cause })),
    Effect.withSpan("desktop.openAtLogin.reconcile"),
  );

  return OpenAtLogin.of({
    state,
    setEnabled,
    openSystemSettings:
      settingsUrl === undefined ? Effect.succeed(false) : loginItems.openSettings(settingsUrl),
    reconcile,
  });
});

export const layer = Layer.effect(OpenAtLogin, make).pipe(Layer.provide(layerElectronLoginItems));
