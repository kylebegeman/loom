import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  AttentionRetryError,
  AttentionRetryRequest,
  AttentionRetryResult,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as AttentionRetry from "./AttentionRetry.ts";

export const AttentionToolkit = Toolkit.make(
  Tool.make("loom_thread_retry_failed_run", {
    description:
      "Retry a failed run after a temporary provider, transport or usage-limit failure. Pass the threadId and latest runId from its snapshot. Continues that exact run with its existing settings; refuses stale runs or pending questions. Use this instead of sending a new message to retry unchanged work.",
    parameters: AttentionRetryRequest,
    success: AttentionRetryResult,
    failure: Schema.Union([AttentionRetryError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);

export const attentionHandlers = McpToolAccess.toLayer(
  AttentionToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return {
      loom_thread_retry_failed_run: McpToolAccess.writesThreads(
        (input) => [input.threadId],
        (input) =>
          withForkRuntime(
            Effect.flatMap(AttentionRetry.AttentionRetry, (service) =>
              service.retry(input, { createdBy: "agent", creationSource: "mcp" }),
            ),
          ).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
    };
  }),
);
