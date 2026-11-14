import { expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeWS from "@effect/platform-node/NodeWS";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Socket from "effect/socket/Socket";
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { upstreamWebSocketConstructor } from "../../device/DeviceHubProxy.ts";
import { ProviderInstanceId } from "@t3tools/contracts";
import { EnvironmentAuth } from "../../auth/EnvironmentAuth.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { SwitchboardAccountRoutes } from "./account-http.ts";
import { SwitchboardGatewayRoutes } from "./gateway-http.ts";
import { SWITCHBOARD_GATEWAY_PREFIX } from "./switchboard.ts";
import { SwitchboardClients } from "./SwitchboardClients.ts";
import * as Gateway from "./SwitchboardGateway.ts";

const KEY = "a".repeat(64);
/** A credential the hub issued to one account computer. */
const COMPUTER = "d".repeat(64);
const fixture = Effect.gen(function* () {
  const state = {
    key: KEY,
    status: 200,
    helperReads: 0,
    socketConstructor: undefined as Socket.WebSocketConstructor["Service"] | undefined,
    /** Completes when the account computer's credential stops working. */
    ended: Deferred.makeUnsafe<void>(),
    /** Completes once Switchboard receives a request; `hold` then delays its answer. */
    executing: Deferred.makeUnsafe<void>(),
    hold: undefined as Deferred.Deferred<void> | undefined,
    body: undefined as ReadableStream<Uint8Array> | undefined,
  };
  const environment: NodeJS.ProcessEnv = { LOOM_SWITCHBOARD_SHARE_GATEWAY: "true" };
  const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer));
  const home = yield* fs.makeTempDirectoryScoped();
  const instanceHome = yield* fs.makeTempDirectoryScoped();
  const requests: Array<{ url: string; headers: Readonly<Record<string, string>>; body: string }> =
    [];
  const dependencies = Layer.mergeAll(
    Layer.succeed(HostProcess.Environment, environment),
    Layer.succeed(HostProcess.Platform, "darwin"),
    Layer.mock(SwitchboardClients)({
      authenticate: (credential) =>
        Effect.succeed(
          credential === COMPUTER
            ? Option.some({ device: "kyle-s-macbook-air", ended: Deferred.await(state.ended) })
            : Option.none(),
        ),
    }),
    Layer.succeed(HostProcess.HomeDirectory, home),
    NodeFileSystem.layer,
    NodePath.layer,
    ServerSettings.layerTest({
      providerInstances: {
        [ProviderInstanceId.make("codex_2")]: {
          driver: "codex",
          config: { homePath: instanceHome },
        },
      },
    }),
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
          yield* Deferred.succeed(state.executing, undefined);
          if (state.hold) yield* Deferred.await(state.hold);
          return HttpClientResponse.fromWeb(
            request,
            new Response(state.body ?? Uint8Array.of(0, 255, 3), {
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
  return { state, environment, requests, gateway, send, fs, home, instanceHome };
});

it.effect("streams personal inference through only the restricted local gateway", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    // The server reads a response in its request's context, as this does.
    const context = yield* Effect.context<never>();
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
        yield* Effect.promise(() => HttpServerResponse.toWeb(response, { context }).arrayBuffer()),
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
    expect(f.requests.at(-1)?.headers.authorization).toBe("Bearer " + KEY);
    for (const path of ["/v1/messages?beta=true", "/v1/messages/count_tokens?beta=true"]) {
      yield* f.send(path, "POST", KEY, { "x-api-key": KEY });
      expect(f.requests.at(-1)?.headers.authorization).toBe("Bearer " + KEY);
      expect(f.requests.at(-1)?.headers["x-api-key"]).toBe(KEY);
    }
  }),
);

it.effect("sends an account computer's requests with the hub key and its ledger name", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.send("/v1/responses", "POST", COMPUTER, { "x-switchboard-device": "spoofed" });
    expect(f.requests.at(-1)?.headers.authorization).toBe("Bearer " + KEY);
    expect(f.requests.at(-1)?.headers["x-switchboard-device"]).toBe("kyle-s-macbook-air");
    yield* f.send("/v1/messages?beta=true", "POST", COMPUTER, { "x-api-key": COMPUTER });
    expect(f.requests.at(-1)?.headers["x-api-key"]).toBe(KEY);
    // The shared key still works during migration, and names no computer.
    yield* f.send("/v1/responses", "POST", KEY, { "x-switchboard-device": "spoofed" });
    expect(f.requests.at(-1)?.headers["x-switchboard-device"]).toBeUndefined();
  }),
);

it.effect("forwards the controller reads a routed computer makes, without the hub key", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.send("/controller/api/v1/availability", "GET", COMPUTER);
    yield* f.send("/controller/api/v1/service-tier?session=thread-1&since=42", "GET", COMPUTER);
    expect(f.requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:8318/api/v1/availability",
      "http://127.0.0.1:8318/api/v1/service-tier?session=thread-1&since=42",
    ]);
    for (const request of f.requests) {
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers["x-switchboard-device"]).toBeUndefined();
    }
    for (const path of [
      "/controller/api/v1/accounts",
      "/controller/api/v1/service-tier?session=a&since=1&extra=1",
      "/controller/api/v1/availability?x=1",
    ])
      expect((yield* f.send(path, "GET", COMPUTER).pipe(Effect.flip)).reason).toBe("path");
    expect(
      (yield* f.send("/controller/api/v1/availability", "GET", "b".repeat(64)).pipe(Effect.flip))
        .reason,
    ).toBe("authentication");
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
    for (const [credential, apiKey] of [
      [KEY, "b".repeat(64)],
      ["b".repeat(64), KEY],
      ["malformed", KEY],
      [KEY, "malformed"],
    ] as const) {
      expect(
        (yield* f
          .send("/v1/messages?beta=true", "POST", credential, { "x-api-key": apiKey })
          .pipe(Effect.flip)).reason,
      ).toBe("authentication");
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

/** Reads a streamed gateway response in the background, noting its first chunk and its end. */
const readBody = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.gen(function* () {
    if (response.body._tag !== "Stream") throw new Error("Expected a streamed body");
    const first = yield* Deferred.make<void>();
    const chunks: Array<string> = [];
    const fiber = yield* response.body.stream.pipe(
      Stream.runForEach((chunk) =>
        Effect.sync(() => chunks.push(new TextDecoder().decode(chunk))).pipe(
          Effect.andThen(Deferred.succeed(first, undefined)),
        ),
      ),
      Effect.exit,
      Effect.forkChild,
    );
    return { first, chunks, fiber };
  });

/** An upstream SSE body that stays open, and sends `data` once. */
const openUpstream = (f: Effect.Success<typeof fixture>, data: string) => {
  const upstream = new TransformStream<Uint8Array, Uint8Array>();
  f.state.body = upstream.readable;
  return () => void upstream.writable.getWriter().write(new TextEncoder().encode(data));
};

/** Serves the gateway's HTTP routes in front of a Responses WebSocket that greets and echoes. */
const serveSockets = (f: Effect.Success<typeof fixture>) =>
  Effect.gen(function* () {
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
      Context.make(Gateway.SwitchboardGateway, f.gateway).pipe(
        Context.add(SwitchboardClients, {
          enroll: () => Effect.succeed(Redacted.make(COMPUTER)),
        } as unknown as SwitchboardClients["Service"]),
      ) as unknown as Context.Context<ForkServices>,
    );
    const services = yield* Layer.build(
      HttpRouter.serve(
        Layer.merge(SwitchboardGatewayRoutes, SwitchboardAccountRoutes).pipe(
          HttpRouter.provideRequest(Layer.merge(runtime, Layer.mock(EnvironmentAuth)({}))),
        ),
        { disableListenLog: true },
      ).pipe(Layer.provideMerge(NodeHttpServer.layerTest)),
    );
    const origin = HttpServer.formatAddress(
      Context.get(services, HttpServer.HttpServer).address,
    ).replace(/^http/u, "ws");
    return { origin, makeSocket, headers: headers.promise, targetClosed: targetClosed.promise };
  });

/** Opens a gateway Responses socket and waits for the target's greeting. */
const openSocket = (bridge: Effect.Success<ReturnType<typeof serveSockets>>, credential: string) =>
  Effect.gen(function* () {
    const socket = yield* Effect.acquireRelease(
      Effect.sync(() =>
        bridge.makeSocket(`${bridge.origin}${SWITCHBOARD_GATEWAY_PREFIX}/v1/responses`, {
          headers: { authorization: "Bearer " + credential },
        }),
      ),
      (socket) => Effect.sync(() => socket.close(1000)),
    );
    const greeted = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    socket.addEventListener("message", () => greeted.resolve());
    socket.addEventListener("error", () => greeted.reject(new Error("Gateway connection failed")));
    socket.addEventListener("close", () => closed.resolve());
    yield* Effect.promise(() => greeted.promise);
    return { closed: closed.promise };
  });

it.effect("carries Responses text and binary WebSocket frames through the public HTTP route", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const { origin, makeSocket, headers, targetClosed } = yield* serveSockets(f);
    const http = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer));
    for (const [path, key, expected] of [
      ["/v1/models", "wrong", 401],
      ["/v0/management/config", KEY, 404],
      ["/v1/models", KEY, 200],
    ] as const) {
      const result = yield* http.get(
        `${origin.replace(/^ws/u, "http")}${SWITCHBOARD_GATEWAY_PREFIX}${path}`,
        {
          headers: { authorization: "Bearer " + key },
        },
      );
      expect(result.status).toBe(expected);
      // Account computers tell the gateway's own refusals from the hub's by this header.
      expect(result.headers["x-loom-switchboard"]).toBe(
        expected === 401 ? "authentication" : expected === 404 ? "path" : undefined,
      );
      yield* result.arrayBuffer;
    }
    // The enroll route answers before the gateway's catch-all, with no client credential.
    for (const [body, expected] of [
      [{ ticket: "a".repeat(64) }, 200],
      [{ ticket: "short" }, 400],
    ] as const) {
      const enrolled = yield* http.post(
        `${origin.replace(/^ws/u, "http")}${SWITCHBOARD_GATEWAY_PREFIX}/enroll`,
        { body: HttpBody.jsonUnsafe(body) },
      );
      expect(enrolled.status).toBe(expected);
      if (expected === 200) expect(yield* enrolled.json).toEqual({ credential: COMPUTER });
      else yield* enrolled.arrayBuffer;
    }
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const socket = makeSocket(`${origin}${SWITCHBOARD_GATEWAY_PREFIX}/v1/responses`, {
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
    const upstream = yield* Effect.promise(() => headers);
    expect(upstream.authorization).toBe("Bearer " + KEY);
    expect(upstream.cookie).toBeUndefined();
    expect(upstream["cf-access-jwt-assertion"]).toBeUndefined();
    expect(frames).toEqual(["ready", [0, 255, 3]]);
    client.close(1000);
    yield* Effect.promise(() => Promise.all([closed.promise, targetClosed]));
  }),
);

it.effect("ends an account computer's socket once its credential stops working", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const bridge = yield* serveSockets(f);
    const socket = yield* openSocket(bridge, COMPUTER);
    yield* Deferred.succeed(f.state.ended, undefined);
    yield* Effect.promise(() => Promise.all([socket.closed, bridge.targetClosed]));
  }),
);

it.effect(
  "fails an account computer's request still waiting once its credential stops working",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.hold = yield* Deferred.make<void>();
      const pending = yield* f.send("/v1/responses", "POST", COMPUTER).pipe(Effect.forkChild);
      yield* Deferred.await(f.state.executing);
      yield* Deferred.succeed(f.state.ended, undefined);
      expect((yield* Fiber.join(pending).pipe(Effect.flip)).reason).toBe("unavailable");
    }),
);

it.effect("cuts an account computer's response stream once its credential stops working", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const send = openUpstream(f, "data: one\n\n");
    const reading = yield* readBody(yield* f.send("/v1/responses", "POST", COMPUTER));
    send();
    yield* Deferred.await(reading.first);
    yield* Deferred.succeed(f.state.ended, undefined);
    expect(Exit.isFailure(yield* Fiber.join(reading.fiber))).toBe(true);
    expect(reading.chunks).toEqual(["data: one\n\n"]);
  }),
);

it.effect("ends every gateway socket and response stream after an hour", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const bridge = yield* serveSockets(f);
    const socket = yield* openSocket(bridge, KEY);
    const send = openUpstream(f, "data: one\n\n");
    const reading = yield* readBody(yield* f.send("/v1/responses", "POST", KEY));
    send();
    yield* Deferred.await(reading.first);
    yield* TestClock.adjust("1 hour");
    yield* Effect.promise(() => Promise.all([socket.closed, bridge.targetClosed]));
    expect(Exit.isFailure(yield* Fiber.join(reading.fiber))).toBe(true);
  }),
);

it.effect("serves the newest routed Codex catalog to holders of the client credential", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const sol = { slug: "gpt-6.1-sol", service_tiers: [] };
    const astra = { slug: "gpt-6-astra", service_tiers: [] };
    yield* f.fs.makeDirectory(`${f.home}/.codex`);
    yield* f.fs.writeFileString(
      `${f.home}/.codex/models_cache.json`,
      JSON.stringify({ fetched_at: "2026-07-10T20:02:39.132177Z", models: [astra] }),
    );
    yield* f.fs.writeFileString(
      `${f.instanceHome}/models_cache.json`,
      JSON.stringify({ fetched_at: "2026-11-13T20:00:00Z", etag: "private", models: [sol, astra] }),
    );
    expect((yield* f.send("/codex/models", "GET", "b".repeat(64)).pipe(Effect.flip)).reason).toBe(
      "authentication",
    );
    expect((yield* f.send("/codex/models", "POST").pipe(Effect.flip)).reason).toBe("path");
    const response = yield* f.send("/codex/models");
    expect(response.headers["cache-control"]).toBe("no-store, no-transform");
    expect(yield* Effect.promise(() => HttpServerResponse.toWeb(response).json())).toEqual({
      models: [sol, astra],
    });
    expect(f.requests).toHaveLength(0);
    yield* f.fs.remove(`${f.instanceHome}/models_cache.json`);
    expect((yield* f.send("/codex/models").pipe(Effect.flip)).reason).toBe("unavailable");
  }),
);
