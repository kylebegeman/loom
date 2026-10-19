import { libraryJsonBody } from "./transfer.ts";
import * as LibraryService from "./LibraryService.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { EnvironmentId, IsoDateTime, type ThreadId } from "@t3tools/contracts";
import {
  LibraryBriefProposal,
  LibraryComputerRegistration,
  LibraryConversationBriefProposal,
  LibraryProject,
  type LibraryProposeBriefRequest,
  LibraryRegisterComputerRequest,
  LibraryError,
  LibraryId,
  LibraryInfo,
  LibraryIngestHistoryRequest,
  LibraryIngestHistoryResult,
  LibraryRegisterCopyRequest,
  LibraryRecordActivityRequest,
  LibraryRecordActivityResult,
  LibraryWorkingCopy,
  type LibraryThreadArchive,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { libraryComputerDirectory } from "./enrollment.ts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import {
  ServerEnvironment,
  ServerEnvironmentIdentity,
} from "../../environment/ServerEnvironment.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient, HttpClientRequest } from "effect/http";
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
    readonly info: Effect.Effect<LibraryInfo, LibraryError>;
    readonly ingest: (
      input: LibraryIngestHistoryRequest,
    ) => Effect.Effect<LibraryIngestHistoryResult, LibraryError>;
    readonly registerCopy: (
      input: LibraryRegisterCopyRequest,
    ) => Effect.Effect<LibraryWorkingCopy, LibraryError>;
    readonly publishAttachments: (
      archive: LibraryThreadArchive,
    ) => Effect.Effect<void, LibraryError>;
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
  }
>()("t3/fork/project-library/LibraryPublisher") {}

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
const decodeReason = Schema.decodeUnknownEffect(
  Schema.Struct({ reason: LibraryError.fields.reason }),
);
const HostCredential = Schema.Struct({
  computer: Schema.optional(LibraryComputerRegistration),
  version: Schema.Literal(1),
  sourceEnvironmentId: EnvironmentId,
  libraryEnvironmentId: EnvironmentId,
  libraryUrl: Schema.String,
  sessionId: Schema.String,
  accessToken: Schema.RedactedFromValue(Schema.String),
  expiresAt: IsoDateTime,
});
const decodeCredential = Schema.decodeEffect(Schema.fromJsonString(HostCredential));
const make = Effect.gen(function* () {
  const localAuthority = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(
    Config.withDefault(false),
  );
  const configuredUrl = yield* Config.String("LOOM_LIBRARY_URL").pipe(Config.option);
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const configuredCredentialFile = yield* Config.String("LOOM_LIBRARY_CREDENTIAL_FILE").pipe(
    Config.option,
  );
  const sourceIdentity = yield* ServerEnvironmentIdentity;
  const sourceEnvironmentId = yield* sourceIdentity.getEnvironmentId;
  const computerDirectory = libraryComputerDirectory(
    yield* HostProcess.HomeDirectory,
    sourceEnvironmentId,
  );
  const externalCredentialFile = path.join(computerDirectory, "publisher.json");
  const defaultCredentialFile = (yield* fs.exists(externalCredentialFile))
    ? externalCredentialFile
    : path.join(config.secretsDir, "library-publisher.json");
  const credentialFile = Option.isSome(configuredCredentialFile)
    ? configuredCredentialFile
    : (yield* fs.exists(defaultCredentialFile))
      ? Option.some(defaultCredentialFile)
      : Option.none();
  const unavailable = (enabled: boolean) => {
    const blocked = Effect.fail(new LibraryError({ reason: "blocked" }));
    return LibraryPublisher.of({
      enabled,
      info: blocked,
      ingest: () => blocked,
      registerCopy: () => blocked,
      publishAttachments: () => blocked,
      recordActivity: () => blocked,
      project: () => blocked,
      proposeBrief: () => blocked,
    });
  };
  if (
    !localAuthority &&
    Option.isNone(credentialFile) &&
    (Option.isNone(configuredUrl) || configuredUrl.value.trim() === "")
  ) {
    return unavailable(false);
  }
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  if (localAuthority) {
    const localLibrary = yield* LibraryService.LibraryService;
    const localAssets = yield* Assets.LibraryAssetService;
    const publishLocalAttachments = Effect.fnUntraced(function* (archive: LibraryThreadArchive) {
      for (const attachment of [
        ...libraryAttachments(archive),
        ...(yield* libraryPageUploads(fs, config.attachmentsDir, archive)),
      ]) {
        const sourcePath = resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: attachment.id,
        });
        if (sourcePath === null) return yield* new LibraryError({ reason: "not-found" });
        const stat = yield* fs
          .stat(sourcePath)
          .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));
        if (
          Number(stat.size) !== attachment.sizeBytes ||
          Number(stat.size) > LIBRARY_ASSET_MAX_BYTES
        )
          return yield* new LibraryError({ reason: "invalid" });
        const bytes = yield* fs
          .readFile(sourcePath)
          .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));
        yield* localAssets.put({
          sourceEnvironmentId: archive.summary.environmentId,
          attachmentId: attachment.id,
          filename: attachment.name,
          contentType: attachment.mimeType,
          bytes,
        });
      }
    });
    return LibraryPublisher.of({
      enabled: true,
      info: localLibrary.info,
      ingest: localLibrary.ingestHistory,
      registerCopy: localLibrary.registerCopy,
      publishAttachments: publishLocalAttachments,
      recordActivity: localLibrary.recordActivity,
      project: (projectId) => localLibrary.project({ projectId }),
      proposeBrief: (input, threadId) =>
        localLibrary.proposeBrief(input, {
          kind: "conversation",
          environmentId: sourceEnvironmentId,
          threadId,
        }),
    });
  }
  const credentialResult = Option.isNone(credentialFile)
    ? null
    : yield* Effect.gen(function* () {
        const stat = yield* fs.stat(credentialFile.value);
        if ((stat.mode & 0o077) !== 0 || Number(stat.size) > 16 * 1024)
          return yield* new LibraryError({ reason: "invalid" });
        return yield* decodeCredential(yield* fs.readFileString(credentialFile.value));
      }).pipe(
        Effect.mapError(() => new LibraryError({ reason: "blocked" })),
        Effect.result,
      );
  if (credentialResult !== null && credentialResult._tag === "Failure") return unavailable(true);
  const credential = credentialResult === null ? null : credentialResult.success;
  if (credential !== null) {
    const identity = yield* ServerEnvironmentIdentity;
    if (
      credential.sourceEnvironmentId !== (yield* identity.getEnvironmentId) ||
      Date.parse(credential.expiresAt) <= (yield* Clock.currentTimeMillis)
    )
      return unavailable(true);
  }
  const selectedUrl =
    Option.isSome(configuredUrl) && configuredUrl.value.trim() !== ""
      ? configuredUrl.value
      : credential?.libraryUrl;
  if (selectedUrl === undefined) return yield* new LibraryError({ reason: "invalid" });
  const base = yield* Effect.try({
    try: () => new URL(selectedUrl),
    catch: () => new LibraryError({ reason: "invalid" }),
  });
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
  )
    return yield* new LibraryError({ reason: "invalid" });
  if (
    credential !== null &&
    base.toString() !==
      (yield* Effect.try({
        try: () => new URL(credential.libraryUrl).toString(),
        catch: () => new LibraryError({ reason: "invalid" }),
      }))
  )
    return unavailable(true);
  const token =
    credential === null
      ? yield* Config.Redacted("LOOM_LIBRARY_TOKEN").pipe(Config.option)
      : Option.some(credential.accessToken);
  const http = yield* HttpClient.HttpClient;
  const execute = Effect.fnUntraced(function* (
    request: HttpClientRequest.HttpClientRequest,
    /** Keep the reason the Library gave for refusing, such as a full proposal queue. */
    keepReason = false,
  ) {
    if (
      Option.isNone(token) ||
      (credential !== null && Date.parse(credential.expiresAt) <= (yield* Clock.currentTimeMillis))
    )
      return yield* new LibraryError({ reason: "blocked" });
    // HTTP failures can hold a request containing its token. Do not retain that cause.
    const response = yield* http
      .execute(request.pipe(HttpClientRequest.bearerToken(token.value)))
      .pipe(
        Effect.timeout("3 minutes"),
        Effect.mapError(() => new LibraryError({ reason: "io" })),
      );
    if (keepReason && (response.status === 400 || response.status === 409)) {
      const refused = yield* response.json.pipe(Effect.flatMap(decodeReason), Effect.option);
      if (Option.isSome(refused)) return yield* new LibraryError({ reason: refused.value.reason });
    }
    if (response.status < 200 || response.status >= 300)
      return yield* new LibraryError({
        reason: response.status === 401 || response.status === 403 ? "blocked" : "io",
      });
    return response;
  });
  const endpoint = (path: string) => new URL(path, base).toString();
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
    );
    return yield* response.json.pipe(
      Effect.flatMap(decodeCopy),
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
  const uploadAsset = Effect.fnUntraced(function* (
    environmentId: EnvironmentId,
    attachmentId: string,
    filename: string,
    contentType: string,
    bytes: Uint8Array,
  ): Effect.fn.Return<LibraryAssetType, LibraryError> {
    const response = yield* execute(
      HttpClientRequest.put(
        endpoint(
          `/api/loom/library/assets/${encodeURIComponent(environmentId)}/${encodeURIComponent(attachmentId)}`,
        ),
      ).pipe(
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
      for (const attachment of [
        ...libraryAttachments(archive),
        ...(yield* libraryPageUploads(fs, config.attachmentsDir, archive)),
      ]) {
        const published = yield* sql<{
          bytes: number;
        }>`SELECT bytes FROM fork_library_source_assets WHERE attachment_id=${attachment.id}`;
        if (published[0]?.bytes === attachment.sizeBytes) continue;
        const sourcePath = resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: attachment.id,
        });
        if (sourcePath === null) return yield* new LibraryError({ reason: "not-found" });
        const stat = yield* fs.stat(sourcePath);
        if (
          Number(stat.size) !== attachment.sizeBytes ||
          Number(stat.size) > LIBRARY_ASSET_MAX_BYTES
        )
          return yield* new LibraryError({ reason: "invalid" });
        const bytes = yield* fs.readFile(sourcePath);
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
        yield* sql`INSERT INTO fork_library_source_assets (attachment_id,payload_digest,bytes) VALUES (${attachment.id},${digest},${bytes.length}) ON CONFLICT(attachment_id) DO UPDATE SET payload_digest=excluded.payload_digest,bytes=excluded.bytes`;
      }
    },
    Effect.mapError(() => new LibraryError({ reason: "io" })),
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
  return LibraryPublisher.of({
    enabled: true,
    info,
    ingest,
    registerCopy,
    publishAttachments,
    recordActivity,
    project,
    proposeBrief,
  });
});
export const layer = Layer.effect(LibraryPublisher, make);
