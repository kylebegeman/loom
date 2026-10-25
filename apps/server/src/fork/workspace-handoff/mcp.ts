import { OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import {
  WorkspaceHandoffError,
  WorkspaceHandoffOffer,
  WorkspaceHandoffPrepareInput,
  WorkspaceHandoffFinishInput,
  WorkspaceHandoffReceipt,
  WorkspaceHandoffFinishResult,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as WorkspaceHandoff from "./WorkspaceHandoffService.ts";

const failure = Schema.Union([WorkspaceHandoffError, OrchestratorMcpFailure]);
export const WorkspaceHandoffToolkit = Toolkit.make(
  Tool.make("loom_workspace_handoff_offer", {
    description:
      "Prepare a portable offer for a stopped thread with a clean, published branch. The original conversation stays on this host. This agent can only offer and finish on its own source computer. Prepare and resume require the destination computer's own agent. For a complete move, tell the user to use the Move work dialog. Never settle the source before destination preparation succeeds.",
    parameters: Schema.Struct({
      threadId: ThreadId,
      requestId: WorkspaceHandoffOffer.fields.requestId,
    }),
    success: WorkspaceHandoffOffer,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_workspace_handoff_prepare", {
    description:
      "Requires the destination computer's own agent or the Move work dialog; a source-side agent cannot route this call to another computer. On this destination host, prepare the offer in an existing project of the same repository. Clones an absent checkout, creates a managed worktree at the exact published commit and waits for workspace setup. Checks the selected provider, model and runtime before returning a receipt; does not settle the source or start the agent. Reuse the request ID when retrying and prepare again before settling the source to recheck readiness.",
    parameters: WorkspaceHandoffPrepareInput,
    success: WorkspaceHandoffReceipt,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_workspace_handoff_finish", {
    description:
      "Only on this original host, finish handoff only after receiving a ready destination receipt. Rejects changed source work and retains local configuration/application data. Otherwise settles the original thread; managed checkout cleanup follows Storage settings.",
    parameters: WorkspaceHandoffFinishInput,
    success: WorkspaceHandoffFinishResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
  Tool.make("loom_workspace_handoff_resume", {
    description:
      "Requires the destination computer's own agent or the Move work dialog. On this ready destination, start the linked continuation after source finish returned successfully. Uses one durable message ID, so retries do not start duplicate continuations. The full original history, attachments and checkpoints remain on the original host.",
    parameters: WorkspaceHandoffFinishInput,
    success: WorkspaceHandoffReceipt,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);
export const workspaceHandoffHandlers = McpToolAccess.toLayer(
  WorkspaceHandoffToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_workspace_handoff_offer: McpToolAccess.writesThreads(
        (input) => [input.threadId],
        (input) =>
          onHost(
            Effect.flatMap(WorkspaceHandoff.WorkspaceHandoffService, (service) =>
              service.offer(input),
            ),
          ),
      ),
      loom_workspace_handoff_prepare: McpToolAccess.startsThreads(
        () => ({}),
        (input, modes) =>
          onHost(
            Effect.flatMap(WorkspaceHandoff.WorkspaceHandoffService, (service) =>
              service.prepare({ ...input, ...modes }),
            ),
          ),
      ),
      loom_workspace_handoff_finish: McpToolAccess.writesThreads(
        (input) => [input.offer.sourceThreadId],
        (input) =>
          onHost(
            Effect.flatMap(WorkspaceHandoff.WorkspaceHandoffService, (service) =>
              service.finish(input),
            ),
          ),
      ),
      loom_workspace_handoff_resume: McpToolAccess.writesThreads(
        (input) => [input.receipt.threadId],
        (input) =>
          onHost(
            Effect.flatMap(WorkspaceHandoff.WorkspaceHandoffService, (service) =>
              service.resume(input),
            ),
          ),
      ),
    };
  }),
);
