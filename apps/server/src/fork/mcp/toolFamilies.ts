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

export const sameCapabilities = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((capability) => right.has(capability));

export const requireToolFamily = Effect.fn("Mcp.requireToolFamily")(function* (
  family: AgentToolFamily,
) {
  const scope = yield* McpInvocationContext;
  if (scope.thread && !scope.capabilities.has(family))
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: `${family} tools are disabled for this agent session. Change Tools for agents in the project settings, then start a new agent session.`,
    });
});
