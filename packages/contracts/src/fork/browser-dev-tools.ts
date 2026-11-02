import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import {
  PreviewAutomationConsoleEntry,
  PreviewAutomationNetworkEntry,
} from "../previewAutomation.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";

export const DEV_ENVIRONMENT_WS_METHODS = {
  httpSend: "loom.browser-dev-tools.httpSend",
  httpHistory: "loom.browser-dev-tools.httpHistory",
  httpClear: "loom.browser-dev-tools.httpClear",
  diagnostics: "loom.browser-dev-tools.diagnostics",
  snapshot: "loom.browser-dev-tools.snapshot",
  watch: "loom.browser-dev-tools.watch",
  start: "loom.browser-dev-tools.start",
  control: "loom.browser-dev-tools.control",
  containers: "loom.browser-dev-tools.containers",
  compose: "loom.browser-dev-tools.compose",
  database: "loom.browser-dev-tools.database",
  databaseUrl: "loom.browser-dev-tools.databaseUrl",
} as const;
export const DevTarget = Schema.Struct({ threadId: ThreadId });
export type DevTarget = typeof DevTarget.Type;
export const DevServerCandidate = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  command: Schema.String,
  previewUrl: Schema.NullOr(Schema.String),
  autoOpenPreview: Schema.Boolean,
});
export type DevServerCandidate = typeof DevServerCandidate.Type;
export const DevServerRun = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  name: Schema.String,
  command: Schema.String,
  root: Schema.String,
  threadId: ThreadId,
  terminalId: Schema.String,
  state: Schema.Literals(["starting", "ready", "running", "exited", "stopped", "error"]),
  urls: Schema.Array(Schema.String),
  output: Schema.String,
  exitCode: Schema.NullOr(Schema.Number),
  startedAt: Schema.String,
});
export type DevServerRun = typeof DevServerRun.Type;
export const DevSnapshot = Schema.Struct({
  root: Schema.String,
  candidates: Schema.Array(DevServerCandidate),
  runs: Schema.Array(DevServerRun),
});
export type DevSnapshot = typeof DevSnapshot.Type;
export const DevBrowserDiagnostics = Schema.Struct({
  url: Schema.String,
  consoleEntries: Schema.Array(PreviewAutomationConsoleEntry),
  networkEntries: Schema.Array(PreviewAutomationNetworkEntry),
});
export type DevBrowserDiagnostics = typeof DevBrowserDiagnostics.Type;
export const DevDiagnosticsTarget = Schema.Struct({
  ...DevTarget.fields,
  tabId: TrimmedNonEmptyString,
});
export type DevDiagnosticsTarget = typeof DevDiagnosticsTarget.Type;
export const DevStart = Schema.Struct({
  ...DevTarget.fields,
  key: TrimmedNonEmptyString,
  requestId: TrimmedNonEmptyString,
});
export type DevStart = typeof DevStart.Type;
export const DevControl = Schema.Struct({
  ...DevTarget.fields,
  runId: TrimmedNonEmptyString,
  action: Schema.Literals(["stop", "restart"]),
  requestId: TrimmedNonEmptyString,
  confirmOtherThread: Schema.optionalKey(Schema.Boolean),
});
export type DevControl = typeof DevControl.Type;
export const DevComposeFile = Schema.Struct({ path: Schema.String });
export const DevContainer = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  service: Schema.String,
  state: Schema.String,
  health: Schema.String,
  ports: Schema.String,
});
export type DevContainer = typeof DevContainer.Type;
export const DevDatabaseKind = Schema.Literals(["postgres", "valkey"]);
export type DevDatabaseKind = typeof DevDatabaseKind.Type;
export const DevDatabase = Schema.Struct({
  kind: DevDatabaseKind,
  name: Schema.String,
  state: Schema.String,
  port: Schema.NullOr(Schema.Number),
  hasData: Schema.Boolean,
});
export type DevDatabase = typeof DevDatabase.Type;
export const DevContainers = Schema.Struct({
  root: Schema.String,
  docker: Schema.Boolean,
  composeFiles: Schema.Array(DevComposeFile),
  services: Schema.Array(DevContainer),
  databases: Schema.Array(DevDatabase),
  output: Schema.String,
});
export type DevContainers = typeof DevContainers.Type;
export const DevCompose = Schema.Struct({
  ...DevTarget.fields,
  file: TrimmedNonEmptyString,
  action: Schema.Literals(["up", "down", "restart", "logs"]),
  service: Schema.optionalKey(TrimmedNonEmptyString),
});
export type DevCompose = typeof DevCompose.Type;
export const DevDatabaseAction = Schema.Struct({
  ...DevTarget.fields,
  kind: DevDatabaseKind,
  action: Schema.Literals(["create", "start", "stop", "remove", "logs"]),
  deleteData: Schema.optionalKey(Schema.Boolean),
});
export type DevDatabaseAction = typeof DevDatabaseAction.Type;
export const DevHttpMethod = Schema.Literals([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);
export type DevHttpMethod = typeof DevHttpMethod.Type;
export const DevHttpRequest = Schema.Struct({
  method: DevHttpMethod,
  url: Schema.String.check(Schema.isMaxLength(8192)),
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String.check(Schema.isMaxLength(131072)),
  timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 60000 })),
});
export type DevHttpRequest = typeof DevHttpRequest.Type;
export const DevHttpSend = Schema.Struct({
  ...DevTarget.fields,
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  request: DevHttpRequest,
});
export type DevHttpSend = typeof DevHttpSend.Type;
export const DevHttpExchange = Schema.Struct({
  id: Schema.String,
  request: DevHttpRequest,
  startedAt: Schema.String,
  durationMs: Schema.Number,
  status: Schema.NullOr(Schema.Number),
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
  byteLength: Schema.Number,
  truncated: Schema.Boolean,
  binary: Schema.Boolean,
  error: Schema.NullOr(Schema.Literals(["timeout", "network"])),
});
export type DevHttpExchange = typeof DevHttpExchange.Type;
export const DevHttpSummary = Schema.Struct({
  id: Schema.String,
  request: Schema.Struct({ method: DevHttpMethod, url: Schema.String }),
  startedAt: Schema.String,
  durationMs: Schema.Number,
  status: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.Literals(["timeout", "network"])),
});
export type DevHttpSummary = typeof DevHttpSummary.Type;
export const DevHttpHistoryTarget = Schema.Struct({
  ...DevTarget.fields,
  exchangeId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type DevHttpHistoryTarget = typeof DevHttpHistoryTarget.Type;
export const DevHttpHistory = Schema.Struct({
  exchanges: Schema.Array(DevHttpSummary),
  selected: Schema.NullOr(DevHttpExchange),
});
export type DevHttpHistory = typeof DevHttpHistory.Type;
export class DevHttpError extends Schema.TaggedError<DevHttpError>()("DevHttpError", {
  reason: Schema.Literals([
    "invalid-request",
    "history-unavailable",
    "request-conflict",
    "request-incomplete",
    "history-pruned",
  ]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    const messages: Record<typeof this.reason, string> = {
      "invalid-request":
        "Use an HTTP or HTTPS URL, valid headers, and a body of at most 128 KiB. GET and HEAD cannot send a body. Put authentication in headers rather than the URL.",
      "history-unavailable":
        "Request history could not be read or saved on this computer. No new request was sent when its receipt could not be saved.",
      "request-conflict": "This request ID was already used with different inputs.",
      "request-incomplete":
        "This request may already have reached the target. Its response is unavailable. A new request ID sends a new request.",
      "history-pruned":
        "This request was already sent, but its response was cleared or expired from history. A new request ID sends a new request.",
    };
    return messages[this.reason];
  }
}
export class DevEnvironmentError extends Schema.TaggedError<DevEnvironmentError>()(
  "DevEnvironmentError",
  {
    reason: Schema.Literals([
      "thread-not-found",
      "checkout-unavailable",
      "candidate-not-found",
      "run-not-found",
      "confirm-other-thread",
      "request-conflict",
      "terminal-failed",
      "docker-unavailable",
      "command-failed",
      "unsafe-compose",
      "ownership-conflict",
      "database-not-found",
      "secret-unavailable",
      "unsupported-platform",
      "browser-tab-unavailable",
    ]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    const messages: Record<typeof this.reason, string> = {
      "thread-not-found": "This conversation is unavailable.",
      "checkout-unavailable": "This checkout is unavailable on the execution computer.",
      "candidate-not-found":
        "This run command changed or is no longer available. Refresh the commands.",
      "run-not-found": "This run does not belong to this checkout.",
      "confirm-other-thread": "Confirm stopping the run owned by another conversation.",
      "request-conflict": "This request ID was already used with different inputs.",
      "terminal-failed": "The dev server terminal could not be opened or controlled.",
      "docker-unavailable":
        "Docker is not available on this computer. Start its container runtime and refresh.",
      "command-failed":
        "The container command failed. Inspect the operation output and refresh its state before retrying.",
      "unsafe-compose":
        "This Compose file uses explicit container names or external resources. Use checkout-scoped resources for an isolated development stack.",
      "ownership-conflict":
        "A resource with this name exists outside this checkout's managed environment.",
      "database-not-found": "This checkout has no managed database of that kind.",
      "secret-unavailable": "The database credential is unavailable on this computer.",
      "browser-tab-unavailable":
        "This Browser tab is unavailable. Open the app in Browser and refresh diagnostics.",
      "unsupported-platform": "This shell is not supported for managed dev-server commands.",
    };
    return messages[this.reason];
  }
}
const error = Schema.Union([DevEnvironmentError, EnvironmentAuthorizationError]);
const httpError = Schema.Union([DevEnvironmentError, DevHttpError, EnvironmentAuthorizationError]);
const M = DEV_ENVIRONMENT_WS_METHODS;
export const DevEnvironmentRpcGroup = RpcGroup.make(
  Rpc.make(M.httpSend, { payload: DevHttpSend, success: DevHttpExchange, error: httpError }),
  Rpc.make(M.httpHistory, {
    payload: DevHttpHistoryTarget,
    success: DevHttpHistory,
    error: httpError,
  }),
  Rpc.make(M.httpClear, { payload: DevTarget, success: DevHttpHistory, error: httpError }),
  Rpc.make(M.diagnostics, { payload: DevDiagnosticsTarget, success: DevBrowserDiagnostics, error }),
  Rpc.make(M.snapshot, { payload: DevTarget, success: DevSnapshot, error }),
  Rpc.make(M.watch, { payload: DevTarget, success: DevSnapshot, error, stream: true }),
  Rpc.make(M.start, { payload: DevStart, success: DevServerRun, error }),
  Rpc.make(M.control, { payload: DevControl, success: DevServerRun, error }),
  Rpc.make(M.containers, { payload: DevTarget, success: DevContainers, error }),
  Rpc.make(M.compose, { payload: DevCompose, success: DevContainers, error }),
  Rpc.make(M.database, { payload: DevDatabaseAction, success: DevContainers, error }),
  Rpc.make(M.databaseUrl, {
    payload: Schema.Struct({ ...DevTarget.fields, kind: DevDatabaseKind }),
    success: Schema.Struct({ url: Schema.String, hostNote: Schema.String }),
    error,
  }),
);
