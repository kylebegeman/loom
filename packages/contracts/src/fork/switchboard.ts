import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";

export const SWITCHBOARD_WS_METHODS = {
  limits: "loom.switchboard.limits",
} as const;

const SwitchboardDriver = Schema.Literals(["claudeAgent", "codex"]);

/**
 * A pooled provider with no account that has plan allowance left, as the Switchboard
 * controller last saw it. Providers with allowance are not listed.
 */
export const SwitchboardLimit = Schema.Struct({
  driver: SwitchboardDriver,
  /** Model patterns the hub still serves, on credits. `*` matches any run of characters. */
  servedModels: Schema.Array(Schema.String),
  /** Earliest time, in epoch milliseconds, an account gets plan allowance back. */
  until: Schema.NullOr(Schema.Number),
});
export type SwitchboardLimit = typeof SwitchboardLimit.Type;

/**
 * One model as Switchboard's controller evaluates it. Only `unavailable` is a
 * confirmed block; `unknown` means its readings or policy could not be confirmed.
 */
export const SwitchboardModelAvailability = Schema.Struct({
  driver: SwitchboardDriver,
  /** The model ID the hub routes, matched against the picker's model slug. */
  id: Schema.String,
  state: Schema.Literals(["available", "restricted", "unavailable", "unknown"]),
  /** Switchboard's own explanation of the state. */
  reason: Schema.String,
  /** Earliest future time, in epoch milliseconds, an account for it resets. */
  resetAt: Schema.NullOr(Schema.Number),
});
export type SwitchboardModelAvailability = typeof SwitchboardModelAvailability.Type;

export const SwitchboardLimits = Schema.Struct({
  limits: Schema.Array(SwitchboardLimit),
  /** Per-model states when the controller reported them. Absent from older servers. */
  models: Schema.optionalKey(Schema.Array(SwitchboardModelAvailability)),
  /**
   * Whether the limits reflect a current controller reading. `unavailable` and
   * `stale` mean availability is unknown, so nothing is blocked; they never imply
   * allowance is left.
   */
  availability: Schema.optionalKey(
    Schema.Literals(["available", "unavailable", "stale", "disabled"]),
  ),
});
export type SwitchboardLimits = typeof SwitchboardLimits.Type;

const SwitchboardLimitsRpc = Rpc.make(SWITCHBOARD_WS_METHODS.limits, {
  payload: Schema.Struct({}),
  success: SwitchboardLimits,
  error: EnvironmentAuthorizationError,
});

export const SwitchboardRpcGroup = RpcGroup.make(SwitchboardLimitsRpc);
