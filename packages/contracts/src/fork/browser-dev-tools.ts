import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import {
  PreviewAutomationConsoleEntry,
  PreviewAutomationNetworkEntry,
} from "../previewAutomation.ts";
import { VaultError } from "./vault-core.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { EnvironmentId, ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";

export const DEV_ENVIRONMENT_WS_METHODS = {
  apiAuthor: "loom.browser-dev-tools.apiAuthor",
  apiList: "loom.browser-dev-tools.apiList",
  apiImport: "loom.browser-dev-tools.apiImport",
  apiRead: "loom.browser-dev-tools.apiRead",
  apiEnvironment: "loom.browser-dev-tools.apiEnvironment",
  apiSaveEnvironment: "loom.browser-dev-tools.apiSaveEnvironment",
  apiRun: "loom.browser-dev-tools.apiRun",
  apiSaveRequest: "loom.browser-dev-tools.apiSaveRequest",
  apiExport: "loom.browser-dev-tools.apiExport",
  apiRemove: "loom.browser-dev-tools.apiRemove",
  httpSend: "loom.browser-dev-tools.httpSend",
  httpHistory: "loom.browser-dev-tools.httpHistory",
  httpBaseline: "loom.browser-dev-tools.httpBaseline",
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
  body: Schema.String.check(Schema.isMaxLength(174764)),
  bodyEncoding: Schema.optionalKey(Schema.Literal("base64")),
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
export const DevApiVaultBinding = Schema.Struct({
  environmentId: EnvironmentId,
  itemId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)),
  label: Schema.String,
  origin: Schema.String.check(Schema.isMaxLength(2048)),
  version: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type DevApiVaultBinding = typeof DevApiVaultBinding.Type;
export const DevApiVariable = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
  secret: Schema.Boolean,
  vault: Schema.optionalKey(DevApiVaultBinding),
});
export type DevApiVariable = typeof DevApiVariable.Type;
export const DevApiSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({ kind: Schema.Literal("json"), id: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("dotenv"), path: Schema.String }),
]);
export type DevApiSource = typeof DevApiSource.Type;
export const DevApiRequestSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  folders: Schema.Array(Schema.String),
  method: Schema.String,
});
export const DevApiWorkspace = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  requestCount: Schema.Number,
  environmentCount: Schema.Number,
});
export type DevApiWorkspace = typeof DevApiWorkspace.Type;
export const DevApiWorkspaceTarget = Schema.Struct({
  ...DevTarget.fields,
  workspaceId: Schema.String,
});
export type DevApiWorkspaceTarget = typeof DevApiWorkspaceTarget.Type;
export const DevApiRead = Schema.Struct({
  ...DevApiWorkspaceTarget.fields,
  requestKey: Schema.optionalKey(Schema.String),
});
export type DevApiRead = typeof DevApiRead.Type;
export const DevApiDetails = Schema.Struct({
  workspace: DevApiWorkspace,
  revision: Schema.String,
  requests: Schema.Array(DevApiRequestSummary),
  environments: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  dotenvFiles: Schema.Array(Schema.String),
  selected: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      sourceJson: Schema.String,
      endpoint: Schema.String,
      variables: Schema.optionalKey(Schema.Array(DevApiVariable)),
      bodyContentType: Schema.NullOr(Schema.String),
      preScripts: Schema.Array(Schema.String),
      testScripts: Schema.Array(Schema.String),
    }),
  ),
});
export type DevApiDetails = typeof DevApiDetails.Type;
export const DevApiImport = Schema.Struct({
  ...DevTarget.fields,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  files: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      content: Schema.String.check(Schema.isMaxLength(16777216)),
    }),
  ),
});
export type DevApiImport = typeof DevApiImport.Type;
export const DevApiAuthor = Schema.Struct({
  ...DevTarget.fields,
  action: Schema.Literals(["workspace", "request", "folder", "curl", "openapi-preview", "openapi-apply"]),
  workspaceId: Schema.optionalKey(Schema.String),
  expectedRevision: Schema.optionalKey(Schema.String),
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  folders: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(200))).check(Schema.isMaxLength(30)),
  content: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(16777216))),
});
export type DevApiAuthor = typeof DevApiAuthor.Type;
export const DevApiAuthorResult = Schema.Struct({
  details: Schema.NullOr(DevApiDetails),
  changes: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, kind: Schema.Literals(["added", "changed", "removed", "customized"]) })),
});
export type DevApiAuthorResult = typeof DevApiAuthorResult.Type;
export const DevApiEnvironmentTarget = Schema.Struct({
  ...DevApiWorkspaceTarget.fields,
  source: DevApiSource,
});
export type DevApiEnvironmentTarget = typeof DevApiEnvironmentTarget.Type;
export const DevApiEnvironment = Schema.Struct({
  revision: Schema.String,
  variables: Schema.Array(DevApiVariable),
});
export type DevApiEnvironment = typeof DevApiEnvironment.Type;
export const DevApiSaveEnvironment = Schema.Struct({
  ...DevApiEnvironmentTarget.fields,
  patch: Schema.optionalKey(Schema.Boolean),
  expectedRevision: Schema.String,
  variables: Schema.Array(DevApiVariable),
});
export type DevApiSaveEnvironment = typeof DevApiSaveEnvironment.Type;
export const DevApiSaveRequest = Schema.Struct({
  ...DevApiWorkspaceTarget.fields,
  requestKey: Schema.String,
  expectedRevision: Schema.String,
  sourceJson: Schema.String.check(Schema.isMaxLength(1048576)),
});
export type DevApiSaveRequest = typeof DevApiSaveRequest.Type;
export const DevApiExport = Schema.Struct({
  files: Schema.Array(Schema.Struct({ name: Schema.String, content: Schema.String })),
});
export type DevApiExport = typeof DevApiExport.Type;
export const DevApiUpload = Schema.Struct({
  fieldIndex: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 999 })),
  fileName: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  contentType: Schema.String.check(Schema.isMaxLength(200)),
  base64: Schema.String.check(Schema.isMaxLength(174764)),
});
export type DevApiUpload = typeof DevApiUpload.Type;
export const DevApiRun = Schema.Struct({
  ...DevApiEnvironmentTarget.fields,
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  requestKey: Schema.String,
  expectedRevision: Schema.String,
  environmentRevision: Schema.String,
  bodyBase64: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(174764))),
  uploads: Schema.optionalKey(Schema.Array(DevApiUpload).check(Schema.isMaxLength(32))),
  requestOverride: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1048576))),
});
export type DevApiRun = typeof DevApiRun.Type;
export const DevApiRunResult = Schema.Struct({
  exchange: DevHttpExchange,
  checks: Schema.Array(Schema.Struct({ name: Schema.String, passed: Schema.Boolean })),
  environmentUpdated: Schema.Boolean,
});
export type DevApiRunResult = typeof DevApiRunResult.Type;
export class DevApiError extends Schema.TaggedError<DevApiError>()("DevApiError", {
  reason: Schema.Literals([
    "invalid-format",
    "unsupported-version",
    "unsupported-auth",
    "unsupported-body",
    "invalid-upload",
    "upload-too-large",
    "unsupported-method",
    "missing-variable",
    "variable-cycle",
    "storage-unavailable",
    "not-found",
    "revision-conflict",
    "script-failed",
    "outcome-unknown",
    "invalid-path",
    "file-too-large",
    "request-conflict",
    "vault-destination",
    "vault-required",
  ]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    const messages: Record<typeof this.reason, string> = {
      "vault-destination":
        "A Vault value is bound to a different API origin. Choose the correct environment or update its binding before sending.",
      "vault-required":
        "This request needs a permitted Vault connection on the execution computer.",
      "invalid-format": "Use native Hoppscotch collection or environment JSON files.",
      "unsupported-version":
        "This Hoppscotch schema version is not supported. Your source files are preserved.",
      "unsupported-auth":
        "This request's authentication type is not supported yet. Its native data is preserved.",
      "invalid-upload":
        "Choose files for each active multipart file field. File names, content types and encoded data must be valid.",
      "upload-too-large":
        "The complete encoded request, including multipart boundaries, must fit within 128 KiB. Choose smaller files or remove fields.",
      "unsupported-body":
        "This request needs a binary file or an unsupported body encoder. Its native data is preserved.",
      "unsupported-method": "This request uses an unsupported HTTP method.",
      "missing-variable":
        "A required request variable is missing. Select an environment and fill its values before sending.",
      "variable-cycle": "The selected variables contain a circular reference.",
      "storage-unavailable": "The API workspace could not be read or saved on this computer.",
      "not-found":
        "This API workspace, request or environment is unavailable. Refresh the workspace.",
      "revision-conflict":
        "The workspace or selected environment changed. Refresh it before saving or sending.",
      "script-failed":
        "A request script failed. Inspect its script and environment before retrying. A failed preparation script prevents dispatch.",
      "outcome-unknown":
        "This request may already have run. Its completed result is unavailable; it will not be sent again with the same request ID.",
      "invalid-path":
        "Choose a dotenv file inside this checkout. Paths escaping the checkout are refused.",
      "file-too-large": "The API import or dotenv file exceeds its supported size limit.",
      "request-conflict": "This request ID was already used with different inputs.",
    };
    return messages[this.reason];
  }
}
export const DevHttpBaseline = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  exchange: DevHttpExchange,
  ignoredPaths: Schema.Array(Schema.String.check(Schema.isMaxLength(300))).check(
    Schema.isMaxLength(100),
  ),
});
export const DevHttpBaselines = Schema.Struct({
  revision: Schema.String,
  baselines: Schema.Array(DevHttpBaseline),
});
export type DevHttpBaselines = typeof DevHttpBaselines.Type;
export const DevHttpBaselineAction = Schema.Struct({
  ...DevTarget.fields,
  action: Schema.Literals(["read", "pin", "remove"]),
  id: Schema.optionalKey(TrimmedNonEmptyString),
  name: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  exchangeId: Schema.optionalKey(Schema.String),
  expectedRevision: Schema.optionalKey(Schema.String),
  ignoredPaths: Schema.optionalKey(DevHttpBaseline.fields.ignoredPaths),
});
export type DevHttpBaselineAction = typeof DevHttpBaselineAction.Type;
export class DevHttpError extends Schema.TaggedError<DevHttpError>()("DevHttpError", {
  reason: Schema.Literals([
    "invalid-request",
    "history-unavailable",
    "request-conflict",
    "request-incomplete",
    "history-pruned",
    "revision-conflict",
  ]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    const messages: Record<typeof this.reason, string> = {
      "invalid-request":
        "Use an HTTP or HTTPS URL, valid headers, and a body of at most 128 KiB. GET and HEAD cannot send a body. Put authentication in headers rather than the URL.",
      "revision-conflict": "Baselines changed. Reload them before saving.",
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
const apiError = Schema.Union([
  VaultError,
  DevApiError,
  DevEnvironmentError,
  DevHttpError,
  EnvironmentAuthorizationError,
]);
export const DevEnvironmentRpcGroup = RpcGroup.make(
  Rpc.make(M.apiAuthor, { payload: DevApiAuthor, success: DevApiAuthorResult, error: apiError }),
  Rpc.make(M.apiSaveRequest, {
    payload: DevApiSaveRequest,
    success: DevApiDetails,
    error: apiError,
  }),
  Rpc.make(M.apiExport, { payload: DevApiWorkspaceTarget, success: DevApiExport, error: apiError }),
  Rpc.make(M.apiList, {
    payload: DevTarget,
    success: Schema.Array(DevApiWorkspace),
    error: apiError,
  }),
  Rpc.make(M.apiImport, { payload: DevApiImport, success: DevApiDetails, error: apiError }),
  Rpc.make(M.apiRead, { payload: DevApiRead, success: DevApiDetails, error: apiError }),
  Rpc.make(M.apiEnvironment, {
    payload: DevApiEnvironmentTarget,
    success: DevApiEnvironment,
    error: apiError,
  }),
  Rpc.make(M.apiSaveEnvironment, {
    payload: DevApiSaveEnvironment,
    success: DevApiEnvironment,
    error: apiError,
  }),
  Rpc.make(M.apiRun, { payload: DevApiRun, success: DevApiRunResult, error: apiError }),
  Rpc.make(M.apiRemove, { payload: DevApiWorkspaceTarget, success: Schema.Void, error: apiError }),
  Rpc.make(M.httpBaseline, {
    payload: DevHttpBaselineAction,
    success: DevHttpBaselines,
    error: httpError,
  }),
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
