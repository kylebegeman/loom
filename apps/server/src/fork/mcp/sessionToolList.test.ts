import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpBody, HttpClient, HttpRouter, HttpServerResponse } from "effect/http";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import * as DeviceService from "../../device/DeviceService.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import type { McpCapability, McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../../mcp/McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "../../mcp/PreviewAutomationBroker.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSearch from "../../orchestration-v2/ThreadSearch.ts";
import * as PreviewManager from "../../preview/Manager.ts";
import * as PreviewBrowser from "../../preview/PreviewBrowser.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../../project/ProjectSetupScriptRunner.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as PullRequestReviewGuideService from "../../pullRequest/PullRequestReviewGuideService.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../../secrets/SecretRequests.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as SourceControlRepositoryService from "../../sourceControl/SourceControlRepositoryService.ts";
import * as StorageCleanup from "../../storageCleanup.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";
import { hideUnusableTools } from "./sessionToolList.ts";

// Listing tools never calls these; they only satisfy the production layer.
const layerStubServices = Layer.mergeAll(
  Layer.mock(StorageCleanup.StorageCleanup)({ latestReport: Effect.succeed(null) }),
  Layer.mock(Orchestrator.OrchestratorV2)({}),
  Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
  Layer.mock(DeviceService.DeviceService)({}),
  Layer.mock(ThreadManagementService.ThreadManagementService)({}),
  Layer.mock(ProviderRegistry.ProviderRegistry)({}),
  Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
  Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
  Layer.mock(SecretRequests.SecretRequests)({}),
  Layer.mock(ProjectService.ProjectService)({}),
  Layer.mock(PullRequestReviewGuideService.PullRequestReviewGuideService)({}),
  ServerSettings.layerTest({}),
  Layer.mock(GitWorkflowService.GitWorkflowService)({}),
  Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
  Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({}),
  Layer.mock(GitVcsDriver.GitVcsDriver)({}),
  Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({ namedProjectsRoot: "/unused" }),
  Layer.mock(PreviewManager.PreviewManager)({}),
  Layer.mock(ServerSecretStore.ServerSecretStore)({}),
  Layer.mock(SourceControlRepositoryService.SourceControlRepositoryService)({}),
  Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
  Layer.mock(ThreadSearch.ThreadSearch)({}),
  McpProviderSessions.layer,
);

const ListedTool = Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [
  Schema.Record(Schema.String, Schema.Unknown),
]);
const decodeToolsListPayload = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ result: Schema.Struct({ tools: Schema.Array(ListedTool) }) }),
  ),
);

const mcpHeaders = (authorization: string, sessionId?: string) => ({
  accept: "application/json, text/event-stream",
  authorization,
  "mcp-protocol-version": "2025-06-18",
  ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
});

const listToolsOverHttp = Effect.fn("test.listToolsOverHttp")(function* (
  request: McpSessionRegistry.McpCredentialRequest,
) {
  const credential = yield* McpSessionRegistry.issueActiveMcpCredential(request);
  expect(credential).toBeDefined();
  const authorization = credential!.config.authorizationHeader;
  const http = yield* HttpClient.HttpClient;
  const initialized = yield* http.post("/mcp", {
    headers: mcpHeaders(authorization),
    body: HttpBody.text(
      `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"catalog-test","version":"1.0.0"}}}`,
      "application/json",
    ),
  });
  expect(initialized.status).toBe(200);
  const listed = yield* http.post("/mcp", {
    headers: mcpHeaders(authorization, initialized.headers["mcp-session-id"]),
    body: HttpBody.text(
      `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
      "application/json",
    ),
  });
  // The transport answers in JSON or as one SSE event, depending on timing.
  const text = yield* listed.text;
  const payload = yield* decodeToolsListPayload(text.match(/\{.*\}/s)![0]);
  return payload.result.tools;
});

const serveProductionMcp = HttpRouter.serve(
  McpHttpServer.layer.pipe(Layer.provide(McpSessionRegistry.layer)),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provide(
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed("environment-catalog" as never),
    }),
  ),
  Layer.provide(PreviewAutomationBroker.layer),
  Layer.provide(PreviewBrowser.layer),
  Layer.provide(layerStubServices),
  Layer.build,
);

const layerHttpTest = Layer.mergeAll(
  NodeHttpServer.layerTest,
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-catalog-mcp-" }).pipe(
    Layer.provide(NodeServices.layer),
  ),
  NodeServices.layer,
);

const providerInstanceId = ProviderInstanceId.make("codex");
const fullAccessSession = {
  threadId: ThreadId.make("thread-catalog-full"),
  providerInstanceId,
  capabilities: new Set(["preview", "device"] as const),
};
const CAPABILITY_TOOL = /^(preview_|t3_preview_|device_|loom_device_qa_)/;

it.effect("lists each session only the tools its credential can call", () =>
  Effect.gen(function* () {
    yield* serveProductionMcp;
    const limited = (yield* listToolsOverHttp({
      threadId: ThreadId.make("thread-catalog-limited"),
      providerInstanceId,
      browserToolsAvailable: false,
    })).map((tool) => tool.name);
    const full = (yield* listToolsOverHttp(fullAccessSession)).map((tool) => tool.name);

    expect(limited).toEqual(expect.arrayContaining(["delegate_task", "loom_preview_link_share"]));
    expect(limited.filter((name) => CAPABILITY_TOOL.test(name))).toEqual([]);
    expect(full).toEqual(
      expect.arrayContaining([
        "preview_status",
        "preview_snapshot",
        "t3_preview_list",
        "device_list",
        "device_screenshot",
        "loom_device_qa_flow",
      ]),
    );
    expect(full.filter((name) => !limited.includes(name)).sort()).toEqual(
      full.filter((name) => CAPABILITY_TOOL.test(name)).sort(),
    );
  }).pipe(Effect.scoped, Effect.provide(layerHttpTest)),
);

/**
 * Agents read every listed tool's name, description and input schema; clients also parse each
 * output schema. Raise a budget only on purpose, after cutting what new text repeats.
 */
const AGENT_VISIBLE_BUDGET_BYTES = 420_000;
const TOOL_BUDGET_BYTES = 32 * 1024;
// Its output schema inlines a whole thread projection, with the turn item union twice.
const OVERSIZED_TOOLS = new Set(["loom_library_history"]);

it.effect("keeps the full tool catalog within its byte budgets", () =>
  Effect.gen(function* () {
    yield* serveProductionMcp;
    const sized = (yield* listToolsOverHttp(fullAccessSession)).map((tool) => ({
      name: tool.name,
      bytes: Buffer.byteLength(JSON.stringify(tool)),
      agentVisibleBytes: Buffer.byteLength(
        JSON.stringify(
          Object.fromEntries(Object.entries(tool).filter(([key]) => key !== "outputSchema")),
        ),
      ),
    }));
    const largest = (key: "bytes" | "agentVisibleBytes") =>
      sized
        .toSorted((left, right) => right[key] - left[key])
        .slice(0, 5)
        .map((tool) => `${tool.name} ${tool[key]}`)
        .join(", ");

    const agentVisible = sized.reduce((total, tool) => total + tool.agentVisibleBytes, 0);
    expect(
      agentVisible,
      `agents read ${agentVisible} bytes of tool definitions; largest: ${largest("agentVisibleBytes")}`,
    ).toBeLessThanOrEqual(AGENT_VISIBLE_BUDGET_BYTES);
    expect(
      sized
        .filter((tool) => tool.bytes > TOOL_BUDGET_BYTES && !OVERSIZED_TOOLS.has(tool.name))
        .map((tool) => `${tool.name} ${tool.bytes}`),
      `largest tools: ${largest("bytes")}`,
    ).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(layerHttpTest)),
);

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const listMessage = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  result: {
    tools: [
      { name: "preview_status", inputSchema: { type: "object" } },
      { name: "delegate_task", inputSchema: { type: "object" } },
      { name: "device_list", inputSchema: { type: "object" } },
    ],
    nextCursor: "page-2",
  },
});
const progress = JSON.stringify({
  jsonrpc: "2.0",
  method: "notifications/progress",
  params: { progressToken: 1, progress: 1 },
});
const scope = (
  capabilities: ReadonlyArray<McpCapability>,
  caller: "thread" | "client" = "thread",
): McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-tool-list"),
  requestNamespace: "session-tool-list",
  thread:
    caller === "thread"
      ? {
          threadId: ThreadId.make("thread-tool-list"),
          providerSessionId: "session-tool-list",
          providerInstanceId: ProviderInstanceId.make("codex"),
        }
      : undefined,
  client:
    caller === "client"
      ? { sessionId: "client-tool-list", label: "Outside agent", access: "full-access" }
      : undefined,
  capabilities: new Set(capabilities),
  issuedAt: 1,
});
const bodyText = (response: HttpServerResponse.HttpServerResponse) =>
  response.body._tag === "Uint8Array"
    ? Effect.succeed(decoder.decode(response.body.body))
    : response.body._tag === "Stream"
      ? Stream.runCollect(response.body.stream.pipe(Stream.orDie)).pipe(
          Effect.map((chunks) => chunks.map((chunk) => decoder.decode(chunk)).join("")),
        )
      : Effect.die(new Error(`unexpected ${response.body._tag} body`));
const kept = listMessage.replace(
  /\{"name":"preview_status"[^}]*\}\},|,\{"name":"device_list"[^}]*\}\}/g,
  "",
);

it.effect.each([
  {
    framing: "JSON",
    response: HttpServerResponse.uint8Array(encoder.encode(`${listMessage}\n`), {
      contentType: "application/json",
      headers: { "mcp-session-id": "session-1" },
    }),
    expected: `${kept}\n`,
  },
  {
    framing: "SSE",
    response: HttpServerResponse.uint8Array(
      encoder.encode(`data: ${progress}\n\ndata: ${listMessage}\n\n`),
      { contentType: "text/event-stream", headers: { "mcp-session-id": "session-1" } },
    ),
    expected: `data: ${progress}\n\ndata: ${kept}\n\n`,
  },
  {
    framing: "streamed SSE",
    response: HttpServerResponse.stream(
      Stream.make(
        encoder.encode(`data: ${progress}\n\n`),
        encoder.encode(`data: ${listMessage}\n\n`),
      ),
      { contentType: "text/event-stream", headers: { "mcp-session-id": "session-1" } },
    ),
    expected: `data: ${progress}\n\ndata: ${kept}\n\n`,
  },
])("drops tools the session cannot call from a $framing tools/list", ({ response, expected }) =>
  Effect.gen(function* () {
    const filtered = hideUnusableTools(response, scope([]));
    expect(yield* bodyText(filtered)).toBe(expected);
    expect(filtered.headers["mcp-session-id"]).toBe("session-1");
    expect(filtered.headers["content-type"]).toBe(response.headers["content-type"]);
    if (filtered.body._tag === "Uint8Array") {
      expect(filtered.headers["content-length"]).toBe(String(filtered.body.contentLength));
    }
  }),
);

it("keeps every tool for a thread holding both capabilities", () => {
  const response = HttpServerResponse.uint8Array(encoder.encode(`${listMessage}\n`), {
    contentType: "application/json",
  });
  expect(hideUnusableTools(response, scope(["preview", "device"]))).toBe(response);
});

it.effect("hides thread-only tools from an outside client even when it holds the capability", () =>
  Effect.gen(function* () {
    const response = HttpServerResponse.uint8Array(encoder.encode(`${listMessage}\n`), {
      contentType: "application/json",
    });
    expect(
      yield* bodyText(hideUnusableTools(response, scope(["preview", "device"], "client"))),
    ).toBe(`${kept}\n`);
  }),
);

it("passes tool call results through untouched", () => {
  const result = HttpServerResponse.uint8Array(
    encoder.encode(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        result: {
          content: [{ type: "text", text: "ok" }],
          structuredContent: { tools: [{ name: "preview_status", inputSchema: {} }] },
        },
      })}\n`,
    ),
    { contentType: "application/json" },
  );
  expect(hideUnusableTools(result, scope([]))).toBe(result);
});
