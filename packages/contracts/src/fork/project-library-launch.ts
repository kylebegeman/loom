import * as Schema from "effect/Schema";
import { EnvironmentId, IsoDateTime } from "../baseSchemas.ts";
import { LibraryId } from "./project-library.ts";

/** Advertised in `loomFeatures` by a Library that ranks where a project's conversation should start. */
export const LIBRARY_LAUNCH_CANDIDATES_FEATURE = "library-launch-candidates";

export const LibraryLaunchCandidatesRequest = Schema.Struct({
  projectId: LibraryId,
  /** The components the conversation needs. Omitted means the whole project. */
  resourceIds: Schema.optional(Schema.Array(LibraryId).check(Schema.isMaxLength(64))),
});
export type LibraryLaunchCandidatesRequest = typeof LibraryLaunchCandidatesRequest.Type;

/** One computer, or one copy on it, ranked as the New conversation dialog ranks it. */
export const LibraryLaunchCandidateSummary = Schema.Struct({
  /** `copy` starts in an existing copy; `get-copy` needs a copy prepared first. */
  kind: Schema.Literals(["copy", "get-copy"]),
  environmentId: EnvironmentId,
  label: Schema.String,
  /** Seen by the Library recently. Only online computers are preselected. */
  online: Schema.Boolean,
  copyId: Schema.optional(LibraryId),
  /** How current the copy is, from the health its computer last published. */
  freshness: Schema.optional(Schema.Literals(["up-to-date", "unknown", "stale", "broken"])),
  /** Most recent conversation of this project on this computer. */
  lastUsedAt: Schema.NullOr(IsoDateTime),
  /** Short reasons in display order, for example ["online", "up to date", "used last"]. */
  reasons: Schema.Array(Schema.String),
  /** The candidate the dialog would choose for the user. At most one is preselected. */
  preselected: Schema.Boolean,
});
export type LibraryLaunchCandidateSummary = typeof LibraryLaunchCandidateSummary.Type;

export const LibraryLaunchCandidates = Schema.Struct({
  projectId: LibraryId,
  /** Best first. Offline computers stay listed after every online one. */
  candidates: Schema.Array(LibraryLaunchCandidateSummary),
});
export type LibraryLaunchCandidates = typeof LibraryLaunchCandidates.Type;
