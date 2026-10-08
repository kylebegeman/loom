import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";

export const SWITCHBOARD_WS_METHODS = {
  limits: "loom.switchboard.limits",
} as const;

/**
 * A pooled provider with no account that has plan allowance left, as the Switchboard
 * controller last saw it. Providers with allowance are not listed.
 */
export const SwitchboardLimit = Schema.Struct({
  driver: Schema.Literals(["claudeAgent", "codex"]),
  /** Model patterns the hub still serves, on credits. `*` matches any run of characters. */
  servedModels: Schema.Array(Schema.String),
  /** Earliest time, in epoch milliseconds, an account gets plan allowance back. */
  until: Schema.NullOr(Schema.Number),
});
export type SwitchboardLimit = typeof SwitchboardLimit.Type;

export const SwitchboardLimits = Schema.Struct({
  limits: Schema.Array(SwitchboardLimit),
});
export type SwitchboardLimits = typeof SwitchboardLimits.Type;

const SwitchboardLimitsRpc = Rpc.make(SWITCHBOARD_WS_METHODS.limits, {
  payload: Schema.Struct({}),
  success: SwitchboardLimits,
  error: EnvironmentAuthorizationError,
});

export const SwitchboardRpcGroup = RpcGroup.make(SwitchboardLimitsRpc);
