import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { TestClock } from "effect/testing";
import * as Jose from "jose";
import * as CloudflareAccess from "./CloudflareAccess.ts";

const ISSUER = "https://loom-test.cloudflareaccess.com";
const AUDIENCE = "a".repeat(64);
const ENV = { LOOM_ACCESS_TEAM_DOMAIN: ISSUER, LOOM_ACCESS_AUDIENCE: AUDIENCE };

const fixture = Effect.gen(function* () {
  const now = yield* DateTime.now;
  const seconds = Math.floor(now.epochMilliseconds / 1000);
  const pair = yield* Effect.promise(() => Jose.generateKeyPair("RS256"));
  const other = yield* Effect.promise(() => Jose.generateKeyPair("RS256"));
  const publicKey = yield* Effect.promise(() => Jose.exportJWK(pair.publicKey));
  const state = {
    status: 200,
    keys: [{ ...publicKey, alg: "RS256", kid: "access-key" }],
  };
  const requests: string[] = [];
  const http = HttpClient.make((request) => {
    requests.push(request.url);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({ keys: state.keys }, { status: state.status }),
      ),
    );
  });
  const dependencies = Layer.succeed(HttpClient.HttpClient, http);
  const accessFor = (env: NodeJS.ProcessEnv) =>
    CloudflareAccess.CloudflareAccess.pipe(
      Effect.provide(CloudflareAccess.layer.pipe(Layer.provide(dependencies))),
      Effect.provideService(HostProcess.Environment, env),
    );
  const sign = (payload: Record<string, unknown> = {}, key = pair.privateKey, kid = "access-key") =>
    Effect.promise(() =>
      new Jose.SignJWT({
        sub: "access-user",
        type: "app",
        iat: seconds,
        exp: seconds + 300,
        iss: ISSUER,
        aud: [AUDIENCE],
        ...payload,
      })
        .setProtectedHeader({ alg: "RS256", kid })
        .sign(key),
    );
  return { accessFor, sign, requests, other, state };
});

describe("Cloudflare Access origin gate", () => {
  it.effect("fails closed on partial configuration and accepts no assertion while disabled", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const off = yield* f.accessFor({});
      expect(yield* off.verify(undefined)).toBeNull();
      for (const env of [
        { LOOM_ACCESS_TEAM_DOMAIN: ISSUER },
        { LOOM_ACCESS_AUDIENCE: AUDIENCE },
        { ...ENV, LOOM_ACCESS_TEAM_DOMAIN: "https://example.com" },
        { ...ENV, LOOM_ACCESS_TEAM_DOMAIN: `${ISSUER}/path` },
        { ...ENV, LOOM_ACCESS_AUDIENCE: " " },
      ]) {
        expect((yield* Effect.result(f.accessFor(env)))._tag).toBe("Failure");
      }
      expect(f.requests).toEqual([]);
    }),
  );

  it.effect(
    "requires a signed application assertion with the configured issuer, audience and expiry",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const access = yield* f.accessFor(ENV);
        for (const token of [undefined, "", "not-a-jwt", "x".repeat(32769)]) {
          expect((yield* Effect.result(access.verify(token)))._tag).toBe("Failure");
        }
        expect(f.requests).toEqual([]);
        for (const payload of [
          { iss: "https://other.cloudflareaccess.com" },
          { aud: ["b".repeat(64)] },
          { type: "org" },
          { sub: "" },
          { exp: 0 },
          { exp: undefined },
          { iat: undefined },
          { iat: 9999999999 },
        ]) {
          expect((yield* Effect.result(access.verify(yield* f.sign(payload))))._tag).toBe(
            "Failure",
          );
        }
        expect(
          (yield* Effect.result(access.verify(yield* f.sign({}, f.other.privateKey))))._tag,
        ).toBe("Failure");
        const token = yield* f.sign();
        expect(yield* access.verify(token)).toEqual({ subject: "access-user" });
        expect(f.requests).toEqual([`${ISSUER}/cdn-cgi/access/certs`]);
        yield* TestClock.adjust("6 minutes");
        expect((yield* Effect.result(access.verify(token)))._tag).toBe("Failure");
      }),
  );

  it.effect("coalesces key loads, throttles unknown keys and fails closed during an outage", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const access = yield* f.accessFor(ENV);
      const token = yield* f.sign({ exp: 3600 });
      yield* Effect.all(
        Array.from({ length: 8 }, () => access.verify(token)),
        { concurrency: "unbounded" },
      );
      expect(f.requests).toHaveLength(1);
      const nextKey = yield* Effect.promise(() => Jose.exportJWK(f.other.publicKey));
      f.state.keys = [{ ...nextKey, alg: "RS256", kid: "next-key" }];
      const next = yield* f.sign({ exp: 3600 }, f.other.privateKey, "next-key");
      expect((yield* Effect.result(access.verify(next)))._tag).toBe("Failure");
      expect(f.requests).toHaveLength(1);
      yield* TestClock.adjust("31 seconds");
      expect(yield* access.verify(next)).toEqual({ subject: "access-user" });
      expect(f.requests).toHaveLength(2);
      f.state.status = 503;
      yield* TestClock.adjust("6 minutes");
      const refused = yield* Effect.result(access.verify(next));
      expect(refused._tag === "Failure" && refused.failure.reason).toBe("unavailable");
    }),
  );

  it.effect(
    "gates every route while preserving the inner Loom credential and OAuth challenge",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const access = yield* f.accessFor(ENV);
        const app = Layer.mergeAll(
          Layer.succeed(Clock.Clock, yield* Clock.Clock),
          HttpRouter.add(
            "*",
            "/*",
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              return HttpServerResponse.jsonUnsafe(
                { authorization: request.headers.authorization },
                {
                  status: 401,
                  headers: {
                    "www-authenticate":
                      'Bearer resource_metadata="https://loom.test/.well-known/oauth-protected-resource"',
                  },
                },
              );
            }),
          ),
          CloudflareAccess.guardLayer.pipe(
            Layer.provide(Layer.succeed(CloudflareAccess.CloudflareAccess, access)),
          ),
        );
        const web = HttpRouter.toWebHandler(app, { disableLogger: true });
        yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
        const token = yield* f.sign();
        for (const path of [
          "/",
          "/api/loom/identity/session",
          "/oauth/token",
          "/mcp",
          "/ws",
          "/unknown",
        ]) {
          const refused = yield* Effect.promise(() =>
            web.handler(
              new Request(`https://loom.test${path}`, {
                headers: { authorization: "Bearer loom-session" },
              }),
            ),
          );
          expect(refused.status).toBe(403);
          const admitted = yield* Effect.promise(() =>
            web.handler(
              new Request(`https://loom.test${path}`, {
                headers: { authorization: "Bearer loom-session", "cf-access-jwt-assertion": token },
              }),
            ),
          );
          expect(admitted.status).toBe(401);
          expect(admitted.headers.get("www-authenticate")).toContain("oauth-protected-resource");
          expect(yield* Effect.promise(() => admitted.json())).toEqual({
            authorization: "Bearer loom-session",
          });
        }
      }).pipe(Effect.scoped),
  );
});
