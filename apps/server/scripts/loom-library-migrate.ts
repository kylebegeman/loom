#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  LibraryError,
  LibraryImportShadowRequest,
  LibraryImportReceipt,
  LibraryInfo,
  LibraryIngestHistoryRequest,
  LibraryIngestHistoryResult,
  LibraryRegisterCopyRequest,
  LibraryProject,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import * as ServerConfig from "../src/config.ts";
import * as WorkspaceStore from "../src/fork/project-library/LibraryWorkspaceStore.ts";
import * as Migration from "../src/fork/project-library/LibraryMigration.ts";
import * as ProjectionStore from "../src/orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../src/orchestration-v2/ProjectStore.ts";
import { libraryAttachments } from "../src/fork/project-library/attachments.ts";
import { resolveAttachmentPathById } from "../src/attachmentStore.ts";
import { LibraryAsset } from "../src/fork/project-library/assets/LibraryAssetService.ts";
import { LIBRARY_ASSET_MAX_BYTES } from "../src/fork/project-library/assets/LibraryObjectStore.ts";
import { sqliteSnapshot } from "../../../scripts/lib/loomLibrarySnapshot.ts";
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodePlan = Schema.decodeEffect(Schema.fromJsonString(Migration.LibraryMigrationPlan));
const shadowCodec = Schema.fromJsonString(Schema.toCodecJson(LibraryImportShadowRequest));
const encodeShadow = Schema.encodeEffect(shadowCodec);
const decodeShadow = Schema.decodeEffect(shadowCodec);
const encodeHistory = Schema.encodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(LibraryIngestHistoryRequest)),
);
const decodeHistoryResult = Schema.decodeUnknownEffect(LibraryIngestHistoryResult);
const encodeCopy = Schema.encodeEffect(Schema.fromJsonString(LibraryRegisterCopyRequest));
const decodeInfo = Schema.decodeUnknownEffect(LibraryInfo);
const decodeReceipt = Schema.decodeUnknownEffect(LibraryImportReceipt);
const decodeAsset = Schema.decodeUnknownEffect(LibraryAsset);
const sourceLayer = (database: string) =>
  Migration.layer.pipe(
    Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer)),
    Layer.provide(NodeSqliteClient.layer({ filename: database, readonly: true })),
  );
const writePrivate = Effect.fnUntraced(function* (output: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(output), { recursive: true, mode: 0o700 });
  yield* fs.writeFileString(output, text, { flag: "wx", mode: 0o600 });
});
export const exportMigration = Effect.fnUntraced(function* (input: {
  database: string;
  plan: string;
  output: string;
  requestId: string;
  journalId: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const plan = yield* decodePlan(yield* fs.readFileString(input.plan));
  const shadow = yield* Migration.LibraryMigration.use((service) =>
    service.exportShadow({ requestId: input.requestId, journalId: input.journalId, plan }),
  ).pipe(Effect.provide(sourceLayer(input.database)));
  yield* writePrivate(input.output, yield* encodeShadow(shadow));
  return {
    projects: shadow.projects.length,
    copies: shadow.copies.length,
    threads: shadow.threads.length,
    output: input.output,
  };
});
export const uploadMigration = Effect.fnUntraced(function* (input: {
  archive: string;
  attachmentsDir: string;
  libraryUrl: string;
  receipt: string;
  catchUp: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const http = yield* HttpClient.HttpClient;
  const base = yield* Effect.try({
    try: () => new URL(input.libraryUrl),
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
  const token = yield* Config.Redacted("LOOM_LIBRARY_TOKEN");
  const execute = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest) {
    const response = yield* http.execute(request.pipe(HttpClientRequest.bearerToken(token))).pipe(
      Effect.timeout("60 seconds"),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
    );
    if (response.status < 200 || response.status >= 300)
      return yield* new LibraryError({
        reason: response.status === 403 || response.status === 401 ? "blocked" : "io",
      });
    return response;
  });
  const archiveText = yield* fs.readFileString(input.archive);
  const archiveDigest = Hex.encode(
    yield* crypto.digest("SHA-256", new TextEncoder().encode(archiveText)),
  );
  const shadow = yield* decodeShadow(archiveText);
  const info = yield* (yield* execute(
    HttpClientRequest.get(new URL("/api/loom/library/info", base).toString()),
  )).json.pipe(
    Effect.flatMap(decodeInfo),
    Effect.mapError(() => new LibraryError({ reason: "io" })),
  );
  const authority = { authorityId: info.authorityId, authorityEpoch: info.authorityEpoch };
  const published = new Set<string>();
  for (const thread of shadow.threads)
    for (const attachment of libraryAttachments(thread)) {
      const key = `${thread.summary.environmentId}\0${attachment.id}`;
      if (published.has(key)) continue;
      const file = resolveAttachmentPathById({
        attachmentsDir: input.attachmentsDir,
        attachmentId: attachment.id,
      });
      if (file === null) return yield* new LibraryError({ reason: "not-found" });
      const stat = yield* fs.stat(file);
      if (Number(stat.size) !== attachment.sizeBytes || Number(stat.size) > LIBRARY_ASSET_MAX_BYTES)
        return yield* new LibraryError({ reason: "invalid" });
      const bytes = yield* fs.readFile(file);
      const digest = Hex.encode(yield* crypto.digest("SHA-256", bytes));
      const response = yield* execute(
        HttpClientRequest.put(
          new URL(
            `/api/loom/library/assets/${encodeURIComponent(thread.summary.environmentId)}/${encodeURIComponent(attachment.id)}`,
            base,
          ).toString(),
        ).pipe(
          HttpClientRequest.setHeader("x-loom-filename", encodeURIComponent(attachment.name)),
          HttpClientRequest.bodyUint8Array(bytes, attachment.mimeType),
        ),
      );
      const asset = yield* response.json.pipe(
        Effect.flatMap(decodeAsset),
        Effect.mapError(() => new LibraryError({ reason: "io" })),
      );
      if (
        asset.digest !== digest ||
        asset.bytes !== bytes.length ||
        asset.sourceEnvironmentId !== thread.summary.environmentId ||
        asset.attachmentId !== attachment.id
      )
        return yield* new LibraryError({ reason: "io" });
      published.add(key);
    }
  if (input.catchUp) {
    for (const copy of shadow.copies)
      yield* execute(
        HttpClientRequest.post(new URL("/api/loom/library/copies/register", base).toString()).pipe(
          HttpClientRequest.bodyText(
            yield* encodeCopy({
              ...authority,
              requestId: `${shadow.requestId}:catch-up-copy:${copy.id}`,
              copy,
            }),
            "application/json",
          ),
        ),
      );
    let cursor = 0;
    for (let offset = 0; offset < shadow.threads.length; offset += 50) {
      const entries = shadow.threads
        .slice(offset, offset + 50)
        .map((thread, index) => ({ sequence: cursor + index + 1, thread }));
      const request = {
        ...authority,
        requestId: `${shadow.requestId}:catch-up:${offset}`,
        sourceEnvironmentId: shadow.sourceEnvironmentId,
        journalId: `${shadow.journalId}:catch-up`,
        fromSequence: cursor,
        entries,
      };
      const response = yield* execute(
        HttpClientRequest.post(new URL("/api/loom/library/history/ingest", base).toString()).pipe(
          HttpClientRequest.bodyText(yield* encodeHistory(request), "application/json"),
        ),
      );
      const acknowledgement = yield* response.json.pipe(
        Effect.flatMap(decodeHistoryResult),
        Effect.mapError(() => new LibraryError({ reason: "io" })),
      );
      if (
        acknowledgement.sourceEnvironmentId !== shadow.sourceEnvironmentId ||
        acknowledgement.journalId !== request.journalId ||
        acknowledgement.lastSequence < cursor + entries.length
      )
        return yield* new LibraryError({ reason: "sequence-conflict" });
      cursor += entries.length;
    }
    const receipt = {
      requestId: shadow.requestId,
      authorityId: info.authorityId,
      authorityEpoch: info.authorityEpoch,
      catchUp: true,
      threads: shadow.threads.length,
      assets: published.size,
    };
    yield* writePrivate(input.receipt, yield* encodeJson(receipt));
    return receipt;
  }
  const response = yield* execute(
    HttpClientRequest.post(new URL("/api/loom/library/import-shadow", base).toString()).pipe(
      HttpClientRequest.bodyText(
        yield* encodeShadow({ ...shadow, ...authority }),
        "application/json",
      ),
    ),
  );
  const receipt = yield* response.json.pipe(
    Effect.flatMap(decodeReceipt),
    Effect.mapError(() => new LibraryError({ reason: "io" })),
  );
  yield* writePrivate(
    input.receipt,
    yield* encodeJson({
      ...receipt,
      ...authority,
      libraryEnvironmentId: info.environmentId,
      archiveDigest,
    }),
  );
  if (!receipt.verified || !receipt.logicalRecordsVerified || !receipt.assetBytesVerified)
    return yield* new LibraryError({ reason: "blocked" });
  return receipt;
});
const ActivationReceipt = Schema.Struct({
  requestId: Schema.String,
  authorityId: Schema.String,
  authorityEpoch: Schema.Int,
  libraryEnvironmentId: LibraryInfo.fields.environmentId,
  archiveDigest: Schema.String,
  verified: Schema.Boolean,
  logicalRecordsVerified: Schema.Boolean,
  assetBytesVerified: Schema.Boolean,
});
const encodeProject = Schema.encodeEffect(Schema.fromJsonString(LibraryProject));
const encodeWorkingCopy = Schema.encodeEffect(Schema.fromJsonString(LibraryWorkingCopy));
const decodeActivationReceipt = Schema.decodeEffect(Schema.fromJsonString(ActivationReceipt));
export const activateMigration = Effect.fnUntraced(function* (input: {
  archive: string;
  receipt: string;
  plan: string;
  stateDir: string;
  libraryUrl: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const http = yield* HttpClient.HttpClient;
  const text = yield* fs.readFileString(input.archive);
  const shadow = yield* decodeShadow(text);
  const plan = yield* decodePlan(yield* fs.readFileString(input.plan));
  const receipt = yield* decodeActivationReceipt(yield* fs.readFileString(input.receipt));
  const digest = Hex.encode(yield* crypto.digest("SHA-256", new TextEncoder().encode(text)));
  if (
    receipt.requestId !== shadow.requestId ||
    receipt.archiveDigest !== digest ||
    !receipt.verified ||
    !receipt.logicalRecordsVerified ||
    !receipt.assetBytesVerified ||
    plan.sourceEnvironmentId !== shadow.sourceEnvironmentId ||
    (yield* fs.readFileString(path.join(input.stateDir, "environment-id"))).trim() !==
      shadow.sourceEnvironmentId
  )
    return yield* new LibraryError({ reason: "blocked" });
  const base = yield* Effect.try({
    try: () => new URL(input.libraryUrl),
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
  const token = yield* Config.Redacted("LOOM_LIBRARY_TOKEN");
  const request = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest) {
    const response = yield* http
      .execute(request.pipe(HttpClientRequest.bearerToken(token)))
      .pipe(Effect.mapError(() => new LibraryError({ reason: "io" })));
    if (response.status !== 200) return yield* new LibraryError({ reason: "blocked" });
    return response;
  });
  const info = yield* (yield* request(
    HttpClientRequest.get(new URL("/api/loom/library/info", base).toString()),
  )).json.pipe(
    Effect.flatMap(decodeInfo),
    Effect.mapError(() => new LibraryError({ reason: "io" })),
  );
  if (
    info.authorityId !== receipt.authorityId ||
    info.authorityEpoch !== receipt.authorityEpoch ||
    info.environmentId !== receipt.libraryEnvironmentId
  )
    return yield* new LibraryError({ reason: "blocked" });
  const verified = yield* (yield* request(
    HttpClientRequest.post(new URL("/api/loom/library/verify-import", base).toString()).pipe(
      HttpClientRequest.bodyText(
        yield* encodeJson({ requestId: receipt.requestId }),
        "application/json",
      ),
    ),
  )).json.pipe(
    Effect.flatMap(decodeReceipt),
    Effect.mapError(() => new LibraryError({ reason: "io" })),
  );
  if (!verified.verified || !verified.logicalRecordsVerified || !verified.assetBytesVerified)
    return yield* new LibraryError({ reason: "blocked" });
  if (
    plan.projects.length !== shadow.projects.length ||
    plan.copies.length !== shadow.copies.length
  )
    return yield* new LibraryError({ reason: "invalid" });
  for (const project of plan.projects) {
    const saved = shadow.projects.find((candidate) => candidate.id === project.id);
    if (saved === undefined || (yield* encodeProject(saved)) !== (yield* encodeProject(project)))
      return yield* new LibraryError({ reason: "invalid" });
  }
  const receipts: WorkspaceStore.WorkspaceReceipt[] = [];
  const bindings: {
    threadId: (typeof shadow.threads)[number]["summary"]["threadId"];
    resolved: Parameters<WorkspaceStore.LibraryWorkspaceStore["Service"]["bind"]>[1];
    project: (typeof plan.projects)[number];
  }[] = [];
  for (const entry of plan.copies) {
    const project = plan.projects.find((project) => project.id === entry.copy.projectId);
    const copy = shadow.copies.find((copy) => copy.id === entry.copy.id);
    if (
      project === undefined ||
      copy === undefined ||
      copy.projectId !== entry.copy.projectId ||
      copy.rootPath !== entry.copy.rootPath ||
      copy.environmentId !== shadow.sourceEnvironmentId ||
      copy.ownership !== "borrowed"
    )
      return yield* new LibraryError({ reason: "invalid" });
    if ((yield* encodeWorkingCopy(copy)) !== (yield* encodeWorkingCopy(entry.copy)))
      return yield* new LibraryError({ reason: "invalid" });
    const original = shadow.threads.filter((thread) => thread.summary.workingCopyId === copy.id);
    for (const thread of original) {
      const local = entry.localProjects.find(
        (local) => local.localProjectId === thread.summary.localProjectId,
      );
      if (
        local === undefined ||
        thread.summary.resourceIds.join("\0") !== local.resourceIds.join("\0")
      )
        return yield* new LibraryError({ reason: "invalid" });
      const sourceRoot =
        copy.repositories.find((repository) => repository.localProjectId === local.localProjectId)
          ?.path ?? copy.rootPath;
      if (local.cwd !== sourceRoot) return yield* new LibraryError({ reason: "invalid" });
      const cwd = thread.projection.thread.worktreePath ?? local.cwd;
      if (!(yield* fs.exists(cwd))) return yield* new LibraryError({ reason: "not-found" });
      const repositoryPaths =
        thread.projection.thread.worktreePath !== null && thread.summary.resourceIds.length === 1
          ? [cwd]
          : copy.repositories
              .filter((repo) => thread.summary.resourceIds.includes(repo.resourceId))
              .map((repo) => repo.path);
      for (const repository of repositoryPaths)
        if (!(yield* fs.exists(repository)))
          return yield* new LibraryError({ reason: "not-found" });
      bindings.push({
        threadId: thread.summary.threadId,
        resolved: {
          cwd,
          localProjectId: thread.summary.localProjectId,
          repositoryPaths,
          binding: {
            projectId: copy.projectId,
            projectRevision: project.revision,
            workingCopyId: copy.id,
            environmentId: copy.environmentId,
            resourceIds: thread.summary.resourceIds,
          },
        },
        project,
      });
    }
    receipts.push({
      requestId: `migration:${shadow.requestId}:${copy.id}`,
      fingerprint: digest,
      project,
      copy,
      rootLocalProjectId:
        entry.localProjects.find((local) => local.cwd === copy.rootPath)?.localProjectId ?? null,
      rootCheckpointRepository: yield* fs.exists(path.join(copy.rootPath, ".git")),
      legacyThreadIds: original.map((thread) => thread.summary.threadId),
      rootIdentity: null,
      releaseRequestId: null,
      releaseReviewToken: null,
      removalPath: null,
      archivePath: null,
      archiveDigest: null,
    });
  }
  const config = Layer.effect(
    ServerConfig.ServerConfig,
    ServerConfig.ServerConfig.pipe(
      Effect.map((initial) => ({ ...initial, stateDir: input.stateDir })),
    ),
  ).pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "loom-library-activate-" })),
  );
  yield* WorkspaceStore.LibraryWorkspaceStore.use((store) =>
    store.importBindings({ receipts, bindings }),
  ).pipe(Effect.provide(WorkspaceStore.layer.pipe(Layer.provide(config))));
  return { copies: receipts.length, threads: bindings.length };
});
const activate = Command.make(
  "activate",
  {
    archive: Flag.String("archive"),
    receipt: Flag.String("receipt"),
    plan: Flag.String("plan"),
    stateDir: Flag.String("state-dir"),
    libraryUrl: Flag.String("library-url"),
  },
  (input) =>
    activateMigration(input).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.flatMap((result) =>
        Console.log(
          `Bound ${result.threads} legacy conversations across ${result.copies} borrowed copies. Native execution history and folders are preserved.`,
        ),
      ),
    ),
);
const database = Flag.String("database");
const output = Flag.String("output");
const snapshot = Command.make(
  "snapshot",
  { source: Flag.String("source"), output },
  ({ source, output }) =>
    Effect.tryPromise({
      try: () => sqliteSnapshot(source, output),
      catch: () => new LibraryError({ reason: "io" }),
    }).pipe(Effect.andThen(Console.log("Read-only SQLite snapshot saved."))),
);
const inventory = Command.make("inventory", { database, output }, ({ database, output }) =>
  Effect.gen(function* () {
    const result = yield* Migration.LibraryMigration.use((service) => service.inventory).pipe(
      Effect.provide(sourceLayer(database)),
    );
    yield* writePrivate(output, yield* encodeJson(result));
    yield* Console.log(
      `Inventory saved: ${result.projects.length} local projects, ${result.threads.length} threads.`,
    );
  }),
);
const exportCommand = Command.make(
  "export",
  {
    database,
    plan: Flag.String("plan"),
    output,
    requestId: Flag.String("request-id"),
    journalId: Flag.String("journal-id"),
  },
  (input) =>
    exportMigration(input).pipe(
      Effect.flatMap((result) =>
        Console.log(
          `Shadow export saved: ${result.projects} projects, ${result.copies} copies, ${result.threads} threads.`,
        ),
      ),
    ),
);
const upload = Command.make(
  "upload",
  {
    archive: Flag.String("archive"),
    attachmentsDir: Flag.String("attachments-dir"),
    libraryUrl: Flag.String("library-url"),
    receipt: Flag.String("receipt"),
    catchUp: Flag.Boolean("catch-up").pipe(Flag.withDefault(false)),
  },
  (input) =>
    uploadMigration(input).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.flatMap(() => Console.log("Verified Library upload saved its receipt.")),
    ),
);
export const loomLibraryMigrationCommand = Command.make("library-migrate").pipe(
  Command.withSubcommands([snapshot, inventory, exportCommand, upload, activate]),
);
if (import.meta.main)
  Command.run(loomLibraryMigrationCommand, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.merge(NodeServices.layer, FetchHttpClient.layer)),
    NodeRuntime.runMain,
  );
