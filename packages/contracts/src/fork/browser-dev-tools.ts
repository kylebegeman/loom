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
const M = DEV_ENVIRONMENT_WS_METHODS;
export const DevEnvironmentRpcGroup = RpcGroup.make(
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
