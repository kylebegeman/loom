import { ServerSelfUpdateError } from "@t3tools/contracts";
import { UpdatePlanError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import packageJson from "../../../package.json" with { type: "json" };
import * as ServerConfig from "../../config.ts";
import * as SelfUpdate from "../../cloud/selfUpdate.ts";
import * as ServiceLauncher from "../../cloud/serviceLauncherClient.ts";
import { serverSelfUpdateEnabled } from "../runtime-owner/selfUpdateSwitch.ts";

export class UpdateRuntime extends Context.Service<
  UpdateRuntime,
  {
    readonly currentVersion: string;
    readonly supported: boolean;
    readonly install: (
      targetVersion: string,
      beforeHandoff: Effect.Effect<void, UpdatePlanError>,
      accepted: Effect.Effect<void>,
    ) => Effect.Effect<void, UpdatePlanError>;
  }
>()("t3/fork/machine-updates/UpdateRuntime") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const launcher = yield* ServiceLauncher.ServiceLauncherClient;
  const updater = yield* SelfUpdate.ServerSelfUpdate;
  const enabled = yield* serverSelfUpdateEnabled;
  const supported =
    enabled &&
    (config.mode === "desktop" ? config.desktopTelemetryControlFd !== undefined : launcher.managed);
  return UpdateRuntime.of({
    currentVersion: packageJson.version,
    supported,
    install: Effect.fn("UpdateRuntime.install")(
      function* (targetVersion, beforeHandoff, accepted) {
        const result = yield* updater.update(
          { targetVersion },
          (stage) =>
            stage === "installing"
              ? beforeHandoff.pipe(
                  Effect.mapError(
                    (cause) =>
                      new ServerSelfUpdateError({
                        reason: "The idle update is no longer ready to install.",
                        cause,
                      }),
                  ),
                )
              : Effect.void,
          () => accepted,
          { waitForIdle: true },
        );
        if (result.method === "desktop-app" && result.desktopUpdateToken !== undefined) {
          if (result.targetVersion !== targetVersion)
            return yield* new ServerSelfUpdateError({
              reason: "The prepared desktop update no longer matches the planned version.",
            });
          return yield* updater.commitDesktopUpdate(result.desktopUpdateToken, () => accepted);
        }
      },
      Effect.mapError((cause) => new UpdatePlanError({ reason: "update", cause })),
    ),
  });
});
export const layer = Layer.effect(UpdateRuntime, make);
