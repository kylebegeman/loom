import type { OrchestrationV2ProviderFailure } from "@t3tools/contracts";
import type { SwitchboardLimits, SwitchboardModelAvailability } from "@t3tools/contracts/fork";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { formatModelSlugName } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { makeSwitchboardLimitsReader } from "./SwitchboardStatus.ts";

type SwitchboardDriver = SwitchboardModelAvailability["driver"];

// CLIProxyAPI answers this when no account registers a route for the model, which is also how a
// controller policy that excludes every account's models looks to the client.
const REFUSAL = /unknown provider for model ([^\s"'`\\,;(){}]+)/;
const DRIVER_NAMES: Record<SwitchboardDriver, string> = { codex: "Codex", claudeAgent: "Claude" };
const MAX_REASON_LENGTH = 500;

/** The model a Switchboard hub refused to route, when the failure is that refusal. */
export function switchboardRefusedModel(message: string): string | null {
  const id = REFUSAL.exec(message)?.[1]?.replace(/[.:]+$/, "");
  return id === undefined || id.length === 0 ? null : id;
}

const formatReset = (resetAt: number, timeZone: string | undefined) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(resetAt);

/**
 * Explains a hub refusal with the controller's reading. Only a current reading that confirms the
 * refused model `unavailable` changes the failure; it becomes a usage limit only with a reset time,
 * since a usage limit without one waits for a reset the hub never reports.
 */
export function switchboardLimitFailure(
  failure: OrchestrationV2ProviderFailure,
  driver: SwitchboardDriver,
  limits: SwitchboardLimits,
  timeZone?: string,
): OrchestrationV2ProviderFailure {
  const id = switchboardRefusedModel(failure.message);
  if (id === null || limits.availability !== "available") return failure;
  const model = limits.models?.find(
    (candidate) =>
      candidate.driver === driver && candidate.id === id && candidate.state === "unavailable",
  );
  if (model === undefined) return failure;
  const reason = model.reason.trim().slice(0, MAX_REASON_LENGTH);
  const message = [
    `Switchboard has no ${DRIVER_NAMES[driver]} account that can serve ${formatModelSlugName(id)}.`,
    ...(reason.length === 0 ? [] : [/[.!?]$/.test(reason) ? reason : `${reason}.`]),
    ...(model.resetAt === null ? [] : [`Next reset ${formatReset(model.resetAt, timeZone)}.`]),
  ].join(" ");
  return model.resetAt === null
    ? { ...failure, message }
    : {
        ...failure,
        class: "usage_limit",
        message,
        resetAt: DateTime.formatIso(DateTime.makeUnsafe(model.resetAt)),
      };
}

/**
 * The adapters' hook for failed turns. It reads the controller only for a hub refusal, and any
 * read failure leaves the original failure.
 */
export const makeSwitchboardLimitFailures = Effect.fn("Switchboard.makeLimitFailures")(function* (
  driver: SwitchboardDriver,
) {
  const { settings } = yield* ProviderHost.ProviderHost;
  const readLimits = yield* makeSwitchboardLimitsReader(settings.get);
  return Effect.fn("Switchboard.explainLimitFailure")(function* (
    failure: OrchestrationV2ProviderFailure,
  ) {
    if (switchboardRefusedModel(failure.message) === null) return failure;
    return switchboardLimitFailure(failure, driver, yield* readLimits);
  });
});
