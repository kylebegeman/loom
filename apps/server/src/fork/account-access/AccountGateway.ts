import { AuthWebSocketTicketResult, AuthOrchestrationReadScope } from "@t3tools/contracts";
import { ACCOUNT_ACCESS_HEADER } from "@t3tools/contracts/fork";
import { isUnsafeReachPath, reachAllowsRequest } from "@t3tools/shared/fork/reach";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";
import {
  HttpClient,
  HttpClientRequest,
  HttpMethod,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as SessionStore from "../../auth/SessionStore.ts";
import { upstreamWebSocketConstructor } from "../../device/DeviceHubProxy.ts";
import { type EnvironmentId } from "@t3tools/contracts";
import * as AccountAccess from "./AccountAccess.ts";

const encodeTicket = Schema.encodeEffect(AuthWebSocketTicketResult);

const DROP_REQUEST = new Set([
  "host",
  "connection",
  "upgrade",
  "authorization",
  "cookie",
  "dpop",
  "content-length",
  "accept-encoding",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "cf-access-jwt-assertion",
  "cf-access-client-id",
  "cf-access-client-secret",
  "cf-authorization",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-for",
  ACCOUNT_ACCESS_HEADER,
]);
const DROP_RESPONSE = new Set([
  "connection",
  "transfer-encoding",
  "content-encoding",
  "set-cookie",
  "location",
  "access-control-allow-origin",
  "access-control-allow-credentials",
]);
const NO_STORE = { "cache-control": "no-store, no-transform" };

export class AccountGateway extends Context.Service<
  AccountGateway,
  {
    readonly forward: (input: {
      readonly request: HttpServerRequest.HttpServerRequest;
      readonly environmentId: EnvironmentId;
      readonly path: string;
    }) => Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      AccountAccess.AccountAccessError,
      Scope.Scope
    >;
  }
>()("t3/fork/account-access/AccountGateway") {}

const pump =
  // Frame pumping shares the connection span and must preserve binary frames.
  Effect.fnUntraced(function* (source: Socket.Socket, sink: Socket.Writer) {
    const { pull } = yield* source.reader;
    while (true) yield* sink.writeAll(yield* pull);
  });

const make = Effect.gen(function* () {
  const access = yield* AccountAccess.AccountAccess;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const sessions = yield* SessionStore.SessionStore;
  const http = HttpClient.withScope(yield* HttpClient.HttpClient);
  const fail = (reason: AccountAccess.AccountAccessError["reason"]) =>
    new AccountAccess.AccountAccessError({ reason });
  const forward: AccountGateway["Service"]["forward"] = Effect.fn("AccountGateway.forward")(
    function* ({ request, environmentId, path }) {
      if (
        isUnsafeReachPath(path) ||
        !(
          reachAllowsRequest(request.method, path) ||
          /^\/api\/auth\/websocket-ticket\/(rpc|media)$/u.test(path)
        )
      )
        return yield* fail("denied");
      const upgrade = request.headers.upgrade?.toLowerCase() === "websocket";
      // Metadata is public; asset handlers verify their own signed URLs at the destination.
      const publicRead =
        !upgrade &&
        (request.method === "GET" || request.method === "HEAD") &&
        (/^\/\.well-known\/t3\/environment(?:\?|$)/u.test(path) ||
          /^\/api\/(?:assets\/|loom\/(?:model-preview-3d|pcb-preview)\/f\/)/u.test(path));
      const caller = publicRead
        ? null
        : yield* (
            upgrade ||
            (/^\/api\/(device-hub|preview-stream)\//u.test(path) &&
              new URL(path, "https://loom.invalid").searchParams.has("wsTicket"))
              ? auth.authenticateWebSocketUpgrade(
                  request,
                  path.split("?", 1)[0] === "/ws" ? "rpc" : "media",
                )
              : auth.authenticateHttpRequest(request)
          ).pipe(Effect.mapError(() => fail("authentication")));
      // Tickets belong to the Library session; they never mint credentials at the destination.
      const pathname = path.split("?", 1)[0];
      if (
        pathname?.startsWith("/api/auth/websocket-ticket") &&
        request.method === "POST" &&
        caller !== null
      ) {
        const use =
          pathname === "/api/auth/websocket-ticket/rpc"
            ? "rpc"
            : pathname === "/api/auth/websocket-ticket/media"
              ? "media"
              : pathname === "/api/auth/websocket-ticket"
                ? undefined
                : null;
        if (use === null || !caller.scopes.includes(AuthOrchestrationReadScope))
          return yield* fail("denied");
        // Check enrollment and owner access before issuing a ticket for this route.
        yield* access.authorize(caller, environmentId);
        const issued = yield* sessions
          .issueWebSocketToken(caller.sessionId, use === undefined ? {} : { audience: use })
          .pipe(Effect.mapError(() => fail("unavailable")));
        const body = yield* encodeTicket({
          ticket: Redacted.make(issued.token),
          expiresAt: DateTime.toUtc(issued.expiresAt),
        }).pipe(Effect.orDie);
        return HttpServerResponse.jsonUnsafe(body, { headers: NO_STORE });
      }
      const cleaned = new URL(path, "https://loom.invalid");
      cleaned.searchParams.delete("wsTicket");
      cleaned.searchParams.delete("dpop");
      const destinationPath = `${cleaned.pathname}${cleaned.search}`;
      const prepared =
        caller === null
          ? { origin: yield* access.publicRoute(environmentId), grant: null }
          : yield* access.prepare({
              caller,
              environmentId,
              method: request.method,
              path: destinationPath,
            });
      const upstream = `${prepared.origin}${destinationPath}`;
      const headers: Record<string, string> =
        prepared.grant === null ? {} : { [ACCOUNT_ACCESS_HEADER]: prepared.grant };
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined && !DROP_REQUEST.has(name)) headers[name] = value;
      }
      if (request.headers.origin !== undefined) headers.origin = prepared.origin;
      if (upgrade && caller !== null) {
        const held = yield* Ref.make(caller.sessionId);
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(caller.sessionId),
          () =>
            Effect.scoped(
              Effect.gen(function* () {
                const client = yield* request.upgrade;
                const server = yield* Socket.makeWebSocket(upstream.replace(/^http/u, "ws"), {
                  headers,
                  openTimeout: "10 seconds",
                }).pipe(Effect.provide(upstreamWebSocketConstructor));
                const clientWriter = yield* client.writer;
                const serverWriter = yield* server.writer;
                yield* Effect.raceFirst(
                  Effect.raceFirst(pump(client, serverWriter), pump(server, clientWriter)),
                  Effect.raceFirst(
                    sessions.awaitSessionChain(held),
                    access.awaitRemoval(environmentId),
                  ),
                );
                return HttpServerResponse.empty();
              }),
            ),
          () => Ref.get(held).pipe(Effect.flatMap((id) => sessions.markDisconnected(id))),
        ).pipe(Effect.mapError(() => fail("unavailable")));
      }
      if (!HttpMethod.isHttpMethod(request.method)) return yield* fail("denied");
      const outgoing = HttpClientRequest.make(request.method)(upstream).pipe(
        HttpClientRequest.setHeaders(headers),
        request.method === "GET" || request.method === "HEAD"
          ? (self) => self
          : HttpClientRequest.bodyStream(request.stream, {
              contentType: request.headers["content-type"],
            }),
      );
      const response = yield* http
        .execute(outgoing)
        .pipe(Effect.mapError(() => fail("unavailable")));
      // An upstream redirect must never turn an account request into credential forwarding.
      if (response.status >= 300 && response.status < 400) return yield* fail("unavailable");
      const responseHeaders: Record<string, string> = { ...NO_STORE };
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined && !DROP_RESPONSE.has(name) && name !== "cache-control")
          responseHeaders[name] = value;
      }
      return HttpServerResponse.stream(
        response.stream.pipe(
          Stream.interruptWhen(
            caller === null
              ? access.awaitRemoval(environmentId)
              : Effect.raceFirst(
                  sessions.awaitInvalidation(caller.sessionId),
                  access.awaitRemoval(environmentId),
                ),
          ),
        ),
        { status: response.status, headers: responseHeaders },
      );
    },
  );
  return AccountGateway.of({ forward });
});

export const layer = Layer.effect(AccountGateway, make);
