import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import { describeLoginItem, LoginItems, type LoginItemReading, make } from "./OpenAtLogin.ts";

const mac = (status: LoginItemReading["status"]): LoginItemReading => ({
  openAtLogin: status === "enabled",
  status,
  executableWillLaunchAtLogin: false,
});

describe("describeLoginItem", () => {
  it("compares what macOS reports with the saved choice", () => {
    assert.strictEqual(describeLoginItem("darwin", true, mac("enabled")), "on");
    assert.strictEqual(
      describeLoginItem("darwin", true, mac("requires-approval")),
      "needs-approval",
    );
    assert.strictEqual(describeLoginItem("darwin", true, mac("not-registered")), "failed");
    assert.strictEqual(describeLoginItem("darwin", true, mac("not-found")), "failed");
    assert.strictEqual(describeLoginItem("darwin", false, mac("not-registered")), "off");
    assert.strictEqual(describeLoginItem("darwin", false, mac("requires-approval")), "off");
    assert.strictEqual(describeLoginItem("darwin", false, mac("enabled")), "failed");
  });

  it("treats a run key turned off in Startup apps as blocked on Windows", () => {
    const windows = (openAtLogin: boolean, executableWillLaunchAtLogin: boolean) =>
      ({ openAtLogin, executableWillLaunchAtLogin }) as LoginItemReading;
    assert.strictEqual(describeLoginItem("win32", true, windows(true, true)), "on");
    assert.strictEqual(describeLoginItem("win32", true, windows(true, false)), "needs-approval");
    assert.strictEqual(describeLoginItem("win32", true, windows(false, false)), "failed");
    assert.strictEqual(describeLoginItem("win32", false, windows(false, false)), "off");
  });
});

const harness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "open-at-login-" });
  const loginItem = { reading: mac("not-registered"), writes: [] as Array<boolean> };
  const fake = LoginItems.of({
    read: Effect.sync(() => loginItem.reading),
    write: (openAtLogin) =>
      Effect.sync(() => {
        loginItem.writes.push(openAtLogin);
        loginItem.reading = mac(openAtLogin ? "enabled" : "not-registered");
      }),
    openSettings: () => Effect.succeed(true),
  });
  // Each call is a fresh launch reading the same saved preference.
  const launch = (overrides: Record<string, unknown> = {}, localEnvironmentEnabled = true) =>
    make.pipe(
      Effect.provideService(
        DesktopEnvironment.DesktopEnvironment,
        DesktopEnvironment.DesktopEnvironment.of({
          path,
          platform: "darwin",
          isPackaged: true,
          isDevelopment: false,
          resourcesPath: "/Applications/Loom.app/Contents/Resources",
          homeDirectory: "/Users/k",
          stateDir,
          ...overrides,
        } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
      ),
      Effect.provideService(LoginItems, fake),
      Effect.provide(
        DesktopAppSettings.layerTest({
          ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
          localEnvironmentEnabled,
        }),
      ),
    );
  return { loginItem, launch };
});

it.layer(NodeServices.layer)("OpenAtLogin", (it) => {
  it.effect("opens the installed app at login by default and remembers turning it off", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        const first = yield* h.launch();
        yield* first.reconcile;
        assert.deepEqual(h.loginItem.writes, [true]);
        assert.deepEqual(yield* first.state, { enabled: true, status: "on" });

        assert.deepEqual(yield* first.setEnabled(false), { enabled: false, status: "off" });
        const second = yield* h.launch();
        yield* second.reconcile;
        assert.deepEqual(h.loginItem.writes, [true, false]);
        assert.deepEqual(yield* second.state, { enabled: false, status: "off" });

        assert.deepEqual(yield* second.setEnabled(true), { enabled: true, status: "on" });
        assert.deepEqual(h.loginItem.writes, [true, false, true]);
      }),
    ),
  );

  it.effect("leaves a client computer out of login items until the user turns it on", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* (yield* h.launch()).reconcile;
        assert.deepEqual(h.loginItem.writes, [true]);

        // Turning off "Run agents on this computer" relaunches the app as a client.
        const client = yield* h.launch({}, false);
        yield* client.reconcile;
        assert.deepEqual(h.loginItem.writes, [true, false]);
        assert.deepEqual(yield* client.state, { enabled: false, status: "off" });

        yield* (yield* h.launch()).reconcile;
        assert.deepEqual(h.loginItem.writes, [true, false, true]);
      }),
    ),
  );

  it.effect("keeps the choice a client computer made itself", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        const client = yield* h.launch({}, false);
        yield* client.reconcile;
        assert.deepEqual(h.loginItem.writes, []);
        assert.deepEqual(yield* client.setEnabled(true), { enabled: true, status: "on" });

        const relaunched = yield* h.launch({}, false);
        yield* relaunched.reconcile;
        assert.deepEqual(h.loginItem.writes, [true]);
        assert.deepEqual(yield* relaunched.state, { enabled: true, status: "on" });
      }),
    ),
  );

  it.effect("registers again when the system lost the login item", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* (yield* h.launch()).reconcile;
        h.loginItem.reading = mac("not-registered");
        yield* (yield* h.launch()).reconcile;
        assert.deepEqual(h.loginItem.writes, [true, true]);
      }),
    ),
  );

  it.effect("leaves a login item the user must allow to the system", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        h.loginItem.reading = mac("requires-approval");
        const service = yield* h.launch();
        yield* service.reconcile;
        assert.deepEqual(h.loginItem.writes, []);
        assert.deepEqual(yield* service.state, { enabled: true, status: "needs-approval" });
      }),
    ),
  );

  it.effect("never registers a development build or an app outside Applications", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        for (const overrides of [
          { isPackaged: false },
          { isDevelopment: true },
          { resourcesPath: "/Users/k/Downloads/Loom.app/Contents/Resources" },
        ]) {
          const service = yield* h.launch(overrides);
          yield* service.reconcile;
          assert.deepEqual(yield* service.setEnabled(true), {
            enabled: true,
            status: "not-installed",
          });
        }
        assert.deepEqual(h.loginItem.writes, []);
      }),
    ),
  );

  it.effect("reports Linux as unsupported", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        const service = yield* h.launch({ platform: "linux" });
        yield* service.reconcile;
        assert.deepEqual(yield* service.state, { enabled: true, status: "unsupported" });
        assert.deepEqual(h.loginItem.writes, []);
      }),
    ),
  );
});
