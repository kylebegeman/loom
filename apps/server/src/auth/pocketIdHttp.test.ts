import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthSessionId,
  EnvironmentId,
  AuthAccessTokenType,
  AuthTokenExchangeGrantType,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as Etag from "effect/http/Etag";
import { expect } from "vite-plus/test";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Checks the page's script against its CSP hash.
import * as NodeCrypto from "node:crypto";
import * as NodeVM from "node:vm";
import * as PocketId from "./PocketId.ts";
import * as SessionStore from "./SessionStore.ts";
import * as PocketIdHttp from "./pocketIdHttp.ts";
import * as ServerHttp from "../http.ts";
import * as ServerConfig from "../config.ts";
import * as AuthHttp from "./http.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const metadata = {
  enabled: true,
  browserLoginEnabled: true,
  issuer: "https://id.example.test",
  clientId: "web-client",
  authorizationEndpoint: "https://id.example.test/authorize",
  tokenEndpoint: "https://id.example.test/token",
  scopes: ["openid"],
  audience: "host",
  environmentId: EnvironmentId.make("host"),
};
const pocket = Layer.mock(PocketId.PocketId)({
  cookieName: "identity-state",
  metadata: Effect.succeed(metadata),
  beginLogin: () =>
    DateTime.now.pipe(
      Effect.map((now) => ({
        authorizationUrl: "https://id.example.test/authorize?state=verified",
        cookieValue: "signed-state",
        expiresAt: DateTime.add(now, { minutes: 5 }),
      })),
    ),
  createSession: (input, _client, origin, currentToken) =>
    input.type === "native"
      ? input.accessToken === "renewed-access-jwt" && currentToken === "current-host-bearer"
        ? Effect.succeed({
            access_token: "renewed-host-bearer",
            issued_token_type: AuthAccessTokenType,
            token_type: "Bearer" as const,
            expires_in: 3600,
            scope: "orchestration:read",
            environmentId: metadata.environmentId,
            identity: { issuer: metadata.issuer, subject: "owner-id" },
          })
        : Effect.fail(
            new PocketId.PocketIdError({
              reason:
                input.accessToken === "old-sign-in"
                  ? "expired"
                  : input.accessToken === "issuer-unreachable"
                    ? "discovery"
                    : input.accessToken === "host-misconfigured"
                      ? "configuration"
                      : input.accessToken === "one-time-code-sign-in"
                        ? "passkey"
                        : "token",
            }),
          )
      : origin === "https://app.example.test" && input.type === "browser"
        ? Effect.succeed({
            access_token: "host-bearer",
            issued_token_type: AuthAccessTokenType,
            token_type: "Bearer" as const,
            expires_in: 600,
            scope: "orchestration:read",
            environmentId: metadata.environmentId,
            identity: { issuer: metadata.issuer, subject: "owner-id" },
          })
        : Effect.fail(new PocketId.PocketIdError({ reason: "state" })),
  logout: (input) =>
    input.bearerToken === "host-bearer" ||
    (input.cookieToken === "host-browser-token" && input.origin === "https://host.example.test")
      ? Effect.void
      : Effect.fail(new PocketId.PocketIdError({ reason: "state" })),
  completeLogin: (input) =>
    Effect.gen(function* () {
      if (input.state !== "verified" || input.cookieValue !== "signed-state")
        return yield* new PocketId.PocketIdError({ reason: "state" });
      if (input.code === "one-time-code-sign-in")
        return yield* new PocketId.PocketIdError({ reason: "passkey" });
      if (input.code === "popup-sign-in")
        return yield* new PocketId.PocketIdError({
          reason: "passkey",
          handoff: { origin: "https://app.example.test", state: "s".repeat(43) },
        });
      return {
        token: "host-browser-token",
        returnTo: "/sites",
        sessionId: AuthSessionId.make("browser"),
        method: "browser-session-cookie" as const,
        scopes: ["orchestration:read" as const],
        client: { deviceType: "desktop" as const },
        expiresAt: DateTime.add(yield* DateTime.now, { minutes: 10 }),
        ...(input.code === "handoff"
          ? {
              handoff: {
                code: "c".repeat(43),
                state: "s".repeat(43),
                environmentId: "host",
                origin: "https://app.example.test",
              },
            }
          : {}),
      };
    }),
  exchangeAccessToken: (input) =>
    input.token !== "verified-access-jwt"
      ? Effect.fail(new PocketId.PocketIdError({ reason: "token" }))
      : Effect.succeed({
          access_token: "host-bearer",
          issued_token_type: AuthAccessTokenType,
          token_type: "Bearer" as const,
          expires_in: 600,
          scope: "orchestration:read",
        }),
});
const sessions = Layer.mock(SessionStore.SessionStore)({
  cookieName: "host-session",
  legacyCookieName: undefined,
});
const platform = HttpPlatform.layer.pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(Etag.layerWeak),
);
const layerBrowser = PocketIdHttp.layer.pipe(
  Layer.provide(pocket),
  Layer.provide(sessions),
  Layer.provide(platform),
);
class TestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.auth) {}
const layerTokens = HttpApiBuilder.layer(TestApi).pipe(
  Layer.provide(AuthHttp.layer),
  Layer.provide(AuthHttp.layerAuthenticatedAuth),
  Layer.provide(pocket),
  Layer.provide(sessions),
  Layer.provide(
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      exchangeBootstrapCredentialForAccessToken: () =>
        Effect.die("External identity token must not use bootstrap authentication"),
    }),
  ),
  Layer.provide(platform),
);

it.layer(NodeServices.layer)("PocketId HTTP", (it) => {
  it.effect(
    "serves public metadata and sets secure browser cookies with the destination bound to login state",
    () =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const context = Context.make(Crypto.Crypto, crypto);
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => HttpRouter.toWebHandler(layerBrowser, { disableLogger: true })),
          (web) =>
            Effect.tryPromise(async () => {
              const response = await web.handler(
                new Request("https://host.example.test/api/loom/identity"),
                context,
              );
              expect(response.status).toBe(200);
              expect(await response.json()).toMatchObject(metadata);
              const login = await web.handler(
                new Request("https://host.example.test/api/loom/identity/login"),
                context,
              );
              expect(login.headers.get("location")).toBe(
                "https://id.example.test/authorize?state=verified",
              );
              expect(login.headers.get("set-cookie")).toContain("Secure");
              expect(login.headers.get("set-cookie")).toContain("HttpOnly");
              const callback = await web.handler(
                new Request(
                  "https://attacker.invalid/api/loom/identity/callback?state=verified&code=code&returnTo=https://attacker.invalid",
                  { headers: { cookie: "identity-state=signed-state" } },
                ),
                context,
              );
              expect(callback.headers.get("location")).toBe("/sites");
              expect(
                callback.headers
                  .getSetCookie()
                  .find((cookie) => cookie.startsWith("host-session=")),
              ).toContain("Secure");
              expect(callback.headers.getSetCookie()).toContainEqual(
                expect.stringContaining("identity-state=;"),
              );
              const handoff = await web.handler(
                new Request(
                  "https://host.example.test/api/loom/identity/callback?state=verified&code=handoff",
                  { headers: { cookie: "identity-state=signed-state" } },
                ),
                context,
              );
              expect(handoff.status).toBe(200);
              expect(handoff.headers.has("location")).toBe(false);
              expect(handoff.headers.get("content-security-policy")).toContain(
                "script-src 'sha256-",
              );
              expect(handoff.headers.get("cache-control")).toBe("no-store");
              const html = await handoff.text();
              expect(html).toContain("window.opener.postMessage(");
              expect(html).toContain('"https://app.example.test"');
              expect(html).not.toContain("host-browser-token");
            }),
          (web) => Effect.promise(() => web.dispose()),
        );
      }),
  );
  it.effect(
    "exchanges explicit external JWT token types without falling back to bootstrap authentication",
    () =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const context = Context.make(Crypto.Crypto, crypto).pipe(
          Context.add(
            ServerSecretStore.ServerSecretStore,
            ServerSecretStore.ServerSecretStore.of({
              get: () => Effect.succeedNone,
              set: () => Effect.void,
              create: () => Effect.void,
              getOrCreateRandom: () => Effect.die("Not used"),
              remove: () => Effect.void,
            }),
          ),
        );
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => HttpRouter.toWebHandler(layerTokens, { disableLogger: true })),
          (web) =>
            Effect.tryPromise(async () => {
              const request = (token: string) =>
                new Request("https://host.example.test/oauth/token", {
                  method: "POST",
                  body: new URLSearchParams({
                    grant_type: AuthTokenExchangeGrantType,
                    subject_token_type: AuthAccessTokenType,
                    requested_token_type: AuthAccessTokenType,
                    subject_token: token,
                    client_label: "My phone",
                    client_device_type: "mobile",
                  }),
                });
              const accepted = await web.handler(request("verified-access-jwt"), context);
              expect(accepted.status).toBe(200);
              expect(await accepted.json()).toMatchObject({
                access_token: "host-bearer",
                token_type: "Bearer",
              });
              const refused = await web.handler(request("not-verified"), context);
              expect(refused.status).toBe(401);
            }),
          (web) => Effect.promise(() => web.dispose()),
        );
      }),
  );
  it.effect(
    "serves CORS preflight and a credential-free browser exchange through the server CORS layer",
    () =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const context = Context.make(Crypto.Crypto, crypto);
        const routes = Layer.merge(layerBrowser, ServerHttp.layerBrowserApiCors).pipe(
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "loom-identity-cors-test-" }),
          ),
          Layer.provide(NodeServices.layer),
        );
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
          (web) =>
            Effect.tryPromise(async () => {
              const preflight = await web.handler(
                new Request("https://host.example.test/api/loom/identity/session", {
                  method: "OPTIONS",
                  headers: {
                    origin: "https://app.example.test",
                    "access-control-request-method": "POST",
                    "access-control-request-headers": "content-type",
                  },
                }),
                context,
              );
              expect(preflight.status).toBeLessThan(300);
              expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
              expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
              expect(preflight.headers.get("access-control-allow-headers")).toContain(
                "content-type",
              );
              const exchange = (origin: string) =>
                web.handler(
                  new Request("https://host.example.test/api/loom/identity/session", {
                    method: "POST",
                    headers: { origin, "content-type": "application/json" },
                    body: encodeJson({
                      type: "browser",
                      code: "c".repeat(43),
                      verifier: "v".repeat(43),
                      environmentId: "host",
                    }),
                  }),
                  context,
                );
              const accepted = await exchange("https://app.example.test");
              expect(accepted.status).toBe(200);
              expect(accepted.headers.get("access-control-allow-origin")).toBe("*");
              expect(accepted.headers.get("access-control-allow-credentials")).not.toBe("true");
              expect(await accepted.json()).toMatchObject({
                access_token: "host-bearer",
                environmentId: "host",
              });
              expect((await exchange("https://attacker.test")).status).toBe(401);
            }),
          (web) => Effect.promise(() => web.dispose()),
        );
      }),
  );
  it.effect(
    "renews native sessions with the current session and tells renewal apart from retryable failures",
    () =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const context = Context.make(Crypto.Crypto, crypto);
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => HttpRouter.toWebHandler(layerBrowser, { disableLogger: true })),
          (web) =>
            Effect.tryPromise(async () => {
              const renew = (accessToken: string, currentToken = "current-host-bearer") =>
                web.handler(
                  new Request("https://host.example.test/api/loom/identity/session", {
                    method: "POST",
                    headers: {
                      "content-type": "application/json",
                      authorization: `Bearer ${currentToken}`,
                    },
                    body: encodeJson({
                      type: "native",
                      accessToken,
                      idToken: "id-token",
                      environmentId: "host",
                    }),
                  }),
                  context,
                );
              const renewed = await renew("renewed-access-jwt");
              expect(renewed.status).toBe(200);
              expect(await renewed.json()).toMatchObject({ access_token: "renewed-host-bearer" });
              const expired = await renew("old-sign-in");
              expect(expired.status).toBe(401);
              expect(await expired.json()).toMatchObject({ error: "sign_in_expired" });
              expect((await renew("issuer-unreachable")).status).toBe(503);
              // A mistyped host setting must not make every renewing device drop its grant.
              expect((await renew("host-misconfigured")).status).toBe(503);
              const rejected = await renew("renewed-access-jwt", "another-host-bearer");
              expect(rejected.status).toBe(401);
              expect(await rejected.json()).toMatchObject({ error: "sign_in_failed" });
            }),
          (web) => Effect.promise(() => web.dispose()),
        );
      }),
  );
  it.effect(
    "tells a renewing device and a browser that only a passkey sign-in works, never as retryable",
    () =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const context = Context.make(Crypto.Crypto, crypto);
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => HttpRouter.toWebHandler(layerBrowser, { disableLogger: true })),
          (web) =>
            Effect.tryPromise(async () => {
              const passkey = new PocketId.PocketIdError({ reason: "passkey" }).message;
              const renewal = await web.handler(
                new Request("https://host.example.test/api/loom/identity/session", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    authorization: "Bearer current-host-bearer",
                  },
                  body: encodeJson({
                    type: "native",
                    accessToken: "one-time-code-sign-in",
                    idToken: "id-token",
                    environmentId: "host",
                  }),
                }),
                context,
              );
              expect(renewal.status).toBe(401);
              expect(await renewal.json()).toEqual({ error: "passkey_required", message: passkey });
              const callback = await web.handler(
                new Request(
                  "https://host.example.test/api/loom/identity/callback?state=verified&code=one-time-code-sign-in",
                  { headers: { cookie: "identity-state=signed-state" } },
                ),
                context,
              );
              // A person reads the callback, so it says what to do instead of returning JSON.
              expect(callback.status).toBe(401);
              expect(callback.headers.get("content-type")).toContain("text/html");
              expect(callback.headers.get("content-security-policy")).toContain(
                "script-src 'none'",
              );
              const page = await callback.text();
              expect(page).toContain("accepts passkey sign-ins only");
              expect(page).toContain('href="/"');
              expect(page).not.toContain("<script>");
              expect(passkey).toContain("accepts passkey sign-ins only");
              expect(
                callback.headers
                  .getSetCookie()
                  .some((cookie) => cookie.startsWith("host-session=")),
              ).toBe(false);
              expect(callback.headers.getSetCookie()).toContainEqual(
                expect.stringContaining("identity-state=;"),
              );

              // The app window that opened the sign-in hears why, at its own origin only.
              const popup = await web.handler(
                new Request(
                  "https://host.example.test/api/loom/identity/callback?state=verified&code=popup-sign-in",
                  { headers: { cookie: "identity-state=signed-state" } },
                ),
                context,
              );
              expect(popup.status).toBe(401);
              const script = /<script>(.*)<\/script>/u.exec(await popup.text())?.[1] ?? "";
              const hash = NodeCrypto.createHash("sha256").update(script).digest("base64");
              expect(popup.headers.get("content-security-policy")).toContain(
                `script-src 'sha256-${hash}'`,
              );
              const posted: Array<unknown> = [];
              NodeVM.runInNewContext(script, {
                window: {
                  opener: { postMessage: (...args: Array<unknown>) => posted.push(args) },
                  close: () => posted.push("closed"),
                },
              });
              expect(posted).toEqual([
                [
                  {
                    type: "loom:identity:failed",
                    state: "s".repeat(43),
                    error: "passkey_required",
                  },
                  "https://app.example.test",
                ],
              ]);
            }),
          (web) => Effect.promise(() => web.dispose()),
        );
      }),
  );
  it.effect(
    "revokes a same-origin cookie session and expires its cookies while rejecting cross-origin logout",
    () =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const context = Context.make(Crypto.Crypto, crypto);
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => HttpRouter.toWebHandler(layerBrowser, { disableLogger: true })),
          (web) =>
            Effect.tryPromise(async () => {
              const logout = (origin?: string) =>
                web.handler(
                  new Request("https://host.example.test/api/loom/identity/logout", {
                    method: "POST",
                    headers: {
                      cookie: "host-session=host-browser-token",
                      ...(origin ? { origin } : {}),
                    },
                  }),
                  context,
                );
              for (const origin of [
                undefined,
                "https://attacker.test",
                "https://host.example.test.attacker.test",
              ]) {
                const rejected = await logout(origin);
                expect(rejected.status).toBe(401);
                expect(rejected.headers.getSetCookie()).toEqual([]);
              }
              const signedOut = await logout("https://host.example.test");
              expect(signedOut.status).toBe(200);
              expect(signedOut.headers.getSetCookie()).toContainEqual(
                expect.stringContaining("host-session=;"),
              );
              expect(signedOut.headers.getSetCookie()).toContainEqual(
                expect.stringContaining("HttpOnly"),
              );
              expect(signedOut.headers.getSetCookie()).toContainEqual(
                expect.stringContaining("Secure"),
              );
              const bearer = await web.handler(
                new Request("https://host.example.test/api/loom/identity/logout", {
                  method: "POST",
                  headers: {
                    authorization: "Bearer host-bearer",
                    origin: "https://app.example.test",
                  },
                }),
                context,
              );
              expect(bearer.status).toBe(200);
              expect(bearer.headers.getSetCookie()).toEqual([]);
            }),
          (web) => Effect.promise(() => web.dispose()),
        );
      }),
  );
});
