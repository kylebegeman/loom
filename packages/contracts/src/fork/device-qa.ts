import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { ProjectId, ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { DeviceHostId, DeviceId, DevicePlatform } from "../device.ts";

export const DEVICE_QA_WS_METHODS = {
  status: "loom.device-qa.status",
  listFlows: "loom.device-qa.listFlows",
  readFlow: "loom.device-qa.readFlow",
  runFlows: "loom.device-qa.runFlows",
  cancelRun: "loom.device-qa.cancelRun",
  getRun: "loom.device-qa.getRun",
  watchRuns: "loom.device-qa.watchRuns",
  runEvents: "loom.device-qa.runEvents",
  capture: "loom.device-qa.capture",
  stopRecording: "loom.device-qa.stopRecording",
  watchEvidence: "loom.device-qa.watchEvidence",
  deleteEvidence: "loom.device-qa.deleteEvidence",
  deleteAllEvidence: "loom.device-qa.deleteAllEvidence",
  installApp: "loom.device-qa.installApp",
  statusBar: "loom.device-qa.statusBar",
  disableArgentTelemetry: "loom.device-qa.disableArgentTelemetry",
  getSettings: "loom.device-qa.getSettings",
  updateSettings: "loom.device-qa.updateSettings",
} as const;

/** The argent release Loom's install command pins. Update with care: flags and records changed before. */
export const ARGENT_PINNED_VERSION = "0.25.2";

/** argent's own installer: installs globally, registers its MCP server in editors, telemetry off. */
export const argentInitCommand = () =>
  `npx @swmansion/argent@${ARGENT_PINNED_VERSION} init --no-telemetry`;
/** Runner-only install, without editor or skill setup. */
export const argentGlobalInstallCommand = () =>
  `npm install -g @swmansion/argent@${ARGENT_PINNED_VERSION}`;

/** argent accepts flow names of letters, numbers, `_` and `-` only. */
export const isArgentFlowName = (name: string) => /^[A-Za-z0-9_-]+$/.test(name);

export const DEVICE_QA_FLOWS_DIR = ".argent/flows";

export const DeviceQaTarget = Schema.Struct({
  /** `local` for the environment host. */
  hostId: DeviceHostId,
  /** Simulator udid or adb serial. */
  deviceId: DeviceId,
  platform: DevicePlatform,
});
export type DeviceQaTarget = typeof DeviceQaTarget.Type;

export const DeviceQaArgentStatus = Schema.Struct({
  installed: Schema.Boolean,
  version: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  telemetry: Schema.Literals(["enabled", "disabled", "unknown"]),
  /** The version Loom's install command uses. */
  pinnedVersion: Schema.String,
});
export type DeviceQaArgentStatus = typeof DeviceQaArgentStatus.Type;

export const DeviceQaLocalDevice = Schema.Struct({
  target: DeviceQaTarget,
  name: Schema.String,
  version: Schema.String,
});
export type DeviceQaLocalDevice = typeof DeviceQaLocalDevice.Type;

export const DeviceQaActiveRecording = Schema.Struct({
  evidenceId: Schema.String,
  threadId: ThreadId,
  target: DeviceQaTarget,
  startedAt: Schema.String,
});
export type DeviceQaActiveRecording = typeof DeviceQaActiveRecording.Type;

export const DeviceQaStatus = Schema.Struct({
  argent: DeviceQaArgentStatus,
  hostPlatform: Schema.Literals(["darwin", "linux", "win32", "other"]),
  tools: Schema.Struct({ simctl: Schema.Boolean, adb: Schema.Boolean }),
  /** Booted local simulators and running emulators, read without the device hub. */
  localDevices: Schema.Array(DeviceQaLocalDevice),
  recording: Schema.NullOr(DeviceQaActiveRecording),
});
export type DeviceQaStatus = typeof DeviceQaStatus.Type;

export const DeviceQaFlowKind = Schema.Literals(["e2e", "fragment", "invalid"]);
export type DeviceQaFlowKind = typeof DeviceQaFlowKind.Type;

export const DeviceQaFlow = Schema.Struct({
  /** Workspace-relative, under `.argent/flows`. */
  path: TrimmedNonEmptyString,
  /** File name without `.yaml`. */
  name: Schema.String,
  /** Folder under `.argent/flows`; "" for the root. */
  folder: Schema.String,
  kind: DeviceQaFlowKind,
  /** The flow's `executionPrerequisite`. */
  prerequisite: Schema.NullOr(Schema.String),
  /** Start-state note of an e2e flow: its leading `echo`. */
  firstEcho: Schema.NullOr(Schema.String),
  stepCount: Schema.Int,
  snapshotSteps: Schema.Int,
  /** Best effort, from `launch` maps and `when: { platform }` blocks. */
  platforms: Schema.Array(Schema.String),
  parseError: Schema.NullOr(Schema.String),
  modifiedAt: Schema.String,
});
export type DeviceQaFlow = typeof DeviceQaFlow.Type;

export const DeviceQaStepStatus = Schema.Literals(["pass", "fail", "skip", "error"]);
export type DeviceQaStepStatus = typeof DeviceQaStepStatus.Type;

export const DeviceQaSnapshotArtifacts = Schema.Struct({
  baseline: Schema.optional(Schema.String),
  current: Schema.optional(Schema.String),
  diff: Schema.optional(Schema.String),
});
export type DeviceQaSnapshotArtifacts = typeof DeviceQaSnapshotArtifacts.Type;

export const DeviceQaStep = Schema.Struct({
  index: Schema.Int,
  kind: Schema.String,
  status: DeviceQaStepStatus,
  reason: Schema.optional(Schema.String),
  warning: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  tool: Schema.optional(Schema.String),
  flow: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  depth: Schema.optional(Schema.Int),
  durationMs: Schema.optional(Schema.Number),
  /** Absolute paths on the environment host, fetched through media-file asset URLs. */
  artifacts: Schema.optional(DeviceQaSnapshotArtifacts),
});
export type DeviceQaStep = typeof DeviceQaStep.Type;

export const DeviceQaRunStatus = Schema.Literals([
  "running",
  "passed",
  "failed",
  "error",
  "cancelled",
  "interrupted",
]);
export type DeviceQaRunStatus = typeof DeviceQaRunStatus.Type;

export const DeviceQaFlowRunStatus = Schema.Literals([
  "pending",
  "running",
  "passed",
  "failed",
  "error",
  "skipped",
  "cancelled",
]);
export type DeviceQaFlowRunStatus = typeof DeviceQaFlowRunStatus.Type;

export const DeviceQaFlowRun = Schema.Struct({
  path: Schema.String,
  status: DeviceQaFlowRunStatus,
  passed: Schema.Int,
  failed: Schema.Int,
  skipped: Schema.Int,
  errored: Schema.Int,
  durationMs: Schema.NullOr(Schema.Number),
  /** argent's `event: "error"` text or the exit reason. */
  error: Schema.NullOr(Schema.String),
});
export type DeviceQaFlowRun = typeof DeviceQaFlowRun.Type;

export const DeviceQaRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  target: DeviceQaTarget,
  flows: Schema.Array(DeviceQaFlowRun),
  updateBaselines: Schema.Boolean,
  status: DeviceQaRunStatus,
  startedBy: Schema.Literals(["user", "agent"]),
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
});
export type DeviceQaRun = typeof DeviceQaRun.Type;

export const DeviceQaRunDetail = Schema.Struct({
  run: DeviceQaRun,
  /** Steps of each flow, by flow path; capped at 500 steps per flow. */
  steps: Schema.Record(Schema.String, Schema.Array(DeviceQaStep)),
});
export type DeviceQaRunDetail = typeof DeviceQaRunDetail.Type;

export const DeviceQaRunEvent = Schema.Union([
  Schema.TaggedStruct("flowStarted", { path: Schema.String }),
  Schema.TaggedStruct("step", { path: Schema.String, step: DeviceQaStep }),
  Schema.TaggedStruct("flowFinished", { path: Schema.String, status: DeviceQaFlowRunStatus }),
  Schema.TaggedStruct("runFinished", { run: DeviceQaRun }),
]);
export type DeviceQaRunEvent = typeof DeviceQaRunEvent.Type;

export const DeviceQaEvidenceKind = Schema.Literals([
  "screenshot",
  "recording",
  "install",
  "flow-report",
]);
export type DeviceQaEvidenceKind = typeof DeviceQaEvidenceKind.Type;

export const DeviceQaEvidenceStatus = Schema.Literals([
  "recording",
  "finalizing",
  "ready",
  "failed",
]);
export type DeviceQaEvidenceStatus = typeof DeviceQaEvidenceStatus.Type;

export const DeviceQaEvidence = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  kind: DeviceQaEvidenceKind,
  status: DeviceQaEvidenceStatus,
  target: DeviceQaTarget,
  deviceName: Schema.String,
  label: Schema.NullOr(Schema.String),
  /** Absolute file path on the environment host (PNG, MP4 or JSON); null for installs. */
  path: Schema.NullOr(Schema.String),
  mimeType: Schema.NullOr(Schema.String),
  sizeBytes: Schema.NullOr(Schema.Number),
  width: Schema.NullOr(Schema.Int),
  height: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(Schema.Number),
  /** Install: bundle id or package. Flow report: run id. Failed items: the failure text. */
  detail: Schema.NullOr(Schema.String),
  createdBy: Schema.Literals(["user", "agent"]),
  createdAt: Schema.String,
});
export type DeviceQaEvidence = typeof DeviceQaEvidence.Type;

export const DEVICE_QA_MAX_RECORDING_SECONDS = 180;

export const DeviceQaCaptureInput = Schema.Struct({
  threadId: ThreadId,
  target: DeviceQaTarget,
  kind: Schema.Literals(["screenshot", "recording"]),
  label: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  /** iOS simulators: apply the clean status bar before and clear it after the capture. */
  cleanStatusBar: Schema.optional(Schema.Boolean),
  /** Recordings: hard stop after this many seconds. */
  maxSeconds: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: DEVICE_QA_MAX_RECORDING_SECONDS })),
  ),
});
export type DeviceQaCaptureInput = typeof DeviceQaCaptureInput.Type;

export const DeviceQaRunFlowsInput = Schema.Struct({
  threadId: ThreadId,
  target: DeviceQaTarget,
  /** Workspace-relative flow files, run in order. The client expands a folder from listFlows. */
  paths: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  updateBaselines: Schema.optional(Schema.Boolean),
});
export type DeviceQaRunFlowsInput = typeof DeviceQaRunFlowsInput.Type;

export const DeviceQaInstallInput = Schema.Struct({
  threadId: ThreadId,
  target: DeviceQaTarget,
  /** Workspace-relative or absolute path to a `.app` directory or an `.apk` file on the host. */
  artifactPath: TrimmedNonEmptyString,
  launch: Schema.optional(Schema.Boolean),
});
export type DeviceQaInstallInput = typeof DeviceQaInstallInput.Type;

export const DeviceQaSettings = Schema.Struct({
  /** Override; null looks argent up on PATH and in npm's global bin. */
  argentPath: Schema.NullOr(Schema.String),
  keepRunsPerProject: Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 200 })),
  defaultCleanStatusBar: Schema.Boolean,
  /** null keeps evidence until its thread is deleted; else items older than N days are deleted. */
  evidenceExpireDays: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 365 })),
  ),
});
export type DeviceQaSettings = typeof DeviceQaSettings.Type;

export const DeviceQaSettingsPatch = Schema.Struct({
  argentPath: Schema.optional(DeviceQaSettings.fields.argentPath),
  keepRunsPerProject: Schema.optional(DeviceQaSettings.fields.keepRunsPerProject),
  defaultCleanStatusBar: Schema.optional(DeviceQaSettings.fields.defaultCleanStatusBar),
  evidenceExpireDays: Schema.optional(DeviceQaSettings.fields.evidenceExpireDays),
});
export type DeviceQaSettingsPatch = typeof DeviceQaSettingsPatch.Type;

export const DEFAULT_DEVICE_QA_SETTINGS: DeviceQaSettings = {
  argentPath: null,
  keepRunsPerProject: 20,
  defaultCleanStatusBar: true,
  evidenceExpireDays: null,
};

/** watchEvidence payload: the latest items plus totals over all of the thread's evidence. */
export const DeviceQaEvidenceList = Schema.Struct({
  /** Latest 200. */
  items: Schema.Array(DeviceQaEvidence),
  totalCount: Schema.Int,
  totalBytes: Schema.Number,
  /** The host's active recording, in any thread, so every client can show the stop button. */
  recording: Schema.NullOr(DeviceQaActiveRecording),
});
export type DeviceQaEvidenceList = typeof DeviceQaEvidenceList.Type;

export const DeviceQaFlowList = Schema.Struct({
  flows: Schema.Array(DeviceQaFlow),
  truncated: Schema.Boolean,
});
export type DeviceQaFlowList = typeof DeviceQaFlowList.Type;

export const DeviceQaRunsEvent = Schema.Struct({ runs: Schema.Array(DeviceQaRun) });
export type DeviceQaRunsEvent = typeof DeviceQaRunsEvent.Type;

export const DeviceQaDeleteAllResult = Schema.Struct({
  deletedCount: Schema.Int,
  freedBytes: Schema.Number,
  skippedActive: Schema.Int,
});
export type DeviceQaDeleteAllResult = typeof DeviceQaDeleteAllResult.Type;

export class DeviceQaError extends Schema.TaggedError<DeviceQaError>()("DeviceQaError", {
  reason: Schema.Literals([
    "argent-missing",
    "workspace-not-found",
    "flow-not-found",
    "invalid-path",
    "device-unavailable",
    "unsupported-on-host",
    "busy",
    "not-found",
    "command-failed",
    "timeout",
  ]),
  message: Schema.String,
}) {}

const errors = Schema.Union([DeviceQaError, EnvironmentAuthorizationError]);
const M = DEVICE_QA_WS_METHODS;
const ThreadRef = Schema.Struct({ threadId: ThreadId });

export const DeviceQaRpcGroup = RpcGroup.make(
  Rpc.make(M.status, { payload: ThreadRef, success: DeviceQaStatus, error: errors }),
  Rpc.make(M.listFlows, { payload: ThreadRef, success: DeviceQaFlowList, error: errors }),
  Rpc.make(M.readFlow, {
    payload: Schema.Struct({ threadId: ThreadId, path: TrimmedNonEmptyString }),
    success: Schema.Struct({ path: Schema.String, text: Schema.String }),
    error: errors,
  }),
  Rpc.make(M.runFlows, { payload: DeviceQaRunFlowsInput, success: DeviceQaRun, error: errors }),
  Rpc.make(M.cancelRun, {
    payload: Schema.Struct({ runId: Schema.String }),
    success: Schema.Void,
    error: errors,
  }),
  Rpc.make(M.getRun, {
    payload: Schema.Struct({ runId: Schema.String }),
    success: DeviceQaRunDetail,
    error: errors,
  }),
  Rpc.make(M.watchRuns, {
    payload: ThreadRef,
    success: DeviceQaRunsEvent,
    error: errors,
    stream: true,
  }),
  Rpc.make(M.runEvents, {
    payload: Schema.Struct({ runId: Schema.String }),
    success: DeviceQaRunEvent,
    error: errors,
    stream: true,
  }),
  Rpc.make(M.capture, { payload: DeviceQaCaptureInput, success: DeviceQaEvidence, error: errors }),
  Rpc.make(M.stopRecording, {
    payload: Schema.Struct({ evidenceId: Schema.String }),
    success: DeviceQaEvidence,
    error: errors,
  }),
  Rpc.make(M.watchEvidence, {
    payload: ThreadRef,
    success: DeviceQaEvidenceList,
    error: errors,
    stream: true,
  }),
  Rpc.make(M.deleteEvidence, {
    payload: Schema.Struct({ evidenceId: Schema.String }),
    success: Schema.Void,
    error: errors,
  }),
  Rpc.make(M.deleteAllEvidence, {
    payload: ThreadRef,
    success: DeviceQaDeleteAllResult,
    error: errors,
  }),
  Rpc.make(M.installApp, {
    payload: DeviceQaInstallInput,
    success: DeviceQaEvidence,
    error: errors,
  }),
  Rpc.make(M.statusBar, {
    payload: Schema.Struct({ target: DeviceQaTarget, mode: Schema.Literals(["clean", "clear"]) }),
    success: Schema.Void,
    error: errors,
  }),
  Rpc.make(M.disableArgentTelemetry, {
    payload: Schema.Struct({}),
    success: DeviceQaArgentStatus,
    error: errors,
  }),
  Rpc.make(M.getSettings, { payload: Schema.Struct({}), success: DeviceQaSettings, error: errors }),
  Rpc.make(M.updateSettings, {
    payload: DeviceQaSettingsPatch,
    success: DeviceQaSettings,
    error: errors,
  }),
);

/** `<hostId>:<deviceId>`, the Device QA panel's surface resource id for a handed-over device. */
export const deviceQaTargetKey = (target: Pick<DeviceQaTarget, "hostId" | "deviceId">) =>
  `${target.hostId}:${target.deviceId}`;

export const parseDeviceQaTargetKey = (key: string) => {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) return null;
  return { hostId: key.slice(0, separator), deviceId: key.slice(separator + 1) };
};
