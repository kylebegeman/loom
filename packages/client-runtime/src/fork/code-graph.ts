import { CODE_GRAPH_WS_METHODS as G } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

/** Code graph status, queries, builds and settings for one environment. */
export function createCodeGraphAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    status: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:code-graph:status",
      tag: G.subscribeStatus,
    }),
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:code-graph:list",
      tag: G.list,
      staleTimeMs: 0,
    }),
    summary: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:code-graph:summary",
      tag: G.summary,
      staleTimeMs: 0,
    }),
    search: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:code-graph:search",
      tag: G.search,
      staleTimeMs: 0,
    }),
    neighborhood: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:code-graph:neighborhood",
      tag: G.neighborhood,
      staleTimeMs: 0,
    }),
    impact: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:code-graph:impact",
      tag: G.impact,
      staleTimeMs: 0,
    }),
    settings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:code-graph:settings",
      tag: G.getSettings,
      staleTimeMs: 0,
    }),
    /** Looks for Graphify again; subscribers see the new status too. */
    recheck: createEnvironmentRpcCommand(runtime, {
      label: "loom:code-graph:recheck",
      tag: G.status,
    }),
    build: createEnvironmentRpcCommand(runtime, { label: "loom:code-graph:build", tag: G.build }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "loom:code-graph:cancel",
      tag: G.cancel,
    }),
    deleteGraph: createEnvironmentRpcCommand(runtime, {
      label: "loom:code-graph:delete",
      tag: G.deleteGraph,
    }),
    setAgentTool: createEnvironmentRpcCommand(runtime, {
      label: "loom:code-graph:set-agent-tool",
      tag: G.setAgentTool,
    }),
    noteProjectOpened: createEnvironmentRpcCommand(runtime, {
      label: "loom:code-graph:note-project-opened",
      tag: G.noteProjectOpened,
    }),
    updateSettings: createEnvironmentRpcCommand(runtime, {
      label: "loom:code-graph:settings-update",
      tag: G.updateSettings,
    }),
  };
}
