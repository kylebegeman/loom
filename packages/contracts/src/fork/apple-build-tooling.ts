import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { ProjectId, ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";

export const APPLE_BUILD_TOOLING_WS_METHODS = {
  status: "loom.apple-build-tooling.status",
  inspect: "loom.apple-build-tooling.inspect",
  destinations: "loom.apple-build-tooling.destinations",
  xcodegen: "loom.apple-build-tooling.xcodegen",
  readiness: "loom.apple-build-tooling.readiness",
  start: "loom.apple-build-tooling.start",
  cancel: "loom.apple-build-tooling.cancel",
  getRun: "loom.apple-build-tooling.getRun",
  watchRuns: "loom.apple-build-tooling.watchRuns",
  tailLog: "loom.apple-build-tooling.tailLog",
  getSettings: "loom.apple-build-tooling.getSettings",
  updateSettings: "loom.apple-build-tooling.updateSettings",
  clearHistory: "loom.apple-build-tooling.clearHistory",
  openResultBundle: "loom.apple-build-tooling.openResultBundle",
} as const;

/** Where the workspace lives. Threads resolve to their worktree or project root on the server. */
export const AppleWorkspaceRef = Schema.Struct({ threadId: ThreadId });
export type AppleWorkspaceRef = typeof AppleWorkspaceRef.Type;

export const AppleContainerKind = Schema.Literals(["workspace", "project", "xcodegen", "package"]);
export type AppleContainerKind = typeof AppleContainerKind.Type;

export const AppleContainer = Schema.Struct({
  kind: AppleContainerKind,
  /** Workspace-relative path: `App.xcworkspace`, `App.xcodeproj`, `project.yml`, `Package.swift`. */
  path: TrimmedNonEmptyString,
  name: Schema.String,
  /** For xcodegen: the project the spec generates, when it exists on disk. */
  generatedProjectPath: Schema.optional(Schema.String),
});
export type AppleContainer = typeof AppleContainer.Type;

export const AppleToolchain = Schema.Struct({
  platform: Schema.Literals(["darwin", "linux", "other"]),
  /** `Xcode 27.0 (27A266a)`. */
  xcodeVersion: Schema.NullOr(Schema.String),
  /** `xcode-select -p`. */
  developerDir: Schema.NullOr(Schema.String),
  developerDirIsCommandLineTools: Schema.Boolean,
  firstLaunchPending: Schema.Boolean,
  runtimes: Schema.Array(
    Schema.Struct({ platform: Schema.String, version: Schema.String, identifier: Schema.String }),
  ),
  tools: Schema.Struct({
    xcodegen: Schema.NullOr(Schema.String),
    xcbeautify: Schema.NullOr(Schema.String),
    mcpbridge: Schema.Boolean,
    /** First line of `xcrun mcp-server status`, or null. */
    mcpServerHeadless: Schema.NullOr(Schema.String),
    xtool: Schema.NullOr(Schema.String),
  }),
});
export type AppleToolchain = typeof AppleToolchain.Type;

export const AppleStatus = Schema.Struct({
  cwd: Schema.String,
  toolchain: AppleToolchain,
  containers: Schema.Array(AppleContainer),
  /** The directory walk stopped early (depth or entry limit). */
  truncated: Schema.Boolean,
  /** Runs go through the thread's lane: its build folder and the machine's build slots. */
  lane: Schema.NullOr(Schema.Struct({ name: Schema.String, buildPath: Schema.String })),
});
export type AppleStatus = typeof AppleStatus.Type;

export const AppleSchemeInfo = Schema.Struct({
  schemes: Schema.Array(Schema.String),
  targets: Schema.Array(Schema.String),
  configurations: Schema.Array(Schema.String),
  /** For the scheme named in the request. */
  testPlans: Schema.Array(Schema.String),
  /** Schemes whose file is under xcshareddata; others exist only in xcuserdata. */
  sharedSchemes: Schema.Array(Schema.String),
});
export type AppleSchemeInfo = typeof AppleSchemeInfo.Type;

export const AppleGenericPlatform = Schema.Literals([
  "iOS",
  "iOS Simulator",
  "macOS",
  "watchOS",
  "tvOS",
  "visionOS",
]);

export const AppleDestination = Schema.Union([
  Schema.TaggedStruct("simulator", {
    udid: Schema.String,
    name: Schema.String,
    /** Display runtime, for example `iOS 27.0`. */
    runtime: Schema.String,
    booted: Schema.Boolean,
  }),
  Schema.TaggedStruct("device", {
    /** Hardware UDID: taken by `devicectl --device` and `xcodebuild -destination id=`. */
    identifier: Schema.String,
    name: Schema.String,
    /** `iOS`, `iPadOS`, `watchOS`, ... */
    platform: Schema.String,
    osVersion: Schema.String,
    paired: Schema.Boolean,
    /** Null when devicectl does not report it. */
    developerModeEnabled: Schema.NullOr(Schema.Boolean),
    /** devicectl connection state for display (`connected`, `disconnected`, ...). */
    connection: Schema.NullOr(Schema.String),
  }),
  Schema.TaggedStruct("mac", {}),
  Schema.TaggedStruct("generic", { platform: AppleGenericPlatform }),
]);
export type AppleDestination = typeof AppleDestination.Type;

export const AppleRunKind = Schema.Literals([
  "build",
  "test",
  "run",
  "releaseBuild",
  "xcodegenGenerate",
  "swiftBuild",
  "swiftTest",
]);
export type AppleRunKind = typeof AppleRunKind.Type;

export const AppleRunStatus = Schema.Literals([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);
export type AppleRunStatus = typeof AppleRunStatus.Type;

export const AppleRunPhase = Schema.Literals([
  "resolving",
  "building",
  "testing",
  "installing",
  "launching",
  "summarizing",
  "done",
]);
export type AppleRunPhase = typeof AppleRunPhase.Type;

export const AppleRunRequest = Schema.Struct({
  workspace: AppleWorkspaceRef,
  kind: AppleRunKind,
  /** Required for every kind; the XcodeGen spec for xcodegenGenerate, `Package.swift` for swift*. */
  container: Schema.optional(AppleContainer),
  scheme: Schema.optional(Schema.String),
  configuration: Schema.optional(Schema.String),
  destination: Schema.optional(AppleDestination),
  testPlan: Schema.optional(Schema.String),
  /** xcodebuild: `<target>/<test identifier>`. swift test: the `swift test list` form. */
  onlyTesting: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(50))),
  /** Test runs: add `-retry-tests-on-failure -test-iterations N`. */
  retryFailedTests: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 }))),
});
export type AppleRunRequest = typeof AppleRunRequest.Type;

export const AppleIssue = Schema.Struct({
  severity: Schema.Literals(["error", "warning", "analyzer"]),
  message: Schema.String,
  target: Schema.optional(Schema.String),
  /** Workspace-relative when inside the workspace, else absolute. */
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Int),
});
export type AppleIssue = typeof AppleIssue.Type;

export const AppleTestFailure = Schema.Struct({
  testName: Schema.String,
  target: Schema.String,
  /** What "Test only this" passes back as `onlyTesting`. */
  identifier: Schema.String,
  message: Schema.String,
  /** From the log when known (swift test); xcresult summaries do not carry it. */
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Int),
});
export type AppleTestFailure = typeof AppleTestFailure.Type;

export const AppleTestResult = Schema.Literals([
  "Passed",
  "Failed",
  "Skipped",
  "Expected Failure",
  "unknown",
]);

export const AppleRunSummary = Schema.Struct({
  build: Schema.optional(
    Schema.Struct({
      status: Schema.String,
      errorCount: Schema.Int,
      warningCount: Schema.Int,
      /** Capped at 100, errors first. */
      issues: Schema.Array(AppleIssue),
    }),
  ),
  tests: Schema.optional(
    Schema.Struct({
      result: AppleTestResult,
      total: Schema.Int,
      passed: Schema.Int,
      failed: Schema.Int,
      skipped: Schema.Int,
      expectedFailures: Schema.Int,
      environment: Schema.String,
      /** Capped at 100. */
      failures: Schema.Array(AppleTestFailure),
    }),
  ),
  launched: Schema.optional(
    Schema.Struct({
      bundleId: Schema.String,
      appPath: Schema.String,
      destination: AppleDestination,
    }),
  ),
  xcodegen: Schema.optional(Schema.Struct({ generatedProject: Schema.String })),
  /** Set when the run failed before any result existed, or with a known cause. */
  failureReason: Schema.optional(Schema.String),
  /** A known cause the panel explains: code signing not set up, or the device unavailable. */
  hint: Schema.optional(Schema.Literals(["signing", "device-unavailable"])),
});
export type AppleRunSummary = typeof AppleRunSummary.Type;

export const AppleRunRecord = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  cwd: Schema.String,
  kind: AppleRunKind,
  request: AppleRunRequest,
  status: AppleRunStatus,
  phase: AppleRunPhase,
  startedBy: Schema.Literals(["user", "agent"]),
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  exitCode: Schema.NullOr(Schema.Int),
  /** Display only: the main command, shell-quoted. */
  commandLine: Schema.String,
  /** Counts for the history list; the full summary comes from getRun. */
  counts: Schema.Struct({ errors: Schema.Int, warnings: Schema.Int, failedTests: Schema.Int }),
  hasResultBundle: Schema.Boolean,
});
export type AppleRunRecord = typeof AppleRunRecord.Type;

export const AppleRunDetail = Schema.Struct({
  run: AppleRunRecord,
  summary: Schema.NullOr(AppleRunSummary),
  logPath: Schema.String,
  resultBundlePath: Schema.NullOr(Schema.String),
  /** Present only when requested: the last 256 KB of the raw log. */
  logTail: Schema.optional(Schema.String),
});
export type AppleRunDetail = typeof AppleRunDetail.Type;

export const AppleXcodegenReport = Schema.Struct({
  spec: Schema.String,
  valid: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  state: Schema.Literals([
    "in-sync",
    "out-of-date",
    "not-generated",
    "invalid",
    "xcodegen-missing",
  ]),
  /** Unified diff of project.pbxproj, capped at 200 KB; null when in sync. */
  diff: Schema.NullOr(Schema.String),
  diffTruncated: Schema.Boolean,
  /** Shared scheme files that differ, by name. */
  changedSchemes: Schema.Array(Schema.String),
});
export type AppleXcodegenReport = typeof AppleXcodegenReport.Type;

export const AppleReadinessSeverity = Schema.Literals(["pass", "warning", "fail", "unknown"]);
export type AppleReadinessSeverity = typeof AppleReadinessSeverity.Type;

export const AppleReadinessCheck = Schema.Struct({
  code: TrimmedNonEmptyString,
  title: Schema.String,
  severity: AppleReadinessSeverity,
  message: Schema.String,
});
export type AppleReadinessCheck = typeof AppleReadinessCheck.Type;

export const AppleReadinessReport = Schema.Struct({
  overall: AppleReadinessSeverity,
  checks: Schema.Array(AppleReadinessCheck),
});
export type AppleReadinessReport = typeof AppleReadinessReport.Type;

export const AppleBuildSettings = Schema.Struct({
  agentToolsEnabled: Schema.Boolean,
  useXcbeautify: Schema.Boolean,
  collectTestDiagnostics: Schema.Literals(["never", "on-failure"]),
  derivedData: Schema.Literals(["loom", "xcode-default"]),
  keepRunsPerProject: Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 200 })),
  openLaunchedSimulatorInDevicePanel: Schema.Boolean,
});
export type AppleBuildSettings = typeof AppleBuildSettings.Type;

export const AppleBuildSettingsPatch = Schema.Struct({
  agentToolsEnabled: Schema.optional(AppleBuildSettings.fields.agentToolsEnabled),
  useXcbeautify: Schema.optional(AppleBuildSettings.fields.useXcbeautify),
  collectTestDiagnostics: Schema.optional(AppleBuildSettings.fields.collectTestDiagnostics),
  derivedData: Schema.optional(AppleBuildSettings.fields.derivedData),
  keepRunsPerProject: Schema.optional(AppleBuildSettings.fields.keepRunsPerProject),
  openLaunchedSimulatorInDevicePanel: Schema.optional(
    AppleBuildSettings.fields.openLaunchedSimulatorInDevicePanel,
  ),
});
export type AppleBuildSettingsPatch = typeof AppleBuildSettingsPatch.Type;

export const DEFAULT_APPLE_BUILD_SETTINGS: AppleBuildSettings = {
  agentToolsEnabled: true,
  useXcbeautify: true,
  collectTestDiagnostics: "never",
  derivedData: "loom",
  keepRunsPerProject: 20,
  openLaunchedSimulatorInDevicePanel: true,
};

/** getSettings result: the settings plus what Loom stores on disk. */
export const AppleBuildSettingsView = Schema.Struct({
  settings: AppleBuildSettings,
  storage: Schema.Struct({
    runCount: Schema.Int,
    runsBytes: Schema.Number,
    derivedDataBytes: Schema.Number,
  }),
});
export type AppleBuildSettingsView = typeof AppleBuildSettingsView.Type;

export const AppleRunsEvent = Schema.Struct({ runs: Schema.Array(AppleRunRecord) });
export type AppleRunsEvent = typeof AppleRunsEvent.Type;

export const AppleLogChunk = Schema.Struct({
  offset: Schema.Int,
  text: Schema.String,
  done: Schema.Boolean,
});
export type AppleLogChunk = typeof AppleLogChunk.Type;

export class AppleBuildError extends Schema.TaggedError<AppleBuildError>()("AppleBuildError", {
  reason: Schema.Literals([
    "unsupported-platform",
    "workspace-not-found",
    "container-not-found",
    "tool-missing",
    "busy",
    "run-not-found",
    "invalid-request",
    "command-failed",
    "timeout",
    "disabled",
  ]),
  message: Schema.String,
}) {}

const errors = Schema.Union([AppleBuildError, EnvironmentAuthorizationError]);
const M = APPLE_BUILD_TOOLING_WS_METHODS;

export const AppleBuildToolingRpcGroup = RpcGroup.make(
  Rpc.make(M.status, { payload: AppleWorkspaceRef, success: AppleStatus, error: errors }),
  Rpc.make(M.inspect, {
    payload: Schema.Struct({
      workspace: AppleWorkspaceRef,
      container: AppleContainer,
      /** Test plans are listed for this scheme; omitted, `testPlans` is empty. */
      scheme: Schema.optional(Schema.String),
      refresh: Schema.optional(Schema.Boolean),
    }),
    success: AppleSchemeInfo,
    error: errors,
  }),
  Rpc.make(M.destinations, {
    payload: Schema.Struct({}),
    success: Schema.Array(AppleDestination),
    error: errors,
  }),
  Rpc.make(M.xcodegen, {
    payload: Schema.Struct({ workspace: AppleWorkspaceRef, spec: Schema.String }),
    success: AppleXcodegenReport,
    error: errors,
  }),
  Rpc.make(M.readiness, {
    payload: Schema.Struct({
      workspace: AppleWorkspaceRef,
      container: AppleContainer,
      scheme: Schema.String,
    }),
    success: AppleReadinessReport,
    error: errors,
  }),
  Rpc.make(M.start, { payload: AppleRunRequest, success: AppleRunRecord, error: errors }),
  Rpc.make(M.cancel, {
    payload: Schema.Struct({ runId: Schema.String }),
    success: Schema.Void,
    error: errors,
  }),
  Rpc.make(M.getRun, {
    payload: Schema.Struct({
      runId: Schema.String,
      includeLogTail: Schema.optional(Schema.Boolean),
    }),
    success: AppleRunDetail,
    error: errors,
  }),
  Rpc.make(M.watchRuns, {
    payload: AppleWorkspaceRef,
    success: AppleRunsEvent,
    error: errors,
    stream: true,
  }),
  Rpc.make(M.tailLog, {
    payload: Schema.Struct({ runId: Schema.String, fromOffset: Schema.Int }),
    success: AppleLogChunk,
    error: errors,
    stream: true,
  }),
  Rpc.make(M.getSettings, {
    payload: Schema.Struct({}),
    success: AppleBuildSettingsView,
    error: errors,
  }),
  Rpc.make(M.updateSettings, {
    payload: AppleBuildSettingsPatch,
    success: AppleBuildSettings,
    error: errors,
  }),
  // Omit projectId to clear every project. Refused with "busy" while an affected run is active.
  Rpc.make(M.clearHistory, {
    payload: Schema.Struct({
      projectId: Schema.optional(ProjectId),
      includeDerivedData: Schema.optional(Schema.Boolean),
    }),
    success: Schema.Void,
    error: errors,
  }),
  Rpc.make(M.openResultBundle, {
    payload: Schema.Struct({ runId: Schema.String }),
    success: Schema.Void,
    error: errors,
  }),
);

const RUN_KIND_LABEL: Record<AppleRunKind, string> = {
  build: "Build",
  test: "Test",
  run: "Build and run",
  releaseBuild: "Release build",
  xcodegenGenerate: "XcodeGen generate",
  swiftBuild: "swift build",
  swiftTest: "swift test",
};

export const appleRunKindLabel = (kind: AppleRunKind) => RUN_KIND_LABEL[kind];

const SUMMARY_LIMIT_BYTES = 8 * 1024;

/** Cuts text to at most `maxBytes` of UTF-8 without splitting a character. */
export const truncateUtf8 = (text: string, maxBytes: number) => {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  const marker = "\n...";
  const cut = new TextDecoder().decode(bytes.slice(0, maxBytes - marker.length));
  // A cut through a multi-byte character decodes to U+FFFD; drop it.
  return `${cut.replace(/�$/, "")}${marker}`;
};

/** Compact text for agents and the composer: status, errors with file:line, failed tests. */
export const formatRunSummaryForAgent = (
  run: Pick<AppleRunRecord, "kind" | "status" | "commandLine">,
  summary: AppleRunSummary | null,
): string => {
  const lines = [`${appleRunKindLabel(run.kind)} ${run.status} (${run.commandLine})`];
  if (summary?.failureReason) lines.push(summary.failureReason);
  for (const issue of (summary?.build?.issues ?? [])
    .filter((candidate) => candidate.severity === "error")
    .slice(0, 20)) {
    const where = issue.file === undefined ? "" : `${issue.file}:${issue.line ?? "?"}: `;
    lines.push(`error: ${where}${issue.message}`);
  }
  const warnings = summary?.build?.warningCount ?? 0;
  if (warnings > 0) lines.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  const tests = summary?.tests;
  if (tests) {
    lines.push(
      `tests: ${tests.passed}/${tests.total} passed, ${tests.failed} failed, ${tests.skipped} skipped`,
    );
    for (const failure of tests.failures.slice(0, 20)) {
      const where = failure.file === undefined ? "" : ` (${failure.file}:${failure.line ?? "?"})`;
      lines.push(`FAIL ${failure.identifier}${where}: ${failure.message}`);
    }
  }
  if (summary?.launched)
    lines.push(`launched ${summary.launched.bundleId} from ${summary.launched.appPath}`);
  return truncateUtf8(lines.join("\n"), SUMMARY_LIMIT_BYTES);
};
