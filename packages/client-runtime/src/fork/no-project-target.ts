// Type-only imports: connection/compatibility.ts loads this module through capabilities.ts, and a
// runtime import of operations/projects.ts would close a cycle back through the RPC client.
import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";

import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";

/**
 * The folder a No project chat would start in on this computer, or null when it cannot start one
 * now. Matches `availableScratchWorkspaceRoot`, except a Library with execution turned off still
 * advertises a scratch folder, so execution support decides, not the folder.
 */
export function noProjectWorkspaceRoot(
  connectionPhase: EnvironmentConnectionPhase | null | undefined,
  serverConfig: Pick<ServerConfig, "scratchWorkspaceRoot" | "environment"> | null | undefined,
): string | null {
  if (connectionPhase !== "connected") return null;
  if (serverConfig?.environment.capabilities.supportsExecution === false) return null;
  return serverConfig?.scratchWorkspaceRoot ?? null;
}

/**
 * Where a No project chat starts: the first preferred computer that can run it (callers pass
 * current, then selected or primary), otherwise the first that can in the caller's display order.
 */
export function noProjectTargetEnvironmentId<
  E extends { readonly environmentId: EnvironmentId },
>(input: {
  readonly environments: readonly E[];
  readonly canRun: (environment: E) => boolean;
  readonly preferred: readonly (EnvironmentId | null | undefined)[];
}): EnvironmentId | null {
  for (const environmentId of input.preferred) {
    if (environmentId == null) continue;
    const environment = input.environments.find((entry) => entry.environmentId === environmentId);
    if (environment !== undefined && input.canRun(environment)) return environmentId;
  }
  return input.environments.find(input.canRun)?.environmentId ?? null;
}
