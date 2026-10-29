import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { NonNegativeInt } from "../baseSchemas.ts";

export const UPDATE_PLAN_FEATURE = "machine-update-plans";
export const UPDATE_ACTIVITY_ROUTE = "/api/loom/updates/activity";
export const UPDATE_PLAN_WS_METHODS = {
  status: "loom.machine-updates.status",
  arm: "loom.machine-updates.arm",
  cancel: "loom.machine-updates.cancel",
} as const;

export const UpdatePlanState = Schema.Literals([
  "armed",
  "waiting",
  "installing",
  "done",
  "cancelled",
  "failed",
]);
export const UpdatePlan = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  targetVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  state: UpdatePlanState,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  finishedAt: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
});
export type UpdatePlan = typeof UpdatePlan.Type;
export const UpdateActivity = Schema.Struct({ waitingAgents: NonNegativeInt });
export type UpdateActivity = typeof UpdateActivity.Type;
export const UpdatePlanStatus = Schema.Struct({
  plan: Schema.NullOr(UpdatePlan),
  currentVersion: Schema.String,
  supported: Schema.Boolean,
  unavailableReason: Schema.NullOr(Schema.String),
  waitingAgents: Schema.NullOr(NonNegativeInt),
});
export type UpdatePlanStatus = typeof UpdatePlanStatus.Type;
export const UpdatePlanArm = Schema.Struct({ targetVersion: Schema.String });
export const UpdatePlanCancel = Schema.Struct({ id: Schema.String });

const messages = {
  unavailable: "This computer cannot install runtime updates automatically.",
  invalid: "Choose an exact Loom version to update to.",
  busy: "Cancel the existing update plan before choosing another version.",
  changed: "This update plan changed. Refresh its status before cancelling.",
  installing: "This update has already been handed off for installation.",
  read: "The saved update plan could not be read.",
  write: "The update plan could not be saved.",
  activity: "This computer's agent activity could not be checked.",
} as const;
export class UpdatePlanError extends Schema.TaggedError<UpdatePlanError>()("UpdatePlanError", {
  reason: Schema.Literals(Object.keys(messages) as Array<keyof typeof messages>),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return messages[this.reason];
  }
}
const error = Schema.Union([UpdatePlanError, EnvironmentAuthorizationError]);
export const UpdatePlanRpcGroup = RpcGroup.make(
  Rpc.make(UPDATE_PLAN_WS_METHODS.status, {
    payload: Schema.Struct({}),
    success: UpdatePlanStatus,
    error,
  }),
  Rpc.make(UPDATE_PLAN_WS_METHODS.arm, {
    payload: UpdatePlanArm,
    success: UpdatePlanStatus,
    error,
  }),
  Rpc.make(UPDATE_PLAN_WS_METHODS.cancel, {
    payload: UpdatePlanCancel,
    success: UpdatePlanStatus,
    error,
  }),
);
