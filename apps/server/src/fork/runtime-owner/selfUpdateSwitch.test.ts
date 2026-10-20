import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ServerSelfUpdateError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/http";

import packageJson from "../../../package.json" with { type: "json" };
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerSelfUpdate from "../../cloud/selfUpdate.ts";
import * as ServiceLauncherClient from "../../cloud/serviceLauncherClient.ts";
import {
  SERVICE_LAUNCHER_CONTEXT_ENV,
  SERVICE_LAUNCHER_PROTOCOL,
} from "../../cloud/serviceProtocol.ts";
import * as ServerConfig from "../../config.ts";
import * as DesktopAppUpdate from "../../desktopUpdate/DesktopAppUpdate.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProcessRunner from "../../processRunner.ts";
import {
  OS_MANAGED_RUNTIME_REASON,
  OS_RUNTIME_OWNER,
  SERVER_SELF_UPDATE_ENV,
} from "./selfUpdateSwitch.ts";

const DESKTOP_RAN = "The desktop app ran its update.";

const withSwitch = (value: string | undefined) =>
  Effect.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: value === undefined ? {} : { [SERVER_SELF_UPDATE_ENV]: value },
      }),
    ),
  );

const makeSelfUpdate = Effect.fn("test.make_switched_self_update")(function* (options: {
  readonly managed: boolean;
  readonly selfUpdate: string | undefined;
  readonly mode?: "web" | "desktop";
}) {
  const fs = yield* FileSystem.FileSystem;
  const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "loom-self-update-switch-" });
  const calls: string[] = [];
  const config = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
  );
  const selfUpdate = yield* ServerSelfUpdate.make().pipe(
    Effect.provideService(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({
        run: (input) => Effect.die(`unexpected process ${input.command}`),
      }),
    ),
    Effect.provideService(
      ServiceLauncherClient.ServiceLauncherClient,
      ServiceLauncherClient.ServiceLauncherClient.of({
        managed: options.managed,
        requestUpdate: () =>
          Effect.sync(() => {
            calls.push("requestUpdate");
            return "launcher-id";
          }),
        prepareTrial: Effect.undefined,
      }),
    ),
    Effect.provideService(DesktopAppUpdate.DesktopAppUpdate, {
      available: options.mode === "desktop",
      run: () =>
        Effect.sync(() => calls.push("desktopAppUpdate")).pipe(
          Effect.andThen(Effect.fail(new ServerSelfUpdateError({ reason: DESKTOP_RAN }))),
        ),
      commit: () => Effect.die("unexpected desktop app commit"),
    }),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("unexpected download")),
    ),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.Architecture, "arm64"),
    Effect.provide(ServerConfig.layer({ ...config, mode: options.mode ?? "web" })),
    withSwitch(options.selfUpdate),
  );
  return { selfUpdate, calls };
});

const launcherHost = {
  connected: true,
  send: () => true,
  on: () => undefined,
  off: () => undefined,
};

const describeServer = (
  baseDir: string,
  selfUpdate: string | undefined,
  overrides: Partial<ServerConfig.ServerConfig["Service"]> = {},
) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig.pipe(
      Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
    );
    const environment = yield* ServerEnvironment.ServerEnvironment.pipe(
      Effect.provide(
        ServerEnvironment.layer.pipe(
          Layer.provide(ServerSecretStore.layer),
          Layer.provide(ServerConfig.layer({ ...config, ...overrides })),
        ),
      ),
    );
    return yield* environment.getDescriptor;
  }).pipe(withSwitch(selfUpdate));

const describeManagedServer = Effect.fn("test.describe_managed_server")(function* (
  selfUpdate: string | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "loom-self-update-switch-" });
  return yield* describeServer(baseDir, selfUpdate).pipe(
    Effect.provideService(ServiceLauncherClient.ServiceLauncherHostProcess, launcherHost),
    Effect.provideService(HostProcess.Environment, {
      [SERVICE_LAUNCHER_CONTEXT_ENV]: JSON.stringify({
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        childVersion: packageJson.version,
      }),
    }),
  );
});

const describeDesktopServer = Effect.fn("test.describe_desktop_server")(function* (
  selfUpdate: string | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "loom-self-update-switch-" });
  return yield* describeServer(baseDir, selfUpdate, {
    mode: "desktop",
    desktopTelemetryControlFd: 5,
  });
});

it.layer(NodeServices.layer)("server self-update switch", (it) => {
  it.effect("refuses a launcher update when the operating system owns the runtime", () =>
    Effect.gen(function* () {
      const { selfUpdate, calls } = yield* makeSelfUpdate({
        managed: true,
        selfUpdate: "false",
      });
      const error = yield* selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip);
      expect(error.reason).toBe(OS_MANAGED_RUNTIME_REASON);
      expect(calls).toEqual([]);
    }),
  );

  it.effect.each([
    { name: "unset", value: undefined },
    { name: "on", value: "true" },
  ])("keeps launcher updates when the switch is $name", ({ value }) =>
    Effect.gen(function* () {
      const { selfUpdate } = yield* makeSelfUpdate({ managed: true, selfUpdate: value });
      // The version check runs after the capability gate, so this proves the gate passed.
      const error = yield* selfUpdate.update({ targetVersion: "latest" }).pipe(Effect.flip);
      expect(error.reason).toBe("'latest' is not an exact t3 version.");
    }),
  );

  it.effect("refuses on a server without a launcher too, so no install hint competes", () =>
    Effect.gen(function* () {
      const off = yield* makeSelfUpdate({ managed: false, selfUpdate: "false" });
      const offError = yield* off.selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip);
      expect(offError.reason).toBe(OS_MANAGED_RUNTIME_REASON);

      const unset = yield* makeSelfUpdate({ managed: false, selfUpdate: undefined });
      const unsetError = yield* unset.selfUpdate
        .update({ targetVersion: "1.1.0" })
        .pipe(Effect.flip);
      expect(unsetError.reason).toContain("t3 service install");
    }),
  );

  it.effect("refuses a desktop-mode update without asking the desktop app", () =>
    Effect.gen(function* () {
      const off = yield* makeSelfUpdate({ managed: false, selfUpdate: "false", mode: "desktop" });
      const offError = yield* off.selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip);
      expect(offError.reason).toBe(OS_MANAGED_RUNTIME_REASON);
      expect(off.calls).toEqual([]);

      const unset = yield* makeSelfUpdate({
        managed: false,
        selfUpdate: undefined,
        mode: "desktop",
      });
      const unsetError = yield* unset.selfUpdate
        .update({ targetVersion: "1.1.0" })
        .pipe(Effect.flip);
      expect(unsetError.reason).toBe(DESKTOP_RAN);
      expect(unset.calls).toEqual(["desktopAppUpdate"]);
    }),
  );

  it.effect("names the operating system as the runtime owner only when the switch is off", () =>
    Effect.gen(function* () {
      const off = (yield* describeManagedServer("false")).capabilities;
      expect(off.serverSelfUpdate).toBeUndefined();
      expect(off.serverRuntimeOwner).toBe(OS_RUNTIME_OWNER);
      for (const value of [undefined, "true"]) {
        const on = (yield* describeManagedServer(value)).capabilities;
        expect(on.serverSelfUpdate).toBe("boot-service");
        expect(on.serverRuntimeOwner).toBeUndefined();
      }
    }),
  );

  it.effect("stops a desktop-mode server advertising the desktop app's update", () =>
    Effect.gen(function* () {
      const off = (yield* describeDesktopServer("false")).capabilities;
      expect(off.serverRuntimeOwner).toBe(OS_RUNTIME_OWNER);
      expect(off.serverSelfUpdate).toBeUndefined();
      expect(off.desktopAppUpdate).toBeUndefined();
      expect(off.serverSelfUpdateProgress).toBeUndefined();

      const unset = (yield* describeDesktopServer(undefined)).capabilities;
      expect(unset).toMatchObject({
        serverSelfUpdate: "desktop-managed",
        desktopAppUpdate: true,
        serverSelfUpdateProgress: true,
      });
      expect(unset.serverRuntimeOwner).toBeUndefined();
    }),
  );

  it.effect("publishes no install method an older client could build a command from", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "loom-self-update-switch-" });
      const prefix = `${yield* fs.realPath(baseDir)}/node`;
      const entry = `${prefix}/lib/node_modules/t3/dist/bin.mjs`;
      yield* fs.makeDirectory(`${prefix}/lib/node_modules/t3/dist`, { recursive: true });
      yield* fs.makeDirectory(`${prefix}/bin`, { recursive: true });
      yield* fs.writeFileString(entry, "");
      yield* fs.writeFileString(
        `${prefix}/lib/node_modules/t3/package.json`,
        '{"name":"t3","version":"0.0.45","bin":{"t3":"./dist/bin.mjs"}}',
      );
      yield* fs.symlink(entry, `${prefix}/bin/t3`);
      const describeNpmGlobal = (selfUpdate: string | undefined) =>
        describeServer(baseDir, selfUpdate).pipe(
          Effect.provideService(HostProcess.Arguments, ["node", entry]),
          Effect.provideService(HostProcess.IsExecutable, false),
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.Environment, {}),
        );

      const off = (yield* describeNpmGlobal("false")).capabilities;
      expect(off.serverInstallation).toBeUndefined();
      expect(off.serverRuntimeOwner).toBe(OS_RUNTIME_OWNER);
      expect((yield* describeNpmGlobal(undefined)).capabilities.serverInstallation).toEqual({
        kind: "npm-global",
        prefix,
      });
    }),
  );
});
