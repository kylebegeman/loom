import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  EnvironmentId,
  PositiveInt,
  NonNegativeInt,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { LibraryError, LibraryId } from "./project-library.ts";
import { LibrarySearchMatch } from "./project-library-semantic-search.ts";

export const LIBRARY_DECISIONS_FEATURE = "library-decisions";
export const LIBRARY_DOCUMENT_MAX_BYTES = 64 * 1024;
export const LIBRARY_DOCUMENT_BATCH_SIZE = 50;
export const LibraryDocumentKind = Schema.Literals(["decision", "catalogue"]);
export type LibraryDocumentKind = typeof LibraryDocumentKind.Type;
export const LibraryDocumentStatus = Schema.Literals([
  "accepted",
  "in-progress",
  "superseded",
  "idea",
  "unknown",
]);
export type LibraryDocumentStatus = typeof LibraryDocumentStatus.Type;
export const LibraryDocumentKey = Schema.Struct({
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  anchor: Schema.String.check(Schema.isMaxLength(512)),
});
export const LibraryDocument = Schema.Struct({
  projectId: LibraryId,
  resourceId: LibraryId,
  ...LibraryDocumentKey.fields,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  kind: LibraryDocumentKind,
  status: LibraryDocumentStatus,
  date: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(100))),
  supersededBy: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  text: Schema.String.check(Schema.isMaxLength(LIBRARY_DOCUMENT_MAX_BYTES)),
});
export type LibraryDocument = typeof LibraryDocument.Type;
export const LibraryDocumentsPublishRequest = Schema.Struct({
  computerId: EnvironmentId,
  projectId: LibraryId,
  resourceId: LibraryId,
  commit: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/)),
  documents: Schema.Array(LibraryDocument).check(Schema.isMaxLength(LIBRARY_DOCUMENT_BATCH_SIZE)),
  removed: Schema.Array(LibraryDocumentKey).check(Schema.isMaxLength(LIBRARY_DOCUMENT_BATCH_SIZE)),
  authorityId: LibraryId,
  authorityEpoch: PositiveInt,
});
export type LibraryDocumentsPublishRequest = typeof LibraryDocumentsPublishRequest.Type;
export const LibraryDocumentsPublishResult = Schema.Struct({
  published: NonNegativeInt,
  removed: NonNegativeInt,
});
export type LibraryDocumentsPublishResult = typeof LibraryDocumentsPublishResult.Type;
export const LibraryDecisionsSearchInput = Schema.Struct({
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  projectId: Schema.optional(LibraryId),
  includeRetired: Schema.optional(Schema.Boolean),
  kind: Schema.optional(LibraryDocumentKind),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(50))),
});
export type LibraryDecisionsSearchInput = typeof LibraryDecisionsSearchInput.Type;
export const LibraryDecisionsSearchHit = Schema.Struct({
  ...LibraryDocument.fields,
  repository: Schema.String,
  commit: Schema.String,
  snippet: Schema.String,
  rank: Schema.Number,
  match: Schema.optional(LibrarySearchMatch),
});
export type LibraryDecisionsSearchHit = typeof LibraryDecisionsSearchHit.Type;
export const LibraryDecisionsSearchResult = Schema.Struct({
  hits: Schema.Array(LibraryDecisionsSearchHit),
});
export type LibraryDecisionsSearchResult = typeof LibraryDecisionsSearchResult.Type;
export const LIBRARY_DECISIONS_WS_METHODS = { search: "loom.library.decisions" } as const;
export const LibraryDecisionsRpcGroup = RpcGroup.make(
  Rpc.make(LIBRARY_DECISIONS_WS_METHODS.search, {
    payload: LibraryDecisionsSearchInput,
    success: LibraryDecisionsSearchResult,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
);
