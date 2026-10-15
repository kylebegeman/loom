import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { ProjectId } from "../baseSchemas.ts";
import { RepositoryIdentity } from "../environment.ts";

export const PROJECT_CHECKOUT_FEATURE = "project-checkout-management";
export const ProjectCheckoutRetention = Schema.Literals(["inherit", "keep", "release-on-settle"]);
export type ProjectCheckoutRetention = typeof ProjectCheckoutRetention.Type;
const ReviewToken = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const PROJECT_CHECKOUT_ACTIONS_FEATURE = "project-checkout-actions";
export const ProjectCheckoutRequest = Schema.Struct({ projectId: ProjectId });
export const ProjectCheckoutActionRequest = Schema.Struct({
  projectId: ProjectId,
  reviewToken: ReviewToken,
});
export type ProjectCheckoutActionRequest = typeof ProjectCheckoutActionRequest.Type;
export const ProjectCheckoutAdoptRequest = Schema.Struct({
  projectId: ProjectId,
  reviewToken: ReviewToken,
  retention: Schema.Literals(["keep", "release-on-settle"]),
});
export type ProjectCheckoutAdoptRequest = typeof ProjectCheckoutAdoptRequest.Type;
export const ProjectCheckoutRetentionRequest = Schema.Struct({
  projectId: ProjectId,
  reviewToken: ReviewToken,
  retention: ProjectCheckoutRetention,
});
export type ProjectCheckoutRetentionRequest = typeof ProjectCheckoutRetentionRequest.Type;
export const ProjectCheckoutPreview = Schema.Struct({
  projectId: ProjectId,
  workspaceRoot: Schema.String,
  state: Schema.Literals(["external", "managed", "released", "blocked"]),
  ownershipSource: Schema.NullOr(Schema.Literals(["clone", "adopted"])),
  retention: ProjectCheckoutRetention,
  head: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  repositoryIdentity: Schema.NullOr(RepositoryIdentity),
  localFiles: Schema.Struct({
    trackedChanges: Schema.Number,
    untrackedFiles: Schema.Number,
    ignoredFiles: Schema.Number,
    truncated: Schema.Boolean,
  }),
  blockers: Schema.Array(Schema.String),
  reviewToken: Schema.NullOr(ReviewToken),
});
export type ProjectCheckoutPreview = typeof ProjectCheckoutPreview.Type;
export const ProjectCheckoutReleaseResult = Schema.Struct({
  preview: ProjectCheckoutPreview,
  outcome: Schema.Literals(["removed", "kept", "failed"]),
  reason: Schema.String,
});
export type ProjectCheckoutReleaseResult = typeof ProjectCheckoutReleaseResult.Type;
export class ProjectCheckoutManagementError extends Schema.TaggedError<ProjectCheckoutManagementError>()(
  "ProjectCheckoutManagementError",
  {
    projectId: ProjectId,
    reason: Schema.Literals(["not-found", "blocked", "stale-review", "not-managed", "io"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    switch (this.reason) {
      case "not-found":
        return "This project is no longer available on this computer.";
      case "blocked":
        return "This folder cannot be managed safely. Review its current status.";
      case "stale-review":
        return "The project changed since your review. Review it again before saving.";
      case "not-managed":
        return "Review and adopt this folder before changing its storage policy.";
      case "io":
        return "The project storage settings could not be read or saved. Please try again.";
    }
  }
}
export const PROJECT_CHECKOUT_WS_METHODS = {
  release: "loom.project-checkout.release",
  restore: "loom.project-checkout.restore",
  preview: "loom.project-checkout.preview",
  adopt: "loom.project-checkout.adopt",
  setRetention: "loom.project-checkout.set-retention",
} as const;
const error = Schema.Union([ProjectCheckoutManagementError, EnvironmentAuthorizationError]);
export const ProjectCheckoutRpcGroup = RpcGroup.make(
  Rpc.make(PROJECT_CHECKOUT_WS_METHODS.release, {
    payload: ProjectCheckoutActionRequest,
    success: ProjectCheckoutReleaseResult,
    error,
  }),
  Rpc.make(PROJECT_CHECKOUT_WS_METHODS.restore, {
    payload: ProjectCheckoutActionRequest,
    success: ProjectCheckoutPreview,
    error,
  }),
  Rpc.make(PROJECT_CHECKOUT_WS_METHODS.preview, {
    payload: ProjectCheckoutRequest,
    success: ProjectCheckoutPreview,
    error,
  }),
  Rpc.make(PROJECT_CHECKOUT_WS_METHODS.adopt, {
    payload: ProjectCheckoutAdoptRequest,
    success: ProjectCheckoutPreview,
    error,
  }),
  Rpc.make(PROJECT_CHECKOUT_WS_METHODS.setRetention, {
    payload: ProjectCheckoutRetentionRequest,
    success: ProjectCheckoutPreview,
    error,
  }),
);
