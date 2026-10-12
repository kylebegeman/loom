import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  GitHubSetupRequest,
  GitHubSetupState,
  GitHubSetupFlowError,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as GitHubSetupFlow from "../../sourceControl/GitHubSetupFlow.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";

export const GitHubHostSetupToolkit = Toolkit.make(
  Tool.make("loom_github_host_setup", {
    description:
      "Prepare persistent GitHub HTTPS access on this host. Start with a unique requestId, then use status to read progress and the public device code. The user approves that code at https://github.com/login/device. Never approve on their behalf. Reopening status reuses the active request. Cancel requires its current requestId. Saved credentials remain on the host outside projects and lanes. Requires full access, including status because it can expose an approval code.",
    // MCP input schemas require an object root; validate action-specific fields at decode.
    parameters: Schema.Struct({
      action: Schema.Literals(["status", "start", "cancel"]),
      requestId: Schema.optional(GitHubSetupRequest.fields.requestId).annotate({
        description: "Required for start and cancel. Reuse the same ID when retrying a start.",
      }),
    }).check(
      Schema.makeFilter(
        (input) =>
          input.action === "status" ||
          input.requestId !== undefined ||
          "requestId is required for start and cancel.",
      ),
    ),
    success: GitHubSetupState,
    failure: Schema.Union([GitHubSetupFlowError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);
export const githubHostSetupHandlers = McpToolAccess.toLayer(
  GitHubHostSetupToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return {
      loom_github_host_setup: McpToolAccess.writesEnvironment((input) =>
        withForkRuntime(
          Effect.gen(function* () {
            const service = yield* GitHubSetupFlow.GitHubSetupFlow;
            switch (input.action) {
              case "start":
                return yield* service.start({ requestId: input.requestId! });
              case "cancel":
                return yield* service.cancel({ requestId: input.requestId! });
              case "status":
                return yield* service.snapshot;
            }
          }),
        ).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
    };
  }),
);
