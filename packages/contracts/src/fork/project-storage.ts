import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  DatabaseStorageStatus,
  StorageCleanupReport,
  StorageCleanupReportEntry,
} from "../settings.ts";

export const PROJECT_STORAGE_FEATURE = "project-storage-inventory";
export const ProjectStorageCategory = Schema.Literals([
  "worktrees",
  "primary",
  "library-copies",
  "git-mirrors",
  "lanes",
  "scratch",
  "database",
]);
export type ProjectStorageCategory = typeof ProjectStorageCategory.Type;

export const ProjectStorageCategoryTotal = Schema.Struct({
  kind: ProjectStorageCategory,
  bytes: Schema.NullOr(Schema.Number),
  knownBytes: Schema.Number,
  locations: Schema.Number,
  unknownLocations: Schema.Number,
  landed: Schema.Number,
  released: Schema.Number,
});
export type ProjectStorageCategoryTotal = typeof ProjectStorageCategoryTotal.Type;

export const AdditionalStorageCleanupEntry = Schema.Struct({
  ...StorageCleanupReportEntry.fields,
  kind: Schema.Literals(["library-copy", "git-mirror"]),
  id: Schema.String,
  at: Schema.String,
});
export type AdditionalStorageCleanupEntry = typeof AdditionalStorageCleanupEntry.Type;

export const ProjectStorageBreakdown = Schema.Struct({
  measuredAt: Schema.String,
  categories: Schema.Array(ProjectStorageCategoryTotal),
  omittedLocations: Schema.Number,
  database: Schema.NullOr(DatabaseStorageStatus),
});
export type ProjectStorageBreakdown = typeof ProjectStorageBreakdown.Type;

export const ProjectStorageReport = Schema.Struct({
  breakdown: ProjectStorageBreakdown,
  cleanup: Schema.NullOr(StorageCleanupReport),
  additionalEntries: Schema.Array(AdditionalStorageCleanupEntry),
  additionalBytesFreed: Schema.Number,
});
export type ProjectStorageReport = typeof ProjectStorageReport.Type;

export class ProjectStorageError extends Schema.TaggedError<ProjectStorageError>()(
  "ProjectStorageError",
  {
    reason: Schema.Literals(["unavailable"]),
  },
) {
  override get message() {
    return "Storage could not be measured on this computer. Try again.";
  }
}

export const PROJECT_STORAGE_WS_METHODS = {
  byCategory: "loom.project-storage.byCategory",
} as const;
export const ProjectStorageRpcGroup = RpcGroup.make(
  Rpc.make(PROJECT_STORAGE_WS_METHODS.byCategory, {
    payload: Schema.Struct({ refresh: Schema.optional(Schema.Boolean) }),
    success: ProjectStorageReport,
    error: Schema.Union([ProjectStorageError, EnvironmentAuthorizationError]),
  }),
);
