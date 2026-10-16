import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { EnvironmentId, IsoDateTime, ProjectId, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { ModelSelection } from "../modelSelection.ts";
import { ProjectScript } from "../project.ts";
import { LibraryError, LibraryId } from "./project-library.ts";
import {
  LibraryProjectProfile,
  LibrarySecretName,
  LibraryToolVersion,
} from "./project-library-profile.ts";

/**
 * Served by a computer that checks a project's required tools and applies its setup to copies.
 * Clients read it from the copy's computer, not from the Library.
 */
export const LIBRARY_PROFILE_READINESS_FEATURE = "library-profile-readiness";

export const LIBRARY_READINESS_WS_METHODS = {
  readiness: "loom.library.profile-readiness",
  profileSettings: "loom.library.profile-settings",
  applyProfile: "loom.library.apply-profile",
} as const;

/**
 * `outdated` carries the version found. `unknown` means the check failed or its output could
 * not be read, so the tool may or may not be usable.
 */
export const LibraryToolCheckStatus = Schema.Literals(["ok", "missing", "outdated", "unknown"]);
export type LibraryToolCheckStatus = typeof LibraryToolCheckStatus.Type;

export const LibraryToolCheck = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(32)),
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  status: LibraryToolCheckStatus,
  minimumVersion: Schema.optional(LibraryToolVersion),
  /** The version this computer has, when the check could read one. */
  version: Schema.optional(LibraryToolVersion),
});
export type LibraryToolCheck = typeof LibraryToolCheck.Type;

export const LibraryProfileReadiness = Schema.Struct({
  projectId: LibraryId,
  environmentId: EnvironmentId,
  checks: Schema.Array(LibraryToolCheck),
  /** Names to configure on this computer. Values are never read. */
  secrets: Schema.Array(Schema.Struct({ name: LibrarySecretName })),
  checkedAt: IsoDateTime,
});
export type LibraryProfileReadiness = typeof LibraryProfileReadiness.Type;

export const LibraryProfileReadinessRequest = Schema.Struct({
  projectId: LibraryId,
  /** The current profile. Without it the computer uses the newest one its copies recorded. */
  profile: Schema.optional(LibraryProjectProfile),
});
export type LibraryProfileReadinessRequest = typeof LibraryProfileReadinessRequest.Type;

/** A local setting that differs from the project's setup. Applying replaces `local`. */
export const LibraryProfileDifference = Schema.Union([
  Schema.Struct({
    field: Schema.Literal("scripts"),
    local: Schema.Array(ProjectScript),
    profile: Schema.Array(ProjectScript),
  }),
  Schema.Struct({
    field: Schema.Literal("defaultModelSelection"),
    local: Schema.NullOr(ModelSelection),
    profile: ModelSelection,
  }),
]);
export type LibraryProfileDifference = typeof LibraryProfileDifference.Type;

export const LibraryProfileSettings = Schema.Struct({
  workingCopyId: LibraryId,
  projects: Schema.Array(
    Schema.Struct({
      localProjectId: ProjectId,
      title: TrimmedNonEmptyString,
      differences: Schema.Array(LibraryProfileDifference),
    }),
  ),
  /** Names exactly these differences. Null when nothing differs. */
  reviewToken: Schema.NullOr(Schema.String),
});
export type LibraryProfileSettings = typeof LibraryProfileSettings.Type;

export const LibraryProfileSettingsRequest = Schema.Struct({
  workingCopyId: LibraryId,
  /** The current profile. Without it the computer uses the one recorded with the copy. */
  profile: Schema.optional(LibraryProjectProfile),
});
export type LibraryProfileSettingsRequest = typeof LibraryProfileSettingsRequest.Type;

export const LibraryApplyProfileRequest = Schema.Struct({
  ...LibraryProfileSettingsRequest.fields,
  /** From the settings the person reviewed. A changed difference refuses with `blocked`. */
  reviewToken: Schema.String.check(Schema.isMaxLength(128)),
});
export type LibraryApplyProfileRequest = typeof LibraryApplyProfileRequest.Type;

const ReadinessError = Schema.Union([LibraryError, EnvironmentAuthorizationError]);

export const ProjectLibraryReadinessRpcGroup = RpcGroup.make(
  Rpc.make(LIBRARY_READINESS_WS_METHODS.readiness, {
    payload: LibraryProfileReadinessRequest,
    success: LibraryProfileReadiness,
    error: ReadinessError,
  }),
  Rpc.make(LIBRARY_READINESS_WS_METHODS.profileSettings, {
    payload: LibraryProfileSettingsRequest,
    success: LibraryProfileSettings,
    error: ReadinessError,
  }),
  Rpc.make(LIBRARY_READINESS_WS_METHODS.applyProfile, {
    payload: LibraryApplyProfileRequest,
    success: LibraryProfileSettings,
    error: ReadinessError,
  }),
);
