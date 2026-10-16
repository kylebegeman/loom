import * as Schema from "effect/Schema";
import { EnvironmentId, IsoDateTime, PositiveInt } from "../baseSchemas.ts";
import { LibraryId, LibraryRequestId } from "./project-library.ts";
import { LibraryTimelineMiniJob, LibraryTimelineScheduledRun } from "./project-library-timeline.ts";

/**
 * Advertised in `loomFeatures`, and in `LibraryInfo.features` to computers, by a Library that
 * records commits from copy health and accepts scheduled run and Mini job activity. Computers
 * publish activity only to a Library that advertises it.
 */
export const LIBRARY_TIMELINE_ACTIVITY_FEATURE = "library-timeline-activity";

const ActivityFields = {
  /** Stable for one completion on its computer, so a resend records nothing new. */
  id: LibraryId,
  /** The Library copy the work ran in. The Library finds its project. */
  copyId: LibraryId,
  /** When the work finished on its computer. */
  at: IsoDateTime,
};
/** Finished work on a computer, as published to the Library's project timeline. */
export const LibraryActivity = Schema.Union([
  Schema.Struct({
    ...ActivityFields,
    kind: Schema.Literal("scheduled-run"),
    run: LibraryTimelineScheduledRun,
  }),
  Schema.Struct({
    ...ActivityFields,
    kind: Schema.Literal("mini-job"),
    job: LibraryTimelineMiniJob,
  }),
]);
export type LibraryActivity = typeof LibraryActivity.Type;

export const LibraryRecordActivityRequest = Schema.Struct({
  authorityId: Schema.optional(LibraryId),
  authorityEpoch: Schema.optional(PositiveInt),
  requestId: LibraryRequestId,
  environmentId: EnvironmentId,
  activity: LibraryActivity,
});
export type LibraryRecordActivityRequest = typeof LibraryRecordActivityRequest.Type;
export const LibraryRecordActivityResult = Schema.Struct({
  projectId: LibraryId,
  copyId: LibraryId,
});
export type LibraryRecordActivityResult = typeof LibraryRecordActivityResult.Type;
