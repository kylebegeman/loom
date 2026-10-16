import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ChatAttachmentId, EnvironmentId } from "@t3tools/contracts";
import {
  LibraryImportShadowRequest,
  type LibraryImportReceipt,
  type LibraryProject,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ServerConfig from "../src/config.ts";
import {
  source,
  localProjectId,
  threadId,
  resource,
  copyFor,
  archiveFor,
} from "../src/fork/project-library/Library.testkit.ts";
import { LibraryMigrationPlan } from "../src/fork/project-library/LibraryMigration.ts";
import * as WorkspaceStore from "../src/fork/project-library/LibraryWorkspaceStore.ts";
import { activateMigration, uploadMigration } from "./loom-library-migrate.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const shadowCodec = Schema.fromJsonString(Schema.toCodecJson(LibraryImportShadowRequest));
const encodeShadow = Schema.encodeEffect(shadowCodec);
const decodeShadow = Schema.decodeEffect(shadowCodec);
const encodePlan = Schema.encodeEffect(Schema.fromJsonString(LibraryMigrationPlan));

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const base = yield* fs.makeTempDirectoryScoped({
    prefix: "loom-library-migration-command-test-",
  });
  const stateDir = path.join(base, "userdata");
  const config = ServerConfig.layerTest(process.cwd(), base);
  const workspace = WorkspaceStore.layer.pipe(Layer.provide(config));
  const timestamp = DateTime.formatIso(yield* DateTime.now);
  const project: LibraryProject = {
    id: "aspectavy",
    title: "AspectAvy",
    brief: "Preserve the explicitly approved grouping.",
    revision: 1,
    resources: [resource],
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const rootPath = path.join(base, "existing-source");
  const repository = path.join(rootPath, "api");
  yield* fs.makeDirectory(repository, { recursive: true });
  yield* fs.writeFileString(path.join(repository, "preserve.txt"), "Existing working files");
  const copy = {
    ...copyFor(project),
    rootPath,
    repositories: [{ ...copyFor(project).repositories[0]!, path: repository }],
  };
  const archive = yield* archiveFor(project);
  const attachment = {
    type: "file" as const,
    id: ChatAttachmentId.make("migration-attachment"),
    name: "diagram.png",
    mimeType: "image/png",
    sizeBytes: 3,
  };
  const shadow: LibraryImportShadowRequest = {
    requestId: "approved-import",
    sourceEnvironmentId: source,
    journalId: "source-journal",
    projects: [project],
    copies: [copy],
    throughSequence: 0,
    threads: [
      {
        ...archive,
        projection: {
          ...archive.projection,
          messages: [{ ...archive.projection.messages[0]!, attachments: [attachment] }],
        },
      },
    ],
  };
  const plan: LibraryMigrationPlan = {
    sourceEnvironmentId: source,
    projects: [project],
    copies: [
      { copy, localProjects: [{ localProjectId, cwd: repository, resourceIds: [resource.id] }] },
    ],
    excludedThreadIds: [],
  };
  const archivePath = path.join(base, "shadow.json");
  const planPath = path.join(base, "plan.json");
  const receiptPath = path.join(base, "receipt.json");
  const attachmentsDir = path.join(base, "attachments");
  yield* fs.makeDirectory(attachmentsDir);
  yield* fs.makeDirectory(stateDir, { recursive: true });
  yield* fs.writeFileString(path.join(stateDir, "environment-id"), source);
  yield* fs.writeFileString(archivePath, yield* encodeShadow(shadow));
  yield* fs.writeFileString(planPath, yield* encodePlan(plan));
  yield* fs.writeFile(path.join(attachmentsDir, `${attachment.id}.png`), new Uint8Array([1, 2, 3]));
  const responses = { authorityEpoch: 1, readbackVerified: true, assetDigestValid: true };
  const requests: string[] = [];
  const uploadedArchives: LibraryImportShadowRequest[] = [];
  const verifiedReceipt: LibraryImportReceipt = {
    requestId: shadow.requestId,
    projects: 1,
    copies: 1,
    threads: 1,
    throughSequence: 0,
    verified: true,
    logicalRecordsVerified: true,
    referencedAssets: 1,
    missingAssets: 0,
    assetBytesVerified: true,
  };
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      expect(request.headers.authorization).toBe("Bearer migration-test-token");
      const pathname = new URL(request.url).pathname;
      requests.push(pathname);
      let response: unknown;
      if (pathname.endsWith("/info"))
        response = {
          environmentId: EnvironmentId.make("central-library"),
          authorityId: "central-authority",
          authorityEpoch: responses.authorityEpoch,
          assets: "local",
        };
      else if (pathname.includes("/assets/")) {
        const bytes = request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array();
        expect([...bytes]).toEqual([1, 2, 3]);
        response = {
          sourceEnvironmentId: source,
          attachmentId: attachment.id,
          digest: responses.assetDigestValid
            ? Hex.encode(yield* crypto.digest("SHA-256", bytes))
            : "0".repeat(64),
          bytes: bytes.length,
          filename: attachment.name,
          contentType: attachment.mimeType,
          createdAt: timestamp,
        };
      } else if (pathname.endsWith("/import-shadow")) {
        const body =
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
        uploadedArchives.push(yield* decodeShadow(body));
        response = { ...verifiedReceipt, requestId: uploadedArchives.at(-1)!.requestId };
      } else {
        expect(pathname.endsWith("/verify-import")).toBe(true);
        response = {
          ...verifiedReceipt,
          requestId: uploadedArchives.at(-1)?.requestId ?? verifiedReceipt.requestId,
          verified: responses.readbackVerified,
          assetBytesVerified: responses.readbackVerified,
        };
      }
      return HttpClientResponse.fromWeb(
        request,
        new Response(encodeJson(response), {
          headers: { "content-type": "application/json" },
        }),
      );
    }).pipe(Effect.orDie),
  );
  const chunked = yield* fs.makeTempDirectoryScoped({ prefix: "loom-library-chunks-" });
  const chunkReceipts = path.join(base, "chunk-receipts");
  const single = { ...shadow, requestId: `${shadow.requestId}:00000` };
  const chunkText = yield* encodeShadow(single);
  yield* fs.writeFileString(path.join(chunked, "chunk-00000.json"), chunkText, { mode: 0o600 });
  const chunkDigest = Hex.encode(
    yield* crypto.digest("SHA-256", new TextEncoder().encode(chunkText)),
  );
  yield* fs.writeFileString(
    path.join(chunked, "manifest.json"),
    encodeJson({
      version: 1,
      sourceEnvironmentId: source,
      requestId: shadow.requestId,
      journalId: shadow.journalId,
      sourceEventSequence: 1,
      threads: 1,
      chunks: [
        {
          file: "chunk-00000.json",
          sha256: chunkDigest,
          byteLength: new TextEncoder().encode(chunkText).byteLength,
          threads: 1,
          threadIds: [threadId],
        },
      ],
    }),
  );
  const upload = {
    archive: archivePath,
    attachmentsDir,
    libraryUrl: "https://library.example.test",
    receipt: receiptPath,
    catchUp: false,
  };
  const activate = {
    archive: archivePath,
    receipt: receiptPath,
    plan: planPath,
    stateDir,
    libraryUrl: upload.libraryUrl,
  };
  return {
    fs,
    path,
    chunked,
    chunkReceipts,
    repository,
    workspace,
    archivePath,
    project,
    copy,
    plan,
    planPath,
    receiptPath,
    http,
    upload,
    activate,
    responses,
    requests,
    uploadedArchives,
  };
});
const run = <A, E, R>(use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const f = yield* fixture;
    return yield* use(f).pipe(Effect.provideService(HttpClient.HttpClient, f.http));
  }).pipe(
    Effect.provide(
      Layer.merge(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_TOKEN: "migration-test-token" } }),
        ),
        NodeServices.layer,
      ),
    ),
    Effect.scoped,
  );

describe("verified Library migration commands", () => {
  it.effect("checks every chunk digest before any upload and refuses modified archive bytes", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.fs.writeFileString(f.path.join(f.chunked, "chunk-00000.json"), "tampered");
        expect(
          (yield* Effect.result(
            uploadMigration({ ...f.upload, archive: f.chunked, receipt: f.chunkReceipts }),
          ))._tag,
        ).toBe("Failure");
        expect(f.requests).toEqual([]);
      }),
    ),
  );
  it.effect(
    "imports a complete checksummed directory and activates all host bindings atomically",
    () =>
      run((f) =>
        Effect.gen(function* () {
          expect(
            yield* uploadMigration({ ...f.upload, archive: f.chunked, receipt: f.chunkReceipts }),
          ).toEqual({ verified: true, threads: 1 });
          expect(
            yield* activateMigration({
              ...f.activate,
              archive: f.chunked,
              receipt: f.chunkReceipts,
            }),
          ).toEqual({ copies: 1, threads: 1 });
        }),
      ),
  );
  it.effect(
    "retains historical bindings when old folders have disappeared without recreating files",
    () =>
      run((f) =>
        Effect.gen(function* () {
          yield* uploadMigration(f.upload);
          yield* f.fs.remove(f.repository, { recursive: true });
          expect(yield* activateMigration(f.activate)).toEqual({ copies: 1, threads: 1 });
          expect(yield* f.fs.exists(f.repository)).toBe(false);
          const bound = yield* WorkspaceStore.LibraryWorkspaceStore.use((store) =>
            store.getBinding(threadId),
          ).pipe(Effect.provide(f.workspace));
          expect(bound?.cwd).toBe(f.repository);
        }),
      ),
  );
  it.effect("marks only native branch worktrees for recovery at their original path", () =>
    run((f) =>
      Effect.gen(function* () {
        const shadow = yield* decodeShadow(yield* f.fs.readFileString(f.archivePath));
        const cwd = f.path.join(f.repository, "gone", "worktree");
        yield* f.fs.writeFileString(
          f.archivePath,
          yield* encodeShadow({
            ...shadow,
            threads: shadow.threads.map((thread) => ({
              ...thread,
              projection: {
                ...thread.projection,
                thread: { ...thread.projection.thread, branch: "old-branch", worktreePath: cwd },
              },
            })),
          }),
        );
        yield* uploadMigration(f.upload);
        yield* activateMigration(f.activate);
        const bound = yield* WorkspaceStore.LibraryWorkspaceStore.use((store) =>
          store.getBinding(threadId),
        ).pipe(Effect.provide(f.workspace));
        expect(bound).toMatchObject({
          cwd,
          repositoryPaths: [cwd],
          legacyWorktreeRoot: f.repository,
        });
        expect(yield* f.fs.exists(cwd)).toBe(false);
      }),
    ),
  );
  it.effect(
    "uploads assets before history and binds original threads to borrowed folders after readback",
    () =>
      run((f) =>
        Effect.gen(function* () {
          expect(yield* uploadMigration(f.upload)).toMatchObject({ verified: true });
          expect(f.requests).toEqual([
            "/api/loom/library/info",
            `/api/loom/library/assets/${source}/migration-attachment`,
            "/api/loom/library/import-shadow",
          ]);
          expect(f.uploadedArchives[0]).toMatchObject({
            authorityId: "central-authority",
            authorityEpoch: 1,
          });
          expect((yield* f.fs.stat(f.receiptPath)).mode & 0o777).toBe(0o600);
          expect(yield* activateMigration(f.activate)).toEqual({ copies: 1, threads: 1 });
          expect(yield* activateMigration(f.activate)).toEqual({ copies: 1, threads: 1 });
          const bound = yield* WorkspaceStore.LibraryWorkspaceStore.use((store) =>
            Effect.gen(function* () {
              return {
                resolved: yield* store.getBinding(threadId),
                project: yield* store.getBoundProject(threadId),
                receipts: yield* store.receipts,
              };
            }),
          ).pipe(Effect.provide(f.workspace));
          expect(bound.resolved).toMatchObject({
            cwd: f.repository,
            localProjectId,
            repositoryPaths: [f.repository],
            binding: {
              projectId: f.project.id,
              workingCopyId: f.copy.id,
              projectRevision: 1,
              environmentId: source,
            },
          });
          expect(bound.project).toEqual(f.project);
          expect(bound.receipts).toHaveLength(1);
          expect(bound.receipts[0]?.copy.ownership).toBe("borrowed");
          expect(yield* f.fs.readDirectory(f.repository)).toEqual(["preserve.txt"]);
          expect(yield* f.fs.readFileString(f.path.join(f.repository, "preserve.txt"))).toBe(
            "Existing working files",
          );
        }),
      ),
  );
  it.effect.each(["archive", "authority", "readback", "plan"] as const)(
    "refuses activation when the approved %s no longer matches",
    (failure) =>
      run((f) =>
        Effect.gen(function* () {
          yield* uploadMigration(f.upload);
          if (failure === "archive")
            yield* f.fs.writeFileString(
              f.archivePath,
              `${yield* f.fs.readFileString(f.archivePath)}\n`,
            );
          else if (failure === "authority") f.responses.authorityEpoch = 2;
          else if (failure === "readback") f.responses.readbackVerified = false;
          else
            yield* f.fs.writeFileString(
              f.planPath,
              yield* encodePlan({
                ...f.plan,
                projects: [{ ...f.project, brief: "Unapproved replacement" }],
              }),
            );
          expect(yield* activateMigration(f.activate).pipe(Effect.flip)).toMatchObject({
            reason: failure === "plan" ? "invalid" : "blocked",
          });
          const binding = yield* WorkspaceStore.LibraryWorkspaceStore.use((store) =>
            store.getBinding(threadId),
          ).pipe(Effect.provide(f.workspace));
          expect(binding).toBeNull();
          expect(yield* f.fs.readFileString(f.path.join(f.repository, "preserve.txt"))).toBe(
            "Existing working files",
          );
        }),
      ),
  );
  it.effect(
    "rejects corrupt asset acknowledgements before importing history or writing a receipt",
    () =>
      run((f) =>
        Effect.gen(function* () {
          f.responses.assetDigestValid = false;
          expect(yield* uploadMigration(f.upload).pipe(Effect.flip)).toMatchObject({
            reason: "io",
          });
          expect(f.uploadedArchives).toEqual([]);
          expect(yield* f.fs.exists(f.receiptPath)).toBe(false);
        }),
      ),
  );
});
