import {
  ATTENTION_STATUS_WS_METHODS as A,
  type AttentionRetryRequest,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as AttentionRetry from "./AttentionRetry.ts";

export const makeAttentionRpcHandlers = Effect.fn("Attention.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
) {
  const service = yield* AttentionRetry.AttentionRetry;
  return {
    [A.retry]: (input: AttentionRetryRequest) =>
      auth.effect(A.retry, service.retry(input, { createdBy: "user", creationSource: "web" })),
  };
});
