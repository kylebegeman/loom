import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import {
  LibraryError,
  LibraryId,
  LibraryProject,
  LibraryRequestId,
  LibraryTitle,
} from "./project-library.ts";

/** Advertised by the Library computer once it stores and decides brief proposals. */
export const LIBRARY_BRIEF_PROPOSALS_FEATURE = "library-brief-proposals";

export const LibraryBriefProposalStatus = Schema.Literals([
  "pending",
  "accepted",
  "dismissed",
  "superseded",
]);
export type LibraryBriefProposalStatus = typeof LibraryBriefProposalStatus.Type;

/**
 * Who proposed the change. The server sets it from the caller, never from request input:
 * an agent in a T3 conversation, an agent signed in through MCP, or a person.
 */
export const LibraryBriefProposalSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("conversation"),
    environmentId: EnvironmentId,
    threadId: ThreadId,
  }),
  Schema.Struct({ kind: Schema.Literal("agent"), id: LibraryId, label: LibraryTitle }),
  Schema.Struct({ kind: Schema.Literal("user") }),
]);
export type LibraryBriefProposalSource = typeof LibraryBriefProposalSource.Type;

const LibraryBriefText = LibraryProject.fields.brief;
const LibraryBriefSummary = TrimmedNonEmptyString.check(Schema.isMaxLength(2000));

/** A full replacement brief, not a patch. Clients diff it against `baseRevision` or the current text. */
export const LibraryBriefProposal = Schema.Struct({
  id: LibraryId,
  projectId: LibraryId,
  baseRevision: PositiveInt,
  proposedBrief: LibraryBriefText,
  /** Why the brief should change. */
  summary: LibraryBriefSummary,
  source: LibraryBriefProposalSource,
  status: LibraryBriefProposalStatus,
  createdAt: IsoDateTime,
  decidedAt: Schema.optional(IsoDateTime),
  /** The project revision the accepted brief was saved as. */
  acceptedRevision: Schema.optional(PositiveInt),
});
export type LibraryBriefProposal = typeof LibraryBriefProposal.Type;

export const LibraryProposeBriefRequest = Schema.Struct({
  requestId: LibraryRequestId,
  projectId: LibraryId,
  /** The project revision whose brief the proposal rewrites. */
  baseRevision: PositiveInt,
  proposedBrief: LibraryBriefText,
  summary: LibraryBriefSummary,
});
export type LibraryProposeBriefRequest = typeof LibraryProposeBriefRequest.Type;

export const LibraryBriefProposalsRequest = Schema.Struct({
  projectId: LibraryId,
  status: Schema.optional(LibraryBriefProposalStatus),
  offset: Schema.optional(NonNegativeInt),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
});
export type LibraryBriefProposalsRequest = typeof LibraryBriefProposalsRequest.Type;

/** Newest first. */
export const LibraryBriefProposalPage = Schema.Struct({
  proposals: Schema.Array(LibraryBriefProposal),
  nextOffset: Schema.NullOr(NonNegativeInt),
});
export type LibraryBriefProposalPage = typeof LibraryBriefProposalPage.Type;

/**
 * Saves the proposed brief, or `brief` when the person edited it, as the next project
 * revision. `expectedRevision` must be the current revision. Without `brief` it must also
 * be the proposal's base; otherwise the request fails with `revision-conflict` so the
 * client can show the proposal against the current text.
 */
export const LibraryAcceptBriefProposalRequest = Schema.Struct({
  requestId: LibraryRequestId,
  proposalId: LibraryId,
  expectedRevision: PositiveInt,
  brief: Schema.optional(LibraryBriefText),
});
export type LibraryAcceptBriefProposalRequest = typeof LibraryAcceptBriefProposalRequest.Type;

export const LibraryAcceptBriefProposalResult = Schema.Struct({
  proposal: LibraryBriefProposal,
  project: LibraryProject,
});
export type LibraryAcceptBriefProposalResult = typeof LibraryAcceptBriefProposalResult.Type;

export const LibraryDismissBriefProposalRequest = Schema.Struct({
  requestId: LibraryRequestId,
  proposalId: LibraryId,
});
export type LibraryDismissBriefProposalRequest = typeof LibraryDismissBriefProposalRequest.Type;

export const LIBRARY_BRIEF_WS_METHODS = {
  propose: "loom.library.brief-propose",
  proposals: "loom.library.brief-proposals",
  accept: "loom.library.brief-accept",
  dismiss: "loom.library.brief-dismiss",
} as const;
const error = Schema.Union([LibraryError, EnvironmentAuthorizationError]);
export const ProjectLibraryBriefRpcGroup = RpcGroup.make(
  Rpc.make(LIBRARY_BRIEF_WS_METHODS.propose, {
    payload: LibraryProposeBriefRequest,
    success: LibraryBriefProposal,
    error,
  }),
  Rpc.make(LIBRARY_BRIEF_WS_METHODS.proposals, {
    payload: LibraryBriefProposalsRequest,
    success: LibraryBriefProposalPage,
    error,
  }),
  Rpc.make(LIBRARY_BRIEF_WS_METHODS.accept, {
    payload: LibraryAcceptBriefProposalRequest,
    success: LibraryAcceptBriefProposalResult,
    error,
  }),
  Rpc.make(LIBRARY_BRIEF_WS_METHODS.dismiss, {
    payload: LibraryDismissBriefProposalRequest,
    success: LibraryBriefProposal,
    error,
  }),
);
