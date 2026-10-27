import { describe, expect, it } from "@effect/vitest";
import { AuthAccessTokenType, AuthEnvironmentBootstrapTokenType } from "@t3tools/contracts";
import { REACH_ALLOWED_PATHS, REACH_ALLOWED_PREFIXES } from "@t3tools/shared/fork/reach";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  HttpEffect,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  UrlParams,
} from "effect/http";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { makeReachGuard, ReachGuardLayer, requestHostname } from "./guard.ts";
import { type ReachGuardState, ReachService } from "./ReachService.ts";

const REACH_HOST = "studio-loom.example.com";
const OTHER_HOST = "studio.tail1234.ts.net";
const PAIRING_CODE = "ABCDEFGHJKLM";

// Every path answers and sets cookies three ways, so the guard alone decides what is refused and
// what a reach host may send back.
const echo = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  yield* HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(HttpServerResponse.setCookieUnsafe(response, "late", "1")),
  );
  const body = request.method === "POST" ? UrlParams.toRecord(yield* request.urlParamsBody) : {};
  return HttpServerResponse.jsonUnsafe({ url: request.url, body }).pipe(
    HttpServerResponse.setCookieUnsafe("session", "secret"),
    HttpServerResponse.setHeader("set-cookie", "raw=1"),
  );
}).pipe(Effect.orDie);

const withGuard = <A, E>(
  installed: boolean,
  use: (harness: {
    readonly state: { current: ReachGuardState };
    readonly send: (
      host: string,
      target: string,
      init?: {
        readonly method?: string;
        readonly body?: string;
        readonly headers?: Record<string, string>;
      },
    ) => Effect.Effect<Response>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const state = { current: { hostname: REACH_HOST, serving: true } as ReachGuardState };
    const reach = ReachService.of({
      applyIdentity: () => Effect.void,
      prepareIdentity: () => Effect.die("unused"),
      status: Effect.die("unused"),
      changes: Effect.die("unused") as never,
      setEnabled: () => Effect.die("unused"),
      remove: () => Effect.die("unused"),
      forget: () => Effect.die("unused"),
      guardState: () => state.current,
      ownPorts: () => [],
    });
    const runtime = installed
      ? (Context.make(ReachService, reach) as unknown as Context.Context<ForkServices>)
      : undefined;
    const app = Layer.mergeAll(
      HttpRouter.add("*", "/*", echo),
      ReachGuardLayer.pipe(Layer.provide(Layer.succeed(ForkRuntime, runtime))),
    );
    const web = HttpRouter.toWebHandler(app, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    return yield* use({
      state,
      send: (host, target, init = {}) =>
        Effect.promise(() =>
          web.handler(
            new Request(`http://${host}${target}`, {
              method: init.method ?? "GET",
              headers: { host, ...init.headers },
              ...(init.body === undefined ? {} : { body: init.body }),
            }),
          ),
        ),
    });
  }).pipe(Effect.scoped);

const tokenForm = (fields: Record<string, string>) => {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type: AuthAccessTokenType,
    ...fields,
  }).toString();
  return {
    method: "POST",
    // As Node receives it. A body without a length is capped while it is read instead.
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(new TextEncoder().encode(body).byteLength),
    },
    body,
  };
};

describe("requestHostname", () => {
  it("compares names the way DNS does", () => {
    expect(requestHostname("Studio-Loom.Example.COM:443")).toBe(REACH_HOST);
    expect(requestHostname("studio-loom.example.com.")).toBe(REACH_HOST);
    expect(requestHostname("[::1]:3773")).toBe("[::1]");
    expect(requestHostname(undefined)).toBeNull();
    expect(requestHostname("")).toBeNull();
  });
});

describe("ReachGuardLayer", () => {
  it.effect("applies the allowlist to the reach host only", () =>
    withGuard(true, (h) =>
      Effect.gen(function* () {
        for (const target of ["/ws", "/api/assets/x", "/.well-known/t3/environment"]) {
          expect((yield* h.send(REACH_HOST, target)).status).toBe(200);
        }
        expect((yield* h.send(`Studio-Loom.Example.com:443`, "/ws")).status).toBe(200);
        for (const target of ["/mcp", "/", "/api/loom/directory/report", "/oauth/authorize"]) {
          expect((yield* h.send(REACH_HOST, target)).status).toBe(404);
          expect((yield* h.send(OTHER_HOST, target)).status).toBe(200);
        }
        expect((yield* h.send(REACH_HOST, "/ws", { method: "DELETE" })).status).toBe(404);
      }),
    ),
  );

  // A WHATWG Request resolves dot segments before the guard sees them, so these keep the raw
  // target the way Node hands it over.
  it.effect("refuses traversal in the raw target and a forwarded host", () =>
    Effect.gen(function* () {
      const guard = makeReachGuard(() => ({ hostname: REACH_HOST, serving: true }));
      const statusFor = (target: string, headers: Record<string, string> = {}) =>
        guard(Effect.succeed(HttpServerResponse.empty({ status: 200 }))).pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(
              new Request(`http://${REACH_HOST}/`, { headers: { host: REACH_HOST, ...headers } }),
            ).modify({ url: target }),
          ),
          Effect.map((response) => response.status),
        );
      for (const target of [
        "/api/assets/../mcp",
        "/api/assets/..%2fmcp",
        "/api/assets/%2e%2e/mcp",
        "/api/assets/%2E/x",
        "/api/assets//x",
        "/api/assets/a%5cb",
        "/api/assets/a%00",
        "/api/assets/a\\b",
        "http://studio-loom.example.com/ws",
      ]) {
        expect(yield* statusFor(target)).toBe(400);
      }
      expect(yield* statusFor("/api/assets/a..b.png")).toBe(200);
      expect(yield* statusFor("/ws?next=../mcp")).toBe(200);
      expect(yield* statusFor("/ws", { "x-forwarded-host": OTHER_HOST })).toBe(400);
    }),
  );

  it.effect("answers 404 for the reach host while reach is off, and nothing else changes", () =>
    withGuard(true, (h) =>
      Effect.gen(function* () {
        h.state.current = { hostname: REACH_HOST, serving: false };
        expect((yield* h.send(REACH_HOST, "/ws")).status).toBe(404);
        expect((yield* h.send(OTHER_HOST, "/ws")).status).toBe(200);
        h.state.current = { hostname: null, serving: false };
        expect((yield* h.send(REACH_HOST, "/mcp")).status).toBe(200);
      }),
    ),
  );

  it.effect("passes everything through where reach is not installed", () =>
    withGuard(false, (h) =>
      Effect.gen(function* () {
        expect((yield* h.send(REACH_HOST, "/mcp")).status).toBe(200);
      }),
    ),
  );

  it.effect("sends no Set-Cookie from any allowlisted path on the reach host", () =>
    withGuard(true, (h) =>
      Effect.gen(function* () {
        const targets = [...REACH_ALLOWED_PATHS, ...REACH_ALLOWED_PREFIXES.map((p) => `${p}x`)];
        for (const target of targets) {
          const response = yield* h.send(REACH_HOST, target);
          expect(response.status).toBe(200);
          expect(response.headers.getSetCookie()).toEqual([]);
        }
        const other = yield* h.send(OTHER_HOST, "/api/auth/session");
        expect(other.headers.getSetCookie().length).toBeGreaterThan(0);
      }),
    ),
  );

  it.effect("exchanges only pairing codes on the reach host, leaving the body readable", () =>
    withGuard(true, (h) =>
      Effect.gen(function* () {
        const pairing = yield* h.send(
          REACH_HOST,
          "/oauth/token",
          tokenForm({
            subject_token: PAIRING_CODE,
            subject_token_type: AuthEnvironmentBootstrapTokenType,
          }),
        );
        expect(pairing.status).toBe(200);
        expect(yield* Effect.promise(() => pairing.json())).toMatchObject({
          body: { subject_token: PAIRING_CODE },
        });

        const identity = yield* h.send(
          REACH_HOST,
          "/oauth/token",
          tokenForm({
            subject_token: "eyJ.identity.token",
            subject_token_type: AuthAccessTokenType,
          }),
        );
        expect(identity.status).toBe(200);

        for (const credential of ["a".repeat(64), "reusable-dev-auth-token-that-is-long-enough"]) {
          const refused = yield* h.send(
            REACH_HOST,
            "/oauth/token",
            tokenForm({
              subject_token: credential,
              subject_token_type: AuthEnvironmentBootstrapTokenType,
            }),
          );
          expect(refused.status).toBe(401);
          expect(yield* Effect.promise(() => refused.json())).toMatchObject({
            code: "auth_invalid",
            reason: "invalid_credential",
          });
          const local = yield* h.send(
            OTHER_HOST,
            "/oauth/token",
            tokenForm({
              subject_token: credential,
              subject_token_type: AuthEnvironmentBootstrapTokenType,
            }),
          );
          expect(local.status).toBe(200);
        }

        const oversized = yield* h.send(
          REACH_HOST,
          "/oauth/token",
          tokenForm({
            subject_token: PAIRING_CODE,
            subject_token_type: AuthEnvironmentBootstrapTokenType,
            padding: "x".repeat(17 * 1024),
          }),
        );
        expect(oversized.status).toBe(401);
      }),
    ),
  );
});
