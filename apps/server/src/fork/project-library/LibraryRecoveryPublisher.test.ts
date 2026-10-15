import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, AuthSessionId } from "@t3tools/contracts";
import { type LibraryRecoveryReceipt } from "@t3tools/contracts/fork";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Publisher from "./LibraryRecoveryPublisher.ts";
import * as Recovery from "./assets/LibraryRecoveryStore.ts";

const source = EnvironmentId.make("source-host");
const library = EnvironmentId.make("central-library");
const bytes = new TextEncoder().encode("archive with work and complete Git recovery history");
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const manifest = {
  version: 1 as const,
  projectId: "project",
  projectRevision: 1,
  copyId: "copy",
  environmentId: source,
  title: "Example project",
  rootBasename: "example",
  manifestFile: "loom-working-copy.json" as const,
};
const fixture = Effect.fnUntraced(function* (mode = "valid") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "recovery-publisher-" });
  const archivePath = path.join(directory, "archive.tar");
  const credentialPath = path.join(directory, "credential.json");
  yield* fs.writeFile(archivePath, bytes);
  yield* fs.writeFileString(
    credentialPath,
    encodeJson({
      version: 1,
      sourceEnvironmentId: mode === "wrong-source" ? "other-host" : source,
      libraryEnvironmentId: library,
      libraryUrl: "https://library.example.test",
      sessionId: AuthSessionId.make("publisher-session"),
      accessToken: "fixture-credential",
      expiresAt: mode === "expired" ? "1970-01-01T00:00:00Z" : "2100-01-01T00:00:00Z",
    }),
    { mode: mode === "insecure" ? 0o644 : 0o600 },
  );
  const sha256 = Hex.encode(yield* (yield* Crypto.Crypto).digest("SHA-256", bytes));
  const receipt: LibraryRecoveryReceipt = {
    sourceEnvironmentId: source,
    copyId: manifest.copyId,
    sha256,
    byteLength: bytes.length,
    archiveKey: "recovery/key",
    verifiedAt: "2026-10-15T00:00:00Z",
  };
  const requests: string[] = [];
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      requests.push(`${request.method} ${request.url}`);
      if (request.url.startsWith("https://objects.example.test")) {
        expect(request.headers.authorization).toBeUndefined();
        return HttpClientResponse.fromWeb(request, new Response(bytes));
      }
      expect(request.headers.authorization).toBe("Bearer fixture-credential");
      if (request.url.endsWith("/info"))
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            environmentId: mode === "wrong-library" ? "another-library" : library,
            authorityId: "authority",
            authorityEpoch: 1,
            assets: "b2",
          }),
        );
      if (request.method === "PUT") {
        expect(request.body._tag).toBe("Stream");
        if (request.body._tag === "Stream") {
          expect(request.body.contentLength).toBe(bytes.length);
          const chunks = yield* request.body.stream.pipe(
            Stream.mapError(() => new Error("Fixture archive stream failed")),
            Stream.runCollect,
            Effect.orDie,
          );
          expect(chunks.flatMap((chunk) => [...chunk])).toEqual([...bytes]);
        }
        expect(request.headers["x-loom-recovery-manifest"]).toBeDefined();
        return HttpClientResponse.fromWeb(
          request,
          mode === "refused"
            ? new Response(null, { status: 503 })
            : Response.json(
                mode === "wrong-receipt" ? { ...receipt, sha256: "0".repeat(64) } : receipt,
              ),
        );
      }
      return HttpClientResponse.fromWeb(
        request,
        mode === "redirect"
          ? new Response(null, {
              status: 302,
              headers: { location: "https://objects.example.test/archive" },
            })
          : new Response(mode === "corrupt" ? bytes.slice(0, bytes.length - 1) : bytes),
      );
    }),
  );
  const publisher = yield* Publisher.LibraryRecoveryPublisher.pipe(
    Effect.provide(Publisher.layer),
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.provideService(
      HostProcess.Environment,
      mode === "unconfigured" ? {} : { LOOM_LIBRARY_CREDENTIAL_FILE: credentialPath },
    ),
  );
  return { publisher, archivePath, sha256, receipt, requests, fs };
});
const run = <A, E, R>(
  mode: string,
  use: (test: Effect.Success<ReturnType<typeof fixture>>) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture(mode));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("recovery archive publishing", () => {
  it.effect("uploads a bounded stream and verifies the entire downloaded archive", () =>
    run("valid", (test) =>
      Effect.gen(function* () {
        expect(
          yield* test.publisher.publish({
            archivePath: test.archivePath,
            sha256: test.sha256,
            manifest,
          }),
        ).toEqual(test.receipt);
        expect(test.requests.map((request) => request.split(" ")[0])).toEqual([
          "GET",
          "PUT",
          "GET",
        ]);
      }),
    ),
  );
  it.effect("downloads object-store redirects without forwarding the publishing credential", () =>
    run("redirect", (test) =>
      Effect.gen(function* () {
        expect(
          yield* test.publisher.publish({
            archivePath: test.archivePath,
            sha256: test.sha256,
            manifest,
          }),
        ).toEqual(test.receipt);
        expect(test.requests.at(-1)).toBe("GET https://objects.example.test/archive");
      }),
    ),
  );
  it.effect("refuses corrupt archives and inconsistent receipts while preserving local bytes", () =>
    Effect.gen(function* () {
      for (const mode of ["corrupt", "wrong-receipt", "refused"])
        yield* run(mode, (test) =>
          Effect.gen(function* () {
            const failed = yield* test.publisher
              .publish({ archivePath: test.archivePath, sha256: test.sha256, manifest })
              .pipe(Effect.flip);
            expect(failed.reason).toBe(
              mode === "refused" ? "publisher-unavailable" : "archive-unverified",
            );
            expect([...(yield* test.fs.readFile(test.archivePath))]).toEqual([...bytes]);
          }),
        );
    }),
  );
  it.effect(
    "blocks absent, unsafe, expired and wrong-source credentials before making a request",
    () =>
      Effect.gen(function* () {
        for (const mode of ["unconfigured", "insecure", "expired", "wrong-source"])
          yield* run(mode, (test) =>
            Effect.gen(function* () {
              expect(
                (yield* test.publisher
                  .publish({ archivePath: test.archivePath, sha256: test.sha256, manifest })
                  .pipe(Effect.flip)).reason,
              ).toBe(mode === "wrong-source" ? "invalid" : "publisher-unavailable");
              expect(test.requests).toEqual([]);
            }),
          );
      }),
  );
  it.effect("refuses upload to a different Library environment", () =>
    run("wrong-library", (test) =>
      Effect.gen(function* () {
        expect(
          (yield* test.publisher
            .publish({ archivePath: test.archivePath, sha256: test.sha256, manifest })
            .pipe(Effect.flip)).reason,
        ).toBe("publisher-unavailable");
        expect(test.requests).toHaveLength(1);
      }),
    ),
  );
  it.effect("verifies central-authority readback before acknowledging a local publish", () =>
    Effect.gen(function* () {
      const test = yield* fixture();
      const local = Layer.mock(Recovery.LibraryRecoveryStore)({
        put: () => Effect.succeed(test.receipt),
        get: () =>
          Effect.succeed({
            receipt: test.receipt,
            manifest,
            url: null,
            body: Stream.make(bytes.slice(0, 4), bytes.slice(4)),
          }),
      });
      const publisher = yield* Publisher.LibraryRecoveryPublisher.pipe(
        Effect.provide(Publisher.layer.pipe(Layer.provide(local))),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Local archive uses no network")),
        ),
        Effect.provideService(HostProcess.Environment, { LOOM_LIBRARY_AUTHORITY: "true" }),
      );
      expect(
        yield* publisher.publish({ archivePath: test.archivePath, sha256: test.sha256, manifest }),
      ).toEqual(test.receipt);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
