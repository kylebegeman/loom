import type { ServerSettings } from "@t3tools/contracts";
import type { SwitchboardLimits } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import * as Option from "effect/Option";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { ServerSettingsService } from "../../serverSettings.ts";
import { SwitchboardAvailability, switchboardLimits } from "./limits.ts";
import { resolveSwitchboardControllerRoute, switchboardControllerHeaders } from "./switchboard.ts";

class SwitchboardStatusOperationError extends Schema.TaggedError<SwitchboardStatusOperationError>()(
  "SwitchboardStatusOperationError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Switchboard Status operation failed.";
  }
}

/** Model availability for the picker, read from the Switchboard this server routes through. */
export class SwitchboardStatus extends Context.Service<
  SwitchboardStatus,
  { readonly readLimits: Effect.Effect<SwitchboardLimits> }
>()("t3/fork/switchboard/SwitchboardStatus") {}

const UNAVAILABLE: SwitchboardLimits = { limits: [], availability: "unavailable" };
const UNCONFIGURED: SwitchboardLimits = { limits: [], availability: "unconfigured" };
const DISABLED: SwitchboardLimits = { limits: [], availability: "disabled" };
const decodeAvailability = Schema.decodeUnknownEffect(SwitchboardAvailability);

/**
 * Builds the availability read from any source of server settings, so provider drivers can read it
 * without the fork runtime.
 */
export const makeSwitchboardLimitsReader = Effect.fn("SwitchboardStatus.makeLimitsReader")(
  function* <E>(getSettings: Effect.Effect<ServerSettings, E>) {
    const http = yield* HttpClient.HttpClient;
    const hostEnvironment = yield* HostProcess.Environment;
    const platform = yield* HostProcess.Platform;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const environment = {
      LOOM_SWITCHBOARD_URL: hostEnvironment.LOOM_SWITCHBOARD_URL,
      LOOM_SWITCHBOARD_CONTROLLER_URL: hostEnvironment.LOOM_SWITCHBOARD_CONTROLLER_URL,
      LOOM_SWITCHBOARD_KEY_HELPER: hostEnvironment.LOOM_SWITCHBOARD_KEY_HELPER,
    };

    // Switchboard caches account readings; Loom never probes subscriptions for this.
    // Any failure reports availability as unknown and blocks nothing: the proxy
    // still enforces each account's limits, and a turn reports the real error.
    return Effect.gen(function* () {
      const current = yield* getSettings;
      if (!current.switchboardEnabled) return DISABLED;
      // A remote hub with no controller setting, or an invalid one, is a setup gap
      // the picker can name, not an outage.
      const controller = yield* Effect.try({
        try: () => resolveSwitchboardControllerRoute(environment, platform),
        catch: (cause) => new SwitchboardStatusOperationError({ cause }),
      }).pipe(Effect.orElseSucceed(() => null));
      if (controller === null) return UNCONFIGURED;
      const headers = yield* switchboardControllerHeaders(controller, hostEnvironment).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      if (Option.isNone(headers)) return UNAVAILABLE;
      const response = yield* http.get(`${controller.url}/api/v1/availability`, {
        headers: headers.value,
      });
      if (response.status !== 200) return UNAVAILABLE;
      const snapshot = yield* response.json.pipe(Effect.flatMap(decodeAvailability));
      return switchboardLimits(snapshot, yield* Clock.currentTimeMillis);
    }).pipe(
      Effect.timeout("2 seconds"),
      Effect.orElseSucceed(() => UNAVAILABLE),
    );
  },
);

const make = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  return SwitchboardStatus.of({
    readLimits: yield* makeSwitchboardLimitsReader(settings.getSettings),
  });
});

export const layer = Layer.effect(SwitchboardStatus, make);
