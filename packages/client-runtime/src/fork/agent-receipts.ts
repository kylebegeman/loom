import { AGENT_RECEIPTS_WS_METHODS as R, type AgentReceiptSummary } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "../state/runtime.ts";

/** Receipts for finished sub-agents, fetched on demand rather than streamed. */
export function createAgentReceiptsAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:agent-receipts:list",
      tag: R.list,
      staleTimeMs: 0,
    }),
    get: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:agent-receipts:get",
      tag: R.get,
      staleTimeMs: 0,
    }),
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What a receipt adds to a sub-agent row: changed files and failed checks, or null. */
export function agentReceiptFacts(
  summary: Pick<AgentReceiptSummary, "filesChanged" | "failedCommands" | "memberCount">,
): string | null {
  const facts = [
    summary.filesChanged > 0 ? plural(summary.filesChanged, "file") + " changed" : null,
    summary.failedCommands > 0 ? plural(summary.failedCommands, "failed check") : null,
    summary.memberCount > 0 ? plural(summary.memberCount, "agent") : null,
  ].filter((fact) => fact !== null);
  return facts.length === 0 ? null : facts.join(" · ");
}
