import * as Schema from "effect/Schema";
import { EnvironmentId, PositiveInt } from "../baseSchemas.ts";
import {
  LibraryCreateProjectRequest,
  LibraryUpdateProjectRequest,
  LibraryArchiveProjectRequest,
  LibraryId,
  LibraryManagementDelegation,
} from "./project-library.ts";
import { LibraryApplyBlueprintRequest, LibrarySaveWorkstream } from "./project-workflows.ts";

export const LibraryProjectManagementRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("create"), input: LibraryCreateProjectRequest }),
  Schema.Struct({ kind: Schema.Literal("update"), input: LibraryUpdateProjectRequest }),
  Schema.Struct({ kind: Schema.Literal("archive"), input: LibraryArchiveProjectRequest }),
  Schema.Struct({ kind: Schema.Literal("apply-blueprint"), input: LibraryApplyBlueprintRequest }),
]);
export type LibraryProjectManagementRequest = typeof LibraryProjectManagementRequest.Type;
export const LibraryManagementRequest = Schema.Union([
  LibraryProjectManagementRequest,
  Schema.Struct({ kind: Schema.Literal("save-workstream"), input: LibrarySaveWorkstream }),
]);
export type LibraryManagementRequest = typeof LibraryManagementRequest.Type;
export const LibraryManagementInvocation = Schema.Struct({
  sourceEnvironmentId: EnvironmentId,
  authorityId: LibraryId,
  authorityEpoch: PositiveInt,
  delegation: LibraryManagementDelegation.fields.token,
  proof: LibraryManagementDelegation.fields.token,
  request: LibraryManagementRequest,
});
export type LibraryManagementInvocation = typeof LibraryManagementInvocation.Type;
