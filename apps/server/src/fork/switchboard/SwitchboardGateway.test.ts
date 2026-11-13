import { expect, it } from "@effect/vitest";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeWS from "@effect/platform-node/NodeWS";
import * as Context from "effect/Context";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { upstreamWebSocketConstructor } from "../../device/DeviceHubProxy.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { SwitchboardGatewayRoutes } from "./gateway-http.ts";
import * as Gateway from "./SwitchboardGateway.ts";

const KEY = "a".repeat(64);
const fixture = Effect.gen(function* () {
  const state = {
    key: KEY,
    status: 200,
    helperReads: 0,
    socketConstructor: undefined as Socket.WebSocketConstructor["Service"] | undefined,
  };
  const environment: NodeJS.ProcessEnv = { LOOM_SWITCHBOARD_SHARE_GATEWAY: "true" };
  const requests: Array<{ url: string; headers: Readonly<Record<string, string>>; body: string }> =
    [];
  const dependencies = Layer.mergeAll(
    Layer.succeed(HostProcess.Environment, environment),
    Layer.succeed(HostProcess.Platform, "darwin"),
    Layer.succeed(Socket.WebSocketConstructor, (url, options) => {
      if (!state.socketConstructor) throw new Error("Unexpected WebSocket");
      return state.socketConstructor(url, options);
    }),
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() =>
        Effect.sync(() => {
          state.helperReads++;
          return ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            unref: Effect.succeed(Effect.void),
            stdin: Sink.drain,
            getInputFd: () => Sink.drain,
            stderr: Stream.empty,
            all: Stream.empty,
            stdout: Stream.succeed(new TextEncoder().encode(state.key)),
            getOutputFd: () => Stream.empty,
          });
        }),
      ),
    ),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.gen(function* () {
          const chunks =
            request.body._tag === "Stream"
              ? yield* Stream.runCollect(request.body.stream.pipe(Stream.orDie))
              : [];
          requests.push({
            url: request.url,
            headers: request.headers,
            body: [...chunks].map((part) => new TextDecoder().decode(part)).join(""),
          });
          return HttpClientResponse.fromWeb(
            request,
            new Response(Uint8Array.of(0, 255, 3), {
              status: state.status,
              headers: {
                "content-type": "text/event-stream",
                "set-cookie": "private=hidden",
                location: "https://other.invalid",
                "cf-access-jwt-assertion": "private",
              },
            }),
          );
        }),
      ),
    ),
  );
  const gateway = yield* Gateway.SwitchboardGateway.pipe(
    Effect.provide(Gateway.layer.pipe(Layer.provide(dependencies))),
  );
  const send = (
    path: string,
    method = "GET",
    credential: string | null = KEY,
    extra: Record<string, string> = {},
  ) =>
    gateway.forward(
      HttpServerRequest.fromWeb(
        new Request("https://computer.loomhost.dev/api/loom/switchboard" + path, {
          method,
          headers: {
            ...(credential === null ? {} : { authorization: "Bearer " + credential }),
            cookie: "loom-session=private",
            "cf-access-jwt-assertion": "private",
            "x-forwarded-for": "untrusted",
            ...extra,
          },
          ...(method === "POST" ? { body: '{"model":"synthetic","stream":true}' } : {}),
        }),
      ),
      path,
    );
  return { state, environment, requests, gateway, send };
});

it.effect("streams personal inference through only the restricted local gateway", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const response = yield* f.send("/v1/responses", "POST");
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({
      url: "http://127.0.0.1:8321/v1/responses",
      body: '{"model":"synthetic","stream":true}',
    });
    expect(f.requests[0]!.headers.authorization).toBe("Bearer " + KEY);
    for (const header of ["cookie", "cf-access-jwt-assertion", "x-forwarded-for"])
      expect(f.requests[0]!.headers[header]).toBeUndefined();
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-store, no-transform");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["cf-access-jwt-assertion"]).toBeUndefined();
    expect([
      ...new Uint8Array(
        yield* Effect.promise(() => HttpServerResponse.toWeb(response).arrayBuffer()),
      ),
    ]).toEqual([0, 255, 3]);
    for (const path of [
      "/v1/models",
      "/v1/chat/completions",
      "/v1/messages",
      "/v1/messages/count_tokens?beta=true",
    ]) {
      yield* f.send(path, path === "/v1/models" ? "GET" : "POST");
    }
    yield* f.send("/v1/messages?beta=true", "POST", null, { "x-api-key": KEY });
    expect(f.requests.at(-1)?.headers["x-api-key"]).toBe(KEY);
    expect(f.requests.at(-1)?.headers.authorization).toBeUndefined();
  }),
);

it.effect("refuses opt-out, foreign credentials, protected routes, and redirected responses", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    delete f.environment.LOOM_SWITCHBOARD_SHARE_GATEWAY;
    expect((yield* f.send("/v1/models").pipe(Effect.flip)).reason).toBe("disabled");
    expect(f.state.helperReads).toBe(0);
    f.environment.LOOM_SWITCHBOARD_SHARE_GATEWAY = "true";
    expect((yield* f.send("/v1/models", "GET", "b".repeat(64)).pipe(Effect.flip)).reason).toBe(
      "authentication",
    );
    for (const path of [
      "/",
      "/api/v1/settings",
      "/v0/management/config",
      "/v1/responses?target=elsewhere",
      "/v1/messages?beta=true?target=elsewhere",
      "/v1/%2e%2e/models",
      "//elsewhere/v1/models",
    ])
      expect((yield* f.send(path).pipe(Effect.flip)).reason).toBe("path");
    expect(f.requests).toHaveLength(0);
    for (const [credential, extra] of [
      [null, {}],
      [KEY, { "x-api-key": KEY }],
      ["malformed", {}],
    ] as const) {
      expect((yield* f.send("/v1/models", "GET", credential, extra).pipe(Effect.flip)).reason).toBe(
        "authentication",
      );
    }
    f.state.key = "b".repeat(64);
    expect((yield* f.send("/v1/models").pipe(Effect.flip)).reason).toBe("authentication");
    yield* f.send("/v1/models", "GET", f.state.key);
    f.state.key = "";
    expect((yield* f.send("/v1/models").pipe(Effect.flip)).reason).toBe("unavailable");
    f.state.key = KEY;
    f.state.status = 302;
    expect((yield* f.send("/v1/models").pipe(Effect.flip)).reason).toBe("unavailable");
    expect(f.requests).toHaveLength(2);
  }),
);

it.effect("carries Responses text and binary WebSocket frames through the public HTTP route", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const headers = Promise.withResolvers<Record<string, string | string[] | undefined>>();
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
    const makeSocket = yield* Socket.WebSocketConstructor.pipe(
      Effect.provide(upstreamWebSocketConstructor),
    );
    f.state.socketConstructor = (url, options) => {
      expect(url).toBe("ws://127.0.0.1:8321/v1/responses");
      return makeSocket(`ws://127.0.0.1:${address.port}/v1/responses`, options);
    };
    target.on("connection", (socket, request) => {
      headers.resolve(request.headers);
      socket.once("close", () => targetClosed.resolve());
      socket.send("ready");
      socket.on("message", (bytes, binary) => socket.send(bytes, { binary }));
    });
    const runtime = Layer.succeed(
      ForkRuntime,
      Context.make(
        Gateway.SwitchboardGateway,
        f.gateway,
      ) as unknown as Context.Context<ForkServices>,
    );
    const services = yield* Layer.build(
      HttpRouter.serve(SwitchboardGatewayRoutes.pipe(HttpRouter.provideRequest(runtime)), {
        disableListenLog: true,
      }).pipe(Layer.provideMerge(NodeHttpServer.layerTest)),
    );
    const origin = HttpServer.formatAddress(
      Context.get(services, HttpServer.HttpServer).address,
    ).replace(/^http/u, "ws");
    const http = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer));
    for (const [path, key, expected] of [
      ["/v1/models", "wrong", 401],
      ["/v0/management/config", KEY, 404],
      ["/v1/models", KEY, 200],
    ] as const) {
      const result = yield* http.get(
        `${origin.replace(/^ws/u, "http")}${Gateway.SWITCHBOARD_GATEWAY_PREFIX}${path}`,
        {
          headers: { authorization: "Bearer " + key },
        },
      );
      expect(result.status).toBe(expected);
      yield* result.arrayBuffer;
    }
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const socket = makeSocket(`${origin}${Gateway.SWITCHBOARD_GATEWAY_PREFIX}/v1/responses`, {
          headers: {
            authorization: "Bearer " + KEY,
            cookie: "private",
            "cf-access-jwt-assertion": "private",
          },
        });
        if ("binaryType" in socket) socket.binaryType = "arraybuffer";
        return socket;
      }),
      (socket) => Effect.sync(() => socket.close(1000)),
    );
    const received = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const frames: Array<string | number[]> = [];
    client.addEventListener("close", () => closed.resolve());
    client.addEventListener("error", () => received.reject(new Error("Gateway connection failed")));
    client.addEventListener("message", ({ data }) => {
      frames.push(typeof data === "string" ? data : [...new Uint8Array(data as ArrayBuffer)]);
      if (frames.length === 1) client.send(Uint8Array.of(0, 255, 3));
      else received.resolve();
    });
    yield* Effect.promise(() => received.promise);
    const upstream = yield* Effect.promise(() => headers.promise);
    expect(upstream.authorization).toBe("Bearer " + KEY);
    expect(upstream.cookie).toBeUndefined();
    expect(upstream["cf-access-jwt-assertion"]).toBeUndefined();
    expect(frames).toEqual(["ready", [0, 255, 3]]);
    client.close(1000);
    yield* Effect.promise(() => Promise.all([closed.promise, targetClosed.promise]));
  }),
);
