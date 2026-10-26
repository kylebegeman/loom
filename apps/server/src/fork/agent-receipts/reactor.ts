import type { OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../../serverActivation.ts";
import { AgentReceipts } from "./AgentReceipts.ts";
import { isTerminalReceiptStatus } from "./buildReceipt.ts";

export class AgentReceiptsReactor extends Context.Service<
  AgentReceiptsReactor,
  {
    /** Writes the receipts one committed event finishes; ignores every other event. */
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/fork/agent-receipts/reactor/AgentReceiptsReactor") {}

const make = Effect.gen(function* () {
  const receipts = yield* AgentReceipts;
  const handle: AgentReceiptsReactor["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
      switch (event.type) {
        case "subagent.updated": {
          if (!isTerminalReceiptStatus(event.payload.status)) return;
          // A coordinator finishes after its members' transcripts flush, so it rereads them.
          yield* receipts.recordSubagent(event.payload.threadId, event.payload.id, {
            refreshMembers: event.payload.workflow !== undefined,
          });
          return;
        }
        case "run.updated": {
          if (!isTerminalReceiptStatus(event.payload.status)) return;
          yield* receipts.recordRun(event.payload.threadId, event.payload.id);
          return;
        }
        case "checkpoint.captured": {
          if (event.payload.files.length === 0) return;
          yield* receipts.noteCheckpoint({
            threadId: event.payload.threadId,
            runId: event.payload.runId,
            nodeId: event.payload.nodeId,
          });
          return;
        }
      }
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("writing an agent receipt failed", {
            threadId: event.threadId,
            type: event.type,
            cause,
          }),
        ),
      ),
  );
  return AgentReceiptsReactor.of({ handle });
});

export const reactorLayer = Layer.effect(AgentReceiptsReactor, make);

/** Follows committed events, then fills in receipts for records from before this version. */
export const AgentReceiptsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const threads = yield* ThreadManagementService;
    const reactor = yield* AgentReceiptsReactor;
    const receipts = yield* AgentReceipts;
    yield* forkParked(
      Stream.runForEach(threads.streamDomainEvents, reactor.handle).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("agent receipt event stream failed", { cause }),
        ),
      ),
    );
    yield* forkParked(
      receipts.backfillOnce.pipe(
        Effect.tap((result) =>
          result === null ? Effect.void : Effect.logInfo("agent receipts backfilled", result),
        ),
        Effect.catchCause((cause) => Effect.logWarning("agent receipt backfill failed", { cause })),
      ),
    );
  }),
);
