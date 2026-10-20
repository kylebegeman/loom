import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";

export const MINI_OFFLOAD_WS_METHODS = {
  workers: "loom.mini-offload.workers",
  register: "loom.mini-offload.register",
  setEnabled: "loom.mini-offload.setEnabled",
  submit: "loom.mini-offload.submit",
  recover: "loom.mini-offload.recover",
  list: "loom.mini-offload.list",
  inspect: "loom.mini-offload.inspect",
  cancel: "loom.mini-offload.cancel",
  patch: "loom.mini-offload.patch",
  artifacts: "loom.mini-offload.artifacts",
  check: "loom.mini-offload.check",
  prepare: "loom.mini-offload.prepare",
  updateWorker: "loom.mini-offload.updateWorker",
  removeWorker: "loom.mini-offload.removeWorker",
} as const;
const Id = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/));
const WorkerId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/));
const bounded = (max: number) => TrimmedNonEmptyString.check(Schema.isMaxLength(max));
export const MiniWorker = Schema.Struct({
  id: WorkerId,
  name: bounded(120),
  target: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,199}$/)),
  sshConfig: Schema.NullOr(bounded(4096)),
  enabled: Schema.Boolean,
});
export type MiniWorker = typeof MiniWorker.Type;
export const MiniWorkerSummary = Schema.Struct({
  id: MiniWorker.fields.id,
  name: MiniWorker.fields.name,
  enabled: MiniWorker.fields.enabled,
});
/** A registered worker's new SSH connection. Its id, name and enabled state stay. */
export const MiniWorkerConnection = Schema.Struct({
  workerId: MiniWorker.fields.id,
  target: MiniWorker.fields.target,
  sshConfig: MiniWorker.fields.sshConfig,
});
export type MiniWorkerConnection = typeof MiniWorkerConnection.Type;
// Match Mini's plain, canonical POSIX file paths. Directories and glob patterns are not expanded.
const OutputPath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.makeFilter(
    (value) =>
      ![...value].some((char) => char.charCodeAt(0) < 32) &&
      !value.includes("\\") &&
      value
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".." && part !== ".git"),
  ),
);
const OutputPaths = Schema.Array(OutputPath).check(
  Schema.isMaxLength(32),
  Schema.makeFilter((paths) => new Set(paths).size === paths.length),
);
export const MiniSubmit = Schema.Struct({
  threadId: ThreadId,
  workerId: WorkerId,
  requestId: Id,
  label: bounded(80).check(
    Schema.makeFilter((label) => [...label].every((char) => char.charCodeAt(0) >= 32)),
  ),
  argv: Schema.Array(
    Schema.String.check(
      Schema.isMaxLength(8192),
      Schema.makeFilter((arg) => !arg.includes(String.fromCharCode(0))),
    ),
  ).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.makeFilter(
      (argv) => argv[0] !== "" && argv.reduce((sum, arg) => sum + arg.length, 0) <= 32768,
    ),
  ),
  memoryMiB: Schema.Int.check(Schema.isBetween({ minimum: 128, maximum: 12288 })),
  cpuPercent: Schema.Int.check(Schema.isBetween({ minimum: 25, maximum: 800 })),
  timeoutSeconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 86400 })),
  committedOnly: Schema.Boolean,
  outputs: Schema.optional(OutputPaths),
});
export type MiniSubmit = typeof MiniSubmit.Type;
export const MiniJob = Schema.Struct({
  id: Id,
  state: Schema.Literals([
    "queued",
    "starting",
    "running",
    "cancelling",
    "succeeded",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  label: Schema.String,
  exit_code: Schema.NullOr(Schema.Int),
  reason: Schema.NullOr(Schema.String),
});
export type MiniJob = typeof MiniJob.Type;
export const MiniReceipt = Schema.Struct({
  request: MiniSubmit,
  workerName: Schema.String,
  sourceRevision: Schema.String,
  archiveSha256: Schema.String,
  archiveBytes: Schema.Int,
  localEditsExcluded: Schema.Boolean,
  createdAt: Schema.String,
  state: Schema.Literals(["transfer_pending", "submitted"]),
  job: Schema.NullOr(MiniJob),
});
export type MiniReceipt = typeof MiniReceipt.Type;
export const MiniRef = Schema.Struct({ threadId: ThreadId, requestId: Id });
export type MiniRef = typeof MiniRef.Type;
export class MiniOffloadError extends Schema.TaggedError<MiniOffloadError>()("MiniOffloadError", {
  cause: Schema.optional(Schema.Defect()),
  reason: Schema.Literals([
    "workspace",
    "worker",
    "dirty",
    "conflict",
    "storage",
    "too_large",
    "transfer",
    "response",
    "patch",
    "artifacts",
  ]),
}) {
  override get message(): string {
    return {
      workspace: "The thread needs a Git repository rooted at its workspace.",
      worker:
        "Register and enable an SSH worker first. To move a registered worker, change its connection instead of registering it again.",
      dirty: "Commit local edits or explicitly send only the committed revision.",
      conflict: "This request ID already belongs to different work or another thread.",
      storage: "The offload receipt or source archive could not be saved or read.",
      too_large:
        "The committed repository snapshot is larger than the 1 GiB offload limit before compression.",
      transfer:
        "The worker could not be reached. A submission may have succeeded. Recover this receipt on the same worker.",
      response: "The worker returned an invalid or mismatched response.",
      patch: "The patch is unavailable or failed its size, revision or checksum check.",
      artifacts:
        "Outputs could not be collected. Check the worker connection and result retention; the bundle must pass its size and checksum checks.",
    }[this.reason];
  }
}
export const MiniDetail = Schema.Struct({
  receipt: MiniReceipt,
  logs: Schema.Struct({ text: Schema.String, truncated: Schema.Boolean }),
});
export const MiniPatch = Schema.Struct({
  sourceRevision: Schema.String,
  sha256: Schema.String,
  bytes: Schema.Int,
  patchBase64: Schema.String,
});
export const MiniArtifacts = Schema.Struct({
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  bytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 * 1024 * 1024 })),
  files: Schema.Array(
    Schema.Struct({
      path: OutputPath,
      bytes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 60 * 1024 * 1024 })),
      sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    }),
  ).check(Schema.isMaxLength(32)),
  missing: OutputPaths,
  artifactsBase64: Schema.String.check(Schema.isMaxLength(90 * 1024 * 1024)),
});
export type MiniArtifacts = typeof MiniArtifacts.Type;
export const MiniAgentArtifacts = Schema.Struct({
  ...MiniArtifacts.fields,
  artifactsBase64: Schema.NullOr(MiniArtifacts.fields.artifactsBase64),
});
export type MiniAgentArtifacts = typeof MiniAgentArtifacts.Type;
export const MiniWorkerRef = Schema.Struct({ workerId: WorkerId });
export type MiniWorkerRef = typeof MiniWorkerRef.Type;
export const MiniWorkerReadiness = Schema.Struct({
  workerId: WorkerId,
  name: bounded(120),
  checkedAt: Schema.String,
  status: Schema.Literals(["ready", "busy", "needs_setup", "unreachable"]),
  architecture: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
  cpuCount: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 256 }))),
  slots: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 256 })),
  active: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 256 })),
  nativeServerRunning: Schema.Boolean,
  outputBundles: Schema.Boolean,
  missingTools: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(
    Schema.isMaxLength(128),
  ),
  reasons: Schema.Array(Schema.String.check(Schema.isMaxLength(80))).check(Schema.isMaxLength(32)),
});
export type MiniWorkerReadiness = typeof MiniWorkerReadiness.Type;
/** A readiness reason: SSH refused the worker's host key, as it does after a reinstall or a move. */
export const MINI_HOST_KEY_MISMATCH = "host_key_mismatch";
const M = MINI_OFFLOAD_WS_METHODS;
const error = Schema.Union([MiniOffloadError, EnvironmentAuthorizationError]);
export const MiniOffloadRpcGroup = RpcGroup.make(
  Rpc.make(M.workers, {
    payload: Schema.Struct({}),
    success: Schema.Array(MiniWorkerSummary),
    error,
  }),
  Rpc.make(M.register, { payload: MiniWorker, success: MiniWorkerSummary, error }),
  Rpc.make(M.setEnabled, {
    payload: Schema.Struct({ workerId: WorkerId, enabled: Schema.Boolean }),
    success: MiniWorkerSummary,
    error,
  }),
  Rpc.make(M.submit, { payload: MiniSubmit, success: MiniReceipt, error }),
  Rpc.make(M.recover, { payload: MiniRef, success: MiniReceipt, error }),
  Rpc.make(M.list, {
    payload: Schema.Struct({ threadId: ThreadId }),
    success: Schema.Array(MiniReceipt),
    error,
  }),
  Rpc.make(M.inspect, { payload: MiniRef, success: MiniDetail, error }),
  Rpc.make(M.cancel, { payload: MiniRef, success: MiniReceipt, error }),
  Rpc.make(M.patch, { payload: MiniRef, success: MiniPatch, error }),
  Rpc.make(M.artifacts, { payload: MiniRef, success: MiniArtifacts, error }),
  Rpc.make(M.check, { payload: MiniWorkerRef, success: MiniWorkerReadiness, error }),
  Rpc.make(M.prepare, { payload: MiniWorkerRef, success: MiniWorkerReadiness, error }),
  Rpc.make(M.updateWorker, { payload: MiniWorkerConnection, success: MiniWorkerSummary, error }),
  Rpc.make(M.removeWorker, { payload: MiniWorkerRef, success: MiniWorkerSummary, error }),
);
