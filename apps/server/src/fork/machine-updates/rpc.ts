import { UPDATE_PLAN_WS_METHODS as U } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as UpdatePlans from "./UpdatePlans.ts";

export const makeUpdatePlanRpcHandlers = Effect.fn("UpdatePlans.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
) {
  const service = yield* UpdatePlans.UpdatePlans;
  return {
    [U.status]: () => auth.effect(U.status, service.status),
    [U.arm]: (input: { readonly targetVersion: string }) =>
      auth.effect(U.arm, service.arm(input.targetVersion)),
    [U.cancel]: (input: { readonly id: string }) => auth.effect(U.cancel, service.cancel(input.id)),
  };
});
