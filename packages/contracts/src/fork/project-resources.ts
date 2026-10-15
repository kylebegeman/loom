import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { NonNegativeInt, ProjectId } from "../baseSchemas.ts";

export const PROJECT_RESOURCES_FEATURE = "project-resources";
export const PROJECT_RESOURCES_LIMIT = 100;
const ResourceId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
);
const Revision = NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
export const ProjectResource = Schema.Struct({
  id: ResourceId,
  kind: Schema.Literals(["repository", "link"]),
  title: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(200),
    Schema.isPattern(/\S/u),
    Schema.isPattern(/^[^\p{Cc}\p{Cf}]*$/u),
  ),
  url: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2048),
    Schema.isPattern(/^[^\p{Cc}\p{Cf}]*$/u),
  ),
});
export type ProjectResource = typeof ProjectResource.Type;
export const ProjectResourcesSnapshot = Schema.Struct({
  projectId: ProjectId,
  revision: Revision,
  resources: Schema.Array(ProjectResource).check(Schema.isMaxLength(PROJECT_RESOURCES_LIMIT)),
});
export type ProjectResourcesSnapshot = typeof ProjectResourcesSnapshot.Type;
export const ProjectResourcesRequest = Schema.Struct({ projectId: ProjectId });
export const ProjectResourceUpsertRequest = Schema.Struct({
  projectId: ProjectId,
  expectedRevision: Revision,
  resource: ProjectResource,
});
export type ProjectResourceUpsertRequest = typeof ProjectResourceUpsertRequest.Type;
export const ProjectResourceRemoveRequest = Schema.Struct({
  projectId: ProjectId,
  expectedRevision: Revision,
  resourceId: ResourceId,
});
export type ProjectResourceRemoveRequest = typeof ProjectResourceRemoveRequest.Type;
export class ProjectResourcesError extends Schema.TaggedError<ProjectResourcesError>()(
  "ProjectResourcesError",
  {
    projectId: ProjectId,
    reason: Schema.Literals([
      "not-found",
      "invalid-resource",
      "stale-revision",
      "duplicate-resource",
      "limit",
      "io",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not-found":
        return "This project is no longer available on this computer.";
      case "invalid-resource":
        return "Use a valid web link or a network Git repository URL without embedded credentials.";
      case "stale-revision":
        return "The project's resources changed. Refresh them before saving again.";
      case "duplicate-resource":
        return "This resource is already part of the project.";
      case "limit":
        return `A project can have at most ${PROJECT_RESOURCES_LIMIT} resources.`;
      case "io":
        return "The project's resources could not be read or saved. Try again.";
    }
  }
}
export const PROJECT_RESOURCES_WS_METHODS = {
  get: "loom.project-resources.get",
  upsert: "loom.project-resources.upsert",
  remove: "loom.project-resources.remove",
} as const;
const error = Schema.Union([ProjectResourcesError, EnvironmentAuthorizationError]);
export const ProjectResourcesRpcGroup = RpcGroup.make(
  Rpc.make(PROJECT_RESOURCES_WS_METHODS.get, {
    payload: ProjectResourcesRequest,
    success: ProjectResourcesSnapshot,
    error,
  }),
  Rpc.make(PROJECT_RESOURCES_WS_METHODS.upsert, {
    payload: ProjectResourceUpsertRequest,
    success: ProjectResourcesSnapshot,
    error,
  }),
  Rpc.make(PROJECT_RESOURCES_WS_METHODS.remove, {
    payload: ProjectResourceRemoveRequest,
    success: ProjectResourcesSnapshot,
    error,
  }),
);
