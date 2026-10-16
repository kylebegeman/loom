import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  EnvironmentId,
  ForwardCompatibleUnionArray,
  IsoDateTime,
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
export const LIBRARY_TIMELINE_KINDS = [
  ...CONVERSATION_KINDS,
  ...PULL_REQUEST_KINDS,
  "brief-revised",
  ...COPY_KINDS,
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
export const LibraryTimelineCopyEntry = Schema.Struct({
  ...entryFields,
  kind: Schema.Literals(COPY_KINDS),
  copy: Schema.Struct({ id: LibraryId, rootPath: Schema.String }),
});
const entryMembers = [
  LibraryTimelineConversationEntry,
  LibraryTimelinePullRequestEntry,
  LibraryTimelineBriefEntry,
  LibraryTimelineCopyEntry,
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
