import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { CodeGraphError, type CodeGraphImpactResult } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as Index from "./CodeGraphIndex.ts";
import { CodeGraphService } from "./CodeGraphService.ts";

/** Lines per section; the tool says how many it left out. */
const AGENT_LIST_LIMIT = 40;

export const AGENT_TOOL_OFF_MESSAGE =
  "The code graph tool is off for this project. Turn on 'Let agents query the code graph' in the Code map panel.";

const QueryParams = Schema.Struct({
  mode: Schema.Literals(["search", "neighbors", "impact", "path"]),
  query: Schema.optional(
    Schema.String.annotate({
      description:
        "search: a symbol or file name. neighbors: a symbol, file path or node id. path: where the path starts.",
    }),
  ),
  to: Schema.optional(Schema.String.annotate({ description: "path: where the path ends." })),
  files: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description:
        "impact: files relative to the project root. Defaults to this thread's uncommitted changes.",
    }),
  ),
  depth: Schema.optional(
    Schema.Literals([1, 2, 3]).annotate({ description: "impact: hops to follow, default 2." }),
  ),
});

export const CodeGraphToolkit = Toolkit.make(
  Tool.make("loom_code_graph_query", {
    description:
      "Query this project's code graph built by Loom: find symbols, list callers and callees, trace a path, or list what changed files can affect.",
    parameters: QueryParams,
    success: Schema.Struct({ text: Schema.String, stale: Schema.Boolean }),
    failure: Schema.Union([CodeGraphError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "Query the code graph")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);

const invalid = (message: string) => new CodeGraphError({ reason: "node-not-found", message });

const place = (node: { readonly file: string; readonly line: number | null }) =>
  node.file === "" ? "external" : node.line === null ? node.file : `${node.file}:${node.line}`;

const more = (total: number) =>
  total > AGENT_LIST_LIMIT ? [`  ... and ${total - AGENT_LIST_LIMIT} more`] : [];

export const formatSearch = (index: Index.CodeGraphIndex, query: string) => {
  const result = Index.search(index, query);
  if (result.nodes.length === 0) return `No symbols or files match "${query}".`;
  return [
    `Matches for "${query}":`,
    ...result.nodes
      .slice(0, AGENT_LIST_LIMIT)
      .map((node) => `  ${node.label} [${node.kind}] ${place(node)}  id=${node.id}`),
    ...more(result.nodes.length),
    ...(result.truncated ? ["  (more matches exist; narrow the query)"] : []),
  ].join("\n");
};

/** The node's direct edges both ways, grouped by relation. */
export const formatNeighbors = (index: Index.CodeGraphIndex, focus: number) => {
  const node = index.nodes[focus]!;
  const section = (title: string, edges: ReadonlyArray<Index.IndexedEdge>) => {
    if (edges.length === 0) return [];
    const lines = edges.slice(0, AGENT_LIST_LIMIT).map((edge) => {
      const other = index.nodes[edge.node]!;
      const at = edge.line === null ? "" : ` (line ${edge.line})`;
      return `  ${edge.relation} ${other.label} ${place(other)}${at}`;
    });
    return [title, ...lines, ...more(edges.length)];
  };
  const lines = [
    `${node.label} [${node.kind}] ${place(node)}`,
    ...section("Uses:", index.out[focus]!),
    ...section("Used by:", index.in[focus]!),
  ];
  return lines.length === 1 ? `${lines[0]}\nNo edges.` : lines.join("\n");
};

export const formatPath = (index: Index.CodeGraphIndex, start: number, end: number) => {
  const steps = Index.shortestPath(index, start, end);
  const from = index.nodes[start]!.label;
  const to = index.nodes[end]!.label;
  if (steps === null) return `No path from ${from} to ${to} within ${Index.MAX_PATH_HOPS} hops.`;
  return [
    `Path from ${from} to ${to} (${steps.length - 1} hops):`,
    ...steps.map((step) =>
      step.via === null
        ? `  ${step.node.label} ${place(step.node)}`
        : `  ${step.via.forward ? "->" : "<-"} ${step.via.relation} ${step.node.label} ${place(step.node)}`,
    ),
  ].join("\n");
};

export const formatImpact = (result: Omit<CodeGraphImpactResult, "stale">) => {
  if (result.seedFiles.length === 0 && result.unknownFiles.length === 0) return "No changed files.";
  const lines = [
    `Changed files in the graph: ${result.seedFiles.length}`,
    ...(result.unknownFiles.length > 0
      ? [`Not in the graph: ${result.unknownFiles.slice(0, AGENT_LIST_LIMIT).join(", ")}`]
      : []),
  ];
  if (result.files.length === 0) return [...lines, "Nothing else depends on them."].join("\n");
  return [
    ...lines,
    "Files that can be affected, nearest first:",
    ...result.files
      .slice(0, AGENT_LIST_LIMIT)
      .map(
        (file) =>
          `  ${file.file} (${file.hitCount} symbol${file.hitCount === 1 ? "" : "s"}, ${file.minDepth} hop${file.minDepth === 1 ? "" : "s"})`,
      ),
    ...more(result.files.length),
    ...(result.truncated ? ["  (stopped early; the change reaches further)"] : []),
  ].join("\n");
};

const callerThread = Effect.gen(function* () {
  const invocation = yield* McpInvocationContext;
  if (invocation.thread === undefined)
    return yield* new CodeGraphError({
      reason: "project-not-found",
      message: "Use the code graph from an agent running in a Loom project thread.",
    });
  return invocation.thread.threadId;
});

/** The tool's answer for the calling thread's project, refused unless its switch is on. */
export const queryCodeGraph = (input: typeof QueryParams.Type) =>
  Effect.gen(function* () {
    const service = yield* CodeGraphService;
    const threadId = yield* callerThread;
    const checkout = yield* service.threadCheckout(threadId);
    const record = yield* service.graphRecord(checkout.projectId);
    if (record === null || !record.agentTool)
      return yield* new CodeGraphError({
        reason: "agent-tool-off",
        message: AGENT_TOOL_OFF_MESSAGE,
      });

    if (input.mode === "impact") {
      const result = yield* service.impact({
        projectId: checkout.projectId,
        threadId,
        files: input.files,
        depth: input.depth,
      });
      return { text: formatImpact(result), stale: result.stale };
    }

    const index = yield* service.indexFor(checkout.projectId);
    const status = yield* service.status(checkout.projectId);
    const stale = status.stale || status.dirty;
    const resolve = (value: string | undefined, name: string) => {
      if (value === undefined || value.trim() === "")
        return Effect.fail(invalid(`The ${input.mode} mode needs \`${name}\`.`));
      const node = Index.resolveNode(index, value);
      return node === null
        ? Effect.fail(invalid(`No symbol or file matches "${value}".`))
        : Effect.succeed(node);
    };

    switch (input.mode) {
      case "search": {
        if (input.query === undefined || input.query.trim() === "")
          return yield* invalid("The search mode needs `query`.");
        return { text: formatSearch(index, input.query), stale };
      }
      case "neighbors":
        return { text: formatNeighbors(index, yield* resolve(input.query, "query")), stale };
      case "path":
        return {
          text: formatPath(
            index,
            yield* resolve(input.query, "query"),
            yield* resolve(input.to, "to"),
          ),
          stale,
        };
    }
  });

export const codeGraphHandlers = McpToolAccess.toLayer(
  CodeGraphToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return {
      loom_code_graph_query: McpToolAccess.readsAsCaller((input) =>
        withForkRuntime(queryCodeGraph(input)).pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
    };
  }),
);
