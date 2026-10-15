import type { SwitchboardLimits } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";

import { ServerSettingsService } from "../../serverSettings.ts";
import { SwitchboardAvailability, switchboardLimits } from "./limits.ts";
import { resolveSwitchboardController } from "./switchboard.ts";

/** Model availability for the picker, read from the Switchboard this server routes through. */
export class SwitchboardStatus extends Context.Service<
  SwitchboardStatus,
  { readonly readLimits: Effect.Effect<SwitchboardLimits> }
>()("t3/fork/switchboard/SwitchboardStatus") {}

const UNAVAILABLE: SwitchboardLimits = { limits: [], availability: "unavailable" };
const DISABLED: SwitchboardLimits = { limits: [], availability: "disabled" };
const decodeAvailability = Schema.decodeUnknownEffect(SwitchboardAvailability);

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const settings = yield* ServerSettingsService;
  const hostEnvironment = yield* HostProcess.Environment;
  const environment = {
    LOOM_SWITCHBOARD_URL: hostEnvironment.LOOM_SWITCHBOARD_URL,
    LOOM_SWITCHBOARD_CONTROLLER_URL: hostEnvironment.LOOM_SWITCHBOARD_CONTROLLER_URL,
  };

  // Switchboard caches account readings; Loom never probes subscriptions for this.
  // Any failure reports availability as unknown and blocks nothing: the proxy
  // still enforces each account's limits, and a turn reports the real error.
  const readLimits = Effect.gen(function* () {
    const current = yield* settings.getSettings;
    if (!current.switchboardEnabled) return DISABLED;
    const controller = yield* Effect.try(() => resolveSwitchboardController(environment));
    if (controller === null) return UNAVAILABLE;
    const response = yield* http.get(`${controller}/api/v1/availability`);
    if (response.status !== 200) return UNAVAILABLE;
    const snapshot = yield* response.json.pipe(Effect.flatMap(decodeAvailability));
    return switchboardLimits(snapshot, yield* Clock.currentTimeMillis);
  }).pipe(
    Effect.timeout("2 seconds"),
    Effect.orElseSucceed(() => UNAVAILABLE),
  );

  return SwitchboardStatus.of({ readLimits });
});

export const layer = Layer.effect(SwitchboardStatus, make);
