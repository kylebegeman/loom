import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { ProjectId, ThreadId } from "../baseSchemas.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";

export const PROJECT_LIFECYCLE_WS_METHODS = {
  getSettings: "loom.project-lifecycle.getSettings",
  updateSettings: "loom.project-lifecycle.updateSettings",
  watch: "loom.project-lifecycle.watch",
  free: "loom.project-lifecycle.free",
  grow: "loom.project-lifecycle.grow",
  mount: "loom.project-lifecycle.mount",
  discard: "loom.project-lifecycle.discard",
  installShell: "loom.project-lifecycle.installShell",
  removeShell: "loom.project-lifecycle.removeShell",
} as const;

const Gigabytes = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4000 }));

export const ProjectLifecycleSettings = Schema.Struct({
  enabled: Schema.Boolean,
  lanesRoot: Schema.String.check(Schema.isMinLength(1)),
  defaultCapGb: Gigabytes, // default 40
  appleCapGb: Gigabytes, // default 100: Xcode projects build into DerivedData and simulators
  reserveGb: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4000 })), // default 40
  projectCapsGb: Schema.Record(Schema.String, Gigabytes),
});
export type ProjectLifecycleSettings = typeof ProjectLifecycleSettings.Type;

/** `image` is a capped ASIF disk image (macOS); `folder` a plain directory with a soft cap. */
export const LaneBackend = Schema.Literals(["image", "folder"]);
export type LaneBackend = typeof LaneBackend.Type;

export const LaneFreeScope = Schema.Literals(["tmp", "build", "all"]);
export type LaneFreeScope = typeof LaneFreeScope.Type;

export const ProjectLifecycleLane = Schema.Struct({
  id: Schema.String,
  projectId: ProjectId,
  projectName: Schema.String,
  name: Schema.String,
  checkoutPath: Schema.String,
  laneDir: Schema.String,
  spacePath: Schema.String,
  tmpPath: Schema.String,
  buildPath: Schema.String,
  dataPath: Schema.String,
  backend: LaneBackend,
  state: Schema.Literals(["ready", "unmounted", "error"]),
  capBytes: Schema.Number,
  usedBytes: Schema.NullOr(Schema.Number),
  /** Host disk the image occupies; deleted files return to the host on the next mount. */
  imageBytes: Schema.NullOr(Schema.Number),
  threadIds: Schema.Array(ThreadId),
  running: Schema.Boolean,
  createdAt: Schema.String,
  message: Schema.NullOr(Schema.String),
});
export type ProjectLifecycleLane = typeof ProjectLifecycleLane.Type;

export const ProjectLifecycleStatus = Schema.Struct({
  enabled: Schema.Boolean,
  lanesRoot: Schema.String,
  backend: LaneBackend,
  hostFreeBytes: Schema.NullOr(Schema.Number),
  hostTotalBytes: Schema.NullOr(Schema.Number),
  reserveBytes: Schema.Number,
  belowReserve: Schema.Boolean,
  shell: Schema.Struct({ installed: Schema.Boolean, profilePath: Schema.String }),
  lanes: Schema.Array(ProjectLifecycleLane),
});
export type ProjectLifecycleStatus = typeof ProjectLifecycleStatus.Type;

export class ProjectLifecycleError extends Schema.TaggedError<ProjectLifecycleError>()(
  "ProjectLifecycleError",
  {
    reason: Schema.Literals([
      "disabled",
      "not-found",
      "busy",
      "no-room",
      "unsupported",
      "command-failed",
    ]),
    message: Schema.String,
  },
) {}

export const DEFAULT_PROJECT_LIFECYCLE_CAPS = {
  defaultCapGb: 40,
  appleCapGb: 100,
  reserveGb: 40,
} as const;

const LaneRef = Schema.Struct({ laneId: Schema.String });

const rpc = <const Tag extends string, Payload extends Schema.Top, Success extends Schema.Top>(
  tag: Tag,
  payload: Payload,
  success: Success,
) =>
  Rpc.make(tag, {
    payload,
    success,
    error: Schema.Union([ProjectLifecycleError, EnvironmentAuthorizationError]),
  });

export const ProjectLifecycleRpcGroup = RpcGroup.make(
  rpc(PROJECT_LIFECYCLE_WS_METHODS.getSettings, Schema.Struct({}), ProjectLifecycleSettings),
  rpc(
    PROJECT_LIFECYCLE_WS_METHODS.updateSettings,
    ProjectLifecycleSettings,
    ProjectLifecycleSettings,
  ),
  Rpc.make(PROJECT_LIFECYCLE_WS_METHODS.watch, {
    payload: Schema.Struct({}),
    success: ProjectLifecycleStatus,
    error: Schema.Union([ProjectLifecycleError, EnvironmentAuthorizationError]),
    stream: true,
  }),
  rpc(
    PROJECT_LIFECYCLE_WS_METHODS.free,
    Schema.Struct({ ...LaneRef.fields, scope: LaneFreeScope }),
    ProjectLifecycleLane,
  ),
  rpc(PROJECT_LIFECYCLE_WS_METHODS.grow, LaneRef, ProjectLifecycleLane),
  rpc(PROJECT_LIFECYCLE_WS_METHODS.mount, LaneRef, ProjectLifecycleLane),
  rpc(PROJECT_LIFECYCLE_WS_METHODS.discard, LaneRef, Schema.Void),
  rpc(PROJECT_LIFECYCLE_WS_METHODS.installShell, Schema.Struct({}), Schema.Void),
  rpc(PROJECT_LIFECYCLE_WS_METHODS.removeShell, Schema.Struct({}), Schema.Void),
);
