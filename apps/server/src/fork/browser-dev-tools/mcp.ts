import { DevRequestsService } from "./DevRequestsService.ts";
import {
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ThreadId,
} from "@t3tools/contracts";
import {
  DevHttpSend,
  DevHttpHistory,
  DevHttpHistoryTarget,
  DevHttpExchange,
  DevHttpError,
  DevEnvironmentError,
  DevSnapshot,
  DevServerRun,
  DevContainers,
  DevStart,
  DevControl,
  DevCompose,
  DevDatabaseAction,
  DevBrowserDiagnostics,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { readThread } from "../../mcp/threadAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { DevEnvironmentService } from "./DevEnvironmentService.ts";
import { DevContainersService } from "./DevContainersService.ts";
import { DevDiagnosticsService } from "./DevDiagnosticsService.ts";
const target = {
  environmentId: OrchestratorMcpEnvironmentTarget,
  threadId: Schema.optionalKey(ThreadId),
};
const failure = Schema.Union([DevEnvironmentError, DevHttpError, OrchestratorMcpFailure]);
const dependencies = [McpInvocationContext, ThreadManagementService];
export const DevEnvironmentToolkit = Toolkit.make(
  Tool.make("loom_dev_request", {
    description:
      "Send one HTTP request from this conversation's execution computer, including its local development ports. Use a stable requestId and identical inputs after a lost response; retries reuse the recorded response rather than sending twice. HTTP/HTTPS only, no automatic redirects or retries. Body limit 128 KiB, response preview 256 KiB, timeout at most 60 seconds. Returned and saved authentication headers and credential query fields are redacted. Requires execution authority; methods can change the target.",
    parameters: Schema.Struct({ ...DevHttpSend.fields, ...target }),
    success: DevHttpExchange,
    failure,
    dependencies,
  }),
  Tool.make("loom_dev_request_history", {
    description:
      "Read the latest 50 HTTP exchange summaries saved for this checkout on its execution computer. Pass exchangeId to load one response preview; authentication headers are redacted. Omit threadId for this conversation. Reading history never sends a request. Requires the same execution authority as the request lab.",
    parameters: Schema.Struct({ ...DevHttpHistoryTarget.fields, ...target }),
    success: DevHttpHistory,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_dev_request_clear", {
    description:
      "Clear saved HTTP exchange payloads for this checkout on the selected execution computer. This includes other conversations sharing the same checkout. Use only when authorized to clear that history. Retains bounded request-ID receipts so a lost response is not automatically resent. Does not change the target server or Browser capture.",
    parameters: Schema.Struct(target),
    success: DevHttpHistory,
    failure,
    dependencies,
  }),
  Tool.make("loom_dev_servers", {
    description:
      "Read this checkout's run commands, managed dev servers, detected URLs, bounded output and exit codes. Omit threadId for this conversation. Commands run on the selected execution computer. A different worktree has its own runs.",
    parameters: Schema.Struct(target),
    success: DevSnapshot,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_dev_start", {
    description:
      "Start an existing checkout command by key from loom_dev_servers. Save requestId and reuse the same inputs after a lost response. Reuses an active run for that command on this checkout. Read back status before opening the URL; a starting run is not ready yet.",
    parameters: Schema.Struct({ ...DevStart.fields, ...target }),
    success: DevServerRun,
    failure,
    dependencies,
  }).annotate(Tool.Destructive, false),
  Tool.make("loom_dev_control", {
    description:
      "Stop or restart an exact run from loom_dev_servers. Use a stable requestId for retries. A run from another checkout is refused. Set confirmOtherThread only when the user authorized interrupting that other conversation's run. Stopping closes only the recorded terminal and its children.",
    parameters: Schema.Struct({ ...DevControl.fields, ...target }),
    success: DevServerRun,
    failure,
    dependencies,
  }),
  Tool.make("loom_dev_containers", {
    description:
      "Read Docker readiness, this checkout's Compose stack and its managed Postgres/Valkey databases. Read-only; no containers are started or changed. Database credentials are omitted.",
    parameters: Schema.Struct(target),
    success: DevContainers,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_dev_compose", {
    description:
      "Start, stop, restart or read logs for a discovered Compose file in this checkout. Uses an isolated checkout-specific project name; refuses explicit container names and external shared resources. down preserves data volumes. This operates on development services on the selected computer.",
    parameters: Schema.Struct({ ...DevCompose.fields, ...target }),
    success: DevContainers,
    failure,
    dependencies,
  }),
  Tool.make("loom_dev_database", {
    description:
      "Create, start, stop, remove or read logs for this checkout's managed Postgres or Valkey. Repeating create reuses the database. Ports bind only to the execution computer's loopback. remove preserves data unless deleteData is explicitly authorized; it never removes another checkout's resources. Credentials are kept on the execution computer and omitted here.",
    parameters: Schema.Struct({ ...DevDatabaseAction.fields, ...target }),
    success: DevContainers,
    failure,
    dependencies,
  }),
  Tool.make("loom_dev_diagnostics", {
    description:
      "Read console messages and network results already captured by a Browser tab in this conversation. Pass tabId from preview_status. Does not navigate, screenshot or take control of the page. URLs omit credentials and queries; results are bounded.",
    parameters: Schema.Struct({ ...target, tabId: Schema.String }),
    success: DevBrowserDiagnostics,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
);
export const devEnvironmentHandlers = McpToolAccess.toLayer(
  DevEnvironmentToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const inRuntime = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    const threadIdFor = Effect.fn("DevEnvironment.mcpTarget")(function* (threadId?: ThreadId) {
      return (yield* readThread(threadId)).projection.thread.id;
    });
    return {
      loom_dev_request: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const threadId = yield* threadIdFor(input.threadId);
          return yield* inRuntime(
            Effect.flatMap(DevRequestsService, (requests) => requests.send({ ...input, threadId })),
          );
        }),
      ),
      loom_dev_request_history: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const threadId = yield* threadIdFor(input.threadId);
          return yield* inRuntime(
            Effect.flatMap(DevRequestsService, (requests) =>
              requests.history({ ...input, threadId }),
            ),
          );
        }),
      ),
      loom_dev_request_clear: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const threadId = yield* threadIdFor(input.threadId);
          return yield* inRuntime(
            Effect.flatMap(DevRequestsService, (requests) => requests.clear({ threadId })),
          );
        }),
      ),
      loom_dev_servers: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const threadId = yield* threadIdFor(input.threadId);
          return yield* inRuntime(
            Effect.flatMap(DevEnvironmentService, (dev) => dev.snapshot({ threadId })),
          );
        }),
      ),
      loom_dev_start: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const threadId = yield* threadIdFor(input.threadId);
          return yield* inRuntime(
            Effect.flatMap(DevEnvironmentService, (dev) => dev.start({ ...input, threadId })),
          );
        }),
      ),
      loom_dev_control: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const threadId = yield* threadIdFor(input.threadId);
          return yield* inRuntime(
            Effect.flatMap(DevEnvironmentService, (dev) => dev.control({ ...input, threadId })),
          );
        }),
      ),
      loom_dev_containers: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const threadId = yield* threadIdFor(input.threadId);
          return yield* inRuntime(
            Effect.flatMap(DevContainersService, (dev) => dev.list({ threadId })),
          );
        }),
      ),
      loom_dev_compose: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const threadId = yield* threadIdFor(input.threadId);
          return yield* inRuntime(
            Effect.flatMap(DevContainersService, (dev) => dev.compose({ ...input, threadId })),
          );
        }),
      ),
      loom_dev_database: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const threadId = yield* threadIdFor(input.threadId);
          return yield* inRuntime(
            Effect.flatMap(DevContainersService, (dev) => dev.database({ ...input, threadId })),
          );
        }),
      ),
      loom_dev_diagnostics: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const threadId = yield* threadIdFor(input.threadId);
          return yield* inRuntime(
            Effect.flatMap(DevDiagnosticsService, (dev) =>
              dev.read({ threadId, tabId: input.tabId }),
            ),
          );
        }),
      ),
    };
  }),
);
