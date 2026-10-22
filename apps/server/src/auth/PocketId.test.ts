import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthAccessWriteScope,
  AuthSessionId,
  EnvironmentId,
  type AuthClientMetadata,
} from "@t3tools/contracts";
import * as Jose from "jose";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TestClock } from "effect/testing";
import { expect } from "vite-plus/test";
import * as PocketId from "./PocketId.ts";
import { identitySessionPrefix } from "./identityPolicy.ts";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Crypto from "effect/Crypto";
import * as SessionStore from "./SessionStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

const ISSUER = "https://id.example.test";
const AUDIENCE = "https://library.example.test";
const CLIENT_ID = "loom-web";
const CLIENT: AuthClientMetadata = { deviceType: "mobile", label: "My phone", os: "iOS" };
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const fixture = Effect.gen(function* () {
  const now = yield* DateTime.now;
  const seconds = Math.floor(now.epochMilliseconds / 1000);
  const pair = yield* Effect.tryPromise(() => Jose.generateKeyPair("RS256"));
  const publicKey = yield* Effect.tryPromise(() => Jose.exportJWK(pair.publicKey));
  const signed = (payload: Jose.JWTPayload, audience: string, typ: string, issuer = ISSUER) =>
    Effect.tryPromise(() =>
      new Jose.SignJWT({ sub: "owner-id", ...payload })
        .setProtectedHeader({ alg: "RS256", kid: "test-key", typ })
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(seconds)
        .setExpirationTime(seconds + 120)
        .sign(pair.privateKey),
    );
  const access = (overrides: Jose.JWTPayload = {}, audience = AUDIENCE, typ = "at+jwt") =>
    signed({ client_id: CLIENT_ID, scope: "openid profile", ...overrides }, audience, typ);
  const issued: Array<NonNullable<Parameters<SessionStore.SessionStore["Service"]["issue"]>[0]>> =
    [];
  const tokenReply = { access: "", id: "" };
  const userInfo = { sub: "owner-id", groups: ["owner"] };
  const requests: string[] = [];
  const env: NodeJS.ProcessEnv = {
    LOOM_IDENTITY_ISSUER: ISSUER,
    LOOM_IDENTITY_CLIENT_ID: CLIENT_ID,
    LOOM_IDENTITY_NATIVE_CLIENT_ID: "loom-native",
    LOOM_IDENTITY_REDIRECT_URI: "https://library.example.test/api/loom/identity/callback",
    LOOM_IDENTITY_AUDIENCE: AUDIENCE,
    LOOM_IDENTITY_ALLOWED_SUBJECTS: "owner-id",
  };
  const http = HttpClient.make((request) => {
    requests.push(request.url);
    const body = request.url.endsWith("openid-configuration")
      ? {
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: `${ISSUER}/jwks`,
          userinfo_endpoint: `${ISSUER}/userinfo`,
          code_challenge_methods_supported: ["S256"],
        }
      : request.url.endsWith("/userinfo")
        ? userInfo
        : request.url.endsWith("/jwks")
          ? { keys: [{ ...publicKey, alg: "RS256", kid: "test-key", use: "sig" }] }
          : { access_token: tokenReply.access, id_token: tokenReply.id, token_type: "Bearer" };
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(encodeJson(body), { headers: { "content-type": "application/json" } }),
      ),
    );
  });
  const sessions = Layer.mock(SessionStore.SessionStore)({
    cookieName: "host-session",
    legacyCookieName: undefined,
    issue: (input) =>
      Effect.gen(function* () {
        if (input === undefined) return yield* Effect.die("Expected identity grant");
        issued.push(input);
        const current = yield* DateTime.now;
        return {
          sessionId: AuthSessionId.make("issued-session"),
          token: "ordinary-host-token",
          method: input.method ?? "browser-session-cookie",
          client: input.client ?? CLIENT,
          scopes: input.scopes ?? [],
          expiresAt: DateTime.add(current, {
            milliseconds: Duration.toMillis(input.ttl ?? Duration.hours(1)),
          }),
          ...(input.proofKeyThumbprint === undefined
            ? {}
            : { proofKeyThumbprint: input.proofKeyThumbprint }),
        };
      }),
  });
  const dependencies = Layer.mergeAll(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("host-id")),
    }),
    Layer.succeed(HttpClient.HttpClient, http),
    Layer.succeed(HostProcess.Environment, env),
  );
  const layer = PocketId.layer.pipe(
    Layer.provideMerge(sessions),
    Layer.provideMerge(dependencies),
    Layer.provideMerge(NodeServices.layer),
  );
  return {
    layer,
    dependencies,
    access,
    signed,
    tokenReply,
    userInfo,
    issued,
    requests,
    env,
    seconds,
  };
});

it.effect(
  "verifies owner groups through userinfo when a real Pocket ID resource JWT omits them",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      test.env.LOOM_IDENTITY_REQUIRED_GROUPS = "owner";
      const token = yield* test.access();
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        expect((yield* identity.verifyAccessToken(token)).subject).toBe(
          `${identitySessionPrefix(test.env)}b3duZXItaWQ`,
        );
        expect(test.requests.some((url) => url.endsWith("/userinfo"))).toBe(true);
        test.userInfo.sub = "different-owner";
        expect((yield* identity.verifyAccessToken(token).pipe(Effect.flip)).reason).toBe("token");
        test.userInfo.sub = "owner-id";
        test.userInfo.groups = [];
        expect((yield* identity.verifyAccessToken(token).pipe(Effect.flip)).reason).toBe("subject");
      }).pipe(Effect.provide(test.layer));
    }),
);
it.effect(
  "bounds a host-local grant to the accepted access token lifetime with client metadata",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      const token = yield* test.access();
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        const exchanged = yield* identity.exchangeAccessToken({ token, client: CLIENT });
        expect(exchanged).toMatchObject({
          access_token: "ordinary-host-token",
          token_type: "Bearer",
          expires_in: 120,
        });
        expect(test.issued[0]).toMatchObject({
          subject: `${identitySessionPrefix(test.env)}b3duZXItaWQ`,
          scopes: PocketId.PocketIdStandardScopes,
          client: CLIENT,
          method: "bearer-access-token",
        });
        expect(test.issued[0]?.scopes).not.toContain(AuthAccessWriteScope);
        yield* identity.verifyAccessToken(token);
        expect(test.requests.filter((url) => url.endsWith("/jwks"))).toHaveLength(1);
      }).pipe(Effect.provide(test.layer));
    }),
);
it.effect(
  "rejects unknown subjects, wrong issuers, audiences and clients, expired tokens, and ID-token substitution",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      const badSubject = yield* test.access({ sub: "stranger" });
      const badAudience = yield* test.access({}, "other-audience");
      const badIssuer = yield* test.signed(
        { client_id: CLIENT_ID },
        AUDIENCE,
        "at+jwt",
        "https://another-issuer.test",
      );
      const badClient = yield* test.access({ client_id: "unregistered-client" });
      const idToken = yield* test.signed({ nonce: "nonce" }, AUDIENCE, "JWT");
      const valid = yield* test.access();
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        for (const token of [badSubject, badIssuer, badClient, badAudience, idToken])
          expect(
            (yield* Effect.result(identity.exchangeAccessToken({ token, client: CLIENT })))._tag,
          ).toBe("Failure");
        yield* TestClock.adjust(Duration.seconds(121));
        expect(
          (yield* Effect.result(identity.exchangeAccessToken({ token: valid, client: CLIENT })))
            ._tag,
        ).toBe("Failure");
        expect(test.issued).toHaveLength(0);
      }).pipe(Effect.provide(test.layer));
    }),
);
it.effect(
  "requires an explicit audience and stable subject allowlist and never returns secrets in metadata",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      delete test.env.LOOM_IDENTITY_ALLOWED_SUBJECTS;
      test.env.LOOM_IDENTITY_CLIENT_SECRET = "private-client-secret";
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        const metadata = yield* identity.metadata;
        expect(metadata.enabled).toBe(false);
        expect(encodeJson(metadata)).not.toContain("private-client-secret");
        expect((yield* Effect.result(identity.beginLogin()))._tag).toBe("Failure");
      }).pipe(Effect.provide(test.layer));
    }),
);
it.effect("refuses scopes outside the host grant and preserves DPoP key binding", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const token = yield* test.access();
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      expect(
        (yield* Effect.result(
          identity.exchangeAccessToken({
            token,
            client: CLIENT,
            requestedScopes: [AuthAccessWriteScope],
          }),
        ))._tag,
      ).toBe("Failure");
      const exchanged = yield* identity.exchangeAccessToken({
        token,
        client: CLIENT,
        proofKeyThumbprint: "proof-key",
      });
      expect(exchanged.token_type).toBe("DPoP");
      expect(exchanged.expires_in).toBe(120);
      expect(test.issued[0]?.proofKeyThumbprint).toBe("proof-key");
    }).pipe(Effect.provide(test.layer));
  }),
);
it.effect(
  "uses S256 PKCE, signed browser state, nonce verification and single-use callback state",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        const login = yield* identity.beginLogin();
        const authorization = new URL(login.authorizationUrl);
        const state = authorization.searchParams.get("state")!;
        expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
        expect(authorization.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(authorization.searchParams.get("redirect_uri")).toBe(
          test.env.LOOM_IDENTITY_REDIRECT_URI,
        );
        test.tokenReply.access = yield* test.access();
        test.tokenReply.id = yield* test.signed(
          { nonce: authorization.searchParams.get("nonce")! },
          CLIENT_ID,
          "JWT",
        );
        const callback = {
          state,
          code: "one-time-code",
          cookieValue: login.cookieValue,
          client: CLIENT,
        };
        expect(
          (yield* Effect.result(
            identity.completeLogin({ ...callback, cookieValue: `${state}.forged-signature` }),
          ))._tag,
        ).toBe("Failure");
        const session = yield* identity.completeLogin(callback);
        expect(session.method).toBe("browser-session-cookie");
        expect(session.expiresAt.epochMilliseconds - (yield* DateTime.now).epochMilliseconds).toBe(
          Duration.toMillis(Duration.seconds(120)),
        );
        expect((yield* Effect.result(identity.completeLogin(callback)))._tag).toBe("Failure");
        expect(test.issued).toHaveLength(1);
      }).pipe(Effect.provide(test.layer));
    }),
);
it.effect("rejects expired callback state before contacting the token endpoint", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      const login = yield* identity.beginLogin();
      const state = new URL(login.authorizationUrl).searchParams.get("state")!;
      yield* TestClock.adjust(Duration.minutes(6));
      expect(
        (yield* Effect.result(
          identity.completeLogin({
            state,
            code: "code",
            cookieValue: login.cookieValue,
            client: CLIENT,
          }),
        ))._tag,
      ).toBe("Failure");
      expect(test.requests.some((url) => url.endsWith("/token"))).toBe(false);
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("rejects mismatched browser token nonces before issuing a host session", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      const login = yield* identity.beginLogin();
      test.tokenReply.access = yield* test.access();
      test.tokenReply.id = yield* test.signed(
        { nonce: "another-browser-session" },
        CLIENT_ID,
        "JWT",
      );
      const state = new URL(login.authorizationUrl).searchParams.get("state")!;
      expect(
        (yield* identity
          .completeLogin({ state, code: "code", cookieValue: login.cookieValue, client: CLIENT })
          .pipe(Effect.flip)).reason,
      ).toBe("token");
      expect(test.issued).toHaveLength(0);
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("identity sessions remain locally revocable and expire with their accepted token", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const token = yield* test.access();
    const sessions = SessionStore.layer.pipe(
      Layer.provide(SqlitePersistence.layerMemory),
      Layer.provide(ServerSecretStore.layer),
      Layer.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "loom-identity-session-test-" }),
      ),
    );
    const layer = PocketId.layer.pipe(
      Layer.provideMerge(sessions),
      Layer.provideMerge(test.dependencies),
      Layer.provideMerge(NodeServices.layer),
    );
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      const local = yield* SessionStore.SessionStore;
      const first = yield* identity.exchangeAccessToken({ token, client: CLIENT });
      const second = yield* identity.exchangeAccessToken({ token, client: CLIENT });
      yield* TestClock.adjust(Duration.seconds(119));
      const verified = yield* local.verify(first.access_token);
      expect(verified.subject).toBe(`${identitySessionPrefix(test.env)}b3duZXItaWQ`);
      expect(yield* local.revoke(verified.sessionId)).toBe(true);
      expect((yield* Effect.result(local.verify(first.access_token)))._tag).toBe("Failure");
      yield* local.verify(second.access_token);
      yield* TestClock.adjust(Duration.seconds(2));
      expect(
        (yield* Effect.result(identity.exchangeAccessToken({ token, client: CLIENT })))._tag,
      ).toBe("Failure");
      expect((yield* Effect.result(local.verify(second.access_token)))._tag).toBe("Failure");
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("binds safe return paths to the single-use login state", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      for (const requested of [
        "/sites?range=30#checks",
        "https://attacker.invalid",
        "//attacker.invalid",
        "/\\attacker.invalid",
        "/sites\r\nLocation: https://attacker.invalid",
      ]) {
        const login = yield* identity.beginLogin(requested);
        const authorization = new URL(login.authorizationUrl);
        test.tokenReply.access = yield* test.access();
        test.tokenReply.id = yield* test.signed(
          { nonce: authorization.searchParams.get("nonce")! },
          CLIENT_ID,
          "JWT",
        );
        const session = yield* identity.completeLogin({
          state: authorization.searchParams.get("state")!,
          code: "one-time-code",
          cookieValue: login.cookieValue,
          client: CLIENT,
        });
        expect(session.returnTo).toBe(requested.startsWith("/sites?") ? requested : "/");
      }
    }).pipe(Effect.provide(test.layer));
  }),
);

const browserRequest = {
  origin: "https://app.example.test",
  environmentId: EnvironmentId.make("host-id"),
  state: "s".repeat(43),
  challenge: "",
};

it.effect(
  "binds browser handoff to an enrolled origin, environment and PKCE verifier, and spends it once",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      test.env.LOOM_IDENTITY_BROWSER_ORIGINS = browserRequest.origin;
      const crypto = yield* Crypto.Crypto.pipe(Effect.provide(NodeServices.layer));
      const verifier = "v".repeat(43);
      const browser = {
        ...browserRequest,
        challenge: Base64Url.encode(
          yield* crypto.digest("SHA-256", new TextEncoder().encode(verifier)),
        ),
      };
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        for (const invalid of [
          { ...browser, origin: "https://attacker.test" },
          { ...browser, environmentId: EnvironmentId.make("another-host") },
          { ...browser, challenge: "plain" },
        ])
          expect((yield* identity.beginLogin("/", invalid).pipe(Effect.flip)).reason).toBe("state");
        const login = yield* identity.beginLogin("/", browser);
        const authorization = new URL(login.authorizationUrl);
        test.tokenReply.access = yield* test.access();
        test.tokenReply.id = yield* test.signed(
          { nonce: authorization.searchParams.get("nonce")! },
          CLIENT_ID,
          "JWT",
        );
        const completed = yield* identity.completeLogin({
          state: authorization.searchParams.get("state")!,
          code: "idp-code",
          cookieValue: login.cookieValue,
          client: CLIENT,
        });
        const handoff = completed.handoff!;
        expect(handoff).toMatchObject({
          state: browser.state,
          origin: browser.origin,
          environmentId: browser.environmentId,
        });
        expect(handoff.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(login.authorizationUrl).not.toContain(handoff.code);
        const redeem = {
          type: "browser" as const,
          code: handoff.code,
          verifier,
          environmentId: browser.environmentId,
        };
        expect(
          (yield* identity.createSession(redeem, CLIENT, "https://attacker.test").pipe(Effect.flip))
            .reason,
        ).toBe("state");
        expect(
          (yield* identity
            .createSession({ ...redeem, verifier: "x".repeat(43) }, CLIENT, browser.origin)
            .pipe(Effect.flip)).reason,
        ).toBe("state");
        expect(
          (yield* identity
            .createSession(
              { ...redeem, environmentId: EnvironmentId.make("other") },
              CLIENT,
              browser.origin,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("state");
        const session = yield* identity.createSession(redeem, CLIENT, browser.origin);
        expect(session).toMatchObject({
          environmentId: browser.environmentId,
          identity: { issuer: ISSUER, subject: "owner-id" },
          expires_in: 120,
          token_type: "Bearer",
        });
        expect(
          (yield* identity.createSession(redeem, CLIENT, browser.origin).pipe(Effect.flip)).reason,
        ).toBe("state");
      }).pipe(Effect.provide(test.layer));
    }),
);

it.effect("expires an unredeemed browser handoff without issuing a bearer session", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    test.env.LOOM_IDENTITY_BROWSER_ORIGINS = browserRequest.origin;
    const crypto = yield* Crypto.Crypto.pipe(Effect.provide(NodeServices.layer));
    const verifier = "v".repeat(43);
    const browser = {
      ...browserRequest,
      challenge: Base64Url.encode(
        yield* crypto.digest("SHA-256", new TextEncoder().encode(verifier)),
      ),
    };
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      const login = yield* identity.beginLogin("/", browser);
      const authorization = new URL(login.authorizationUrl);
      test.tokenReply.access = yield* test.access();
      test.tokenReply.id = yield* test.signed(
        { nonce: authorization.searchParams.get("nonce")! },
        CLIENT_ID,
        "JWT",
      );
      const completed = yield* identity.completeLogin({
        state: authorization.searchParams.get("state")!,
        code: "idp-code",
        cookieValue: login.cookieValue,
        client: CLIENT,
      });
      yield* TestClock.adjust(Duration.seconds(61));
      expect(
        (yield* identity
          .createSession(
            {
              type: "browser",
              code: completed.handoff!.code,
              verifier,
              environmentId: browser.environmentId,
            },
            CLIENT,
            browser.origin,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("state");
      expect(test.issued).toHaveLength(1);
    }).pipe(Effect.provide(test.layer));
  }),
);
