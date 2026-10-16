import {
  LibraryComputer,
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
  LibraryIngestHistoryRequest,
  LibraryIngestHistoryResult,
  LibraryImportShadowRequest,
  LibraryImportReceipt,
  LibraryInfo,
  LibraryError,
  LibraryRequestId,
} from "@t3tools/contracts/fork";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
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
import * as Assets from "./assets/LibraryAssetService.ts";
import { libraryAttachments } from "./attachments.ts";
import { validLibraryResources } from "./policy.ts";

export class LibraryService extends Context.Service<
  LibraryService,
  {
    readonly registerComputer: (
      input: LibraryRegisterComputerRequest,
    ) => Effect.Effect<LibraryComputer, LibraryError>;
    readonly info: Effect.Effect<LibraryInfo, LibraryError>;
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
  authority: compileCodec(
    Schema.fromJsonString(Schema.Struct({ id: Schema.String, epoch: Schema.Int })),
  ),
};
const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
const isLibraryError = Schema.is(LibraryError);
const io = (cause: unknown) =>
  isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause });
const invalid = () => new LibraryError({ reason: "invalid" });
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
  const identity = yield* ServerEnvironmentIdentity;
  const crypto = yield* Crypto.Crypto;
  const assets = yield* Assets.LibraryAssetService;
  const lock = yield* Semaphore.make(1);
  const refreshes = yield* SubscriptionRef.make(0);
  const decode = <A>(codec: ReturnType<typeof compileCodec<A>>, text: string) =>
    codec.decode(text).pipe(Effect.mapError(io));
  const encode = <A>(codec: ReturnType<typeof compileCodec<A>>, value: A) =>
    codec
      .encode(value)
      .pipe(Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })));
  const digest = Effect.fnUntraced(function* (encoded: string) {
    return Hex.encode(
      yield* crypto
        .digest(
          "SHA-256",
          new TextEncoder().encode(encodeUnknownJson(canonicalJson(decodeUnknownJson(encoded)))),
        )
        .pipe(Effect.mapError(io)),
    );
  });
  const transact = <A>(effect: Effect.Effect<A, LibraryError | LibraryStore.LibraryStoreError>) =>
    store.transaction(effect).pipe(Effect.mapError(io), lock.withPermit);
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
    return project;
  });
  const mutation = <A>(
    operation: string,
    requestId: string,
    encoded: Effect.Effect<string, LibraryError>,
    codec: ReturnType<typeof compileCodec<A>>,
    action: Effect.Effect<A, LibraryError | LibraryStore.LibraryStoreError>,
  ) =>
    transact(
      Effect.gen(function* () {
        if (!isAuthority) return yield* new LibraryError({ reason: "not-authority" });
        const requestBody = yield* encoded;
        yield* validateAuthority(
          yield* decodeFence(decodeUnknownJson(requestBody)).pipe(Effect.mapError(() => invalid())),
        );
        const fingerprint = yield* digest(requestBody);
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
      // Publish only after the transaction commits, once per new command rather than receipt replay.
      Effect.tap(({ changed }) =>
        changed ? SubscriptionRef.update(refreshes, (revision) => revision + 1) : Effect.void,
      ),
      Effect.map(({ result }) => result),
    );
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
  const saveCopy = Effect.fnUntraced(function* (copy: LibraryWorkingCopy) {
    const project = yield* getProject(copy.projectId, copy.projectRevision);
    if (
      copy.repositories.length > 64 ||
      new Set(copy.repositories.map((repo) => repo.resourceId)).size !== copy.repositories.length ||
      copy.repositories.some(
        (repo) =>
          !project.resources.some(
            (resource) => resource.kind !== "link" && resource.id === repo.resourceId,
          ),
      )
    )
      return yield* invalid();
    if (copy.ownership === "borrowed" && copy.state === "released")
      return yield* new LibraryError({ reason: "not-managed" });
    const previous = yield* store.copy(copy.id);
    if (previous) {
      const old = yield* decode(codecs.copy, previous);
      if (
        old.projectId !== copy.projectId ||
        old.environmentId !== copy.environmentId ||
        old.rootPath !== copy.rootPath ||
        old.ownership !== copy.ownership ||
        old.createdAt !== copy.createdAt ||
        old.projectRevision !== copy.projectRevision ||
        (old.rootLocalProjectId != null && old.rootLocalProjectId !== copy.rootLocalProjectId)
      )
        return yield* invalid();
      if (Date.parse(copy.updatedAt) < Date.parse(old.updatedAt)) return old;
    }
    const payload = yield* encode(codecs.copy, copy);
    yield* store.putCopy({ ...copy, payload });
    yield* store.appendEvent(copy.id, "copy.saved", payload, copy.updatedAt);
    return copy;
  });
  const saveThread = Effect.fnUntraced(function* (
    archive: LibraryThreadArchive,
    environmentId: string,
  ) {
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
    const previous = yield* store.thread(environmentId, summary.threadId);
    if (previous) {
      const old = yield* decode(codecs.archive, previous);
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
    }
    const version = yield* store.threadVersion(summary.id, summary.sequence);
    if (version !== null) {
      const saved = yield* decode(codecs.archive, version);
      if (
        (yield* digest(
          yield* encode(codecs.archive, {
            ...saved,
            summary: { ...saved.summary, syncedAt: summary.syncedAt },
          }),
        )) !== (yield* digest(yield* encode(codecs.archive, archive)))
      )
        return yield* new LibraryError({ reason: "sequence-conflict" });
    }
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
    if (version === null)
      yield* store.putThreadVersion(
        summary.id,
        summary.sequence,
        yield* encode(codecs.archive, normalized),
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
      return {
        environmentId: yield* identity.getEnvironmentId,
        isAuthority,
        computers: isAuthority
          ? yield* Effect.forEach(yield* store.computers, (row) => decode(codecs.computer, row))
          : [],
        authorityId: authority.id,
        authorityEpoch: authority.epoch,
        assets: assets.mode,
      };
    }),
  );
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
          archived: false,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }),
    );
  const updateProject = (input: LibraryUpdateProjectRequest) =>
    mutation(
      "update-project",
      input.requestId,
      encode(codecs.update, input),
      codecs.project,
      Effect.gen(function* () {
        const current = yield* getProject(input.projectId);
        if (current.revision !== input.expectedRevision)
          return yield* new LibraryError({ reason: "revision-conflict" });
        if (!validLibraryResources(input.resources)) return yield* invalid();
        return yield* putProject({
          ...current,
          title: input.title.trim(),
          brief: input.brief,
          resources: input.resources,
          revision: current.revision + 1,
          updatedAt: yield* now,
        });
      }),
    );
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
      validateAuthority(input).pipe(Effect.andThen(saveCopy(input.copy))),
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
  const ingestHistory = (input: LibraryIngestHistoryRequest) =>
    mutation(
      "ingest-history",
      input.requestId,
      encode(codecs.ingest, input),
      codecs.ingestResult,
      Effect.gen(function* () {
        yield* validateAuthority(input);
        let cursor = yield* store.cursor(input.sourceEnvironmentId, input.journalId);
        if (input.fromSequence > cursor) return yield* new LibraryError({ reason: "sequence-gap" });
        let applied = 0;
        for (const [index, entry] of input.entries.entries()) {
          if (entry.sequence !== input.fromSequence + index + 1)
            return yield* new LibraryError({ reason: "sequence-gap" });
          const payload = yield* encode(codecs.archive, entry.thread);
          const fingerprint = yield* digest(payload);
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
          yield* saveThread(entry.thread, input.sourceEnvironmentId);
          yield* store.putIngestedDigest(
            input.sourceEnvironmentId,
            input.journalId,
            entry.sequence,
            fingerprint,
            payload,
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
  const verifyProof = Effect.fnUntraced(function* (input: LibraryImportShadowRequest) {
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
    for (const thread of input.threads) {
      const saved = yield* store.threadVersion(thread.summary.id, thread.summary.sequence);
      if (saved === null) logicalRecordsVerified = false;
      else {
        const archive = yield* decode(codecs.archive, saved);
        const normalized = {
          ...archive,
          summary: { ...archive.summary, syncedAt: thread.summary.syncedAt },
        };
        if (
          (yield* digest(yield* encode(codecs.archive, normalized))) !==
          (yield* digest(yield* encode(codecs.archive, thread)))
        )
          logicalRecordsVerified = false;
      }
      const current = yield* store.thread(input.sourceEnvironmentId, thread.summary.threadId);
      if (
        current === null ||
        (yield* decode(codecs.archive, current)).summary.sequence < thread.summary.sequence
      )
        logicalRecordsVerified = false;
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
        return yield* verifyProof(yield* decode(codecs.import, proof));
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
        yield* store.putImportProof(input.requestId, yield* encode(codecs.import, input));
        return yield* verifyProof(input);
      }),
    );
  return LibraryService.of({
    info,
    registerComputer,
    subscribeRefreshes: SubscriptionRef.changes(refreshes),
    createProject,
    updateProject,
    archiveProject,
    registerCopy,
    registerThread,
    ingestHistory,
    importShadow,
    verifyImport,
    project: (input) => getProject(input.projectId).pipe(Effect.mapError(io)),
    projects: (input) =>
      store.projects(input.includeArchived ?? false).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, (row) => decode(codecs.project, row))),
        Effect.mapError(io),
      ),
    copies: (input) =>
      store.copies(input.projectId).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, (row) => decode(codecs.copy, row))),
        Effect.map((copies) =>
          input.includeReleased === true
            ? copies
            : copies.filter((copy) => copy.registered !== false && copy.state !== "released"),
        ),
        Effect.mapError(io),
      ),
    threads: (input) =>
      store.threads(input.projectId, 2147483647, 0).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, (row) => decode(codecs.summary, row))),
        Effect.mapError(io),
      ),
    lookupThread: (input) =>
      store.threadSummary(input.sourceEnvironmentId, input.threadId).pipe(
        Effect.flatMap((row) =>
          row === null ? Effect.succeed(null) : decode(codecs.summary, row),
        ),
        Effect.mapError(io),
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
      return store.threadIndex(limit + 1, offset).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, (row) => decode(codecs.summary, row))),
        Effect.map((rows) => ({
          threads: rows.slice(0, limit),
          nextOffset: rows.length > limit ? offset + limit : null,
        })),
        Effect.mapError(io),
      );
    },
    history: (input) =>
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
  });
});
export const layer = Layer.effect(LibraryService, make).pipe(Layer.provide(LibraryStore.layer));
