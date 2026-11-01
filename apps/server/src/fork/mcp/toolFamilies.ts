import type { AgentToolFamily } from "@t3tools/contracts/fork";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";

export const toolFamily = (name: string): AgentToolFamily | undefined =>
  name.startsWith("loom_pcb_") || name.startsWith("loom_model_preview_3d_")
    ? "hardware"
    : name.startsWith("loom_reach_")
      ? "reach"
      : name === "loom_sites" || name.startsWith("loom_site_")
        ? "sites"
        : undefined;

export const requireToolFamily = Effect.fn("Mcp.requireToolFamily")(function* (
  family: AgentToolFamily,
) {
  const scope = yield* McpInvocationContext;
  if (scope.thread && !scope.capabilities.has(family))
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: `${family} tools are turned off for this project. With the user's authorization, use loom_project_profiles_update to change agentToolFamilies.${family}, then retry in this conversation.`,
    });
});
