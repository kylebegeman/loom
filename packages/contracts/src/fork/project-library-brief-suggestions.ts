import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { IsoDateTime, ThreadId } from "../baseSchemas.ts";
import { LibraryError, LibraryId } from "./project-library.ts";
import { LibraryProposeBriefRequest } from "./project-library-brief.ts";

/**
 * Advertised by a server that saves a project's brief suggestion setting, forwards brief
 * proposals and project reads from its conversations to the Library, and runs suggestions
 * when its conversations settle. Clients check the Library for the setting and the
 * conversation's computer for its offer.
 */
export const LIBRARY_BRIEF_SUGGESTIONS_FEATURE = "library-brief-suggestions";

/** Suggestion runs one computer starts for one project in any 24 hours. Later settles skip. */
export const BRIEF_SUGGESTION_RUNS_PER_DAY = 3;

export const LIBRARY_BRIEF_SUGGESTION_WS_METHODS = {
  suggestion: "loom.library.brief-suggestion",
  start: "loom.library.brief-suggestion-start",
  decline: "loom.library.brief-suggestion-decline",
} as const;

/**
 * `offered` waits for a person (the project asks first). `starting` is recorded before the run
 * launches, so a restart finishes the launch instead of starting another. `skipped` never ran.
 */
export const LibraryBriefSuggestionStatus = Schema.Literals([
  "offered",
  "starting",
  "started",
  "declined",
  "skipped",
]);
export type LibraryBriefSuggestionStatus = typeof LibraryBriefSuggestionStatus.Type;

/** `daily-limit`: the project reached `BRIEF_SUGGESTION_RUNS_PER_DAY` on this computer. */
export const LibraryBriefSuggestionSkipReason = Schema.Literals(["daily-limit", "launch-failed"]);
export type LibraryBriefSuggestionSkipReason = typeof LibraryBriefSuggestionSkipReason.Type;

/** At most one per conversation, kept by the computer where it settled. */
export const LibraryBriefSuggestion = Schema.Struct({
  threadId: ThreadId,
  projectId: LibraryId,
  /** The project setting when the conversation settled. */
  mode: Schema.Literals(["ask", "automatic"]),
  /** The settle that triggered it. */
  settledAt: IsoDateTime,
  status: LibraryBriefSuggestionStatus,
  reason: Schema.optional(LibraryBriefSuggestionSkipReason),
  /** The background conversation that reads this one and may propose. */
  runThreadId: Schema.optional(ThreadId),
  /** The proposal the run made, linked to this conversation. */
  proposalId: Schema.optional(LibraryId),
  updatedAt: IsoDateTime,
});
export type LibraryBriefSuggestion = typeof LibraryBriefSuggestion.Type;

/**
 * A proposal a computer forwards for one of its conversations. The Library takes the computer
 * from the caller's session, so a computer can only propose as its own conversations.
 */
export const LibraryConversationBriefProposal = Schema.Struct({
  ...LibraryProposeBriefRequest.fields,
  threadId: ThreadId,
});
export type LibraryConversationBriefProposal = typeof LibraryConversationBriefProposal.Type;

export const LibraryBriefSuggestionRequest = Schema.Struct({ threadId: ThreadId });
export type LibraryBriefSuggestionRequest = typeof LibraryBriefSuggestionRequest.Type;

const SuggestionError = Schema.Union([LibraryError, EnvironmentAuthorizationError]);

export const ProjectLibraryBriefSuggestionRpcGroup = RpcGroup.make(
  Rpc.make(LIBRARY_BRIEF_SUGGESTION_WS_METHODS.suggestion, {
    payload: LibraryBriefSuggestionRequest,
    success: Schema.NullOr(LibraryBriefSuggestion),
    error: SuggestionError,
  }),
  /** Starts an offered suggestion. Fails with `invalid` unless it is offered. */
  Rpc.make(LIBRARY_BRIEF_SUGGESTION_WS_METHODS.start, {
    payload: LibraryBriefSuggestionRequest,
    success: LibraryBriefSuggestion,
    error: SuggestionError,
  }),
  Rpc.make(LIBRARY_BRIEF_SUGGESTION_WS_METHODS.decline, {
    payload: LibraryBriefSuggestionRequest,
    success: LibraryBriefSuggestion,
    error: SuggestionError,
  }),
);
