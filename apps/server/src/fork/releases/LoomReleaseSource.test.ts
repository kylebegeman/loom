import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as ServerConfig from "../../config.ts";
import {
  type LibraryConnection,
  LibraryConnectionService,
} from "../project-library/LibraryConnection.ts";
import {
  LoomReleaseSource,
  layer,
  libraryReleaseClient,
  libraryReleasesForHome,
  newestLibraryRelease,
} from "./LoomReleaseSource.ts";

const ORIGIN = "https://library.example.test";
const SIGNED = "https://s3.example.test/bucket/releases/v1.2.3/SHA256SUMS?X-Amz-Signature=abc";

const fixture = (libraryResponse: (url: string) => Response) =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<{ url: string; redirect: unknown }>>([]);
    const direct = yield* Ref.make<ReadonlyArray<HttpClientRequest.HttpClientRequest>>([]);
    const send = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function* () {
        const init = yield* Effect.serviceOption(FetchHttpClient.RequestInit);
        yield* Ref.update(sent, (all) => [
          ...all,
          { url: request.url, redirect: init._tag === "Some" ? init.value.redirect : undefined },
        ]);
        const authenticated = request.pipe(HttpClientRequest.bearerToken("publisher-secret"));
        return HttpClientResponse.fromWeb(authenticated, libraryResponse(request.url));
      });
    const directClient = HttpClient.make((request) =>
      Ref.update(direct, (all) => [...all, request]).pipe(
        Effect.as(HttpClientResponse.fromWeb(request, new Response("object bytes"))),
      ),
    );
    return { sent, direct, send, directClient };
  });

type Send = Extract<LibraryConnection, { kind: "remote" }>["send"];

const remote = (send: Send): LibraryConnection => ({
  kind: "remote",
  credential: null,
  credentialAvailable: true,
  origin: ORIGIN,
  endpoint: (path) => new URL(path, ORIGIN).toString(),
  send,
});

describe("library release client", () => {
  it.effect("follows the Library's redirect without this computer's credentials", () =>
    Effect.gen(function* () {
      const f = yield* fixture(
        () => new Response(null, { status: 302, headers: { location: SIGNED } }),
      );
      const client = libraryReleaseClient({
        origin: ORIGIN,
        send: f.send,
        direct: f.directClient,
      });
      const response = yield* client.get(`${ORIGIN}/api/loom/releases/v1.2.3/SHA256SUMS`);
      expect(yield* response.text).toBe("object bytes");
      expect(yield* Ref.get(f.sent)).toEqual([
        { url: `${ORIGIN}/api/loom/releases/v1.2.3/SHA256SUMS`, redirect: "manual" },
      ]);
      const [followed] = yield* Ref.get(f.direct);
      expect(followed?.url).toBe(SIGNED);
      for (const header of ["authorization", "cf-access-client-id", "cf-access-client-secret"])
        expect(followed?.headers[header]).toBeUndefined();
    }),
  );

  it.effect("sends other origins directly and refuses an insecure redirect", () =>
    Effect.gen(function* () {
      const f = yield* fixture(
        () => new Response(null, { status: 302, headers: { location: "http://plain.example" } }),
      );
      const client = libraryReleaseClient({
        origin: ORIGIN,
        send: f.send,
        direct: f.directClient,
      });
      yield* client.get("https://github.com/owner/repo/releases/download/1.2.3/SHA256SUMS");
      expect(yield* Ref.get(f.sent)).toEqual([]);
      const refused = yield* client.get(`${ORIGIN}/api/loom/releases/index.json`).pipe(Effect.flip);
      expect(refused.reason._tag).toBe("TransportError");
      expect(yield* Ref.get(f.direct)).toHaveLength(1);
    }),
  );
});

describe("loom release source", () => {
  const resolveWith = (connection: (send: Send) => LibraryConnection, response: () => Response) =>
    Effect.gen(function* () {
      const f = yield* fixture(response);
      const service = yield* LoomReleaseSource.pipe(
        Effect.provide(
          layer.pipe(
            Layer.provide(
              Layer.mock(LibraryConnectionService)({
                current: Effect.succeed(connection(f.send)),
                send: f.send,
              }),
            ),
          ),
        ),
      );
      return { f, service };
    });

  it.effect("downloads from the Library when it hosts releases", () =>
    Effect.gen(function* () {
      const { f, service } = yield* resolveWith(
        remote,
        () => new Response(null, { status: 302, headers: { location: SIGNED } }),
      );
      const source = yield* service.resolve({
        releaseBaseUrl: undefined,
        httpClient: f.directClient,
      });
      expect(source.releaseBaseUrl).toBe(`${ORIGIN}/api/loom/releases`);
      expect(source.httpClient).not.toBe(f.directClient);
      expect(yield* Ref.get(f.sent)).toEqual([
        { url: `${ORIGIN}/api/loom/releases/index.json`, redirect: "manual" },
      ]);
    }),
  );

  it.effect("keeps the configured source when the Library hosts none or none is enrolled", () =>
    Effect.gen(function* () {
      const notHosted = () => Response.json({ reason: "not-hosted" }, { status: 404 });
      for (const [connection, response] of [
        [remote, notHosted],
        [(): LibraryConnection => ({ kind: "none" }), notHosted],
        [(send: Send) => ({ ...remote(send), credentialAvailable: false }), notHosted],
      ] as const) {
        const { f, service } = yield* resolveWith(connection, response);
        const configured = { releaseBaseUrl: undefined, httpClient: f.directClient };
        expect(yield* service.resolve(configured)).toBe(configured);
      }
      const { f, service } = yield* resolveWith(remote, notHosted);
      const explicit = { releaseBaseUrl: "https://mirror.example/", httpClient: f.directClient };
      expect(yield* service.resolve(explicit)).toBe(explicit);
      expect(yield* Ref.get(f.sent)).toEqual([]);
    }),
  );

  it.effect("reports an unreachable Library from the download instead of falling back", () =>
    Effect.gen(function* () {
      const { f, service } = yield* resolveWith(
        remote,
        () => new Response("unavailable", { status: 503 }),
      );
      const source = yield* service.resolve({
        releaseBaseUrl: undefined,
        httpClient: f.directClient,
      });
      expect(source.releaseBaseUrl).toBe(`${ORIGIN}/api/loom/releases`);
    }),
  );
});

describe("t3 update on an enrolled computer", () => {
  const INDEX = "https://s3.example.test/bucket/releases/index.json?X-Amz-Signature=abc";
  const forHome = (input: {
    readonly environmentId?: string;
    readonly credentialFor?: string;
    readonly index: () => Response;
  }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      yield* fs.makeDirectory(config.secretsDir, { recursive: true });
      if (input.environmentId !== undefined)
        yield* fs.writeFileString(config.environmentIdPath, `${input.environmentId}\n`);
      yield* fs.writeFileString(
        `${config.secretsDir}/library-publisher.json`,
        JSON.stringify({
          version: 1,
          sourceEnvironmentId: input.credentialFor ?? "studio",
          libraryEnvironmentId: "library",
          libraryUrl: ORIGIN,
          sessionId: "session",
          accessToken: "publisher-secret",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
        { mode: 0o600 },
      );
      const requests: HttpClientRequest.HttpClientRequest[] = [];
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push(request);
          return HttpClientResponse.fromWeb(
            request,
            request.url === INDEX
              ? Response.json([
                  { tag_name: "0.0.210-nightly.20261114.4700", draft: true },
                  { tag_name: "0.0.209-nightly.20261113.4650" },
                  { tag_name: "0.0.208" },
                ])
              : input.index(),
          );
        }),
      );
      const releases = yield* libraryReleasesForHome(config).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.provideService(HostProcess.HomeDirectory, config.baseDir),
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: {} })),
      );
      return { releases, requests };
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "release-source-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    );

  it.effect("lists and downloads with this computer's sign-in, never sending it on", () =>
    Effect.gen(function* () {
      const { releases, requests } = yield* forHome({
        environmentId: "studio",
        index: () => new Response(null, { status: 302, headers: { location: INDEX } }),
      });
      expect(releases?.releaseBaseUrl).toBe(`${ORIGIN}/api/loom/releases`);
      expect(yield* newestLibraryRelease(releases!, "nightly")).toBe(
        "0.0.209-nightly.20261113.4650",
      );
      expect(yield* newestLibraryRelease(releases!, "stable")).toBe("0.0.208");
      const preview = yield* newestLibraryRelease(releases!, "preview").pipe(Effect.flip);
      expect(preview.reason).toBe("Your Library has no published preview release.");
      for (const request of requests)
        expect(request.headers["authorization"]).toBe(
          request.url === INDEX ? undefined : "Bearer publisher-secret",
        );
      expect(requests.map((request) => request.url)).toContain(INDEX);
    }),
  );

  it.effect("keeps the public source unless this home is enrolled in a Library with releases", () =>
    Effect.gen(function* () {
      const notHosted = () => Response.json({ reason: "not-hosted" }, { status: 404 });
      const hosted = () => new Response(null, { status: 302, headers: { location: INDEX } });
      for (const input of [
        { index: hosted },
        { environmentId: "studio", credentialFor: "laptop", index: hosted },
        { environmentId: "studio", index: notHosted },
      ]) {
        expect((yield* forHome(input)).releases).toBeUndefined();
      }
    }),
  );
});
