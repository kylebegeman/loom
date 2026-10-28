import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { NonNegativeInt, RunId, ThreadId } from "../baseSchemas.ts";

export const ATTENTION_RETRY_FEATURE = "attention-status-retry";
export const ATTENTION_STATUS_WS_METHODS = {
  retry: "loom.attention-status.retry",
} as const;

export const AttentionRetryRequest = Schema.Struct({ threadId: ThreadId, runId: RunId });
export type AttentionRetryRequest = typeof AttentionRetryRequest.Type;
export const AttentionRetryResult = Schema.Struct({ sequence: NonNegativeInt });
export type AttentionRetryResult = typeof AttentionRetryResult.Type;

const messages = {
  "not-found": "This thread is no longer available.",
  changed: "This thread has changed. Refresh it before retrying.",
  "not-retryable": "This failure needs a changed message before trying again.",
  "pending-request": "Answer the pending request before retrying this thread.",
  unavailable: "Could not retry this run. Open the thread for details.",
} as const;

export class AttentionRetryError extends Schema.TaggedError<AttentionRetryError>()(
  "AttentionRetryError",
  {
    reason: Schema.Literals(Object.keys(messages) as Array<keyof typeof messages>),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return messages[this.reason];
  }
}

export const AttentionStatusRpcGroup = RpcGroup.make(
  Rpc.make(ATTENTION_STATUS_WS_METHODS.retry, {
    payload: AttentionRetryRequest,
    success: AttentionRetryResult,
    error: Schema.Union([AttentionRetryError, EnvironmentAuthorizationError]),
  }),
);
