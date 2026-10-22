import {
  LibraryComputer,
  LibraryDocumentsPublishRequest,
  LibraryDocumentsPublishResult,
  LibraryDecisionsSearchInput,
  LibraryDecisionsSearchResult,
  LibraryAuthorizeRecoveryRequest,
  LibraryRecoveryGrant,
  LibraryRegisterComputerRequest,
  LibraryProject,
  LibraryWorkingCopy,
  LibraryThreadArchive,
  LibraryThreadSummary,
  LibraryThreadIndex,
  LibraryCreateProjectRequest,
  LibraryUpdateProjectRequest,
  LibraryArchiveProjectRequest,
  LibraryRegisterCopyRequest,
  LibraryRecordActivityRequest,
  LibraryRecordActivityResult,
  LibraryIngestHistoryRequest,
  LibraryIngestHistoryResult,
  LibraryImportShadowRequest,
  LibraryImportReceipt,
  LibraryInfo,
  LibraryError,
  LibraryRequestId,
  libraryProfileAddedUnknownTools,
  libraryProfileSecretValueField,
  libraryProfileSecretValueMessage,
  libraryProfileUnknownToolsMessage,
  LibrarySearchRequest,
  LibrarySearchResult,
  LibraryBriefProposal,
  LibraryBriefProposalPage,
  LibraryAcceptBriefProposalRequest,
  LibraryAcceptBriefProposalResult,
  LibraryDismissBriefProposalRequest,
  type LibraryBriefProposalSource,
  type LibraryBriefProposalsRequest,
  type LibraryProposeBriefRequest,
} from "@t3tools/contracts/fork";
import {
  AuthLibraryRecoveryReadScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as Config from "effect/Config";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as LibraryStore from "./LibraryStore.ts";
import * as LibraryTimeline from "./LibraryTimeline.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as ServerConfig from "../../config.ts";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import { libraryComputerDirectory, readLibraryDestination } from "./enrollment.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { libraryAttachments } from "./attachments.ts";
import { validLibraryResources } from "./policy.ts";
import { makeLibraryDocuments } from "./LibraryDocuments.ts";
import { makeLibrarySearch } from "./LibrarySearch.ts";
import { warnIfLibraryEmbeddingsUnusable } from "./LibraryEmbedder.ts";
import * as ServerActivation from "../../serverActivation.ts";
import * as BriefProposals from "./LibraryBriefProposals.ts";
import * as CopyHealthPublication from "./LibraryCopyHealthPublication.ts";
import { LOOM_SERVER_FEATURES } from "../features.ts";
import * as SessionStore from "../../auth/SessionStore.ts";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import * as Recovery from "./assets/LibraryRecoveryStore.ts";
import { readRecoveryGrantClaims, recoveryGrantSubject } from "./recoveryGrant.ts";

export class LibraryService extends Context.Service<
  LibraryService,
  {
    readonly publishDocuments: (
      input: LibraryDocumentsPublishRequest,
    ) => Effect.Effect<LibraryDocumentsPublishResult, LibraryError>;
    readonly decisions: (
      input: LibraryDecisionsSearchInput,
    ) => Effect.Effect<LibraryDecisionsSearchResult, LibraryError>;
    readonly registerComputer: (
      input: LibraryRegisterComputerRequest,
    ) => Effect.Effect<LibraryComputer, LibraryError>;
    readonly info: Effect.Effect<LibraryInfo, LibraryError>;
    readonly authorizeRecovery: (
      input: LibraryAuthorizeRecoveryRequest,
      session: Pick<AuthenticatedSession, "subject" | "scopes" | "expiresAt">,
    ) => Effect.Effect<LibraryRecoveryGrant, LibraryError>;
    readonly readRecoveryGrant: (
      input: {
        readonly destinationEnvironmentId: EnvironmentId;
        readonly sourceEnvironmentId: EnvironmentId;
        readonly workingCopyId: string;
        readonly sha256: string;
        readonly descriptorDigest: string;
      },
      session: Pick<AuthenticatedSession, "subject" | "scopes" | "expiresAt">,
    ) => ReturnType<Recovery.LibraryRecoveryStore["Service"]["get"]>;
    readonly subscribeRefreshes: Stream.Stream<number>;
    readonly projects: (input: {
      includeArchived?: boolean | undefined;
    }) => Effect.Effect<readonly LibraryProject[], LibraryError>;
    readonly project: (input: { projectId: string }) => Effect.Effect<LibraryProject, LibraryError>;
    readonly createProject: (
      input: LibraryCreateProjectRequest,
    ) => Effect.Effect<LibraryProject, LibraryError>;
    readonly updateProject: (
      input: LibraryUpdateProjectRequest,
    ) => Effect.Effect<LibraryProject, LibraryError>;
    readonly archiveProject: (
      input: LibraryArchiveProjectRequest,
    ) => Effect.Effect<LibraryProject, LibraryError>;
    readonly registerThread: (input: {
      requestId: string;
      thread: LibraryThreadArchive;
    }) => Effect.Effect<LibraryThreadSummary, LibraryError>;
    readonly registerCopy: (
      input: LibraryRegisterCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    /** Records a computer's finished scheduled run or Mini job on its copy's project timeline. */
    readonly recordActivity: (
      input: LibraryRecordActivityRequest,
    ) => Effect.Effect<LibraryRecordActivityResult, LibraryError>;
    readonly copies: (input: {
      projectId?: string | undefined;
      includeReleased?: boolean | undefined;
    }) => Effect.Effect<readonly LibraryWorkingCopy[], LibraryError>;
    readonly threads: (input: {
      projectId: string;
    }) => Effect.Effect<readonly LibraryThreadSummary[], LibraryError>;
    readonly lookupThread: (input: {
      sourceEnvironmentId: EnvironmentId;
      threadId: ThreadId;
    }) => Effect.Effect<LibraryThreadSummary | null, LibraryError>;
    readonly threadIndex: (input: {
      offset?: number | undefined;
      limit?: number | undefined;
    }) => Effect.Effect<LibraryThreadIndex, LibraryError>;
    readonly history: (input: {
      id: string;
      offset?: number | undefined;
      limit?: number | undefined;
    }) => Effect.Effect<LibraryThreadArchive, LibraryError>;
    readonly ingestHistory: (
      input: LibraryIngestHistoryRequest,
    ) => Effect.Effect<LibraryIngestHistoryResult, LibraryError>;
    readonly importShadow: (
      input: LibraryImportShadowRequest,
    ) => Effect.Effect<LibraryImportReceipt, LibraryError>;
    readonly verifyImport: (input: {
      requestId: string;
    }) => Effect.Effect<LibraryImportReceipt, LibraryError>;
    readonly search: (
      input: LibrarySearchRequest,
    ) => Effect.Effect<LibrarySearchResult, LibraryError>;
    readonly proposeBrief: (
      input: LibraryProposeBriefRequest,
      source: LibraryBriefProposalSource,
    ) => Effect.Effect<LibraryBriefProposal, LibraryError>;
    readonly briefProposals: (
      input: LibraryBriefProposalsRequest,
    ) => Effect.Effect<LibraryBriefProposalPage, LibraryError>;
    /** People only: agents propose, and the guarded RPC is the only caller. */
    readonly acceptBriefProposal: (
      input: LibraryAcceptBriefProposalRequest,
    ) => Effect.Effect<LibraryAcceptBriefProposalResult, LibraryError>;
    /** People only, like `acceptBriefProposal`. */
    readonly dismissBriefProposal: (
      input: LibraryDismissBriefProposalRequest,
    ) => Effect.Effect<LibraryBriefProposal, LibraryError>;
  }
>()("t3/fork/project-library/LibraryService") {}

function compileCodec<A>(codec: Schema.Codec<A, string>) {
  return { decode: Schema.decodeEffect(codec), encode: Schema.encodeEffect(codec) };
}
const codecs = {
  computer: compileCodec(Schema.fromJsonString(LibraryComputer)),
  project: compileCodec(Schema.fromJsonString(LibraryProject)),
  copy: compileCodec(Schema.fromJsonString(LibraryWorkingCopy)),
  archive: compileCodec(Schema.fromJsonString(Schema.toCodecJson(LibraryThreadArchive))),
  create: compileCodec(Schema.fromJsonString(LibraryCreateProjectRequest)),
  update: compileCodec(Schema.fromJsonString(LibraryUpdateProjectRequest)),
  archiveProject: compileCodec(Schema.fromJsonString(LibraryArchiveProjectRequest)),
  register: compileCodec(Schema.fromJsonString(LibraryRegisterCopyRequest)),
  recordActivity: compileCodec(Schema.fromJsonString(LibraryRecordActivityRequest)),
  activityResult: compileCodec(Schema.fromJsonString(LibraryRecordActivityResult)),
  registerThread: compileCodec(
    Schema.fromJsonString(
      Schema.toCodecJson(
        Schema.Struct({ requestId: LibraryRequestId, thread: LibraryThreadArchive }),
      ),
    ),
  ),
  summary: compileCodec(Schema.fromJsonString(LibraryThreadSummary)),
  ingest: compileCodec(Schema.fromJsonString(Schema.toCodecJson(LibraryIngestHistoryRequest))),
  ingestResult: compileCodec(Schema.fromJsonString(LibraryIngestHistoryResult)),
  import: compileCodec(Schema.fromJsonString(Schema.toCodecJson(LibraryImportShadowRequest))),
  receipt: compileCodec(Schema.fromJsonString(LibraryImportReceipt)),
  briefProposal: compileCodec(Schema.fromJsonString(LibraryBriefProposal)),
  proposeBrief: compileCodec(Schema.fromJsonString(BriefProposals.LibraryProposeBriefCommand)),
  acceptBrief: compileCodec(Schema.fromJsonString(LibraryAcceptBriefProposalRequest)),
  acceptedBrief: compileCodec(Schema.fromJsonString(LibraryAcceptBriefProposalResult)),
  dismissBrief: compileCodec(Schema.fromJsonString(LibraryDismissBriefProposalRequest)),
  authority: compileCodec(
    Schema.fromJsonString(Schema.Struct({ id: Schema.String, epoch: Schema.Int })),
  ),
};
const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
// The Library rewrites syncedAt on every save, so versions compare archives without it.
const VERSION_SYNCED_AT = "1970-01-01T00:00:00.000Z";
const isLibraryError = Schema.is(LibraryError);
const io = (cause: unknown) =>
  isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause });
/** A detail says what to fix; it reaches people and agents as the error message. */
const invalid = (detail?: string) =>
  new LibraryError({ reason: "invalid", ...(detail === undefined ? {} : { cause: detail }) });
const unknownJson = Schema.fromJsonString(Schema.Unknown);
const decodeUnknownJson = Schema.decodeSync(unknownJson);
const encodeUnknownJson = Schema.encodeSync(unknownJson);
const decodeFence = Schema.decodeUnknownEffect(
  Schema.Struct({
    authorityId: Schema.optional(Schema.String),
    authorityEpoch: Schema.optional(Schema.Int),
  }),
);
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalJson(item)]),
  );
}
const make = Effect.gen(function* () {
  const isAuthority = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(
    Config.withDefault(false),
  );
  const store = yield* LibraryStore.LibraryStore;
  const fs = yield* FileSystem.FileSystem;
  const identity = yield* ServerEnvironmentIdentity;
  const crypto = yield* Crypto.Crypto;
  const assets = yield* Assets.LibraryAssetService;
  const sessions = yield* Effect.serviceOption(SessionStore.SessionStore);
  const recovery = yield* Effect.serviceOption(Recovery.LibraryRecoveryStore);
  const historySearch = yield* makeLibrarySearch;
  const documents = yield* makeLibraryDocuments;
  if (isAuthority) yield* ServerActivation.forkParked(documents.backfill);
  const lock = yield* Semaphore.make(1);
  const refreshes = yield* SubscriptionRef.make(0);
  if (isAuthority && historySearch.semantic !== null)
    yield* ServerActivation.forkParked(historySearch.semantic.backfill(refreshes));
  else if (isAuthority) yield* warnIfLibraryEmbeddingsUnusable;
  const decode = <A>(codec: ReturnType<typeof compileCodec<A>>, text: string) =>
    codec.decode(text).pipe(Effect.mapError(io));
  const encode = <A>(codec: ReturnType<typeof compileCodec<A>>, value: A) =>
    codec
      .encode(value)
      .pipe(Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })));
  const digestValue = Effect.fnUntraced(function* (value: unknown) {
    return Hex.encode(
      yield* crypto
        .digest("SHA-256", new TextEncoder().encode(encodeUnknownJson(canonicalJson(value))))
        .pipe(Effect.mapError(io)),
    );
  });
  const digest = Effect.fnUntraced(function* (encoded: string) {
    return yield* digestValue(decodeUnknownJson(encoded));
  });
  const versionDigest = Effect.fnUntraced(function* (archive: LibraryThreadArchive) {
    return yield* digest(
      yield* encode(codecs.archive, {
        ...archive,
        summary: { ...archive.summary, syncedAt: VERSION_SYNCED_AT },
      }),
    );
  });
  // A version's digest as the saving release encoded it. Re-encoding under today's contract can add
  // a defaulted field and miss.
  const encodedVersionDigest = Effect.fnUntraced(function* (archive: unknown) {
    return typeof archive === "object" &&
      archive !== null &&
      "summary" in archive &&
      typeof archive.summary === "object" &&
      archive.summary !== null
      ? yield* digestValue({
          ...archive,
          summary: { ...archive.summary, syncedAt: VERSION_SYNCED_AT },
        })
      : null;
  });
  // Digests of a proof's archives as the importing release encoded them, which is what saveThread
  // recorded.
  const importedVersionDigests = Effect.fnUntraced(function* (proof: string) {
    const parsed = decodeUnknownJson(proof);
    const threads =
      typeof parsed === "object" && parsed !== null && "threads" in parsed ? parsed.threads : null;
    const digests: Array<string | null> = [];
    for (const archive of Array.isArray(threads) ? threads : [])
      digests.push(yield* encodedVersionDigest(archive));
    return digests;
  });
  const savedVersionDigest = Effect.fnUntraced(function* (id: string, sequence: number) {
    const saved = yield* store.threadVersion(id, sequence);
    if (saved === null) return null;
    if ("digest" in saved) return saved.digest;
    return yield* versionDigest(yield* decode(codecs.archive, saved.payload));
  });
  // Earlier releases kept a whole archive for each version. The one a save supersedes is reduced to
  // a digest of the archive exactly as stored, which an import proof of it still matches after a
  // contract change. This runs before putThread, which can then free an archive the two shared.
  // An archive that cannot be read is left for offline repair rather than blocking the save.
  const compactVersion = Effect.fnUntraced(function* (id: string, sequence: number) {
    const kept = yield* Effect.gen(function* () {
      const saved = yield* store.threadVersion(id, sequence);
      if (saved === null || "digest" in saved) return null;
      yield* decode(codecs.archive, saved.payload);
      return yield* encodedVersionDigest(decodeUnknownJson(saved.payload));
    }).pipe(Effect.orElseSucceed(() => null));
    if (kept) yield* store.compactThreadVersion(id, sequence, kept);
  });
  const transact = <A>(effect: Effect.Effect<A, LibraryError | LibraryStore.LibraryStoreError>) =>
    store
      .transaction(effect)
      .pipe(Effect.mapError(io), Effect.withSpan("LibraryService.transaction"), lock.withPermit);
  const getProject = Effect.fnUntraced(function* (projectId: string, revision?: number) {
    const saved = yield* revision === undefined
      ? store.project(projectId)
      : store.projectRevision(projectId, revision);
    if (saved === null) return yield* new LibraryError({ reason: "not-found" });
    return yield* decode(codecs.project, saved);
  });
  const putProject = Effect.fnUntraced(function* (project: LibraryProject) {
    const payload = yield* encode(codecs.project, project);
    yield* store.putProject({ ...project, payload });
    yield* store.appendEvent(project.id, "project.saved", payload, project.updatedAt);
    yield* LibraryTimeline.recordProjectTimeline(store, project);
    return project;
  });
  const mutation = Effect.fn("LibraryService.mutation")(function* <A>(
    operation: string,
    requestId: string,
    encoded: Effect.Effect<string, LibraryError>,
    codec: ReturnType<typeof compileCodec<A>>,
    action: Effect.Effect<A, LibraryError | LibraryStore.LibraryStoreError>,
  ): Effect.fn.Return<A, LibraryError> {
    // Spans carry the operation, sizes and counts, never ids or conversation text.
    yield* Effect.annotateCurrentSpan({ "library.operation": operation });
    if (!isAuthority) return yield* new LibraryError({ reason: "not-authority" });
    // Encoding and digesting a request reads nothing saved but takes seconds for a large history
    // batch, so it runs before the lock. Its failures are raised where the transaction raised them.
    // Each step is synchronous, so yields between them let waiting requests run.
    const request = yield* Effect.exit(
      Effect.gen(function* () {
        yield* Effect.yieldNow;
        const requestBody = yield* encoded;
        yield* Effect.yieldNow;
        const fence = yield* decodeFence(decodeUnknownJson(requestBody)).pipe(
          Effect.mapError(() => invalid()),
        );
        yield* Effect.yieldNow;
        return { fence, fingerprint: yield* Effect.exit(digest(requestBody)) };
      }),
    ).pipe(Effect.withSpan("LibraryService.prepareRequest"));
    return yield* transact(
      Effect.gen(function* () {
        const prepared = yield* request;
        yield* validateAuthority(prepared.fence);
        const fingerprint = yield* prepared.fingerprint;
        const receipt = yield* store.receipt(requestId);
        if (receipt) {
          if (receipt.operation !== operation || receipt.fingerprint !== fingerprint)
            return yield* new LibraryError({ reason: "request-conflict" });
          return { result: yield* decode(codec, receipt.result_json), changed: false };
        }
        const result = yield* action;
        yield* store.putReceipt(requestId, operation, fingerprint, yield* encode(codec, result));
        return { result, changed: true };
      }),
    ).pipe(
      // Publish only after the transaction commits, once per new command rather than receipt
      // replay.
      Effect.tap(({ changed }) =>
        changed ? SubscriptionRef.update(refreshes, (revision) => revision + 1) : Effect.void,
      ),
      Effect.map(({ result }) => result),
    );
  });
  const validateAuthority = Effect.fnUntraced(function* (input: {
    authorityId?: string | undefined;
    authorityEpoch?: number | undefined;
  }) {
    if ((input.authorityId === undefined) !== (input.authorityEpoch === undefined))
      return yield* invalid();
    if (input.authorityId === undefined) return;
    const payload = yield* store.authority;
    if (payload === null) return yield* new LibraryError({ reason: "blocked" });
    const authority = yield* decode(codecs.authority, payload);
    if (authority.id !== input.authorityId || authority.epoch !== input.authorityEpoch)
      return yield* new LibraryError({ reason: "blocked" });
  });
  const saveCopy = Effect.fnUntraced(function* (incoming: LibraryWorkingCopy) {
    const project = yield* getProject(incoming.projectId, incoming.projectRevision);
    if (
      incoming.repositories.length > 64 ||
      new Set(incoming.repositories.map((repo) => repo.resourceId)).size !==
        incoming.repositories.length ||
      incoming.repositories.some(
        (repo) =>
          !project.resources.some(
            (resource) => resource.kind !== "link" && resource.id === repo.resourceId,
          ),
      ) ||
      (incoming.health !== undefined &&
        !CopyHealthPublication.healthBelongsTo(incoming.health, incoming))
    )
      return yield* invalid();
    if (incoming.ownership === "borrowed" && incoming.state === "released")
      return yield* new LibraryError({ reason: "not-managed" });
    const previous = yield* store.copy(incoming.id);
    const old = previous ? yield* decode(codecs.copy, previous) : null;
    const health = CopyHealthPublication.latestCopyHealth(old?.health, incoming.health);
    if (old) {
      if (
        old.projectId !== incoming.projectId ||
        old.environmentId !== incoming.environmentId ||
        old.rootPath !== incoming.rootPath ||
        old.ownership !== incoming.ownership ||
        old.createdAt !== incoming.createdAt ||
        old.projectRevision !== incoming.projectRevision ||
        (old.rootLocalProjectId != null && old.rootLocalProjectId !== incoming.rootLocalProjectId)
      )
        return yield* invalid();
      if (Date.parse(incoming.updatedAt) < Date.parse(old.updatedAt)) {
        if (health === old.health) return old;
        // A stale record can still carry the newest health report.
        const updated = CopyHealthPublication.withCopyHealth(old, health);
        yield* store.putCopy({ ...updated, payload: yield* encode(codecs.copy, updated) });
        yield* LibraryTimeline.recordTimeline(
          store,
          LibraryTimeline.commitsTimeline(updated, old.health, health),
        );
        return updated;
      }
    }
    const copy = CopyHealthPublication.withCopyHealth(incoming, health);
    const payload = yield* encode(codecs.copy, copy);
    yield* store.putCopy({ ...copy, payload });
    // A moved head is history even when nothing else about the copy changed.
    yield* LibraryTimeline.recordTimeline(
      store,
      LibraryTimeline.commitsTimeline(copy, old?.health, health),
    );
    // Health reports alone are not copy history. Logging each one would flood the event log
    // that the timeline replays.
    const withoutHealth = (entry: LibraryWorkingCopy) =>
      encode(codecs.copy, CopyHealthPublication.withCopyHealth(entry, undefined));
    if (old !== null && (yield* withoutHealth(old)) === (yield* withoutHealth(copy))) return copy;
    yield* store.appendEvent(copy.id, "copy.saved", payload, copy.updatedAt);
    yield* LibraryTimeline.recordTimeline(store, LibraryTimeline.copyTimeline(old, copy));
    return copy;
  });
  /** `prepared` is the archive's version digest when the caller took it before the lock. */
  const saveThread = Effect.fnUntraced(function* (
    archive: LibraryThreadArchive,
    environmentId: string,
    prepared?: Effect.Effect<string, LibraryError>,
  ) {
    const archiveDigest = prepared ?? versionDigest(archive);
    if (archive.window !== undefined) return yield* invalid();
    const { summary, projection } = archive;
    if (
      summary.environmentId !== environmentId ||
      projection.thread.id !== summary.threadId ||
      projection.thread.projectId !== summary.localProjectId ||
      new Set(summary.resourceIds).size !== summary.resourceIds.length
    )
      return yield* invalid();
    yield* getProject(summary.projectId);
    if (archive.context !== undefined) {
      if (
        archive.context.id !== summary.projectId ||
        archive.context.revision !== summary.projectRevision
      )
        return yield* invalid();
      const manifest = yield* getProject(summary.projectId, archive.context.revision);
      if (
        (yield* digest(yield* encode(codecs.project, manifest))) !==
        (yield* digest(yield* encode(codecs.project, archive.context)))
      )
        return yield* invalid();
    } else if (summary.projectRevision !== undefined)
      yield* getProject(summary.projectId, summary.projectRevision);
    if (summary.workingCopyId !== null) {
      const payload = yield* store.copy(summary.workingCopyId);
      if (!payload) return yield* new LibraryError({ reason: "not-found" });
      const copy = yield* decode(codecs.copy, payload);
      if (
        copy.environmentId !== environmentId ||
        copy.projectId !== summary.projectId ||
        summary.resourceIds.some((id) => !copy.repositories.some((repo) => repo.resourceId === id))
      )
        return yield* invalid();
    }
    const old = yield* Effect.gen(function* () {
      const previous = yield* store.thread(environmentId, summary.threadId);
      return previous ? yield* decode(codecs.archive, previous) : null;
    }).pipe(Effect.withSpan("LibraryService.readPreviousThread"));
    if (old) {
      if (
        old.summary.id !== summary.id ||
        old.summary.projectId !== summary.projectId ||
        old.summary.localProjectId !== summary.localProjectId ||
        old.summary.workingCopyId !== summary.workingCopyId ||
        old.summary.projectRevision !== summary.projectRevision ||
        old.summary.resourceIds.join("\0") !== summary.resourceIds.join("\0")
      )
        return yield* new LibraryError({ reason: "sequence-conflict" });
      if (
        old.summary.sequence > summary.sequence ||
        Date.parse(old.summary.updatedAt) > Date.parse(summary.updatedAt)
      )
        return old;
      // Each sequence holds one archive. The saved conversation is compared rather than its
      // version's digest, which predates any field a later contract fills with a default.
      if (old.summary.sequence === summary.sequence) {
        if ((yield* versionDigest(old)) !== (yield* archiveDigest))
          return yield* new LibraryError({ reason: "sequence-conflict" });
        return old;
      }
    }
    const fingerprint = yield* archiveDigest;
    const version = yield* savedVersionDigest(summary.id, summary.sequence);
    if (version !== null && version !== fingerprint)
      return yield* new LibraryError({ reason: "sequence-conflict" });
    if (old) yield* compactVersion(summary.id, old.summary.sequence);
    const normalized = { ...archive, summary: { ...summary, syncedAt: yield* now } };
    yield* store.putThread({
      id: summary.id,
      environmentId,
      threadId: summary.threadId,
      projectId: summary.projectId,
      workingCopyId: summary.workingCopyId,
      sourceSequence: summary.sequence,
      summary: yield* encode(codecs.summary, normalized.summary),
      payload: yield* encode(codecs.archive, normalized),
      updatedAt: summary.updatedAt,
    });
    yield* historySearch.index(summary.id);
    if (version === null) yield* store.putThreadVersion(summary.id, summary.sequence, fingerprint);
    yield* LibraryTimeline.recordTimeline(
      store,
      LibraryTimeline.threadTimeline(
        old && LibraryTimeline.timelineThread(old),
        LibraryTimeline.timelineThread(normalized),
      ),
    );
    return normalized;
  });
  const registerComputer = (input: LibraryRegisterComputerRequest) =>
    transact(
      Effect.gen(function* () {
        if (!isAuthority) return yield* new LibraryError({ reason: "not-authority" });
        yield* validateAuthority(input);
        const computer = input.computer;
        if (
          computer.environmentId === (yield* identity.getEnvironmentId) ||
          computer.endpoints.some((endpoint) => {
            try {
              const url = new URL(endpoint);
              return (
                url.username !== "" ||
                url.password !== "" ||
                url.search !== "" ||
                url.hash !== "" ||
                (url.protocol !== "https:" &&
                  !(
                    url.protocol === "http:" &&
                    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
                  ))
              );
            } catch {
              return true;
            }
          })
        )
          return yield* invalid();
        const saved = (yield* Effect.forEach(yield* store.computers, (row) =>
          decode(codecs.computer, row),
        )).find((entry) => entry.environmentId === computer.environmentId);
        const timestamp = yield* now;
        const current = {
          ...computer,
          enrolledAt: saved?.enrolledAt ?? timestamp,
          lastSeenAt: timestamp,
        };
        yield* store.putComputer(computer.environmentId, yield* encode(codecs.computer, current));
        return {
          result: current,
          changed:
            !saved ||
            saved.label !== current.label ||
            saved.appVersion !== current.appVersion ||
            saved.endpoints.join("\0") !== current.endpoints.join("\0"),
        };
      }),
    ).pipe(
      Effect.tap(({ changed }) =>
        changed ? SubscriptionRef.update(refreshes, (revision) => revision + 1) : Effect.void,
      ),
      Effect.map(({ result }) => result),
    );
  const info = transact(
    Effect.gen(function* () {
      const saved = yield* store.authority;
      const authority = saved
        ? yield* decode(codecs.authority, saved)
        : { id: yield* randomUuidV4, epoch: 1 };
      if (!saved) yield* store.putAuthority(yield* encode(codecs.authority, authority));
      const environmentId = yield* identity.getEnvironmentId;
      const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
      const destination =
        isAuthority || Option.isNone(config)
          ? undefined
          : yield* Effect.gen(function* () {
              const configuredFile = yield* Config.String("LOOM_LIBRARY_CREDENTIAL_FILE").pipe(
                Config.option,
              );
              const home = yield* HostProcess.HomeDirectory;
              return yield* readLibraryDestination({
                sourceEnvironmentId: environmentId,
                credentialPaths: Option.isSome(configuredFile)
                  ? [configuredFile.value]
                  : [
                      `${libraryComputerDirectory(home, environmentId)}/publisher.json`,
                      `${config.value.secretsDir}/library-publisher.json`,
                    ],
              });
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.catch(() => Effect.succeed(undefined)),
            );
      return {
        ...(destination ? { destination } : {}),
        environmentId,
        isAuthority,
        computers: isAuthority
          ? yield* Effect.forEach(yield* store.computers, (row) => decode(codecs.computer, row))
          : [],
        authorityId: authority.id,
        authorityEpoch: authority.epoch,
        assets: assets.mode,
        ...(isAuthority ? { features: LOOM_SERVER_FEATURES } : {}),
      };
    }),
  );
  const authorizeRecovery: LibraryService["Service"]["authorizeRecovery"] = Effect.fn(
    "LibraryService.authorizeRecovery",
  )(function* (input, session) {
    if (!isAuthority) return yield* new LibraryError({ reason: "not-authority" });
    const issuedAt = yield* DateTime.now;
    if (
      !session.scopes.includes(AuthOrchestrationOperateScope) ||
      !session.scopes.includes(AuthOrchestrationReadScope) ||
      session.subject === "mcp-client" ||
      session.subject.startsWith("loom-host:") ||
      (session.expiresAt !== undefined &&
        session.expiresAt.epochMilliseconds <= issuedAt.epochMilliseconds)
    )
      return yield* new LibraryError({ reason: "blocked" });
    if (Option.isNone(sessions) || Option.isNone(recovery))
      return yield* new LibraryError({ reason: "publisher-unavailable" });
    const saved = yield* store.copy(input.workingCopyId).pipe(Effect.mapError(io));
    if (saved === null) return yield* new LibraryError({ reason: "not-found" });
    const current = yield* decode(codecs.copy, saved);
    const sourceCopy = input.sourceCopy ?? current;
    // Recovery and observed Git state can advance after a user accepts a snapshot. Its checkout
    // binding must still belong to the authoritative copy before the immutable archive is granted.
    if (
      current.environmentId !== input.sourceEnvironmentId ||
      sourceCopy.id !== current.id ||
      sourceCopy.environmentId !== current.environmentId ||
      sourceCopy.projectId !== current.projectId ||
      sourceCopy.projectRevision !== current.projectRevision ||
      sourceCopy.rootPath !== current.rootPath ||
      (sourceCopy.rootLocalProjectId ?? null) !== (current.rootLocalProjectId ?? null) ||
      sourceCopy.ownership !== current.ownership ||
      sourceCopy.createdAt !== current.createdAt ||
      sourceCopy.repositories.length !== current.repositories.length ||
      new Set(sourceCopy.repositories.map((repository) => repository.resourceId)).size !==
        sourceCopy.repositories.length ||
      sourceCopy.repositories.some((repository) => {
        const registered = current.repositories.find(
          (entry) => entry.resourceId === repository.resourceId,
        );
        return (
          registered === undefined ||
          registered.path !== repository.path ||
          registered.localProjectId !== repository.localProjectId
        );
      })
    )
      return yield* new LibraryError({ reason: "blocked" });
    yield* getProject(sourceCopy.projectId, sourceCopy.projectRevision).pipe(Effect.mapError(io));
    const metadata = sourceCopy.recovery;
    if (metadata === undefined) return yield* new LibraryError({ reason: "archive-unverified" });
    const archive = yield* recovery.value.get(
      sourceCopy.environmentId,
      sourceCopy.id,
      metadata.sha256,
    );
    if (
      archive.receipt.byteLength !== metadata.byteLength ||
      archive.receipt.archiveKey !== metadata.archiveKey ||
      archive.manifest.projectId !== sourceCopy.projectId ||
      archive.manifest.projectRevision !== sourceCopy.projectRevision ||
      archive.manifest.environmentId !== sourceCopy.environmentId ||
      archive.manifest.copyId !== sourceCopy.id ||
      archive.receipt.sourceEnvironmentId !== sourceCopy.environmentId ||
      archive.receipt.copyId !== sourceCopy.id ||
      archive.receipt.sha256 !== metadata.sha256
    )
      return yield* new LibraryError({ reason: "archive-unverified" });
    const expiresAt = DateTime.makeUnsafe(
      Math.min(
        issuedAt.epochMilliseconds + 5 * 60 * 1000,
        session.expiresAt?.epochMilliseconds ?? Infinity,
      ),
    );
    const descriptor = {
      sourceCopy,
      destinationEnvironmentId: input.destinationEnvironmentId,
      libraryEnvironmentId: yield* identity.getEnvironmentId,
      expiresAt: DateTime.formatIso(expiresAt),
    };
    const issued = yield* sessions.value
      .issue({
        subject: yield* recoveryGrantSubject(descriptor).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
        ),
        method: "bearer-access-token",
        scopes: [AuthLibraryRecoveryReadScope],
        expiresAt,
        client: { deviceType: "bot", label: "Loom project recovery" },
      })
      .pipe(Effect.mapError(() => new LibraryError({ reason: "io" })));
    return { ...descriptor, accessToken: issued.token };
  });
  const readRecoveryGrant: LibraryService["Service"]["readRecoveryGrant"] = Effect.fn(
    "LibraryService.readRecoveryGrant",
  )(function* (input, session) {
    if (!isAuthority) return yield* new LibraryError({ reason: "not-authority" });
    const claims = yield* readRecoveryGrantClaims(session);
    if (
      claims.destinationEnvironmentId !== input.destinationEnvironmentId ||
      claims.sourceEnvironmentId !== input.sourceEnvironmentId ||
      claims.copyId !== input.workingCopyId ||
      claims.sha256 !== input.sha256 ||
      claims.descriptorDigest !== input.descriptorDigest ||
      claims.libraryEnvironmentId !== (yield* identity.getEnvironmentId) ||
      Date.parse(claims.expiresAt) <= (yield* DateTime.now).epochMilliseconds
    )
      return yield* new LibraryError({ reason: "blocked" });
    if (Option.isNone(recovery))
      return yield* new LibraryError({ reason: "publisher-unavailable" });
    const archive = yield* recovery.value.get(
      input.sourceEnvironmentId,
      input.workingCopyId,
      input.sha256,
    );
    if (
      archive.receipt.sourceEnvironmentId !== claims.sourceEnvironmentId ||
      archive.receipt.copyId !== claims.copyId ||
      archive.receipt.sha256 !== claims.sha256 ||
      archive.receipt.byteLength !== claims.byteLength ||
      archive.manifest.projectId !== claims.projectId ||
      archive.manifest.projectRevision !== claims.projectRevision ||
      archive.manifest.copyId !== claims.copyId ||
      archive.manifest.environmentId !== claims.sourceEnvironmentId
    )
      return yield* new LibraryError({ reason: "archive-unverified" });
    return archive;
  });
  const createProject = (input: LibraryCreateProjectRequest) =>
    mutation(
      "create-project",
      input.requestId,
      encode(codecs.create, input),
      codecs.project,
      Effect.gen(function* () {
        const timestamp = yield* now;
        const resources = input.resources ?? [];
        if (!validLibraryResources(resources)) return yield* invalid();
        return yield* putProject({
          id: yield* randomUuidV4,
          title: input.title.trim(),
          brief: input.brief ?? "",
          resources,
          ...(input.color ? { color: input.color } : {}),
          archived: false,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }),
    );
  // Shared by updateProject and accepted brief proposals, so both keep the saved profile.
  // Untraced like the other catalog steps: it runs inside the calling request's RPC span.
  const reviseProject = Effect.fnUntraced(function* (input: LibraryUpdateProjectRequest) {
    const current = yield* getProject(input.projectId);
    if (current.revision !== input.expectedRevision)
      return yield* new LibraryError({ reason: "revision-conflict" });
    if (!validLibraryResources(input.resources)) return yield* invalid();
    // Omitted keeps the saved color and profile so older clients never clear them; null
    // returns the color to automatic and removes the profile.
    const { color: savedColor, profile: savedProfile, ...rest } = current;
    const color = input.color === undefined ? savedColor : (input.color ?? undefined);
    const profile = input.profile === undefined ? savedProfile : (input.profile ?? undefined);
    // Only what this save adds is checked, so a profile saved under older rules still
    // survives an unrelated edit or being resent unchanged.
    if (input.profile) {
      const unknownTools = libraryProfileAddedUnknownTools(input.profile, savedProfile);
      if (unknownTools.length)
        return yield* invalid(libraryProfileUnknownToolsMessage(unknownTools));
      const secretField = libraryProfileSecretValueField(input.profile, savedProfile);
      if (secretField) return yield* invalid(libraryProfileSecretValueMessage(secretField));
    }
    const next = {
      ...rest,
      ...(color ? { color } : {}),
      ...(profile ? { profile } : {}),
      title: input.title.trim(),
      brief: input.brief,
      resources: input.resources,
    };
    // An edit that changes nothing keeps its revision, so conversations stay current.
    if ((yield* encode(codecs.project, next)) === (yield* encode(codecs.project, current)))
      return current;
    return yield* putProject({
      ...next,
      revision: current.revision + 1,
      updatedAt: yield* now,
    });
  });
  const updateProject = (input: LibraryUpdateProjectRequest) =>
    mutation(
      "update-project",
      input.requestId,
      encode(codecs.update, input),
      codecs.project,
      reviseProject(input),
    );
  const briefs = yield* BriefProposals.make({
    getProject,
    reviseProject,
    appendEvent: store.appendEvent,
  });
  const archiveProject = (input: LibraryArchiveProjectRequest) =>
    mutation(
      "archive-project",
      input.requestId,
      encode(codecs.archiveProject, input),
      codecs.project,
      Effect.gen(function* () {
        const current = yield* getProject(input.projectId);
        if (current.revision !== input.expectedRevision)
          return yield* new LibraryError({ reason: "revision-conflict" });
        return yield* putProject({
          ...current,
          archived: input.archived,
          revision: current.revision + 1,
          updatedAt: yield* now,
        });
      }),
    );
  const registerCopy = (input: LibraryRegisterCopyRequest) =>
    mutation(
      "register-copy",
      input.requestId,
      encode(codecs.register, input),
      codecs.copy,
      Effect.gen(function* () {
        yield* validateAuthority(input);
        // A health report replaces the copy's previous one, and so does its receipt.
        const marker = yield* CopyHealthPublication.copyHealthRequestMarker(crypto, input.copy.id);
        const at = input.requestId.indexOf(marker);
        if (input.copy.health !== undefined && at > 0)
          yield* store.deleteReceipts(input.requestId.slice(0, at + marker.length));
        return yield* saveCopy(input.copy);
      }),
    );
  const recordActivity = (input: LibraryRecordActivityRequest) =>
    mutation(
      "record-activity",
      input.requestId,
      encode(codecs.recordActivity, input),
      codecs.activityResult,
      Effect.gen(function* () {
        const { activity } = input;
        if (
          Number.isNaN(Date.parse(activity.at)) ||
          (activity.kind === "scheduled-run" && Number.isNaN(Date.parse(activity.run.startedAt)))
        )
          return yield* invalid();
        const saved = yield* store.copy(activity.copyId);
        if (saved === null) return yield* new LibraryError({ reason: "not-found" });
        const copy = yield* decode(codecs.copy, saved);
        // A computer reports work only in its own copies.
        if (copy.environmentId !== input.environmentId) return yield* invalid();
        yield* LibraryTimeline.recordTimeline(store, [
          LibraryTimeline.activityTimeline(copy, activity),
        ]);
        return { projectId: copy.projectId, copyId: copy.id };
      }),
    );
  const registerThread = (input: { requestId: string; thread: LibraryThreadArchive }) =>
    mutation(
      "register-thread",
      input.requestId,
      encode(codecs.registerThread, input),
      codecs.summary,
      saveThread(input.thread, input.thread.summary.environmentId).pipe(
        Effect.map((archive) => archive.summary),
      ),
    );
  const ingestHistory = Effect.fn("LibraryService.ingestHistory")(function* (
    input: LibraryIngestHistoryRequest,
  ) {
    yield* Effect.annotateCurrentSpan({ "library.entries": input.entries.length });
    const ingestDigest = (thread: LibraryThreadArchive) =>
      encode(codecs.archive, thread).pipe(Effect.flatMap(digest));
    // A computer resends a batch whose response it lost, and the receipt answers it without the
    // entries, so their digests are skipped once one exists. The check uses the reader, so it does
    // not wait behind a write. Skipped digests are taken in the transaction if it needs them.
    const replayed =
      !isAuthority ||
      (yield* store.transaction(store.receipt(input.requestId)).pipe(
        NodeSqliteClient.readOnly,
        Effect.orElseSucceed(() => null),
      )) !== null;
    // Entry digests read nothing saved either, so they are taken before the lock with the
    // request's, and a failure is raised at the entry that raised it before.
    const entries = replayed
      ? input.entries.map((entry) => ({
          entry,
          ingested: ingestDigest(entry.thread),
          version: undefined,
        }))
      : yield* Effect.forEach(input.entries, (entry) =>
          Effect.all({
            entry: Effect.succeed(entry),
            ingested: Effect.exit(Effect.yieldNow.pipe(Effect.andThen(ingestDigest(entry.thread)))),
            version: Effect.exit(Effect.yieldNow.pipe(Effect.andThen(versionDigest(entry.thread)))),
          }),
        ).pipe(Effect.withSpan("LibraryService.prepareEntries"));
    return yield* mutation(
      "ingest-history",
      input.requestId,
      encode(codecs.ingest, input),
      codecs.ingestResult,
      Effect.gen(function* () {
        yield* validateAuthority(input);
        let cursor = yield* store.cursor(input.sourceEnvironmentId, input.journalId);
        if (input.fromSequence > cursor) return yield* new LibraryError({ reason: "sequence-gap" });
        let applied = 0;
        for (const [index, { entry, ingested, version }] of entries.entries()) {
          if (entry.sequence !== input.fromSequence + index + 1)
            return yield* new LibraryError({ reason: "sequence-gap" });
          const fingerprint = yield* ingested;
          if (entry.sequence <= cursor) {
            if (
              (yield* store.ingestedDigest(
                input.sourceEnvironmentId,
                input.journalId,
                entry.sequence,
              )) !== fingerprint
            )
              return yield* new LibraryError({ reason: "sequence-conflict" });
            continue;
          }
          if (entry.sequence !== cursor + 1)
            return yield* new LibraryError({ reason: "sequence-gap" });
          yield* saveThread(entry.thread, input.sourceEnvironmentId, version);
          yield* store.putIngestedDigest(
            input.sourceEnvironmentId,
            input.journalId,
            entry.sequence,
            fingerprint,
          );
          cursor = entry.sequence;
          applied++;
        }
        yield* store.putCursor(input.sourceEnvironmentId, input.journalId, cursor);
        yield* store.appendEvent(
          input.sourceEnvironmentId,
          "history.ingested",
          encodeUnknownJson({ journalId: input.journalId, lastSequence: cursor, applied }),
          yield* now,
        );
        return {
          sourceEnvironmentId: input.sourceEnvironmentId,
          journalId: input.journalId,
          lastSequence: cursor,
          applied,
        };
      }),
    );
  });
  const verifyProof = Effect.fnUntraced(function* (
    input: LibraryImportShadowRequest,
    proof: string,
  ) {
    let logicalRecordsVerified = true;
    for (const project of input.projects) {
      const saved = yield* store.projectRevision(project.id, project.revision);
      if (
        saved === null ||
        (yield* digest(saved)) !== (yield* digest(yield* encode(codecs.project, project)))
      )
        logicalRecordsVerified = false;
    }
    for (const copy of input.copies) {
      const saved = yield* store.copy(copy.id);
      if (saved === null) {
        logicalRecordsVerified = false;
        continue;
      }
      const current = yield* decode(codecs.copy, saved);
      if (
        current.projectId !== copy.projectId ||
        current.projectRevision !== copy.projectRevision ||
        current.environmentId !== copy.environmentId ||
        current.ownership !== copy.ownership ||
        current.rootPath !== copy.rootPath ||
        current.createdAt !== copy.createdAt ||
        current.repositories
          .map(
            (repository) =>
              `${repository.resourceId}\0${repository.localProjectId}\0${repository.path}`,
          )
          .join("\n") !==
          copy.repositories
            .map(
              (repository) =>
                `${repository.resourceId}\0${repository.localProjectId}\0${repository.path}`,
            )
            .join("\n")
      )
        logicalRecordsVerified = false;
    }
    const attachments = new Map<string, { id: string; bytes: number }>();
    let imported: ReadonlyArray<string | null> | undefined;
    for (const [index, thread] of input.threads.entries()) {
      const saved = yield* store.thread(input.sourceEnvironmentId, thread.summary.threadId);
      const current = saved === null ? null : yield* decode(codecs.archive, saved);
      // Like saveThread, a proof of the current sequence is checked against the conversation.
      const expected =
        current?.summary.sequence === thread.summary.sequence
          ? yield* versionDigest(current)
          : yield* savedVersionDigest(thread.summary.id, thread.summary.sequence);
      if (current === null || current.summary.sequence < thread.summary.sequence)
        logicalRecordsVerified = false;
      else if (expected !== (yield* versionDigest(thread))) {
        // Parsed only on a mismatch, since a proof can be as large as the computer's history.
        imported ??= yield* importedVersionDigests(proof);
        if (expected === null || expected !== imported[index]) logicalRecordsVerified = false;
      }
      for (const attachment of libraryAttachments(thread))
        attachments.set(attachment.id, { id: attachment.id, bytes: attachment.sizeBytes });
    }
    let missingAssets = 0;
    for (const attachment of attachments.values()) {
      const covered = yield* Effect.gen(function* () {
        const asset = yield* assets.find(input.sourceEnvironmentId, attachment.id);
        const bytes = yield* assets.read(asset);
        return asset.bytes === attachment.bytes && bytes.length === attachment.bytes;
      }).pipe(Effect.orElseSucceed(() => false));
      if (!covered) missingAssets++;
    }
    return {
      requestId: input.requestId,
      projects: input.projects.length,
      copies: input.copies.length,
      threads: input.threads.length,
      throughSequence: input.throughSequence,
      logicalRecordsVerified,
      referencedAssets: attachments.size,
      missingAssets,
      assetBytesVerified: missingAssets === 0,
      verified: logicalRecordsVerified && missingAssets === 0,
    };
  });
  const verifyImport = (input: { requestId: string }) =>
    transact(
      Effect.gen(function* () {
        const proof = yield* store.importProof(input.requestId);
        if (proof === null) return yield* new LibraryError({ reason: "not-found" });
        return yield* verifyProof(yield* decode(codecs.import, proof), proof);
      }),
    );
  const importShadow = (input: LibraryImportShadowRequest) =>
    mutation(
      "import-shadow",
      input.requestId,
      encode(codecs.import, input),
      codecs.receipt,
      Effect.gen(function* () {
        yield* validateAuthority(input);
        if (
          new Set(input.projects.map((project) => project.id)).size !== input.projects.length ||
          new Set(input.copies.map((copy) => copy.id)).size !== input.copies.length ||
          new Set(input.threads.map((thread) => thread.summary.id)).size !== input.threads.length
        )
          return yield* invalid();
        for (const project of input.projects) {
          if (!validLibraryResources(project.resources, { allowLocalRemotes: true }))
            return yield* invalid();
          const existing = yield* store.project(project.id);
          if (
            existing &&
            (yield* digest(existing)) !== (yield* digest(yield* encode(codecs.project, project)))
          )
            return yield* new LibraryError({ reason: "revision-conflict" });
          if (!existing) yield* putProject(project);
        }
        for (const copy of input.copies) {
          if (copy.environmentId !== input.sourceEnvironmentId || copy.ownership !== "borrowed")
            return yield* invalid();
          yield* saveCopy(copy);
        }
        for (const thread of input.threads) yield* saveThread(thread, input.sourceEnvironmentId);
        const cursor = yield* store.cursor(input.sourceEnvironmentId, input.journalId);
        if (input.throughSequence < cursor)
          return yield* new LibraryError({ reason: "sequence-conflict" });
        yield* store.putCursor(input.sourceEnvironmentId, input.journalId, input.throughSequence);
        const proof = yield* encode(codecs.import, input);
        yield* store.putImportProof(input.requestId, proof);
        return yield* verifyProof(input, proof);
      }),
    );
  const catalogRead = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    isAuthority ? effect : Effect.fail(new LibraryError({ reason: "not-authority" }));
  return LibraryService.of({
    publishDocuments: (input) =>
      transact(
        Effect.gen(function* () {
          if (!isAuthority) return yield* new LibraryError({ reason: "not-authority" });
          yield* validateAuthority(input);
          return yield* documents.publish(input);
        }),
      ),
    decisions: (input) => catalogRead(documents.search(input)),
    info,
    authorizeRecovery,
    readRecoveryGrant,
    registerComputer,
    subscribeRefreshes: SubscriptionRef.changes(refreshes),
    createProject,
    updateProject,
    archiveProject,
    registerCopy,
    recordActivity,
    registerThread,
    ingestHistory,
    importShadow,
    verifyImport,
    search: (input) => catalogRead(historySearch.search(input)),
    proposeBrief: (input, source) =>
      mutation(
        "propose-brief",
        input.requestId,
        encode(codecs.proposeBrief, { ...input, source }),
        codecs.briefProposal,
        briefs.propose({ ...input, source }),
      ),
    briefProposals: (input) => catalogRead(briefs.list(input).pipe(Effect.mapError(io))),
    acceptBriefProposal: (input) =>
      mutation(
        "accept-brief-proposal",
        input.requestId,
        encode(codecs.acceptBrief, input),
        codecs.acceptedBrief,
        briefs.accept(input),
      ),
    dismissBriefProposal: (input) =>
      mutation(
        "dismiss-brief-proposal",
        input.requestId,
        encode(codecs.dismissBrief, input),
        codecs.briefProposal,
        briefs.dismiss(input),
      ),
    project: (input) => catalogRead(getProject(input.projectId).pipe(Effect.mapError(io))),
    projects: (input) =>
      catalogRead(
        store.projects(input.includeArchived ?? false).pipe(
          Effect.flatMap((rows) => Effect.forEach(rows, (row) => decode(codecs.project, row))),
          Effect.mapError(io),
        ),
      ),
    copies: (input) =>
      catalogRead(
        store.copies(input.projectId).pipe(
          Effect.flatMap((rows) => Effect.forEach(rows, (row) => decode(codecs.copy, row))),
          Effect.map((copies) =>
            input.includeReleased === true
              ? copies
              : copies.filter((copy) => copy.registered !== false && copy.state !== "released"),
          ),
          Effect.mapError(io),
        ),
      ),
    threads: (input) =>
      catalogRead(
        store.threads(input.projectId, 2147483647, 0).pipe(
          Effect.flatMap((rows) => Effect.forEach(rows, (row) => decode(codecs.summary, row))),
          Effect.mapError(io),
        ),
      ),
    lookupThread: (input) =>
      catalogRead(
        store.threadSummary(input.sourceEnvironmentId, input.threadId).pipe(
          Effect.flatMap((row) =>
            row === null ? Effect.succeed(null) : decode(codecs.summary, row),
          ),
          Effect.mapError(io),
        ),
      ),
    threadIndex: (input) => {
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 100;
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 200
      )
        return Effect.fail(new LibraryError({ reason: "invalid" }));
      return catalogRead(
        store.threadIndex(limit + 1, offset).pipe(
          Effect.flatMap((rows) => Effect.forEach(rows, (row) => decode(codecs.summary, row))),
          Effect.map((rows) => ({
            threads: rows.slice(0, limit),
            nextOffset: rows.length > limit ? offset + limit : null,
          })),
          Effect.mapError(io),
        ),
      );
    },
    history: (input) =>
      catalogRead(
        Effect.gen(function* () {
          if (input.offset !== undefined || input.limit !== undefined) {
            const offset = input.offset ?? 0,
              limit = input.limit ?? 50;
            if (
              !Number.isSafeInteger(offset) ||
              offset < 0 ||
              !Number.isSafeInteger(limit) ||
              limit < 1 ||
              limit > 100
            )
              return yield* invalid();
            const page = yield* store.historyWindow(input.id, offset, limit);
            if (!page) return yield* new LibraryError({ reason: "not-found" });
            const archive = yield* decode(codecs.archive, page.payload);
            return {
              ...archive,
              window: {
                offset,
                totalItems: page.totalItems,
                hasMore: offset + (page.itemCount ?? limit) < page.totalItems,
                nextOffset: offset + (page.itemCount ?? limit),
              },
            };
          }
          const row = yield* store.history(input.id);
          return row === null
            ? yield* new LibraryError({ reason: "not-found" })
            : yield* decode(codecs.archive, row);
        }).pipe(Effect.mapError(io)),
      ),
  });
});
export const layer = Layer.effect(LibraryService, make).pipe(Layer.provide(LibraryStore.layer));
