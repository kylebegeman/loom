// @effect-diagnostics nodeBuiltinImport:off -- Compare fixed-length personal credentials without timing-dependent string comparison.
import * as NodeCrypto from "node:crypto";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import type { ServerSettings } from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";
import * as Socket from "effect/socket/Socket";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { ServerSettingsService } from "../../serverSettings.ts";
import { readSharedCodexCatalog, SWITCHBOARD_CODEX_CATALOG_PATH } from "./serviceTier.ts";
import { SwitchboardClients } from "./SwitchboardClients.ts";
import {
  readSwitchboardCredential,
  resolveSwitchboardController,
  resolveSwitchboardHubConfiguration,
  SWITCHBOARD_CONTROLLER_PATH,
} from "./switchboard.ts";

const GATEWAY_ORIGIN = "http://127.0.0.1:8321";
/** The controller reads a routed computer's picker and Ultrafast readback make. */
const CONTROLLER_AVAILABILITY = `${SWITCHBOARD_CONTROLLER_PATH}/api/v1/availability`;
const CONTROLLER_SERVICE_TIER = `${SWITCHBOARD_CONTROLLER_PATH}/api/v1/service-tier`;
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
  // The hub's own key replaces whichever credential the computer sent.
  "authorization",
  "x-api-key",
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
// Bounds a request, response or socket past its credential check, as when the hub key rotates.
const LIFETIME_MS = Duration.toMillis(Duration.hours(1));
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

/** Every Codex home this computer's instances use; the default one first. */
const codexHomes = (
  instances: ServerSettings["providerInstances"],
  environment: NodeJS.ProcessEnv,
  home: string,
  paths: Path.Path,
) => {
  const homes = [environment.CODEX_HOME || paths.join(home, ".codex")];
  for (const instance of Object.values(instances)) {
    if (instance.driver !== "codex" || typeof instance.config !== "object" || !instance.config)
      continue;
    const config = instance.config as Record<string, unknown>;
    for (const value of [config.homePath, config.shadowHomePath])
      if (typeof value === "string" && value.trim()) homes.push(expandHomePath(value.trim(), home));
  }
  return homes;
};

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
  const fileSystem = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const settings = yield* ServerSettingsService;
  const home = yield* HostProcess.HomeDirectory;
  const clients = yield* SwitchboardClients;
  return SwitchboardGateway.of({
    forward: Effect.fn("SwitchboardGateway.forward")(function* (request, path) {
      if (environment.LOOM_SWITCHBOARD_SHARE_GATEWAY !== "true")
        return yield* new SwitchboardGatewayError({ reason: "disabled" });
      const [pathname, query] = path.split("?");
      const upgrade = request.headers.upgrade?.toLowerCase() === "websocket";
      const claude = pathname === "/v1/messages" || pathname === "/v1/messages/count_tokens";
      const tierQuery =
        pathname === CONTROLLER_SERVICE_TIER &&
        query !== undefined &&
        /^session=[A-Za-z0-9._%-]{1,512}&since=\d{1,16}$/u.test(query);
      const allowedQuery =
        query === undefined || tierQuery || (claude && path === `${pathname}?beta=true`);
      if (
        !pathname ||
        !allowedQuery ||
        path.includes("#") ||
        (upgrade
          ? request.method !== "GET" || pathname !== "/v1/responses" || query !== undefined
          : !(
              (request.method === "GET" &&
                (pathname === "/v1/models" ||
                  pathname === SWITCHBOARD_CODEX_CATALOG_PATH ||
                  pathname === CONTROLLER_AVAILABILITY) &&
                query === undefined) ||
              (request.method === "GET" && tierQuery) ||
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
        try: () => resolveSwitchboardHubConfiguration(environment, platform),
        catch: () => new SwitchboardGatewayError({ reason: "unavailable" }),
      });
      const current = yield* readSwitchboardCredential(config.keyCommand, environment).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      if (Option.isNone(current) || !/^[a-f0-9]{64}$/u.test(Redacted.value(current.value)))
        return yield* new SwitchboardGatewayError({ reason: "unavailable" });
      const hubKey = Redacted.value(current.value);
      // An account computer's own credential, or the shared key computers set up by hand still use.
      const computer = yield* clients
        .authenticate(key)
        .pipe(Effect.mapError(() => new SwitchboardGatewayError({ reason: "unavailable" })));
      if (
        Option.isNone(computer) &&
        !NodeCrypto.timingSafeEqual(Buffer.from(key), Buffer.from(hubKey))
      )
        return yield* new SwitchboardGatewayError({ reason: "authentication" });
      const admittedAt = yield* Clock.currentTimeMillis;
      /** Fails once the credential stops working or the request outlives its lifetime. */
      const cutoff = Effect.gen(function* () {
        const left = admittedAt + LIFETIME_MS - (yield* Clock.currentTimeMillis);
        yield* (Option.isSome(computer) ? computer.value.ended : Effect.never).pipe(
          Effect.timeoutOption(Duration.millis(left)),
        );
        return yield* new SwitchboardGatewayError({ reason: "unavailable" });
      });
      if (pathname === SWITCHBOARD_CODEX_CATALOG_PATH) {
        const { providerInstances } = yield* settings.getSettings.pipe(
          Effect.mapError(() => new SwitchboardGatewayError({ reason: "unavailable" })),
        );
        const catalog = yield* readSharedCodexCatalog(
          codexHomes(providerInstances, environment, home, paths),
        ).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, paths),
        );
        if (catalog === undefined)
          return yield* new SwitchboardGatewayError({ reason: "unavailable" });
        return HttpServerResponse.jsonUnsafe(catalog, { headers: NO_STORE });
      }
      const controller = pathname === CONTROLLER_AVAILABILITY || tierQuery;
      const controllerOrigin = controller
        ? yield* Effect.try({
            try: () => resolveSwitchboardController(environment),
            catch: () => new SwitchboardGatewayError({ reason: "unavailable" }),
          })
        : null;
      if (controller && controllerOrigin === null)
        return yield* new SwitchboardGatewayError({ reason: "unavailable" });
      const upstream =
        controllerOrigin === null
          ? GATEWAY_ORIGIN + path
          : controllerOrigin + path.slice(SWITCHBOARD_CONTROLLER_PATH.length);
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (
          value !== undefined &&
          !DROP_REQUEST.has(name) &&
          !/^(cf-|x-forwarded-|x-loom-|x-t3-|x-switchboard-)/u.test(name)
        )
          headers[name] = value;
      }
      if (controllerOrigin === null) {
        headers.authorization = `Bearer ${hubKey}`;
        if (apiKey !== undefined) headers["x-api-key"] = hubKey;
        // Attribution for Switchboard's ledger; the credential check above is the boundary.
        if (Option.isSome(computer)) headers["x-switchboard-device"] = computer.value.device;
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
            ).pipe(Effect.raceFirst(cutoff), Effect.ignore);
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
        Effect.raceFirst(cutoff),
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
      // Fails rather than ends, so a client cannot take a cut stream for a finished one.
      return HttpServerResponse.stream(response.stream.pipe(Stream.interruptWhen(cutoff)), {
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
