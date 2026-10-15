import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProviderDriverKind } from "@t3tools/contracts";
import {
  FORK_WS_METHODS,
  type SwitchboardLimit,
  type SwitchboardLimits,
} from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";

import { connectionAtomRuntime } from "~/connection/runtime";

/**
 * Switchboard's controller re-reads every account every few minutes, so a minute's
 * polling keeps the picker within one pass of it.
 */
const switchboardLimitsQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:switchboard:limits",
  tag: FORK_WS_METHODS.limits,
  staleTimeMs: 30_000,
  refreshIntervalMs: 60_000,
  idleTtlMs: 5 * 60_000,
});

const NO_STATUS: SwitchboardLimits = { limits: [] };
const DISABLED_STATUS: SwitchboardLimits = { limits: [], availability: "disabled" };
const UNAVAILABLE_STATUS: SwitchboardLimits = { limits: [], availability: "unavailable" };
const disabledStatusAtom = Atom.make(DISABLED_STATUS);

/**
 * Model availability from the environment that owns the provider launch. While it
 * loads nothing is blocked; a failed read reports `unavailable`, which blocks
 * nothing either, since the hub still enforces every account's limits.
 */
export function useSwitchboardStatus(
  enabled: boolean,
  environmentId: EnvironmentId | null,
): SwitchboardLimits {
  const statusAtom = useMemo(() => {
    if (!enabled || environmentId === null) return disabledStatusAtom;
    const query = switchboardLimitsQuery({ environmentId, input: {} });
    return Atom.make((get) => {
      const result = get(query);
      if (AsyncResult.isFailure(result)) return UNAVAILABLE_STATUS;
      return Option.getOrElse(AsyncResult.value(result), () => NO_STATUS);
    });
  }, [enabled, environmentId]);
  return useAtomValue(statusAtom);
}

/** Whether Switchboard could not confirm availability, so the picker blocks nothing. */
export const isSwitchboardAvailabilityUnknown = (status: SwitchboardLimits): boolean =>
  status.availability === "unavailable" ||
  status.availability === "stale" ||
  status.availability === "unconfigured";

/** Whether anything in `status` can block a model. */
export const hasSwitchboardBlocks = (status: SwitchboardLimits): boolean =>
  status.limits.length > 0 || (status.models ?? []).some((model) => model.state === "unavailable");

const globMatches = (pattern: string, model: string) =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(model);

const BRAND: Record<SwitchboardLimit["driver"], string> = { claudeAgent: "Claude", codex: "Codex" };

const formatUntil = (until: number | null) =>
  until === null
    ? "an account resets"
    : new Date(until).toLocaleString("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      });

const asSentence = (text: string) => {
  const trimmed = text.trim();
  return trimmed === "" || /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const listNames = (names: ReadonlyArray<string>) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * Why Switchboard cannot serve `model` right now, or null when it can. A state
 * Switchboard reports for the model itself decides first, and only `unavailable`
 * blocks, with Switchboard's own reason; a model it does not list falls back to
 * its provider's limit. `nameOf` turns a model slug into the name the picker shows.
 */
export function switchboardModelBlock(
  status: Pick<SwitchboardLimits, "limits" | "models">,
  driverKind: ProviderDriverKind,
  model: string,
  nameOf: (slug: string) => string,
): string | null {
  const limit = status.limits.find((candidate) => candidate.driver === driverKind);
  const own = status.models?.find(
    (candidate) => candidate.driver === driverKind && candidate.id === model,
  );
  if (own !== undefined && own.state !== "unavailable") return null;
  if (own !== undefined && !limit) {
    const reason = asSentence(own.reason);
    if (reason === "") {
      return `Switchboard has no ${BRAND[own.driver]} account that can serve ${nameOf(model)} until ${formatUntil(own.resetAt)}.`;
    }
    const reset =
      own.resetAt === null ? "" : ` The next account reset is ${formatUntil(own.resetAt)}.`;
    return `Switchboard cannot serve ${nameOf(model)} right now. ${reason}${reset}`;
  }
  if (!limit || limit.servedModels.some((pattern) => globMatches(pattern, model))) return null;
  const brand = BRAND[limit.driver];
  const until = formatUntil(limit.until);
  if (limit.servedModels.length === 0) {
    return `Every ${brand} account is out of allowance until ${until}.`;
  }
  const served = listNames(limit.servedModels.map(nameOf));
  return `${brand} is on credits until ${until}, so Switchboard serves only ${served}.`;
}
