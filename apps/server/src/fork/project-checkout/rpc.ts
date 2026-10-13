import { PROJECT_CHECKOUT_WS_METHODS as C } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as ProjectCheckoutManagement from "../../project/ProjectCheckoutManagement.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";

export const makeProjectCheckoutRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* ProjectCheckoutManagement.ProjectCheckoutManagement;
    return {
      [C.preview]: (input: Parameters<typeof service.preview>[0]) =>
        auth.effect(C.preview, service.preview(input)),
      [C.adopt]: (input: Parameters<typeof service.adopt>[0]) =>
        auth.effect(C.adopt, service.adopt(input)),
      [C.setRetention]: (input: Parameters<typeof service.setRetention>[0]) =>
        auth.effect(C.setRetention, service.setRetention(input)),
    };
  });
