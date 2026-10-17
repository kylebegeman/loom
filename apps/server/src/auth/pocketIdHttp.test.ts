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
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as Etag from "effect/http/Etag";
import { expect } from "vite-plus/test";
import * as PocketId from "./PocketId.ts";
import * as SessionStore from "./SessionStore.ts";
import * as PocketIdHttp from "./pocketIdHttp.ts";
import * as AuthHttp from "./http.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

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
  completeLogin: (input) =>
    Effect.gen(function* () {
      if (input.state !== "verified" || input.cookieValue !== "signed-state")
        return yield* new PocketId.PocketIdError({ reason: "state" });
      return {
        token: "host-browser-token",
        returnTo: "/sites",
        sessionId: AuthSessionId.make("browser"),
        method: "browser-session-cookie" as const,
        scopes: ["orchestration:read" as const],
        client: { deviceType: "desktop" as const },
        expiresAt: DateTime.add(yield* DateTime.now, { minutes: 10 }),
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
});
