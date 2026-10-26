import type { ThreadId } from "@t3tools/contracts";
import { AGENT_RECEIPTS_WS_METHODS as R } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { AgentReceipts } from "./AgentReceipts.ts";

export const makeAgentReceiptsRpcHandlers = Effect.fn("AgentReceipts.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
) {
  const receipts = yield* AgentReceipts;
  return {
    [R.list]: (input: { threadId: ThreadId }) => auth.effect(R.list, receipts.list(input.threadId)),
    [R.get]: (input: { threadId: ThreadId; subjectId: string }) =>
      auth.effect(R.get, receipts.get(input.threadId, input.subjectId)),
  };
});
