import { expect, it } from "@effect/vitest";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeWS from "@effect/platform-node/NodeWS";
import { AuthSessionId, AuthStandardClientScopes, EnvironmentId } from "@t3tools/contracts";
import { ACCOUNT_ACCESS_HEADER } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as SessionStore from "../../auth/SessionStore.ts";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as AccountAccess from "./AccountAccess.ts";
import * as AccountGateway from "./AccountGateway.ts";

const COMPUTER = EnvironmentId.make("computer-a");
const caller: EnvironmentAuth.AuthenticatedSession = {
  sessionId: AuthSessionId.make("device-a"),
  subject: "identity:owner",
  method: "bearer-access-token",
  scopes: AuthStandardClientScopes,
};
const fixture = Effect.gen(function* () {
  const revoked = yield* Deferred.make<void>();
  const removed = yield* Deferred.make<void>();
  const requests: Array<{ url: string; headers: Readonly<Record<string, string>> }> = [];
  let status = 200;
  let origin = "https://computer-loom.example.test";
  const dependencies = Layer.mergeAll(
    Layer.mock(AccountAccess.AccountAccess)({
      prepare: () =>
        Effect.succeed({
          origin,
          grant: "one-use-grant",
          lease: { keyFingerprint: "key", membershipRevision: null },
        }),
      publicRoute: () => Effect.succeed(origin),
      awaitRemoval: () => Deferred.await(removed),
    }),
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      authenticateHttpRequest: () => Effect.succeed(caller),
      authenticateWebSocketUpgrade: () => Effect.succeed(caller),
    }),
    Layer.mock(SessionStore.SessionStore)({
      cookieName: "test",
      legacyCookieName: undefined,
      markConnected: () => Effect.void,
      markDisconnected: () => Effect.void,
      awaitSessionChain: () => Deferred.await(revoked),
      awaitInvalidation: () => Deferred.await(revoked),
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        requests.push({ url: request.url, headers: request.headers });
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(Uint8Array.of(0, 0xff, 3), {
              status,
              headers: {
                "content-type": "application/octet-stream",
                "set-cookie": "host-credential=secret",
                location: "https://other.example.test",
              },
            }),
          ),
        );
      }),
    ),
  );
  return {
    revoked,
    removed,
    requests,
    dependencies,
    setStatus: (value: number) => {
      status = value;
    },
    setOrigin: (value: string) => {
      origin = value;
    },
  };
});

it.effect(
  "streams HTTP bytes while keeping the Library credential and host cookies out of the hop",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const gateway = yield* AccountGateway.AccountGateway.pipe(
        Effect.provide(AccountGateway.layer.pipe(Layer.provide(f.dependencies))),
      );
      const request = HttpServerRequest.fromWeb(
        new Request("https://library.example.test/account/path", {
          headers: {
            authorization: "Bearer library-secret",
            cookie: "session=library-secret",
            "x-forwarded-host": "untrusted.example.test",
            "cf-access-jwt-assertion": "library-transport-credential",
            "cf-access-client-secret": "library-transport-secret",
            [ACCOUNT_ACCESS_HEADER]: "forged",
          },
        }),
      );
      const result = yield* gateway.forward({
        request,
        environmentId: COMPUTER,
        path: "/api/projects?variant=small",
      });
      expect(f.requests).toHaveLength(1);
      expect(f.requests[0]?.url).toBe(
        "https://computer-loom.example.test/api/projects?variant=small",
      );
      expect(f.requests[0]?.headers[ACCOUNT_ACCESS_HEADER]).toBe("one-use-grant");
      expect(f.requests[0]?.headers.authorization).toBeUndefined();
      expect(f.requests[0]?.headers.cookie).toBeUndefined();
      expect(f.requests[0]?.headers["x-forwarded-host"]).toBeUndefined();
      expect(f.requests[0]?.headers["cf-access-jwt-assertion"]).toBeUndefined();
      expect(f.requests[0]?.headers["cf-access-client-secret"]).toBeUndefined();
      expect(result.headers["set-cookie"]).toBeUndefined();
      expect(result.headers.location).toBeUndefined();
      const bytes = yield* Effect.promise(() => HttpServerResponse.toWeb(result).arrayBuffer());
      expect([...new Uint8Array(bytes)]).toEqual([0, 255, 3]);
    }),
);

it.effect("refuses redirect responses and paths outside the computer API", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const gateway = yield* AccountGateway.AccountGateway.pipe(
      Effect.provide(AccountGateway.layer.pipe(Layer.provide(f.dependencies))),
    );
    const request = HttpServerRequest.fromWeb(
      new Request("https://library.example.test/account/path"),
    );
    for (const path of [
      "//other.example.test/ws",
      "/api/assets/%2e%2e/mcp",
      "/mcp",
      "/api/loom/account/verify",
    ]) {
      expect(
        (yield* Effect.result(gateway.forward({ request, environmentId: COMPUTER, path })))._tag,
      ).toBe("Failure");
    }
    expect(f.requests).toHaveLength(0);
    f.setStatus(302);
    expect(
      (yield* Effect.result(
        gateway.forward({ request, environmentId: COMPUTER, path: "/api/projects" }),
      ))._tag,
    ).toBe("Failure");
    expect(f.requests).toHaveLength(1);
  }),
);

it.effect("preserves WebSocket frames and closes both hops when the device is revoked", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const headers = Promise.withResolvers<{
      url: string | undefined;
      headers: Record<string, string | string[] | undefined>;
    }>();
    const targetClosed = Promise.withResolvers<void>();
    const target = yield* Effect.acquireRelease(
      Effect.sync(() => new NodeWS.WebSocketServer({ port: 0 })),
      (server) =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              for (const client of server.clients) client.terminate();
              server.close(() => resolve());
            }),
        ),
    );
    if (!target.address())
      yield* Effect.promise(
        () => new Promise<void>((resolve) => target.once("listening", resolve)),
      );
    const address = target.address();
    if (typeof address !== "object" || address === null) throw new Error("Missing target port");
    f.setOrigin(`http://127.0.0.1:${address.port}`);
    target.on("connection", (socket, request) => {
      headers.resolve({ url: request.url, headers: request.headers });
      socket.on("close", () => targetClosed.resolve());
      socket.send(Uint8Array.of(0x83));
      socket.on("message", (bytes, binary) => socket.send(bytes, { binary }));
    });
    const route = HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        return yield* (yield* AccountGateway.AccountGateway).forward({
          request,
          environmentId: COMPUTER,
          path: "/ws?wsTicket=library-ticket",
        });
      }).pipe(Effect.orDie),
    );
    const services = yield* Layer.build(
      HttpRouter.serve(route, { disableListenLog: true }).pipe(
        Layer.provide(AccountGateway.layer.pipe(Layer.provide(f.dependencies))),
        Layer.provideMerge(NodeHttpServer.layerTest),
      ),
    );
    const origin = HttpServer.formatAddress(
      Context.get(services, HttpServer.HttpServer).address,
    ).replace(/^http/u, "ws");
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocket(`${origin}/ws`)),
      (socket) => Effect.sync(() => socket.close()),
    );
    client.binaryType = "arraybuffer";
    const received = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const frames: number[][] = [];
    client.addEventListener("close", () => closed.resolve());
    client.addEventListener("error", () => received.reject(new Error("Gateway connection failed")));
    client.addEventListener("message", ({ data }) => {
      frames.push([...new Uint8Array(data as ArrayBuffer)]);
      if (frames.length === 1) client.send(Uint8Array.of(0, 0xff, 3));
      else received.resolve();
    });
    yield* Effect.promise(() => received.promise);
    const upstream = yield* Effect.promise(() => headers.promise);
    expect(upstream.url).toBe("/ws");
    expect(upstream.headers[ACCOUNT_ACCESS_HEADER]).toBe("one-use-grant");
    expect(frames).toEqual([[0x83], [0, 255, 3]]);
    yield* Deferred.succeed(f.revoked, undefined);
    yield* Effect.promise(() => Promise.all([closed.promise, targetClosed.promise]));
  }),
);

it.effect("keeps destination-signed assets public and uses media admission for HTTP streams", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const gateway = yield* AccountGateway.AccountGateway.pipe(
      Effect.provide(AccountGateway.layer.pipe(Layer.provide(f.dependencies))),
    );
    const publicRequest = HttpServerRequest.fromWeb(
      new Request("https://library.example.test/account/api/assets/image?signature=host-signed"),
    );
    yield* gateway.forward({
      request: publicRequest,
      environmentId: COMPUTER,
      path: "/api/assets/image?signature=host-signed",
    });
    expect(f.requests[0]?.headers[ACCOUNT_ACCESS_HEADER]).toBeUndefined();
    expect(f.requests[0]?.url).toContain("?signature=host-signed");
    const mediaAuth = Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      authenticateHttpRequest: () =>
        Effect.fail(new EnvironmentAuth.ServerAuthMissingCredentialError()),
      authenticateWebSocketUpgrade: (_request, use) => {
        expect(use).toBe("media");
        return Effect.succeed(caller);
      },
    });
    const streamGateway = yield* AccountGateway.AccountGateway.pipe(
      Effect.provide(
        AccountGateway.layer.pipe(Layer.provide(Layer.merge(f.dependencies, mediaAuth))),
      ),
    );
    const streamRequest = HttpServerRequest.fromWeb(
      new Request(
        "https://library.example.test/account/api/device-hub/stream?wsTicket=media-ticket",
      ),
    );
    yield* streamGateway.forward({
      request: streamRequest,
      environmentId: COMPUTER,
      path: "/api/device-hub/stream?wsTicket=media-ticket",
    });
    expect(f.requests[1]?.url).toBe("https://computer-loom.example.test/api/device-hub/stream");
    expect(f.requests[1]?.headers[ACCOUNT_ACCESS_HEADER]).toBe("one-use-grant");
  }),
);
