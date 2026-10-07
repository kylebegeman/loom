import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import type { ProviderDriverKind } from "@t3tools/contracts";
import { FORK_WS_METHODS, type SwitchboardLimit } from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";

import { connectionAtomRuntime } from "~/connection/runtime";
import { usePrimaryEnvironmentId } from "~/state/environments";

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

const NO_LIMITS: ReadonlyArray<SwitchboardLimit> = [];
const noLimitsAtom = Atom.make(NO_LIMITS);

/**
 * The providers Switchboard is serving without plan allowance. The hub runs next to the
 * primary server, the one whose setting turns Switchboard mode on, so that server reads
 * it. Empty while Switchboard mode is off.
 */
export function useSwitchboardLimits(enabled: boolean): ReadonlyArray<SwitchboardLimit> {
  const environmentId = usePrimaryEnvironmentId();
  const limitsAtom = useMemo(() => {
    if (!enabled || environmentId === null) return noLimitsAtom;
    const query = switchboardLimitsQuery({ environmentId, input: {} });
    return Atom.make((get) =>
      Option.match(AsyncResult.value(get(query)), {
        onNone: () => NO_LIMITS,
        onSome: (value) => value.limits,
      }),
    );
  }, [enabled, environmentId]);
  return useAtomValue(limitsAtom);
}

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

const listNames = (names: ReadonlyArray<string>) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * Why Switchboard cannot serve `model` right now, or null when it can. `nameOf` turns a
 * served model slug into the name the picker shows.
 */
export function switchboardModelBlock(
  limits: ReadonlyArray<SwitchboardLimit>,
  driverKind: ProviderDriverKind,
  model: string,
  nameOf: (slug: string) => string,
): string | null {
  const limit = limits.find((candidate) => candidate.driver === driverKind);
  if (!limit || limit.servedModels.some((pattern) => globMatches(pattern, model))) return null;
  const brand = BRAND[limit.driver];
  const until = formatUntil(limit.until);
  if (limit.servedModels.length === 0) {
    return `Every ${brand} account is out of allowance until ${until}.`;
  }
  const served = listNames(limit.servedModels.map(nameOf));
  return `${brand} is on credits until ${until}, so Switchboard serves only ${served}.`;
}
