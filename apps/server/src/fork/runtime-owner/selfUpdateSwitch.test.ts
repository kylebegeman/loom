import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
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
import { OS_MANAGED_RUNTIME_REASON, SERVER_SELF_UPDATE_ENV } from "./selfUpdateSwitch.ts";

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
      available: false,
      run: () => Effect.die("unexpected desktop app update run"),
      commit: () => Effect.die("unexpected desktop app commit"),
    }),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("unexpected download")),
    ),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.Architecture, "arm64"),
    Effect.provide(ServerConfig.layer({ ...config, mode: "web" })),
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

const describeManagedServer = Effect.fn("test.describe_managed_server")(function* (
  selfUpdate: string | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "loom-self-update-switch-" });
  return yield* Effect.gen(function* () {
    const environment = yield* ServerEnvironment.ServerEnvironment;
    return yield* environment.getDescriptor;
  }).pipe(
    Effect.provide(
      ServerEnvironment.layer.pipe(
        Layer.provide(ServerSecretStore.layer),
        Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
      ),
    ),
    Effect.provideService(ServiceLauncherClient.ServiceLauncherHostProcess, launcherHost),
    Effect.provideService(HostProcess.Environment, {
      [SERVICE_LAUNCHER_CONTEXT_ENV]: JSON.stringify({
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        childVersion: packageJson.version,
      }),
    }),
    withSwitch(selfUpdate),
  );
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

  it.effect("keeps the service install hint on servers without a launcher", () =>
    Effect.gen(function* () {
      const { selfUpdate } = yield* makeSelfUpdate({ managed: false, selfUpdate: "false" });
      const error = yield* selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip);
      expect(error.reason).toContain("t3 service install");
    }),
  );

  it.effect("stops advertising self-update when the switch is off", () =>
    Effect.gen(function* () {
      expect((yield* describeManagedServer("false")).capabilities.serverSelfUpdate).toBeUndefined();
      expect((yield* describeManagedServer(undefined)).capabilities.serverSelfUpdate).toBe(
        "boot-service",
      );
    }),
  );
});
