import {
  CommandId,
  MessageId,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
} from "@t3tools/contracts";
import {
  AttentionRetryError,
  pendingSubagentAttentionRequests,
  type AttentionRetryRequest,
  type AttentionRetryResult,
} from "@t3tools/contracts/fork";
import { isRetryableFailureClass } from "@t3tools/shared/fork/run-continuation";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";

export class AttentionRetry extends Context.Service<
  AttentionRetry,
  {
    readonly retry: (
      input: AttentionRetryRequest,
      actor: { createdBy: OrchestrationV2Actor; creationSource: OrchestrationV2CreationSource },
    ) => Effect.Effect<AttentionRetryResult, AttentionRetryError>;
  }
>()("t3/fork/attention/AttentionRetry") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const crypto = yield* Crypto.Crypto;
  return AttentionRetry.of({
    retry: Effect.fn("AttentionRetry.retry")(function* (input, actor) {
      const shell = yield* threads
        .getThreadShell(input.threadId)
        .pipe(
          Effect.mapError((cause) => new AttentionRetryError({ reason: "unavailable", cause })),
        );
      if (shell === null || shell.archivedAt !== null || shell.deletedAt !== null)
        return yield* new AttentionRetryError({ reason: "not-found" });
      if (
        shell.latestRunId !== input.runId ||
        (shell.activityRunStatus ?? shell.status) !== "failed" ||
        shell.activeRunId !== null
      )
        return yield* new AttentionRetryError({ reason: "changed" });
      if (!isRetryableFailureClass(shell.lastErrorClass))
        return yield* new AttentionRetryError({ reason: "not-retryable" });
      const family = yield* threads
        .readShellSnapshot({ location: "active", familyOf: input.threadId })
        .pipe(
          Effect.flatten,
          Effect.mapError((cause) => new AttentionRetryError({ reason: "unavailable", cause })),
        );
      if (
        shell.pendingRuntimeRequest !== null ||
        pendingSubagentAttentionRequests(family.threads).has(input.threadId)
      )
        return yield* new AttentionRetryError({ reason: "pending-request" });
      const id = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
      const result = yield* threads
        .dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(`attention:${id}`),
          threadId: input.threadId,
          messageId: MessageId.make(`attention:${id}`),
          manualContinuationOfRunId: input.runId,
          text: "Continue where you left off.",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          ...actor,
        })
        .pipe(Effect.mapError((cause) => new AttentionRetryError({ reason: "changed", cause })));
      return { sequence: result.sequence };
    }),
  });
});

export const layer = Layer.effect(AttentionRetry, make);
