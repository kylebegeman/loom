import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import {
  type LibraryConnection,
  LibraryConnectionService,
} from "../project-library/LibraryConnection.ts";
import { LoomReleaseSource, layer, libraryReleaseClient } from "./LoomReleaseSource.ts";

const ORIGIN = "https://library.example.test";
const SIGNED = "https://s3.example.test/bucket/releases/v1.2.3/SHA256SUMS?X-Amz-Signature=abc";

const fixture = (
  libraryResponse: (url: string) => Response,
  objectResponse: () => Response = () => new Response("object bytes"),
) =>
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
        Effect.as(HttpClientResponse.fromWeb(request, objectResponse())),
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

const resolveWith = (
  connection: (send: Send) => LibraryConnection,
  response: () => Response,
  objectResponse?: () => Response,
) =>
  Effect.gen(function* () {
    const f = yield* fixture(response, objectResponse);
    const service = yield* LoomReleaseSource.pipe(
      Effect.provide(
        layer.pipe(
          Layer.provide(
            Layer.mock(LibraryConnectionService)({
              current: Effect.succeed(connection(f.send)),
              send: f.send,
            }),
          ),
          Layer.provide(Layer.succeed(HttpClient.HttpClient, f.directClient)),
        ),
      ),
    );
    return { f, service };
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

describe("loom release index", () => {
  const redirect = () => new Response(null, { status: 302, headers: { location: SIGNED } });

  it.effect("reads the Library's mirrored releases through its signed redirect", () =>
    Effect.gen(function* () {
      const { f, service } = yield* resolveWith(remote, redirect, () =>
        Response.json([
          {
            tag_name: "1.2.3",
            draft: false,
            prerelease: false,
            body: "Notes",
            assets: [{ name: "SHA256SUMS", size: 10 }],
            html_url: "https://github.com/owner/repo/releases/tag/1.2.3",
          },
        ]),
      );
      expect(yield* service.index).toEqual([
        {
          tag_name: "1.2.3",
          draft: false,
          prerelease: false,
          body: "Notes",
          assets: [{ name: "SHA256SUMS" }],
        },
      ]);
      expect((yield* Ref.get(f.direct)).map((request) => request.url)).toEqual([SIGNED]);
    }),
  );

  it.effect("is null when the Library hosts no releases or none is enrolled", () =>
    Effect.gen(function* () {
      const notHosted = () => Response.json({ reason: "not-hosted" }, { status: 404 });
      for (const connection of [remote, (): LibraryConnection => ({ kind: "none" })]) {
        const { f, service } = yield* resolveWith(connection, notHosted);
        expect(yield* service.index).toBeNull();
        expect(yield* Ref.get(f.direct)).toEqual([]);
      }
    }),
  );

  it.effect("fails for an unreachable Library or an unreadable list instead of falling back", () =>
    Effect.gen(function* () {
      const unreachable = yield* resolveWith(remote, () => new Response("down", { status: 503 }));
      expect((yield* Effect.flip(unreachable.service.index)).reason).toBe("unreachable");
      expect(yield* Ref.get(unreachable.f.direct)).toEqual([]);
      const unreadable = yield* resolveWith(remote, redirect, () =>
        Response.json([{ tag_name: "1.2.3" }]),
      );
      expect((yield* Effect.flip(unreadable.service.index)).reason).toBe("invalid");
    }),
  );
});
