import { REACH_WS_METHODS as REACH, type ReachRetireInput } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../../rpcAuthorization.ts";
import { ReachProvisioner } from "./ReachProvisioner.ts";

export const makeReachLibraryRpcHandlers = Effect.fn("ReachLibrary.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
) {
  const provisioner = yield* ReachProvisioner;
  return {
    [REACH.libraryList]: () => auth.effect(REACH.libraryList, provisioner.computers),
    [REACH.libraryRetire]: (input: ReachRetireInput) =>
      auth.effect(REACH.libraryRetire, provisioner.retire(input)),
  };
});
