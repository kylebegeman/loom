import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  EnvironmentId,
  ForwardCompatibleUnionArray,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { LibraryError, LibraryId, LibraryTitle } from "./project-library.ts";

/** Advertised in `loomFeatures` by a Library that records and serves project timelines. */
export const LIBRARY_TIMELINE_FEATURE = "library-timeline";

const CONVERSATION_KINDS = [
  "conversation-started",
  "conversation-settled",
  "conversation-failed",
  "conversation-archived",
] as const;
const PULL_REQUEST_KINDS = [
  "pull-request-linked",
  "pull-request-merged",
  "pull-request-closed",
  "pull-request-checks-failed",
] as const;
const COPY_KINDS = ["copy-added", "copy-released", "copy-failed"] as const;
/** Recorded only by a Library that advertises `library-timeline-activity`. */
export const LIBRARY_TIMELINE_ACTIVITY_KINDS = ["commits", "scheduled-run", "mini-job"] as const;
export const LIBRARY_TIMELINE_KINDS = [
  ...CONVERSATION_KINDS,
  ...PULL_REQUEST_KINDS,
  "brief-revised",
  "brief-proposed",
  ...COPY_KINDS,
  ...LIBRARY_TIMELINE_ACTIVITY_KINDS,
] as const;
export const LibraryTimelineKind = Schema.Literals(LIBRARY_TIMELINE_KINDS);
export type LibraryTimelineKind = typeof LibraryTimelineKind.Type;

const entryFields = {
  /** Position in the Library's event log. Pass the oldest one shown as `before` for the next page. */
  sequence: PositiveInt,
  /** When the change happened on its computer, not when the Library heard about it. */
  at: IsoDateTime,
  /** Computer the change came from; null for changes made on the Library itself. */
  environmentId: Schema.NullOr(EnvironmentId),
  /** Rebuilt from saved records when the timeline was introduced, so time and order are estimates. */
  approximate: Schema.optional(Schema.Boolean),
};
export const LibraryTimelineConversation = Schema.Struct({
  /** Library conversation id, as read by `loom.library.history`. */
  id: LibraryId,
  threadId: ThreadId,
  title: Schema.String,
});
export type LibraryTimelineConversation = typeof LibraryTimelineConversation.Type;
export const LibraryTimelineConversationEntry = Schema.Struct({
  ...entryFields,
  kind: Schema.Literals(CONVERSATION_KINDS),
  conversation: LibraryTimelineConversation,
});
export const LibraryTimelinePullRequest = Schema.Struct({
  url: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: Schema.NullOr(Schema.String),
});
export type LibraryTimelinePullRequest = typeof LibraryTimelinePullRequest.Type;
export const LibraryTimelinePullRequestEntry = Schema.Struct({
  ...entryFields,
  kind: Schema.Literals(PULL_REQUEST_KINDS),
  conversation: LibraryTimelineConversation,
  pullRequest: LibraryTimelinePullRequest,
});
export const LibraryTimelineBriefEntry = Schema.Struct({
  ...entryFields,
  kind: Schema.Literal("brief-revised"),
  revision: PositiveInt,
  title: LibraryTitle,
});
/** A new brief proposal, read in full through `loom.library.brief-proposals`. */
export const LibraryTimelineBriefProposalEntry = Schema.Struct({
  ...entryFields,
  kind: Schema.Literal("brief-proposed"),
  proposalId: LibraryId,
  summary: Schema.String,
});
export const LibraryTimelineCopy = Schema.Struct({ id: LibraryId, rootPath: Schema.String });
export type LibraryTimelineCopy = typeof LibraryTimelineCopy.Type;
export const LibraryTimelineCopyEntry = Schema.Struct({
  ...entryFields,
  kind: Schema.Literals(COPY_KINDS),
  copy: LibraryTimelineCopy,
});
const CommitId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
/**
 * A repository in a copy moved from `from` to `to` between two health reports. `count` is the
 * number of commits from `from` to `to`, present only when its computer could count them: `to`
 * builds on `from` and the computer still remembered `from`. A rewrite or a branch switch has none.
 */
export const LibraryTimelineCommitsEntry = Schema.Struct({
  ...entryFields,
  kind: Schema.Literal("commits"),
  copy: LibraryTimelineCopy,
  repository: Schema.Struct({
    resourceId: LibraryId,
    branch: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
  }),
  from: CommitId,
  to: CommitId,
  count: Schema.optional(NonNegativeInt),
});
/** A scheduled task run that finished, with no prompt or error text. `at` is when it finished. */
export const LibraryTimelineScheduledRun = Schema.Struct({
  taskId: LibraryId,
  title: Schema.String.check(Schema.isMaxLength(160)),
  status: Schema.Literals(["succeeded", "failed"]),
  startedAt: IsoDateTime,
});
export type LibraryTimelineScheduledRun = typeof LibraryTimelineScheduledRun.Type;
export const LibraryTimelineScheduledRunEntry = Schema.Struct({
  ...entryFields,
  kind: Schema.Literal("scheduled-run"),
  copy: LibraryTimelineCopy,
  run: LibraryTimelineScheduledRun,
});
/** A Mini job that reached a final state. `summary` is the worker's short reason, if it gave one. */
export const LibraryTimelineMiniJob = Schema.Struct({
  requestId: LibraryId,
  label: Schema.String.check(Schema.isMaxLength(80)),
  workerName: Schema.optional(Schema.String.check(Schema.isMaxLength(80))),
  status: Schema.Literals(["succeeded", "failed", "cancelled", "interrupted"]),
  exitCode: Schema.optional(Schema.Int),
  summary: Schema.optional(Schema.String.check(Schema.isMaxLength(160))),
});
export type LibraryTimelineMiniJob = typeof LibraryTimelineMiniJob.Type;
export const LibraryTimelineMiniJobEntry = Schema.Struct({
  ...entryFields,
  kind: Schema.Literal("mini-job"),
  copy: LibraryTimelineCopy,
  job: LibraryTimelineMiniJob,
});
const entryMembers = [
  LibraryTimelineConversationEntry,
  LibraryTimelinePullRequestEntry,
  LibraryTimelineBriefEntry,
  LibraryTimelineBriefProposalEntry,
  LibraryTimelineCopyEntry,
  LibraryTimelineCommitsEntry,
  LibraryTimelineScheduledRunEntry,
  LibraryTimelineMiniJobEntry,
] as const;
export const LibraryTimelineEntry = Schema.Union(entryMembers);
export type LibraryTimelineEntry = typeof LibraryTimelineEntry.Type;

export const LibraryTimelineRequest = Schema.Struct({
  projectId: LibraryId,
  /** Read entries older than this sequence. Omit for the newest page. */
  before: Schema.optional(PositiveInt),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
  /** Only these kinds. Kinds this Library does not know are ignored, so newer clients can ask. */
  kinds: Schema.optional(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(64))).check(Schema.isMaxLength(32)),
  ),
});
export type LibraryTimelineRequest = typeof LibraryTimelineRequest.Type;
export const LibraryTimelinePage = Schema.Struct({
  /** Newest first. Kinds added by a newer Library are skipped rather than failing the page. */
  entries: ForwardCompatibleUnionArray(entryMembers, "kind"),
  /** Pass as `before` to read older entries; null at the start of the project. */
  nextBefore: Schema.NullOr(PositiveInt),
});
export type LibraryTimelinePage = typeof LibraryTimelinePage.Type;

export const LIBRARY_TIMELINE_WS_METHODS = {
  timeline: "loom.library.timeline",
} as const;
export const ProjectLibraryTimelineRpcGroup = RpcGroup.make(
  Rpc.make(LIBRARY_TIMELINE_WS_METHODS.timeline, {
    payload: LibraryTimelineRequest,
    success: LibraryTimelinePage,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
);
