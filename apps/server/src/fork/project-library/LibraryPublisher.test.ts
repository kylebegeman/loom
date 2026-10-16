import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ChatAttachmentId } from "@t3tools/contracts";
import { LibraryIngestHistoryRequest, type LibraryProject } from "@t3tools/contracts/fork";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { libraryComputerDirectory } from "./enrollment.ts";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ServerConfig from "../../config.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as LibraryService from "./LibraryService.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import * as Publisher from "./LibraryPublisher.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import { source, resource, archiveFor, copyFor } from "./Library.testkit.ts";

const project: LibraryProject = {
  id: "project",
  title: "AspectAvy",
  brief: "",
  revision: 1,
  resources: [resource],
  archived: false,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};
const decodeIngest = Schema.decodeSync(
  Schema.fromJsonString(Schema.toCodecJson(LibraryIngestHistoryRequest)),
);
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const run = <A, E, R>(
  env: Record<string, string>,
  use: (state: Effect.Success<ReturnType<typeof fixture>>) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const state = yield* fixture(env);
    return yield* use(state);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix: "library-publisher-test-" }),
        layerMemory,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
    Effect.scoped,
  );
const fixture = Effect.fnUntraced(function* (env: Record<string, string>) {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const requests = yield* Ref.make<string[]>([]);
  const corruptReply = yield* Ref.make(false);
  const remoteInput = yield* Ref.make<LibraryIngestHistoryRequest | null>(null);
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      expect(request.headers.authorization).toBe("Bearer fixture-token");
      const pathname = new URL(request.url).pathname;
      yield* Ref.update(requests, (paths) => [...paths, pathname]);
      const bytes = request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array();
      let response: unknown;
      if (pathname.endsWith("/info"))
        response = {
          ...(env.LOOM_TEST_CREDENTIAL === "external" ? { computers: [] } : {}),
          environmentId: source,
          authorityId: "authority",
          authorityEpoch: 1,
          assets: "local",
        };
      else if (pathname.endsWith("/copies/register")) response = copyFor(project);
      else if (pathname.endsWith("/history/ingest")) {
        const input = decodeIngest(new TextDecoder().decode(bytes));
        yield* Ref.set(remoteInput, input);
        response = {
          sourceEnvironmentId: input.sourceEnvironmentId,
          journalId: input.journalId,
          lastSequence: input.entries.at(-1)!.sequence,
          applied: input.entries.length,
        };
      } else
        response = {
          sourceEnvironmentId: source,
          attachmentId: pathname.split("/").at(-1),
          filename: "notes.txt",
          contentType: "text/plain",
          bytes: bytes.length,
          digest: (yield* Ref.get(corruptReply))
            ? "0".repeat(64)
            : Hex.encode(yield* crypto.digest("SHA-256", bytes).pipe(Effect.orDie)),
          createdAt: project.createdAt,
        };
      return HttpClientResponse.fromWeb(
        request,
        new Response(json(response), { headers: { "content-type": "application/json" } }),
      );
    }),
  );
  const effectiveEnv = { ...env };
  const enrolledHome = `${config.stateDir}/isolated-home`;
  if (env.LOOM_TEST_CREDENTIAL !== undefined) {
    const mode = env.LOOM_TEST_CREDENTIAL;
    yield* fs.makeDirectory(config.secretsDir, { recursive: true, mode: 0o700 });
    const useDefault = mode.endsWith("default") || mode === "external";
    const external = `${libraryComputerDirectory(enrolledHome, source)}/publisher.json`;
    if (mode === "external")
      yield* fs.makeDirectory(libraryComputerDirectory(enrolledHome, source), {
        recursive: true,
        mode: 0o700,
      });
    const credentialFile =
      mode === "external"
        ? external
        : useDefault
          ? `${config.secretsDir}/library-publisher.json`
          : `${config.stateDir}/host-credential.json`;
    yield* fs.writeFileString(
      credentialFile,
      json({
        ...(mode === "external"
          ? {
              computer: {
                environmentId: source,
                label: "Dorothy",
                platform: { os: "darwin", arch: "arm64" },
                appVersion: "0.0.58",
                supportsExecution: true,
                endpoints: ["https://computer.example.test"],
              },
            }
          : {}),
        version: 1,
        sourceEnvironmentId: mode === "wrong-source" ? "another-computer" : source,
        libraryEnvironmentId: mode === "wrong-library" ? "another-library" : source,
        libraryUrl: "https://library.example.test",
        sessionId: "session",
        accessToken: "fixture-token",
        expiresAt: mode.startsWith("expired")
          ? "1970-01-01T00:00:00.000Z"
          : "2100-01-01T00:00:00.000Z",
      }),
      { mode: mode.startsWith("insecure") ? 0o644 : 0o600 },
    );
    if (!useDefault) effectiveEnv.LOOM_LIBRARY_CREDENTIAL_FILE = credentialFile;
  }
  const publisher = yield* Publisher.LibraryPublisher.pipe(
    Effect.provide(
      Publisher.layer.pipe(
        Layer.provide(
          Layer.merge(
            Layer.mock(LibraryService.LibraryService)({}),
            Layer.mock(Assets.LibraryAssetService)({ mode: "local" }),
          ),
        ),
      ),
    ),
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: effectiveEnv }))),
    Effect.provideService(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(source) }),
    Effect.provideService(HostProcess.HomeDirectory, enrolledHome),
  );
  return { publisher, requests, corruptReply, remoteInput, sql, fs, config };
});
const configured = {
  LOOM_LIBRARY_URL: "https://library.example.test",
  LOOM_LIBRARY_TOKEN: "fixture-token",
};

describe("authenticated Library publishing", () => {
  it.effect(
    "verifies remote asset bytes before caching success and sends complete JSON history",
    () =>
      run(configured, (f) =>
        Effect.gen(function* () {
          const base = yield* archiveFor(project, 42);
          const attachment = {
            type: "file" as const,
            id: ChatAttachmentId.make("source-thread-00000000-0000-4000-8000-000000000000-txt"),
            name: "notes.txt",
            mimeType: "text/plain",
            sizeBytes: 3,
          };
          const archive = {
            ...base,
            projection: {
              ...base.projection,
              messages: [{ ...base.projection.messages[0]!, attachments: [attachment] }],
            },
          };
          yield* f.fs.writeFile(
            `${f.config.attachmentsDir}/${attachment.id}.txt`,
            new Uint8Array([1, 2, 3]),
          );
          yield* Ref.set(f.corruptReply, true);
          expect((yield* f.publisher.publishAttachments(archive).pipe(Effect.flip)).reason).toBe(
            "io",
          );
          expect(yield* f.sql`SELECT attachment_id FROM fork_library_source_assets`).toHaveLength(
            0,
          );
          yield* Ref.set(f.corruptReply, false);
          yield* f.publisher.publishAttachments(archive);
          yield* f.publisher.publishAttachments(archive);
          expect(
            (yield* Ref.get(f.requests)).filter((path) => path.includes("/assets/")),
          ).toHaveLength(2);
          expect((yield* f.publisher.info).authorityId).toBe("authority");
          yield* f.publisher.registerCopy({ requestId: "copy", copy: copyFor(project) });
          expect(
            yield* f.publisher.ingest({
              requestId: "ingest",
              sourceEnvironmentId: source,
              journalId: "journal",
              fromSequence: 0,
              entries: [{ sequence: 1, thread: archive }],
            }),
          ).toMatchObject({ lastSequence: 1 });
          const received = yield* Ref.get(f.remoteInput);
          expect(received?.entries[0]?.thread.projection.messages[0]?.text).toContain(
            "complete conversation",
          );
          expect(received?.entries[0]?.thread.summary.sequence).toBe(42);
        }),
      ),
  );
  it.effect(
    "keeps configured hosts blocked when credentials are unavailable without making a request",
    () =>
      run({ LOOM_LIBRARY_URL: configured.LOOM_LIBRARY_URL }, (f) =>
        Effect.gen(function* () {
          expect((yield* f.publisher.info.pipe(Effect.flip)).reason).toBe("blocked");
          expect(yield* Ref.get(f.requests)).toEqual([]);
        }),
      ),
  );
  it.effect(
    "adopts an enrolled host credential from its own private directory without shell configuration",
    () =>
      run({ LOOM_TEST_CREDENTIAL: "external" }, (f) =>
        Effect.gen(function* () {
          expect(f.publisher.enabled).toBe(true);
          expect((yield* f.publisher.info).authorityId).toBe("authority");
          expect(yield* Ref.get(f.requests)).toContain("/api/loom/library/computers/register");
        }),
      ),
  );
  it.effect(
    "keeps an invalid default enrollment blocked instead of silently disabling publication",
    () =>
      Effect.gen(function* () {
        for (const mode of ["insecure-default", "expired-default"])
          yield* run({ LOOM_TEST_CREDENTIAL: mode }, (f) =>
            Effect.gen(function* () {
              expect(f.publisher.enabled).toBe(true);
              expect((yield* f.publisher.info.pipe(Effect.flip)).reason).toBe("blocked");
              expect(yield* Ref.get(f.requests)).toEqual([]);
            }),
          );
      }),
  );
  it.effect("stays disabled without a central URL", () =>
    run({}, (f) =>
      Effect.gen(function* () {
        expect(f.publisher.enabled).toBe(false);
        expect(yield* Ref.get(f.requests)).toEqual([]);
      }),
    ),
  );
  it.effect(
    "uses a sealed host credential file when URL and token are absent from the environment",
    () =>
      run({ LOOM_TEST_CREDENTIAL: "valid" }, (f) =>
        Effect.gen(function* () {
          expect(f.publisher.enabled).toBe(true);
          expect((yield* f.publisher.info).authorityId).toBe("authority");
        }),
      ),
  );
  it.effect(
    "rejects expired, world-readable, and wrong-source credential files before sending credentials",
    () =>
      Effect.gen(function* () {
        for (const mode of ["expired", "insecure", "wrong-source"])
          yield* run({ LOOM_TEST_CREDENTIAL: mode }, (f) =>
            Effect.gen(function* () {
              expect(f.publisher.enabled).toBe(true);
              expect((yield* f.publisher.info.pipe(Effect.flip)).reason).toBe("blocked");
              expect(yield* Ref.get(f.requests)).toEqual([]);
            }),
          );
      }),
  );
  it.effect("rejects a credential file for a different Library environment", () =>
    run({ LOOM_TEST_CREDENTIAL: "wrong-library" }, (f) =>
      Effect.gen(function* () {
        expect((yield* f.publisher.info.pipe(Effect.flip)).reason).toBe("blocked");
      }),
    ),
  );
});
