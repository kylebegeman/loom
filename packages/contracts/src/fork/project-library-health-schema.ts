import * as Schema from "effect/Schema";
import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";

// Schemas only. project-library.ts imports this file, so it must not import project-library.ts.
const HealthId = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const RefName = Schema.String.check(Schema.isMaxLength(512));

/** Why a repository's health could not be read. */
export const LibraryRepositoryHealthError = Schema.Literals([
  "missing",
  "not-a-repository",
  "unreadable",
]);
export type LibraryRepositoryHealthError = typeof LibraryRepositoryHealthError.Type;

/**
 * One repository in a copy, as its computer sees it. `branch` is absent on a detached head;
 * `upstream`, `ahead` and `behind` without an upstream; `upstreamGone` marks a deleted upstream.
 * `fetchedAt` is the last real fetch, and `fetchFailed` means the counts predate a failed one.
 * `commitsSince` counts commits since the head last reported here, when this head builds on it.
 */
export const LibraryRepositoryHealth = Schema.Struct({
  resourceId: HealthId,
  branch: Schema.optional(RefName),
  head: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
  commitsSince: Schema.optional(
    Schema.Struct({
      head: Schema.String.check(Schema.isMaxLength(64)),
      count: NonNegativeInt,
    }),
  ),
  upstream: Schema.optional(RefName),
  upstreamGone: Schema.optional(Schema.Boolean),
  ahead: Schema.optional(NonNegativeInt),
  behind: Schema.optional(NonNegativeInt),
  uncommittedFiles: NonNegativeInt,
  unpushedCommits: NonNegativeInt,
  checkedAt: IsoDateTime,
  fetchedAt: Schema.optional(IsoDateTime),
  fetchFailed: Schema.optional(Schema.Boolean),
  error: Schema.optional(LibraryRepositoryHealthError),
});
export type LibraryRepositoryHealth = typeof LibraryRepositoryHealth.Type;

export const LibraryCopyHealth = Schema.Struct({
  copyId: HealthId,
  environmentId: EnvironmentId,
  repositories: Schema.Array(LibraryRepositoryHealth),
  checkedAt: IsoDateTime,
});
export type LibraryCopyHealth = typeof LibraryCopyHealth.Type;
