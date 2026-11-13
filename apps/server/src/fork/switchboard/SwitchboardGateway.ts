// @effect-diagnostics nodeBuiltinImport:off -- Compare fixed-length personal credentials without timing-dependent string comparison.
import * as NodeCrypto from "node:crypto";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Socket from "effect/socket/Socket";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { readSwitchboardCredential, resolveSwitchboardConfiguration } from "./switchboard.ts";

export const SWITCHBOARD_GATEWAY_PREFIX = "/api/loom/switchboard";
const GATEWAY_ORIGIN = "http://127.0.0.1:8321";
const POST_PATHS = new Set([
  "/v1/responses",
  "/v1/chat/completions",
  "/v1/messages",
  "/v1/messages/count_tokens",
]);
const DROP_REQUEST = new Set([
  "host",
  "cookie",
  "dpop",
  "origin",
  "connection",
  "upgrade",
  "content-length",
  "accept-encoding",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
]);
const DROP_RESPONSE = new Set([
  "connection",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie",
  "location",
  "access-control-allow-origin",
  "access-control-allow-credentials",
]);
const NO_STORE = { "cache-control": "no-store, no-transform" };
export class SwitchboardGatewayError extends Schema.TaggedError<SwitchboardGatewayError>()(
  "SwitchboardGatewayError",
  {
    reason: Schema.Literals(["disabled", "authentication", "path", "unavailable"]),
  },
) {}

export class SwitchboardGateway extends Context.Service<
  SwitchboardGateway,
  {
    readonly forward: (
      request: HttpServerRequest.HttpServerRequest,
      path: string,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, SwitchboardGatewayError, Scope.Scope>;
  }
>()("t3/fork/switchboard/SwitchboardGateway") {}

const pump = Effect.fnUntraced(function* (source: Socket.Reader, sink: Socket.Writer) {
  // Per-frame tracing would add overhead to the opaque stream.
  while (true) yield* sink.writeAll(yield* source.pull);
});
const make = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const socketConstructor = yield* Socket.WebSocketConstructor;
  const http = HttpClient.withScope(yield* HttpClient.HttpClient);
  return SwitchboardGateway.of({
    forward: Effect.fn("SwitchboardGateway.forward")(function* (request, path) {
      if (environment.LOOM_SWITCHBOARD_SHARE_GATEWAY !== "true")
        return yield* new SwitchboardGatewayError({ reason: "disabled" });
      const [pathname, query] = path.split("?");
      const upgrade = request.headers.upgrade?.toLowerCase() === "websocket";
      const claude = pathname === "/v1/messages" || pathname === "/v1/messages/count_tokens";
      const allowedQuery = query === undefined || (claude && path === `${pathname}?beta=true`);
      if (
        !pathname ||
        !allowedQuery ||
        path.includes("#") ||
        (upgrade
          ? request.method !== "GET" || pathname !== "/v1/responses" || query !== undefined
          : !(
              (request.method === "GET" && pathname === "/v1/models" && query === undefined) ||
              (request.method === "POST" && POST_PATHS.has(pathname))
            ))
      )
        return yield* new SwitchboardGatewayError({ reason: "path" });
      const bearer = request.headers.authorization;
      const apiKey = request.headers["x-api-key"];
      // Claude sends its helper credential in both headers.
      if (
        bearer !== undefined &&
        apiKey !== undefined &&
        (!claude || bearer !== `Bearer ${apiKey}`)
      )
        return yield* new SwitchboardGatewayError({ reason: "authentication" });
      const key = bearer?.match(/^Bearer ([a-f0-9]{64})$/u)?.[1] ?? (claude ? apiKey : undefined);
      if (key === undefined || !/^[a-f0-9]{64}$/u.test(key))
        return yield* new SwitchboardGatewayError({ reason: "authentication" });
      const config = yield* Effect.try({
        try: () => resolveSwitchboardConfiguration(environment, platform),
        catch: () => new SwitchboardGatewayError({ reason: "unavailable" }),
      });
      const current = yield* readSwitchboardCredential(config.keyCommand, environment).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      if (Option.isNone(current) || !/^[a-f0-9]{64}$/u.test(Redacted.value(current.value)))
        return yield* new SwitchboardGatewayError({ reason: "unavailable" });
      if (!NodeCrypto.timingSafeEqual(Buffer.from(key), Buffer.from(Redacted.value(current.value))))
        return yield* new SwitchboardGatewayError({ reason: "authentication" });
      const upstream = GATEWAY_ORIGIN + path;
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (
          value !== undefined &&
          !DROP_REQUEST.has(name) &&
          !/^(cf-|x-forwarded-|x-loom-|x-t3-|x-switchboard-)/u.test(name)
        )
          headers[name] = value;
      }
      if (upgrade)
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const server = yield* Socket.makeWebSocket(upstream.replace(/^http/u, "ws"), {
              headers,
              openTimeout: "10 seconds",
            }).pipe(Effect.provideService(Socket.WebSocketConstructor, socketConstructor));
            const serverReader = yield* server.reader;
            const client = yield* request.upgrade;
            const clientReader = yield* client.reader;
            const clientWriter = yield* client.writer;
            const serverWriter = yield* server.writer;
            yield* Effect.raceFirst(
              pump(clientReader, serverWriter),
              pump(serverReader, clientWriter),
            ).pipe(Effect.ignore);
            return HttpServerResponse.empty();
          }),
        ).pipe(Effect.mapError(() => new SwitchboardGatewayError({ reason: "unavailable" })));
      const outgoing = HttpClientRequest.make(request.method === "POST" ? "POST" : "GET")(
        upstream,
      ).pipe(
        HttpClientRequest.setHeaders(headers),
        request.method === "POST"
          ? HttpClientRequest.bodyStream(request.stream, {
              contentType: request.headers["content-type"],
            })
          : (self) => self,
      );
      const response = yield* http.execute(outgoing).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.mapError(() => new SwitchboardGatewayError({ reason: "unavailable" })),
      );
      if (response.status >= 300 && response.status < 400)
        return yield* new SwitchboardGatewayError({ reason: "unavailable" });
      const responseHeaders: Record<string, string> = { ...NO_STORE };
      for (const [name, value] of Object.entries(response.headers)) {
        if (
          value !== undefined &&
          name !== "cache-control" &&
          !DROP_RESPONSE.has(name) &&
          !/^(cf-|x-loom-|x-t3-)/u.test(name)
        )
          responseHeaders[name] = value;
      }
      return HttpServerResponse.stream(response.stream, {
        status: response.status,
        headers: responseHeaders,
        ...(response.headers["content-type"]
          ? { contentType: response.headers["content-type"] }
          : {}),
      });
    }),
  });
});
export const layer = Layer.effect(SwitchboardGateway, make);
