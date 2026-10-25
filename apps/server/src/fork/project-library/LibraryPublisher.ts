import { libraryJsonBody } from "./transfer.ts";
import * as LibraryService from "./LibraryService.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { EnvironmentId, type ThreadId } from "@t3tools/contracts";
import {
  LibraryBriefProposal,
  LibraryDocumentsPublishRequest,
  LibraryDocumentsPublishResult,
  LibraryDecisionsSearchInput,
  LibraryDecisionsSearchResult,
  LibraryConversationBriefProposal,
  LibraryProject,
  type LibraryProposeBriefRequest,
  LibraryRegisterComputerRequest,
  LibraryError,
  LibraryId,
  LibraryInfo,
  LibraryIngestHistoryRequest,
  LibraryIngestHistoryResult,
  LibraryPageReplies,
  type LibraryPageReply,
  LibraryPageRepliesNextRequest,
  LibraryPageReplyAckRequest,
  LibraryPagePublishRequest,
  LibraryPreviewAccess,
  LibraryPreviewRegisterRequest,
  LibraryRegisterCopyRequest,
  LibraryRecordActivityRequest,
  LibraryRecordActivityResult,
  LibraryWorkingCopy,
  type LibraryThreadArchive,
  PREVIEW_PAGE_MAX_BYTES,
  PreviewPage,
  PreviewPagesError,
  PreviewPageUpdateInput,
} from "@t3tools/contracts/fork";
import { PreviewAccessService } from "../preview-access/PreviewAccessService.ts";
import { resolveLibraryConnection } from "./LibraryConnection.ts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import {
  ServerEnvironment,
  ServerEnvironmentIdentity,
} from "../../environment/ServerEnvironment.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClientRequest, type HttpClientResponse } from "effect/http";
import { resolveAttachmentPathById } from "../../attachmentStore.ts";
import * as ServerConfig from "../../config.ts";
import { libraryAttachments, libraryPageUploads } from "./attachments.ts";
import {
  LibraryAsset,
  type LibraryAsset as LibraryAssetType,
} from "./assets/LibraryAssetService.ts";
import { LIBRARY_ASSET_MAX_BYTES } from "./assets/LibraryObjectStore.ts";

/** Host publishing is a separate boundary so durable outbox behavior needs no network in tests. */
export class LibraryPublisher extends Context.Service<
  LibraryPublisher,
  {
    readonly enabled: boolean;
    readonly decisions: (
      input: LibraryDecisionsSearchInput,
    ) => Effect.Effect<LibraryDecisionsSearchResult, LibraryError>;
    readonly copyRegistrations: Stream.Stream<LibraryWorkingCopy>;
    readonly publishDocuments: (
      input: LibraryDocumentsPublishRequest,
    ) => Effect.Effect<LibraryDocumentsPublishResult, LibraryError>;
    readonly info: Effect.Effect<LibraryInfo, LibraryError>;
    readonly ingest: (
      input: LibraryIngestHistoryRequest,
    ) => Effect.Effect<LibraryIngestHistoryResult, LibraryError>;
    readonly registerCopy: (
      input: LibraryRegisterCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    /**
     * Uploads the attachments a conversation references. Resolves with the ones a deleted
     * conversation lost before the Library got them, which its history must leave out: the
     * Library would otherwise count them missing in every backup. A conversation deleted after
     * the snapshot counts as deleted. A live conversation fails `not-found`.
     */
    readonly publishAttachments: (
      archive: LibraryThreadArchive,
    ) => Effect.Effect<ReadonlySet<string>, LibraryError>;
    readonly recordActivity: (
      input: LibraryRecordActivityRequest,
    ) => Effect.Effect<LibraryRecordActivityResult, LibraryError>;
    /** The project as the Library has it now. */
    readonly project: (projectId: string) => Effect.Effect<LibraryProject, LibraryError>;
    /** Proposes a brief as one of this computer's conversations. */
    readonly proposeBrief: (
      input: LibraryProposeBriefRequest,
      threadId: ThreadId,
    ) => Effect.Effect<LibraryBriefProposal, LibraryError>;
    /**
     * Tells the Library which preview hosts this computer serves, or null to stop its sign-in.
     * Fails with `not-found` when the Library does not offer preview sign-in.
     */
    readonly registerPreviews: (
      previews: LibraryPreviewRegisterRequest["previews"],
    ) => Effect.Effect<LibraryPreviewAccess, LibraryError>;
    /**
     * Pages fail `unavailable` when the Library does not serve them, so callers can tell an
     * older or page-less Library from one that refused.
     */
    readonly publishPage: (
      input: LibraryPagePublishRequest,
    ) => Effect.Effect<PreviewPage, PreviewPagesError>;
    readonly listPages: () => Effect.Effect<ReadonlyArray<PreviewPage>, PreviewPagesError>;
    readonly updatePage: (
      input: PreviewPageUpdateInput,
    ) => Effect.Effect<PreviewPage, PreviewPagesError>;
    /** Waits up to `waitMs` for replies to this computer's pages, leasing those it returns. */
    readonly nextReplies: (
      waitMs: number,
    ) => Effect.Effect<ReadonlyArray<LibraryPageReply>, PreviewPagesError>;
    readonly ackReply: (
      input: LibraryPageReplyAckRequest,
    ) => Effect.Effect<void, PreviewPagesError>;
    /** Ends every pages browser sign-in; a Library that predates this answers `unavailable`. */
    readonly signOutPageReaders: () => Effect.Effect<void, PreviewPagesError>;
  }
>()("t3/fork/project-library/LibraryPublisher") {}

const PAGES_ERROR_MESSAGES: Record<PreviewPagesError["reason"], string> = {
  unavailable: "Publishing pages needs a connected Library that serves pages.",
  "not-found": "That page was not found.",
  invalid: "The Library could not accept that page request.",
  "too-large": `A page can be at most ${PREVIEW_PAGE_MAX_BYTES / (1024 * 1024)} MB.`,
  blocked: "The Library refused this computer's page request.",
  io: "Could not reach the Library. Try again in a moment.",
};
/** A Library's own refusal can explain itself, such as a full page quota. */
const LIBRARY_MESSAGE_MAX = 300;

export const libraryPagesError = (reason: PreviewPagesError["reason"], message?: string) =>
  new PreviewPagesError({
    reason,
    message:
      message === undefined || message.trim() === ""
        ? PAGES_ERROR_MESSAGES[reason]
        : message.trim().slice(0, LIBRARY_MESSAGE_MAX),
  });

const encodeIngest = Schema.encodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(LibraryIngestHistoryRequest)),
);
const decodeInfo = Schema.decodeUnknownEffect(LibraryInfo);
const decodeIngest = Schema.decodeUnknownEffect(LibraryIngestHistoryResult);
const encodeCopy = Schema.encodeEffect(Schema.fromJsonString(LibraryRegisterCopyRequest));
const decodeCopy = Schema.decodeUnknownEffect(LibraryWorkingCopy);
const encodeActivity = Schema.encodeEffect(Schema.fromJsonString(LibraryRecordActivityRequest));
const decodeActivity = Schema.decodeUnknownEffect(LibraryRecordActivityResult);
const decodeAsset = Schema.decodeUnknownEffect(LibraryAsset);
const encodeProjectRead = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ projectId: LibraryId })),
);
const decodeProject = Schema.decodeUnknownEffect(LibraryProject);
const encodeProposal = Schema.encodeEffect(Schema.fromJsonString(LibraryConversationBriefProposal));
const decodeProposal = Schema.decodeUnknownEffect(LibraryBriefProposal);
const encodePreviews = Schema.encodeEffect(Schema.fromJsonString(LibraryPreviewRegisterRequest));
const decodePreviewAccess = Schema.decodeUnknownEffect(LibraryPreviewAccess);
const decodeReason = Schema.decodeUnknownEffect(
  Schema.Struct({ reason: LibraryError.fields.reason }),
);
const encodePagePublish = Schema.encodeEffect(Schema.fromJsonString(LibraryPagePublishRequest));
const encodePageUpdate = Schema.encodeEffect(Schema.fromJsonString(PreviewPageUpdateInput));
const encodeRepliesNext = Schema.encodeEffect(Schema.fromJsonString(LibraryPageRepliesNextRequest));
const encodeReplyAck = Schema.encodeEffect(Schema.fromJsonString(LibraryPageReplyAckRequest));
const decodePage = Schema.decodeUnknownEffect(PreviewPage);
const decodePages = Schema.decodeUnknownEffect(Schema.Struct({ pages: Schema.Array(PreviewPage) }));
const decodeReplies = Schema.decodeUnknownEffect(LibraryPageReplies);
const decodePageRefusal = Schema.decodeUnknownEffect(
  Schema.Struct({
    reason: PreviewPagesError.fields.reason,
    message: Schema.optional(Schema.String),
  }),
);
const encodeDecisions = Schema.encodeEffect(Schema.fromJsonString(LibraryDecisionsSearchInput));
const decodeDecisions = Schema.decodeUnknownEffect(LibraryDecisionsSearchResult);
const encodeDocuments = Schema.encodeEffect(Schema.fromJsonString(LibraryDocumentsPublishRequest));
const decodeDocuments = Schema.decodeUnknownEffect(LibraryDocumentsPublishResult);
const isLibraryError = Schema.is(LibraryError);
const missingAttachment = (attachmentId: string) =>
  new LibraryError({
    reason: "not-found",
    detail: `Attachment ${attachmentId} is missing from this computer.`,
  });
const make = Effect.gen(function* () {
  const registrations = yield* PubSub.unbounded<LibraryWorkingCopy>();
  const copyRegistrations = Stream.fromPubSub(registrations);
  const registered = (copy: LibraryWorkingCopy) => PubSub.publish(registrations, copy);
  const connection = yield* resolveLibraryConnection;
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const sourceIdentity = yield* ServerEnvironmentIdentity;
  const sourceEnvironmentId = yield* sourceIdentity.getEnvironmentId;
  const noPages = Effect.fail(libraryPagesError("unavailable"));
  const unavailable = (enabled: boolean) => {
    const blocked = Effect.fail(new LibraryError({ reason: "blocked" }));
    return LibraryPublisher.of({
      enabled,
      copyRegistrations,
      publishDocuments: () => blocked,
      decisions: () => blocked,
      info: blocked,
      ingest: () => blocked,
      registerCopy: () => blocked,
      publishAttachments: () => blocked,
      recordActivity: () => blocked,
      project: () => blocked,
      proposeBrief: () => blocked,
      registerPreviews: () => blocked,
      publishPage: () => noPages,
      listPages: () => noPages,
      updatePage: () => noPages,
      nextReplies: () => noPages,
      ackReply: () => noPages,
      signOutPageReaders: () => noPages,
    });
  };
  if (connection.kind === "none") return unavailable(false);
  if (connection.kind === "unavailable") return unavailable(true);
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  // Deleting a conversation removes its attachment files, and that can happen before its last
  // snapshot is uploaded. Null means the file is gone and nothing can bring it back.
  const sourceFile = Effect.fnUntraced(function* (attachmentId: string) {
    const path = resolveAttachmentPathById({ attachmentsDir: config.attachmentsDir, attachmentId });
    if (path === null) return null;
    return yield* fs.stat(path).pipe(
      Effect.map((info) => ({ path, size: Number(info.size) })),
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
    );
  });
  // A snapshot queued before its conversation was deleted still says live, and the journal sends
  // it before the deletion's own snapshot, after deletion removed the files.
  const wasDeleted = Effect.fnUntraced(function* (archive: LibraryThreadArchive) {
    if (archive.summary.deleted === true) return true;
    const rows = yield* sql<{
      deleted: number;
    }>`SELECT 1 AS deleted FROM orchestration_v2_projection_threads WHERE thread_id=${archive.summary.threadId} AND deleted_at IS NOT NULL`;
    return rows.length > 0;
  });
  if (connection.kind === "authority") {
    const localLibrary = yield* LibraryService.LibraryService;
    const localAssets = yield* Assets.LibraryAssetService;
    const localPreviewAccess = yield* PreviewAccessService;
    const publishLocalAttachments = Effect.fnUntraced(
      function* (archive: LibraryThreadArchive) {
        const gone = new Set<string>();
        let deleted: boolean | undefined;
        for (const attachment of [
          ...libraryAttachments(archive),
          ...(yield* libraryPageUploads(fs, config.attachmentsDir, archive)),
        ]) {
          const source = yield* sourceFile(attachment.id);
          if (source === null) {
            deleted ??= yield* wasDeleted(archive);
            if (!deleted) return yield* missingAttachment(attachment.id);
            // An earlier snapshot may have saved it before the file went.
            const held = yield* localAssets.find(archive.summary.environmentId, attachment.id).pipe(
              Effect.map((asset) => asset.bytes === attachment.sizeBytes),
              Effect.catchIf(
                (error) => error.reason === "not-found",
                () => Effect.succeed(false),
              ),
            );
            if (!held) gone.add(attachment.id);
            continue;
          }
          if (source.size !== attachment.sizeBytes || source.size > LIBRARY_ASSET_MAX_BYTES)
            return yield* new LibraryError({ reason: "invalid" });
          const bytes = yield* fs.readFile(source.path);
          yield* localAssets.put({
            sourceEnvironmentId: archive.summary.environmentId,
            attachmentId: attachment.id,
            filename: attachment.name,
            contentType: attachment.mimeType,
            bytes,
          });
        }
        return gone;
      },
      Effect.mapError((cause) =>
        isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
      ),
    );
    return LibraryPublisher.of({
      enabled: true,
      copyRegistrations,
      publishDocuments: localLibrary.publishDocuments,
      decisions: localLibrary.decisions,
      info: localLibrary.info,
      ingest: localLibrary.ingestHistory,
      registerCopy: (input) => localLibrary.registerCopy(input).pipe(Effect.tap(registered)),
      publishAttachments: publishLocalAttachments,
      recordActivity: localLibrary.recordActivity,
      project: (projectId) => localLibrary.project({ projectId }),
      proposeBrief: (input, threadId) =>
        localLibrary.proposeBrief(input, {
          kind: "conversation",
          environmentId: sourceEnvironmentId,
          threadId,
        }),
      // A Library that is its own computer registers in-process, with no session to outlive.
      registerPreviews: (previews) =>
        localPreviewAccess
          .register({ environmentId: sourceEnvironmentId, sessionId: null, previews })
          .pipe(
            // Callers read not-found as "no preview sign-in here", as a remote Library answers it.
            Effect.catchIf(
              (error) => error.reason === "not-authority",
              () => Effect.fail(new LibraryError({ reason: "not-found" })),
            ),
          ),
      // Pages are filed under the publishing computer's Library sign-in, which a Library that is
      // its own computer does not have.
      publishPage: () => noPages,
      listPages: () => noPages,
      updatePage: () => noPages,
      nextReplies: () => noPages,
      ackReply: () => noPages,
      signOutPageReaders: () => noPages,
    });
  }
  const { credential, endpoint, send } = connection;
  const execute = Effect.fnUntraced(function* (
    request: HttpClientRequest.HttpClientRequest,
    /** Keep the reason the Library gave for refusing, such as a full proposal queue. */
    keepReason = false,
    /** A route newer than the Library answers 404, which callers treat as unsupported. */
    notFound = false,
  ) {
    const response = yield* send(request);
    if (keepReason && (response.status === 400 || response.status === 409)) {
      const refused = yield* response.json.pipe(Effect.flatMap(decodeReason), Effect.option);
      if (Option.isSome(refused)) return yield* new LibraryError({ reason: refused.value.reason });
    }
    if (notFound && response.status === 404)
      return yield* new LibraryError({ reason: "not-found" });
    // Without a detail, "blocked" reads as a busy working copy, which this refusal never is.
    if (response.status === 401 || response.status === 403)
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "Your Library refused this request from this computer. Reconnect this computer to your Library, then try again.",
      });
    if (response.status < 200 || response.status >= 300)
      return yield* new LibraryError({ reason: "io" });
    return response;
  });
  /** A Library without pages answers their routes 404; it explains every other refusal. */
  const executePage = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest) {
    const response = yield* send(request).pipe(
      Effect.mapError((error) => libraryPagesError(error.reason === "blocked" ? "blocked" : "io")),
    );
    if (response.status === 404) return yield* libraryPagesError("unavailable");
    if (response.status === 409) {
      const refused = yield* response.json.pipe(Effect.flatMap(decodePageRefusal), Effect.option);
      if (Option.isSome(refused))
        return yield* libraryPagesError(refused.value.reason, refused.value.message);
    }
    // The Library caps the request body, which JSON escaping can push past a page that fits.
    if (response.status === 413) return yield* libraryPagesError("too-large");
    if (response.status < 200 || response.status >= 300)
      return yield* libraryPagesError(
        response.status === 401 || response.status === 403 ? "blocked" : "io",
      );
    // A Library older than pages answers a GET it does not know with its web app's index page.
    if (/^text\/html\b/i.test(response.headers["content-type"] ?? ""))
      return yield* libraryPagesError("unavailable");
    return response;
  });
  const descriptorService = yield* Effect.serviceOption(ServerEnvironment);
  const encodeComputer = Schema.encodeEffect(Schema.fromJsonString(LibraryRegisterComputerRequest));
  const info = Effect.gen(function* () {
    const response = yield* execute(HttpClientRequest.get(endpoint("/api/loom/library/info")));
    const info = yield* response.json.pipe(
      Effect.flatMap(decodeInfo),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
    );
    if (credential !== null && info.environmentId !== credential.libraryEnvironmentId)
      return yield* new LibraryError({ reason: "blocked" });
    if (info.computers !== undefined) {
      const descriptor = Option.isSome(descriptorService)
        ? yield* descriptorService.value.getDescriptor
        : null;
      const computer = descriptor
        ? {
            environmentId: descriptor.environmentId,
            label: descriptor.label,
            platform: descriptor.platform,
            appVersion: descriptor.serverVersion,
            supportsExecution: descriptor.capabilities.supportsExecution !== false,
            endpoints: credential?.computer?.endpoints ?? [],
          }
        : credential?.computer;
      if (computer !== undefined && computer !== null) {
        if (computer.environmentId !== (yield* sourceIdentity.getEnvironmentId))
          return yield* new LibraryError({ reason: "blocked" });
        yield* execute(
          HttpClientRequest.post(endpoint("/api/loom/library/computers/register")).pipe(
            HttpClientRequest.bodyText(
              yield* encodeComputer({
                authorityId: info.authorityId,
                authorityEpoch: info.authorityEpoch,
                computer,
              }).pipe(Effect.mapError(() => new LibraryError({ reason: "invalid" }))),
              "application/json",
            ),
          ),
        );
      }
    }
    return info;
  });
  const ingest = Effect.fnUntraced(function* (input: LibraryIngestHistoryRequest) {
    const body = yield* encodeIngest(input).pipe(
      Effect.mapError(() => new LibraryError({ reason: "invalid" })),
    );
    const response = yield* execute(
      yield* libraryJsonBody(
        HttpClientRequest.post(endpoint("/api/loom/library/history/ingest")),
        body,
      ),
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodeIngest),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
    );
  });
  const registerCopy = Effect.fnUntraced(function* (input: LibraryRegisterCopyRequest) {
    const body = yield* encodeCopy(input).pipe(
      Effect.mapError(() => new LibraryError({ reason: "invalid" })),
    );
    const response = yield* execute(
      HttpClientRequest.post(endpoint("/api/loom/library/copies/register")).pipe(
        HttpClientRequest.bodyText(body, "application/json"),
      ),
      // Replication skips a copy whose project the Library no longer has, as it does locally.
      true,
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodeCopy),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
      Effect.tap(registered),
    );
  });
  const decisions = Effect.fn("LibraryPublisher.decisions")(function* (
    input: LibraryDecisionsSearchInput,
  ) {
    const body = yield* encodeDecisions(input).pipe(
      Effect.mapError(() => new LibraryError({ reason: "invalid" })),
    );
    const response = yield* execute(
      HttpClientRequest.post(endpoint("/api/loom/library/documents/search")).pipe(
        HttpClientRequest.bodyText(body, "application/json"),
      ),
      true,
      true,
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodeDecisions),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
    );
  });
  const publishDocuments = Effect.fn("LibraryPublisher.publishDocuments")(function* (
    input: LibraryDocumentsPublishRequest,
  ) {
    if (input.computerId !== sourceEnvironmentId)
      return yield* new LibraryError({ reason: "blocked" });
    const body = yield* encodeDocuments(input).pipe(
      Effect.mapError(() => new LibraryError({ reason: "invalid" })),
    );
    const response = yield* execute(
      HttpClientRequest.post(endpoint("/api/loom/library/documents/publish")).pipe(
        HttpClientRequest.bodyText(body, "application/json"),
      ),
      true,
      true,
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodeDocuments),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
    );
  });
  const recordActivity = Effect.fnUntraced(function* (input: LibraryRecordActivityRequest) {
    const body = yield* encodeActivity(input).pipe(
      Effect.mapError(() => new LibraryError({ reason: "invalid" })),
    );
    const response = yield* execute(
      HttpClientRequest.post(endpoint("/api/loom/library/activity/record")).pipe(
        HttpClientRequest.bodyText(body, "application/json"),
      ),
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodeActivity),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
    );
  });
  const assetEndpoint = (environmentId: EnvironmentId, attachmentId: string) =>
    endpoint(
      `/api/loom/library/assets/${encodeURIComponent(environmentId)}/${encodeURIComponent(attachmentId)}`,
    );
  const recordAsset = (attachmentId: string, digest: string, bytes: number) =>
    sql`INSERT INTO fork_library_source_assets (attachment_id,payload_digest,bytes) VALUES (${attachmentId},${digest},${bytes}) ON CONFLICT(attachment_id) DO UPDATE SET payload_digest=excluded.payload_digest,bytes=excluded.bytes`;
  // The ledger misses assets uploaded another way, such as by the migration script, and the
  // Library keeps those after the local file is gone. History must keep referencing them.
  const libraryHolds = Effect.fnUntraced(function* (
    environmentId: EnvironmentId,
    attachment: { readonly id: string; readonly sizeBytes: number },
  ) {
    const response = yield* execute(
      HttpClientRequest.get(assetEndpoint(environmentId, attachment.id)),
      false,
      true,
    ).pipe(
      Effect.catchIf(
        (error) => error.reason === "not-found",
        () => Effect.succeed(null),
      ),
    );
    if (response === null) return false;
    const bytes = new Uint8Array(
      yield* response.arrayBuffer.pipe(Effect.mapError(() => new LibraryError({ reason: "io" }))),
    );
    if (bytes.length !== attachment.sizeBytes) return false;
    yield* recordAsset(
      attachment.id,
      Hex.encode(yield* crypto.digest("SHA-256", bytes)),
      bytes.length,
    );
    return true;
  });
  const uploadAsset = Effect.fnUntraced(function* (
    environmentId: EnvironmentId,
    attachmentId: string,
    filename: string,
    contentType: string,
    bytes: Uint8Array,
  ): Effect.fn.Return<LibraryAssetType, LibraryError> {
    const response = yield* execute(
      HttpClientRequest.put(assetEndpoint(environmentId, attachmentId)).pipe(
        HttpClientRequest.setHeader("x-loom-filename", encodeURIComponent(filename)),
        HttpClientRequest.bodyUint8Array(bytes, contentType),
      ),
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodeAsset),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
    );
  });
  const publishAttachments = Effect.fnUntraced(
    function* (archive: LibraryThreadArchive) {
      const gone = new Set<string>();
      let deleted: boolean | undefined;
      for (const attachment of [
        ...libraryAttachments(archive),
        ...(yield* libraryPageUploads(fs, config.attachmentsDir, archive)),
      ]) {
        const published = yield* sql<{
          bytes: number;
        }>`SELECT bytes FROM fork_library_source_assets WHERE attachment_id=${attachment.id}`;
        if (published[0]?.bytes === attachment.sizeBytes) continue;
        const source = yield* sourceFile(attachment.id);
        if (source === null) {
          deleted ??= yield* wasDeleted(archive);
          if (!deleted) return yield* missingAttachment(attachment.id);
          if (!(yield* libraryHolds(archive.summary.environmentId, attachment)))
            gone.add(attachment.id);
          continue;
        }
        if (source.size !== attachment.sizeBytes || source.size > LIBRARY_ASSET_MAX_BYTES)
          return yield* new LibraryError({ reason: "invalid" });
        const bytes = yield* fs.readFile(source.path);
        const digest = Hex.encode(yield* crypto.digest("SHA-256", bytes));
        const saved = yield* uploadAsset(
          archive.summary.environmentId,
          attachment.id,
          attachment.name,
          attachment.mimeType,
          bytes,
        );
        if (
          saved.sourceEnvironmentId !== archive.summary.environmentId ||
          saved.attachmentId !== attachment.id ||
          saved.digest !== digest ||
          saved.bytes !== bytes.length
        )
          return yield* new LibraryError({ reason: "io" });
        yield* recordAsset(attachment.id, digest, bytes.length);
      }
      return gone;
    },
    Effect.mapError((cause) =>
      isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
    ),
  );
  const project = Effect.fnUntraced(function* (projectId: string) {
    const body = yield* encodeProjectRead({ projectId }).pipe(
      Effect.mapError(() => new LibraryError({ reason: "invalid" })),
    );
    const response = yield* execute(
      HttpClientRequest.post(endpoint("/api/loom/library/projects/read")).pipe(
        HttpClientRequest.bodyText(body, "application/json"),
      ),
      true,
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodeProject),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
    );
  });
  const proposeBrief = Effect.fnUntraced(function* (
    input: LibraryProposeBriefRequest,
    threadId: ThreadId,
  ) {
    const body = yield* encodeProposal({ ...input, threadId }).pipe(
      Effect.mapError(() => new LibraryError({ reason: "invalid" })),
    );
    const response = yield* execute(
      HttpClientRequest.post(endpoint("/api/loom/library/brief/propose")).pipe(
        HttpClientRequest.bodyText(body, "application/json"),
      ),
      true,
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodeProposal),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
    );
  });
  const registerPreviews = Effect.fnUntraced(function* (
    previews: LibraryPreviewRegisterRequest["previews"],
  ) {
    const body = yield* encodePreviews({ environmentId: sourceEnvironmentId, previews }).pipe(
      Effect.mapError(() => new LibraryError({ reason: "invalid" })),
    );
    const response = yield* execute(
      HttpClientRequest.post(endpoint("/api/loom/library/previews/register")).pipe(
        HttpClientRequest.bodyText(body, "application/json"),
      ),
      false,
      true,
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodePreviewAccess),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
    );
  });
  const postPage = Effect.fnUntraced(function* (route: string, body: string) {
    return yield* executePage(
      HttpClientRequest.post(endpoint(`/api/loom/library/pages${route}`)).pipe(
        HttpClientRequest.bodyText(body, "application/json"),
      ),
    );
  });
  const readPageJson = <A, E>(
    response: HttpClientResponse.HttpClientResponse,
    decode: (input: unknown) => Effect.Effect<A, E>,
  ) =>
    response.json.pipe(
      Effect.flatMap(decode),
      Effect.mapError(() => libraryPagesError("io")),
    );
  const invalidPageRequest = () => libraryPagesError("invalid");
  const publishPage = Effect.fnUntraced(function* (input: LibraryPagePublishRequest) {
    const body = yield* encodePagePublish(input).pipe(Effect.mapError(invalidPageRequest));
    return yield* readPageJson(yield* postPage("/publish", body), decodePage);
  });
  const listPages = Effect.fnUntraced(function* () {
    const response = yield* executePage(HttpClientRequest.get(endpoint("/api/loom/library/pages")));
    return (yield* readPageJson(response, decodePages)).pages;
  });
  const updatePage = Effect.fnUntraced(function* (input: PreviewPageUpdateInput) {
    const body = yield* encodePageUpdate(input).pipe(Effect.mapError(invalidPageRequest));
    return yield* readPageJson(yield* postPage("/update", body), decodePage);
  });
  const nextReplies = Effect.fnUntraced(function* (waitMs: number) {
    const body = yield* encodeRepliesNext({ waitMs }).pipe(Effect.mapError(invalidPageRequest));
    return (yield* readPageJson(yield* postPage("/replies/next", body), decodeReplies)).replies;
  });
  const ackReply = Effect.fnUntraced(function* (input: LibraryPageReplyAckRequest) {
    const body = yield* encodeReplyAck(input).pipe(Effect.mapError(invalidPageRequest));
    yield* postPage("/replies/ack", body);
  });
  const signOutPageReaders = Effect.fnUntraced(function* () {
    yield* postPage("/sign-out", "{}");
  });
  return LibraryPublisher.of({
    enabled: true,
    copyRegistrations,
    publishDocuments,
    decisions,
    info,
    ingest,
    registerCopy,
    publishAttachments,
    recordActivity,
    project,
    proposeBrief,
    registerPreviews,
    publishPage,
    listPages,
    updatePage,
    nextReplies,
    ackReply,
    signOutPageReaders,
  });
});
export const layer = Layer.effect(LibraryPublisher, make);
