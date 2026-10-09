// @effect-diagnostics nodeBuiltinImport:off - Reads the graph.json fixture.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { CodeGraphError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { impact, parseGraph, type CodeGraphIndex } from "./CodeGraphIndex.ts";
import { CodeGraphService } from "./CodeGraphService.ts";
import {
  AGENT_TOOL_OFF_MESSAGE,
  formatImpact,
  formatNeighbors,
  formatPath,
  formatSearch,
  queryCodeGraph,
} from "./mcp.ts";

const index = (() => {
  const parsed = parseGraph(
    JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(import.meta.dirname, "__fixtures__/graph.small.json"),
        "utf8",
      ),
    ),
  );
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.index;
})();

const idOf = (graph: CodeGraphIndex, id: string) => graph.byId.get(id)!;

describe("agent tool output", () => {
  it("lists matches with their place and id, and says when nothing matches", () => {
    const text = formatSearch(index, "pngInfo");
    expect(text.split("\n")[1]).toMatch(
      /^ {2}pngInfo\(\) \[symbol\] src\/hostDevices\.ts:\d+ {2}id=src_hostdevices_pnginfo$/,
    );
    expect(formatSearch(index, "zzzz-nothing")).toBe('No symbols or files match "zzzz-nothing".');
  });

  it("groups a symbol's edges into what it uses and what uses it", () => {
    const text = formatNeighbors(index, idOf(index, "src_hostdevices_pnginfo"));
    expect(text).toContain("Used by:");
    expect(text).toMatch(/imports pngInfo\(\)|imports DeviceQaService\.ts/);
  });

  it("traces a path with the direction of each hop", () => {
    const text = formatPath(
      index,
      idOf(index, "src_hostdevices_pnginfo"),
      idOf(index, "src_deviceqaservice"),
    );
    expect(text).toContain("(1 hops)");
    expect(text).toContain("<- imports DeviceQaService.ts src/DeviceQaService.ts");
  });

  it("summarizes impact by file and names files the graph does not know", () => {
    const text = formatImpact(impact(index, ["src/hostDevices.ts", "src/missing.ts"], 1));
    expect(text).toContain("Changed files in the graph: 1");
    expect(text).toContain("Not in the graph: src/missing.ts");
    expect(text).toMatch(/ {2}src\/DeviceQaService\.ts \(\d+ symbols?, 1 hop\)/);
    expect(formatImpact(impact(index, [], 2))).toBe("No changed files.");
  });
});

function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}

const projectId = ProjectId.make("project-graph");
const threadId = ThreadId.make("thread-agent");

const invocation = (thread: boolean) =>
  ({
    environmentId: EnvironmentId.make("env"),
    capabilities: new Set(),
    issuedAt: 0,
    requestNamespace: "test",
    thread: thread
      ? { threadId, providerSessionId: "session", providerInstanceId: "codex" as never }
      : undefined,
    client: undefined,
  }) as McpInvocationContext["Service"];

/** A service whose project has a graph only when `record` is given. */
const service = (record: { readonly agentTool: boolean } | null) =>
  partial<CodeGraphService["Service"]>({
    threadCheckout: () => Effect.succeed({ projectId, inProjectRoot: true } as never),
    graphRecord: () => Effect.succeed(record as never),
    indexFor: () =>
      Effect.fail(new CodeGraphError({ reason: "no-graph", message: "No code graph yet." })),
  });

const run = (
  input: Parameters<typeof queryCodeGraph>[0],
  options: { readonly thread: boolean; readonly record: { readonly agentTool: boolean } | null },
) =>
  queryCodeGraph(input).pipe(
    Effect.provideService(CodeGraphService, service(options.record)),
    Effect.provideService(McpInvocationContext, invocation(options.thread)),
  );

describe("agent tool access", () => {
  it.effect("answers only thread callers whose project has the switch on", () =>
    Effect.gen(function* () {
      const notThread = yield* Effect.flip(
        run({ mode: "search", query: "x" }, { thread: false, record: { agentTool: true } }),
      );
      expect(notThread.reason).toBe("project-not-found");

      const noGraph = yield* Effect.flip(
        run({ mode: "search", query: "x" }, { thread: true, record: null }),
      );
      expect(noGraph).toMatchObject({ reason: "agent-tool-off", message: AGENT_TOOL_OFF_MESSAGE });

      const off = yield* Effect.flip(
        run({ mode: "search", query: "x" }, { thread: true, record: { agentTool: false } }),
      );
      expect(off.reason).toBe("agent-tool-off");

      // With the switch on, the query reaches the graph, which reports its own absence.
      const missing = yield* Effect.flip(
        run({ mode: "search", query: "x" }, { thread: true, record: { agentTool: true } }),
      );
      expect(missing.reason).toBe("no-graph");
    }),
  );
});
