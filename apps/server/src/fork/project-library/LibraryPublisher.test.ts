import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ChatAttachmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryIngestHistoryRequest,
  type LibraryPageReply,
  type LibraryProject,
  type PreviewPage,
  type PreviewPagesError,
} from "@t3tools/contracts/fork";
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
import {
  PreviewAccessService,
  type PreviewRegisterInput,
} from "../preview-access/PreviewAccessService.ts";
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
  const previewsSupported = yield* Ref.make(true);
  const previewBodies = yield* Ref.make<unknown[]>([]);
  /** What a Library that is its own computer registers in-process. */
  const localRegistrations = yield* Ref.make<PreviewRegisterInput[]>([]);
  /** Replaces every page route's answer while set. */
  const pageAnswer = yield* Ref.make<{ readonly status: number; readonly body: unknown } | null>(
    null,
  );
  const pageRequests = yield* Ref.make<
    Array<{ readonly method: string; readonly path: string; readonly body: unknown }>
  >([]);
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      expect(request.headers.authorization).toBe("Bearer fixture-token");
      const pathname = new URL(request.url).pathname;
      yield* Ref.update(requests, (paths) => [...paths, pathname]);
      const bytes = request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array();
      let response: unknown;
      let status = 200;
      if (pathname.startsWith("/api/loom/library/pages")) {
        const text = new TextDecoder().decode(bytes);
        yield* Ref.update(pageRequests, (sent) => [
          ...sent,
          { method: request.method, path: pathname, body: text === "" ? null : JSON.parse(text) },
        ]);
        const answer = yield* Ref.get(pageAnswer);
        // A string answer stands for a web page, such as an older Library's app fallback.
        if (answer !== null && typeof answer.body === "string")
          return HttpClientResponse.fromWeb(
            request,
            new Response(answer.body, {
              status: answer.status,
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
          );
        if (answer !== null) {
          status = answer.status;
          response = answer.body;
        } else if (pathname.endsWith("/replies/ack")) {
          return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
        } else if (pathname.endsWith("/replies/next")) response = { replies: [pageReply] };
        else if (pathname.endsWith("/update")) response = { ...page, kept: true, expiresAt: null };
        else if (pathname.endsWith("/publish")) response = page;
        else response = { pages: [page] };
      } else if (pathname.endsWith("/previews/register")) {
        yield* Ref.update(previewBodies, (bodies) => [
          ...bodies,
          JSON.parse(new TextDecoder().decode(bytes)),
        ]);
        if (yield* Ref.get(previewsSupported)) response = previewAccess;
        else {
          status = 404;
          response = { reason: "not-found" };
        }
      } else if (pathname.endsWith("/info"))
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
        new Response(json(response), { status, headers: { "content-type": "application/json" } }),
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
          Layer.mergeAll(
            Layer.mock(LibraryService.LibraryService)({}),
            Layer.mock(Assets.LibraryAssetService)({ mode: "local" }),
            Layer.mock(PreviewAccessService)({
              issuerOrigin: previewAccess.origin,
              register: (input) =>
                Effect.gen(function* () {
                  yield* Ref.update(localRegistrations, (sent) => [...sent, input]);
                  if (!(yield* Ref.get(previewsSupported)))
                    return yield* new LibraryError({ reason: "not-authority" });
                  return previewAccess;
                }),
            }),
          ),
        ),
      ),
    ),
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: effectiveEnv }))),
    Effect.provideService(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(source) }),
    Effect.provideService(HostProcess.HomeDirectory, enrolledHome),
  );
  return {
    publisher,
    requests,
    corruptReply,
    remoteInput,
    previewsSupported,
    previewBodies,
    localRegistrations,
    pageAnswer,
    pageRequests,
    sql,
    fs,
    config,
  };
});
const previewAccess = {
  origin: "https://library.example.test",
  ticketPath: "/api/loom/preview/ticket",
  keyId: "key-id",
  publicKey: "A".repeat(43),
};
const configured = {
  LOOM_LIBRARY_URL: "https://library.example.test",
  LOOM_LIBRARY_TOKEN: "fixture-token",
};
const page: PreviewPage = {
  id: "page-1",
  url: "https://pages.bagels.top/p/page-1",
  title: "Release plan",
  kind: "html",
  projectId: ProjectId.make("project"),
  threadId: ThreadId.make("thread"),
  state: "open",
  kept: false,
  sizeBytes: 9,
  createdAt: "2026-10-19T00:00:00.000Z",
  expiresAt: "2026-11-18T00:00:00.000Z",
  endedAt: null,
  restorableUntil: null,
};
const pageReply: LibraryPageReply = {
  replyId: "reply-0001",
  pageId: page.id,
  pageTitle: page.title,
  projectId: page.projectId,
  threadId: page.threadId,
  text: "Ship it",
  createdAt: "2026-10-19T01:00:00.000Z",
};
const pageReason = (error: PreviewPagesError) => ({ reason: error.reason, message: error.message });

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
  it.effect(
    "registers preview hosts and reads a Library without preview sign-in as not-found",
    () =>
      run(configured, (f) =>
        Effect.gen(function* () {
          expect(
            yield* f.publisher.registerPreviews({ machine: "dorothy", suffix: "bagels.top" }),
          ).toEqual(previewAccess);
          yield* f.publisher.registerPreviews(null);
          // It names itself, so a token shared by several computers can register too.
          expect(yield* Ref.get(f.previewBodies)).toEqual([
            { environmentId: source, previews: { machine: "dorothy", suffix: "bagels.top" } },
            { environmentId: source, previews: null },
          ]);
          yield* Ref.set(f.previewsSupported, false);
          expect((yield* f.publisher.registerPreviews(null).pipe(Effect.flip)).reason).toBe(
            "not-found",
          );
        }),
      ),
  );
  it.effect("registers its own preview hosts in-process when it is the Library", () =>
    run({ LOOM_LIBRARY_AUTHORITY: "true" }, (f) =>
      Effect.gen(function* () {
        const previews = { machine: "dorothy", suffix: "bagels.top" };
        expect(yield* f.publisher.registerPreviews(previews)).toEqual(previewAccess);
        expect(yield* Ref.get(f.localRegistrations)).toEqual([
          { environmentId: source, sessionId: null, previews },
        ]);
        // Without a public origin it answers like a remote Library without preview sign-in.
        yield* Ref.set(f.previewsSupported, false);
        expect((yield* f.publisher.registerPreviews(previews).pipe(Effect.flip)).reason).toBe(
          "not-found",
        );
        expect(yield* Ref.get(f.requests)).toEqual([]);
      }),
    ),
  );
  it.effect("publishes, lists and updates pages and leases and acknowledges their replies", () =>
    run(configured, (f) =>
      Effect.gen(function* () {
        const publish = {
          projectId: page.projectId,
          threadId: page.threadId,
          title: page.title,
          kind: "html" as const,
          html: "<p>hi</p>",
        };
        expect(yield* f.publisher.publishPage(publish)).toEqual(page);
        expect(yield* f.publisher.listPages()).toEqual([page]);
        expect(yield* f.publisher.updatePage({ pageId: page.id, action: "keep" })).toMatchObject({
          kept: true,
          expiresAt: null,
        });
        expect(yield* f.publisher.nextReplies(25_000)).toEqual([pageReply]);
        yield* f.publisher.ackReply({ replyId: pageReply.replyId, outcome: "delivered" });
        expect(yield* Ref.get(f.pageRequests)).toEqual([
          { method: "POST", path: "/api/loom/library/pages/publish", body: publish },
          { method: "GET", path: "/api/loom/library/pages", body: null },
          {
            method: "POST",
            path: "/api/loom/library/pages/update",
            body: { pageId: page.id, action: "keep" },
          },
          {
            method: "POST",
            path: "/api/loom/library/pages/replies/next",
            body: { waitMs: 25_000 },
          },
          {
            method: "POST",
            path: "/api/loom/library/pages/replies/ack",
            body: { replyId: pageReply.replyId, outcome: "delivered" },
          },
        ]);
      }),
    ),
  );
  it.effect(
    "reads a Library without pages as unavailable and keeps the reasons it refuses with",
    () =>
      run(configured, (f) =>
        Effect.gen(function* () {
          const refusal = (status: number, body: unknown) =>
            Ref.set(f.pageAnswer, { status, body }).pipe(
              Effect.andThen(f.publisher.listPages().pipe(Effect.flip)),
              Effect.map(pageReason),
            );
          expect((yield* refusal(404, { error: "Not found" })).reason).toBe("unavailable");
          // An older Library serves its web app for a GET route it does not have.
          expect((yield* refusal(200, "<!doctype html><title>Loom</title>")).reason).toBe(
            "unavailable",
          );
          expect((yield* refusal(409, { reason: "too-large" })).reason).toBe("too-large");
          expect((yield* refusal(413, { reason: "too-large" })).reason).toBe("too-large");
          expect(
            yield* refusal(409, {
              reason: "blocked",
              message: "This Library holds 500 open pages.",
            }),
          ).toEqual({ reason: "blocked", message: "This Library holds 500 open pages." });
          // A refusal without a reason it can name is not one the computer can act on.
          expect((yield* refusal(409, { reason: "full" })).reason).toBe("io");
          expect((yield* refusal(401, {})).reason).toBe("blocked");
          expect((yield* refusal(403, {})).reason).toBe("blocked");
          expect((yield* refusal(502, {})).reason).toBe("io");
          expect((yield* refusal(200, { pages: [{ id: "page-1" }] })).reason).toBe("io");
        }),
      ),
  );
  it.effect("signs pages browsers out, reading a Library without that route as unavailable", () =>
    run(configured, (f) =>
      Effect.gen(function* () {
        yield* f.publisher.signOutPageReaders();
        expect(yield* Ref.get(f.pageRequests)).toEqual([
          { method: "POST", path: "/api/loom/library/pages/sign-out", body: {} },
        ]);
        yield* Ref.set(f.pageAnswer, { status: 404, body: { error: "Not found" } });
        expect((yield* f.publisher.signOutPageReaders().pipe(Effect.flip)).reason).toBe(
          "unavailable",
        );
      }),
    ),
  );
  it.effect("keeps pages unavailable without a Library and blocked without a token", () =>
    Effect.gen(function* () {
      yield* run({}, (f) =>
        Effect.gen(function* () {
          expect((yield* f.publisher.listPages().pipe(Effect.flip)).reason).toBe("unavailable");
          expect((yield* f.publisher.nextReplies(0).pipe(Effect.flip)).reason).toBe("unavailable");
        }),
      );
      yield* run({ LOOM_LIBRARY_URL: configured.LOOM_LIBRARY_URL }, (f) =>
        Effect.gen(function* () {
          expect((yield* f.publisher.listPages().pipe(Effect.flip)).reason).toBe("blocked");
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
