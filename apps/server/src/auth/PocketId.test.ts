import { it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthRelayWriteScope,
  AuthStandardClientScopes,
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
import * as Digest from "effect/crypto/Digest";
import * as SessionStore from "./SessionStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

class PocketIdFixtureError extends Schema.TaggedError<PocketIdFixtureError>()(
  "PocketIdFixtureError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Pocket Id operation failed.";
  }
}

const ISSUER = "https://id.example.test";
const AUDIENCE = "https://library.example.test";
const CLIENT_ID = "loom-web";
const CLIENT: AuthClientMetadata = { deviceType: "mobile", label: "My phone", os: "iOS" };
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const fixture = Effect.gen(function* () {
  const now = yield* DateTime.now;
  const seconds = Math.floor(now.epochMilliseconds / 1000);
  const pair = yield* Effect.tryPromise({
    try: () => Jose.generateKeyPair("RS256"),
    catch: (cause) => new PocketIdFixtureError({ cause }),
  });
  const publicKey = yield* Effect.tryPromise({
    try: () => Jose.exportJWK(pair.publicKey),
    catch: (cause) => new PocketIdFixtureError({ cause }),
  });
  const signed = (
    payload: Jose.JWTPayload,
    audience: string | string[],
    typ: string,
    issuer = ISSUER,
  ) =>
    Effect.tryPromise({
      try: () =>
        new Jose.SignJWT({ sub: "owner-id", ...payload })
          .setProtectedHeader({ alg: "RS256", kid: "test-key", typ })
          .setIssuer(issuer)
          .setAudience(audience)
          .setIssuedAt(seconds)
          .setExpirationTime(seconds + 120)
          .sign(pair.privateKey),
      catch: (cause) => new PocketIdFixtureError({ cause }),
    });
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
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
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
it.effect(
  "requires the browser client as authorized party for an ID token with multiple audiences",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        test.tokenReply.access = yield* test.access();
        for (const azp of [undefined, "another-client", CLIENT_ID]) {
          const login = yield* identity.beginLogin();
          const authorization = new URL(login.authorizationUrl);
          test.tokenReply.id = yield* test.signed(
            {
              nonce: authorization.searchParams.get("nonce")!,
              ...(azp === undefined ? {} : { azp }),
            },
            [CLIENT_ID, "another-client"],
            "JWT",
          );
          const result = yield* Effect.result(
            identity.completeLogin({
              state: authorization.searchParams.get("state")!,
              code: "one-time-code",
              cookieValue: login.cookieValue,
              client: CLIENT,
            }),
          );
          expect(result._tag).toBe(azp === CLIENT_ID ? "Success" : "Failure");
        }
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
      Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    );
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      const local = yield* SessionStore.SessionStore;
      const first = yield* identity.exchangeAccessToken({ token, client: CLIENT });
      const second = yield* identity.exchangeAccessToken({ token, client: CLIENT });
      yield* TestClock.adjust(Duration.seconds(119));
      const verified = yield* local.verify(first.access_token);
      expect(verified.subject).toBe(`${identitySessionPrefix(test.env)}b3duZXItaWQ`);
      for (const origin of [
        undefined,
        "https://attacker.invalid",
        "https://library.example.test.attacker.invalid",
      ]) {
        const result = yield* Effect.result(
          identity.logout({ cookieToken: first.access_token, ...(origin ? { origin } : {}) }),
        );
        expect(result._tag).toBe("Failure");
        yield* local.verify(first.access_token);
      }
      yield* identity.logout({
        cookieToken: first.access_token,
        origin: "https://library.example.test",
      });
      expect((yield* Effect.result(local.verify(first.access_token)))._tag).toBe("Failure");
      yield* local.verify(second.access_token);
      const third = yield* identity.exchangeAccessToken({ token, client: CLIENT });
      yield* identity.logout({ bearerToken: third.access_token });
      expect((yield* Effect.result(local.verify(third.access_token)))._tag).toBe("Failure");
      yield* identity.logout({ bearerToken: third.access_token });
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
      const crypto = yield* Digest.Digest.pipe(
        Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      );
      const verifier = "v".repeat(43);
      const browser = {
        ...browserRequest,
        expectedIdentity: { issuer: ISSUER, subject: "owner-id" },
        challenge: Base64Url.encode(
          yield* crypto.digest(Digest.sha256, new TextEncoder().encode(verifier)),
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
        const issuedCount = test.issued.length;
        const wrongAccount = yield* identity.beginLogin("/", {
          ...browser,
          expectedIdentity: { issuer: ISSUER, subject: "different-saved-account" },
        });
        const wrongAuthorization = new URL(wrongAccount.authorizationUrl);
        test.tokenReply.id = yield* test.signed(
          { nonce: wrongAuthorization.searchParams.get("nonce")! },
          CLIENT_ID,
          "JWT",
        );
        const refused = yield* identity
          .completeLogin({
            state: wrongAuthorization.searchParams.get("state")!,
            code: "idp-code",
            cookieValue: wrongAccount.cookieValue,
            client: CLIENT,
          })
          .pipe(Effect.flip);
        expect(refused.reason).toBe("subject");
        // The window that opened the sign-in can be told why, and only that window.
        expect(refused.handoff).toEqual({ origin: browser.origin, state: browser.state });
        expect(test.issued.length).toBe(issuedCount);
      }).pipe(Effect.provide(test.layer));
    }),
);

it.effect("expires an unredeemed browser handoff without issuing a bearer session", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    test.env.LOOM_IDENTITY_BROWSER_ORIGINS = browserRequest.origin;
    const crypto = yield* Digest.Digest.pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    );
    const verifier = "v".repeat(43);
    const browser = {
      ...browserRequest,
      challenge: Base64Url.encode(
        yield* crypto.digest(Digest.sha256, new TextEncoder().encode(verifier)),
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

const atHash = (accessToken: string) =>
  Effect.gen(function* () {
    const crypto = yield* Digest.Digest;
    const hash = yield* crypto.digest(Digest.sha256, new TextEncoder().encode(accessToken));
    return Base64Url.encode(hash.slice(0, hash.length / 2));
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

it.effect(
  "requires a native ID token bound to the access token when the host caps sign-in age",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      test.env.LOOM_IDENTITY_MAX_SESSION_AGE = "1h";
      const accessToken = yield* test.access();
      const bound = yield* atHash(accessToken);
      const idToken = (payload: Jose.JWTPayload = {}, audience = "loom-native") =>
        test.signed({ at_hash: bound, auth_time: test.seconds - 60, ...payload }, audience, "JWT");
      const native = (token?: string) => ({
        type: "native" as const,
        accessToken,
        environmentId: EnvironmentId.make("host-id"),
        ...(token === undefined ? {} : { idToken: token }),
      });
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        const refused = (token?: string) =>
          identity.createSession(native(token), CLIENT).pipe(
            Effect.flip,
            Effect.map((error) => error.reason),
          );
        expect((yield* identity.metadata).maxSessionAgeSeconds).toBe(3600);
        expect(yield* refused()).toBe("token");
        expect(yield* refused(yield* idToken({ at_hash: yield* atHash(`${accessToken}x`) }))).toBe(
          "token",
        );
        expect(yield* refused(yield* idToken({ at_hash: undefined }))).toBe("token");
        expect(yield* refused(yield* idToken({}, CLIENT_ID))).toBe("token");
        expect(yield* refused(yield* idToken({ azp: CLIENT_ID }))).toBe("token");
        expect(yield* refused(yield* idToken({ sub: "different-owner" }))).toBe("subject");
        expect(yield* refused(yield* idToken({ auth_time: undefined }))).toBe("token");
        expect(yield* refused(yield* idToken({ auth_time: test.seconds + 3601 }))).toBe("token");
        expect(yield* refused(yield* idToken({ auth_time: test.seconds - 3601 }))).toBe("expired");
        expect(
          (yield* identity
            .exchangeAccessToken({ token: accessToken, client: CLIENT })
            .pipe(Effect.flip)).reason,
        ).toBe("token");
        expect(test.issued).toHaveLength(0);
        const session = yield* identity.createSession(
          native(yield* idToken({ auth_time: test.seconds - 3540 })),
          CLIENT,
        );
        expect(session.expires_in).toBe(60);
        expect(Duration.toMillis(test.issued[0]!.ttl!)).toBe(60_000);
      }).pipe(Effect.provide(test.layer));
    }),
);

it.effect("verifies an offered native ID token even without a sign-in limit", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const accessToken = yield* test.access();
    const idToken = yield* test.signed(
      { at_hash: yield* atHash(accessToken) },
      "loom-native",
      "JWT",
    );
    const withoutIdToken = {
      type: "native" as const,
      accessToken,
      environmentId: EnvironmentId.make("host-id"),
    };
    const request = (token: string) => ({ ...withoutIdToken, idToken: token });
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      expect((yield* identity.metadata).maxSessionAgeSeconds).toBeUndefined();
      expect(
        (yield* identity
          .createSession(request(yield* test.signed({}, "loom-native", "JWT")), CLIENT)
          .pipe(Effect.flip)).reason,
      ).toBe("token");
      expect((yield* identity.createSession(request(idToken), CLIENT)).expires_in).toBe(120);
      expect((yield* identity.createSession(withoutIdToken, CLIENT)).expires_in).toBe(120);
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("names the account from a verified native ID token and skips odd profile claims", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const accessToken = yield* test.access();
    const idToken = (claims: Record<string, unknown>) =>
      Effect.gen(function* () {
        return yield* test.signed(
          { at_hash: yield* atHash(accessToken), ...claims },
          "loom-native",
          "JWT",
        );
      });
    const withoutIdToken = {
      type: "native" as const,
      accessToken,
      environmentId: EnvironmentId.make("host-id"),
    };
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      const named = yield* identity.createSession(
        {
          ...withoutIdToken,
          idToken: yield* idToken({ name: " Kyle ", email: "kyle@example.test" }),
        },
        CLIENT,
      );
      expect(named.identity).toEqual({
        issuer: ISSUER,
        subject: "owner-id",
        name: "Kyle",
        email: "kyle@example.test",
      });
      const odd = yield* identity.createSession(
        { ...withoutIdToken, idToken: yield* idToken({ name: 7, preferred_username: "kb" }) },
        CLIENT,
      );
      expect(odd.identity).toEqual({ issuer: ISSUER, subject: "owner-id", name: "kb" });
      expect((yield* identity.createSession(withoutIdToken, CLIENT)).identity).toEqual({
        issuer: ISSUER,
        subject: "owner-id",
      });
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("caps browser sign-in age and asks Pocket ID for a recent enough sign-in", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    test.env.LOOM_IDENTITY_MAX_SESSION_AGE = "2h";
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      const signIn = (authTime: number) =>
        Effect.gen(function* () {
          const login = yield* identity.beginLogin();
          const authorization = new URL(login.authorizationUrl);
          expect(authorization.searchParams.get("max_age")).toBe("3600");
          test.tokenReply.access = yield* test.access();
          test.tokenReply.id = yield* test.signed(
            { nonce: authorization.searchParams.get("nonce")!, auth_time: authTime },
            CLIENT_ID,
            "JWT",
          );
          return yield* identity.completeLogin({
            state: authorization.searchParams.get("state")!,
            code: "one-time-code",
            cookieValue: login.cookieValue,
            client: CLIENT,
          });
        });
      expect(yield* signIn(test.seconds - 7200).pipe(Effect.flip)).toMatchObject({
        reason: "expired",
      });
      expect(yield* signIn(test.seconds + 7201).pipe(Effect.flip)).toMatchObject({
        reason: "token",
      });
      const session = yield* signIn(test.seconds - 7170);
      expect(session.expiresAt.epochMilliseconds - (yield* DateTime.now).epochMilliseconds).toBe(
        30_000,
      );
    }).pipe(Effect.provide(test.layer));
  }),
);

const reasonOf = <A>(effect: Effect.Effect<A, PocketId.PocketIdError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );
const withAmr = (amr: ReadonlyArray<string> | undefined) =>
  amr === undefined ? {} : { amr: [...amr] };

it.effect("requires a passkey sign-in in the browser and natively when the host asks for one", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    test.env.LOOM_IDENTITY_REQUIRE_PASSKEY = "true";
    const accessToken = yield* test.access();
    const bound = yield* atHash(accessToken);
    const nativeIdToken = (amr?: ReadonlyArray<string>) =>
      test.signed({ at_hash: bound, ...withAmr(amr) }, "loom-native", "JWT");
    const native = (idToken?: string) => ({
      type: "native" as const,
      accessToken,
      environmentId: EnvironmentId.make("host-id"),
      ...(idToken === undefined ? {} : { idToken }),
    });
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      const browserSignIn = (amr?: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const login = yield* identity.beginLogin();
          const authorization = new URL(login.authorizationUrl);
          test.tokenReply.access = accessToken;
          test.tokenReply.id = yield* test
            .signed(
              { nonce: authorization.searchParams.get("nonce")!, ...withAmr(amr) },
              CLIENT_ID,
              "JWT",
            )
            .pipe(Effect.orDie);
          return yield* identity.completeLogin({
            state: authorization.searchParams.get("state")!,
            code: "one-time-code",
            cookieValue: login.cookieValue,
            client: CLIENT,
          });
        });
      // No sign-in limit is set: the requirement alone makes the ID token mandatory.
      expect((yield* identity.metadata).maxSessionAgeSeconds).toBeUndefined();
      // A same-window sign-in has no app window to tell.
      expect((yield* browserSignIn(["otp"]).pipe(Effect.flip)).handoff).toBeUndefined();
      for (const amr of [["otp"], undefined, []]) {
        expect(yield* reasonOf(browserSignIn(amr))).toBe("passkey");
        expect(
          yield* reasonOf(identity.createSession(native(yield* nativeIdToken(amr)), CLIENT)),
        ).toBe("passkey");
      }
      expect(yield* reasonOf(identity.createSession(native(), CLIENT))).toBe("token");
      expect(
        yield* reasonOf(identity.exchangeAccessToken({ token: accessToken, client: CLIENT })),
      ).toBe("token");
      expect(test.issued).toHaveLength(0);
      yield* browserSignIn(["phr"]);
      yield* identity.createSession(native(yield* nativeIdToken(["otp", "phr"])), CLIENT);
      expect(test.issued.map((grant) => grant.method)).toEqual([
        "browser-session-cookie",
        "bearer-access-token",
      ]);
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("names a missing passkey before an expired sign-in when both rules apply", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    test.env.LOOM_IDENTITY_REQUIRE_PASSKEY = "true";
    test.env.LOOM_IDENTITY_MAX_SESSION_AGE = "1h";
    const accessToken = yield* test.access();
    const bound = yield* atHash(accessToken);
    const native = (amr: ReadonlyArray<string>) =>
      test
        .signed(
          { at_hash: bound, auth_time: test.seconds - 3601, ...withAmr(amr) },
          "loom-native",
          "JWT",
        )
        .pipe(
          Effect.map((idToken) => ({
            type: "native" as const,
            accessToken,
            idToken,
            environmentId: EnvironmentId.make("host-id"),
          })),
        );
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      expect(yield* reasonOf(identity.createSession(yield* native(["otp"]), CLIENT))).toBe(
        "passkey",
      );
      expect(yield* reasonOf(identity.createSession(yield* native(["phr"]), CLIENT))).toBe(
        "expired",
      );
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect("refuses to enable Identity when the passkey setting is anything but true", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    for (const value of ["yes", "TRUE", "false", "1"]) {
      test.env.LOOM_IDENTITY_REQUIRE_PASSKEY = value;
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        expect(yield* reasonOf(identity.metadata)).toBe("configuration");
      }).pipe(Effect.provide(test.layer));
    }
    for (const value of [" true ", " "]) {
      test.env.LOOM_IDENTITY_REQUIRE_PASSKEY = value;
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        expect((yield* identity.metadata).enabled).toBe(true);
      }).pipe(Effect.provide(test.layer));
    }
  }),
);

it.effect("refuses to enable Identity with a sign-in limit outside its range", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    test.env.LOOM_IDENTITY_MAX_SESSION_AGE = "30m";
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      expect((yield* identity.metadata.pipe(Effect.flip)).reason).toBe("configuration");
    }).pipe(Effect.provide(test.layer));
  }),
);

it.effect(
  "links a native renewal to the caller's live session and ends the whole chain on logout",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      const token = yield* test.access();
      const sessions = SessionStore.layer.pipe(
        Layer.provide(SqlitePersistence.layerMemory),
        Layer.provide(ServerSecretStore.layer),
        Layer.provide(
          ServerConfig.layerTest(process.cwd(), { prefix: "loom-identity-renewal-test-" }),
        ),
      );
      const layer = PocketId.layer.pipe(
        Layer.provideMerge(sessions),
        Layer.provideMerge(test.dependencies),
        Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      );
      const native = {
        type: "native" as const,
        accessToken: token,
        environmentId: EnvironmentId.make("host-id"),
      };
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        const local = yield* SessionStore.SessionStore;
        const first = yield* identity.createSession(native, CLIENT);
        const renewal = yield* identity.createSession(
          native,
          CLIENT,
          undefined,
          first.access_token,
        );
        const unrelated = yield* identity.createSession(native, CLIENT, undefined, "not-a-session");
        const ordinary = yield* local.issue({
          subject: "browser",
          method: "bearer-access-token",
        });
        const foreign = yield* identity.createSession(native, CLIENT, undefined, ordinary.token);
        yield* identity.logout({ bearerToken: renewal.access_token });
        for (const revoked of [first, renewal])
          expect((yield* Effect.result(local.verify(revoked.access_token)))._tag).toBe("Failure");
        for (const kept of [unrelated, foreign]) yield* local.verify(kept.access_token);
        yield* local.verify(ordinary.token);
      }).pipe(Effect.provide(layer));
    }),
);

it.effect("refuses to renew a session the host revoked, along with its earlier renewal", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const token = yield* test.access();
    const layer = PocketId.layer.pipe(
      Layer.provideMerge(
        SessionStore.layer.pipe(
          Layer.provide(SqlitePersistence.layerMemory),
          Layer.provide(ServerSecretStore.layer),
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "loom-identity-revoke-test-" }),
          ),
        ),
      ),
      Layer.provideMerge(test.dependencies),
      Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    );
    const native = {
      type: "native" as const,
      accessToken: token,
      environmentId: EnvironmentId.make("host-id"),
    };
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      const local = yield* SessionStore.SessionStore;
      const first = yield* identity.createSession(native, CLIENT);
      const renewal = yield* identity.createSession(native, CLIENT, undefined, first.access_token);
      yield* local.revoke((yield* local.verify(first.access_token)).sessionId);
      expect((yield* local.verify(renewal.access_token).pipe(Effect.flip))._tag).toBe(
        "SessionTokenRevokedError",
      );
      for (const current of [first, renewal])
        expect(
          (yield* identity
            .createSession(native, CLIENT, undefined, current.access_token)
            .pipe(Effect.flip)).reason,
        ).toBe("revoked");
    }).pipe(Effect.provide(layer));
  }),
);

// fork: vault-sign-in
const OWNER = { issuer: ISSUER, subject: "owner-id" };
const vaultScopes = [...PocketId.PocketIdStandardScopes, ...PocketId.VaultAccessScopes];
const realSessions = (prefix: string) =>
  SessionStore.layer.pipe(
    Layer.provide(SqlitePersistence.layerMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix })),
  );

it.effect(
  "adds Vault access to a native sign-in only for a fresh passkey pinned to the saved account",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      const accessToken = yield* test.access();
      const bound = yield* atHash(accessToken);
      const idToken = (payload: Jose.JWTPayload = {}) =>
        test.signed(
          { at_hash: bound, auth_time: test.seconds - 30, amr: ["phr"], ...payload },
          "loom-native",
          "JWT",
        );
      const vault = (token: string | undefined) => ({
        type: "native" as const,
        accessToken,
        environmentId: EnvironmentId.make("host-id"),
        expectedIdentity: OWNER,
        access: "vault" as const,
        ...(token === undefined ? {} : { idToken: token }),
      });
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        const granted = yield* identity.createSession(vault(yield* idToken()), CLIENT);
        expect(granted.scope.split(" ")).toEqual(vaultScopes);
        expect(test.issued[0]?.scopes).toEqual(vaultScopes);
        expect(test.issued[0]?.scopes).not.toContain(AuthRelayWriteScope);
        expect(test.issued[0]?.client?.label).toBe("My phone (Vault access)");
        // `issue` still caps it at the token's life, inside the one-hour host session.
        expect(granted.expires_in).toBe(120);

        const { expectedIdentity: _unpinned, ...unpinned } = vault(yield* idToken());
        for (const refused of [
          vault(yield* idToken({ auth_time: test.seconds - 301 })),
          vault(yield* idToken({ auth_time: test.seconds + 5 })),
          vault(yield* idToken({ auth_time: undefined })),
          // Pocket ID copies `amr` from the browser session, so an email-code session stays "otp".
          vault(yield* idToken({ amr: ["otp"] })),
          vault(yield* idToken({ amr: undefined })),
          vault(undefined),
          unpinned,
        ])
          expect(yield* reasonOf(identity.createSession(refused, CLIENT))).toBe("vault-sign-in");
        expect(test.issued).toHaveLength(1);

        // Without the intent the same fresh passkey changes nothing.
        const { access: _access, ...standard } = vault(yield* idToken());
        const plain = yield* identity.createSession(standard, CLIENT);
        expect(plain.scope.split(" ")).toEqual([...PocketId.PocketIdStandardScopes]);
        expect(test.issued[1]?.client?.label).toBe("My phone");
        // Token exchange has no ID token and no intent, so it never adds Vault access.
        const exchanged = yield* identity.exchangeAccessToken({
          token: accessToken,
          client: CLIENT,
        });
        expect(exchanged.scope.split(" ")).not.toContain(AuthAccessReadScope);
      }).pipe(Effect.provide(test.layer));
    }),
);

it.effect("leaves an Allow admin host's sessions as they are and honors the off switch", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const accessToken = yield* test.access();
    const bound = yield* atHash(accessToken);
    const stale = yield* test.signed(
      { at_hash: bound, auth_time: test.seconds - 3000, amr: ["otp"] },
      "loom-native",
      "JWT",
    );
    const fresh = yield* test.signed(
      { at_hash: bound, auth_time: test.seconds - 10, amr: ["phr"] },
      "loom-native",
      "JWT",
    );
    const vault = (idToken: string) => ({
      type: "native" as const,
      accessToken,
      idToken,
      environmentId: EnvironmentId.make("host-id"),
      expectedIdentity: OWNER,
      access: "vault" as const,
    });
    test.env.LOOM_IDENTITY_ALLOW_ADMIN = "true";
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      const session = yield* identity.createSession(vault(stale), CLIENT);
      expect(session.scope.split(" ")).toEqual([...AuthStandardClientScopes]);
    }).pipe(Effect.provide(test.layer));
    delete test.env.LOOM_IDENTITY_ALLOW_ADMIN;

    test.env.LOOM_IDENTITY_VAULT_SIGN_IN = "off";
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      expect(yield* reasonOf(identity.createSession(vault(fresh), CLIENT))).toBe("vault-sign-in");
      const { access: _access, ...standard } = vault(fresh);
      yield* identity.createSession(standard, CLIENT);
    }).pipe(Effect.provide(test.layer));

    // Any other value is a mistake, so Identity refuses to start rather than guess.
    for (const value of ["on", "false", "OFF"]) {
      test.env.LOOM_IDENTITY_VAULT_SIGN_IN = value;
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        expect(yield* reasonOf(identity.metadata)).toBe("configuration");
      }).pipe(Effect.provide(test.layer));
    }
  }),
);

it.effect("renews an elevated native session back to the standard scopes and still links it", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const accessToken = yield* test.access();
    const bound = yield* atHash(accessToken);
    const idToken = yield* test.signed(
      { at_hash: bound, auth_time: test.seconds - 10, amr: ["phr"] },
      "loom-native",
      "JWT",
    );
    const layer = PocketId.layer.pipe(
      Layer.provideMerge(realSessions("loom-identity-vault-renewal-test-")),
      Layer.provideMerge(test.dependencies),
      Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    );
    const native = {
      type: "native" as const,
      accessToken,
      idToken,
      environmentId: EnvironmentId.make("host-id"),
      expectedIdentity: OWNER,
    };
    yield* Effect.gen(function* () {
      const identity = yield* PocketId.PocketId;
      const local = yield* SessionStore.SessionStore;
      const elevated = yield* identity.createSession({ ...native, access: "vault" }, CLIENT);
      expect(elevated.scope.split(" ")).toEqual(vaultScopes);
      yield* TestClock.adjust(Duration.seconds(30));
      // The renewal worker sends no intent; a refreshed grant keeps the old auth_time.
      const renewal = yield* identity.createSession(
        native,
        CLIENT,
        undefined,
        elevated.access_token,
      );
      expect(renewal.scope.split(" ")).toEqual([...PocketId.PocketIdStandardScopes]);
      const elevatedId = (yield* local.verify(elevated.access_token)).sessionId;
      const renewalId = (yield* local.verify(renewal.access_token)).sessionId;
      expect(yield* local.renewalsOf(elevatedId)).toEqual(new Set([elevatedId, renewalId]));
      // Asking again on renewal needs a fresh passkey, which a refreshed grant never has: its
      // ID token keeps the original auth_time.
      const refreshed = yield* test.signed(
        { at_hash: bound, auth_time: test.seconds - 400, amr: ["phr"] },
        "loom-native",
        "JWT",
      );
      expect(
        yield* reasonOf(
          identity.createSession(
            { ...native, idToken: refreshed, access: "vault" },
            CLIENT,
            undefined,
            renewal.access_token,
          ),
        ),
      ).toBe("vault-sign-in");
    }).pipe(Effect.provide(layer));
  }),
);

it.effect(
  "asks Pocket ID for a fresh sign-in for a Vault login and carries the access through the handoff",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      test.env.LOOM_IDENTITY_BROWSER_ORIGINS = browserRequest.origin;
      test.env.LOOM_IDENTITY_MAX_SESSION_AGE = "2h";
      const crypto = yield* Digest.Digest.pipe(
        Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      );
      const verifier = "v".repeat(43);
      const browser = {
        ...browserRequest,
        expectedIdentity: OWNER,
        access: "vault" as const,
        challenge: Base64Url.encode(
          yield* crypto.digest(Digest.sha256, new TextEncoder().encode(verifier)),
        ),
      };
      yield* Effect.gen(function* () {
        const identity = yield* PocketId.PocketId;
        const searchOf = (login: { readonly authorizationUrl: string }) =>
          new URL(login.authorizationUrl).searchParams;
        const standard = yield* identity.beginLogin();
        expect(searchOf(standard).get("max_age")).toBe("3600");
        const sameOrigin = yield* identity.beginLogin("/settings/vault", undefined, "vault");
        expect(searchOf(sameOrigin).get("max_age")).toBe("0");
        // Only max_age changes; state, nonce and the PKCE challenge are made as before.
        expect([...searchOf(sameOrigin).keys()].toSorted()).toEqual(
          [...searchOf(standard).keys()].toSorted(),
        );
        for (const name of [
          "response_type",
          "client_id",
          "redirect_uri",
          "scope",
          "code_challenge_method",
        ])
          expect(searchOf(sameOrigin).get(name)).toBe(searchOf(standard).get(name));
        for (const name of ["state", "nonce", "code_challenge"])
          expect(searchOf(sameOrigin).get(name)).toMatch(/^[A-Za-z0-9_-]{43}$/);

        const complete = (
          login: { readonly authorizationUrl: string; readonly cookieValue: string },
          claims: Jose.JWTPayload,
        ) =>
          Effect.gen(function* () {
            test.tokenReply.access = yield* test.access().pipe(Effect.orDie);
            test.tokenReply.id = yield* test
              .signed({ nonce: searchOf(login).get("nonce")!, ...claims }, CLIENT_ID, "JWT")
              .pipe(Effect.orDie);
            return yield* identity.completeLogin({
              state: searchOf(login).get("state")!,
              code: "idp-code",
              cookieValue: login.cookieValue,
              client: CLIENT,
            });
          });
        const fresh = { auth_time: test.seconds - 20, amr: ["phr"] };

        // A tampered state cookie still fails on the state check.
        const tampered = yield* identity.beginLogin("/", undefined, "vault");
        expect(
          yield* reasonOf(
            complete(
              { ...tampered, cookieValue: `${searchOf(tampered).get("state")}.forged-signature` },
              fresh,
            ),
          ),
        ).toBe("state");

        const cookie = yield* complete(sameOrigin, fresh);
        expect(cookie.scopes).toEqual(vaultScopes);
        expect(cookie.returnTo).toBe("/settings/vault");
        expect(test.issued.at(-1)?.client?.label).toBe("My phone (Vault access)");
        expect(
          yield* reasonOf(
            complete(yield* identity.beginLogin("/", undefined, "vault"), {
              ...fresh,
              amr: ["otp"],
            }),
          ),
        ).toBe("vault-sign-in");

        const stale = yield* complete(yield* identity.beginLogin("/", browser), {
          ...fresh,
          auth_time: test.seconds - 400,
        }).pipe(Effect.flip);
        expect(stale.reason).toBe("vault-sign-in");
        // The window that asked hears why.
        expect(stale.handoff).toEqual({ origin: browser.origin, state: browser.state });

        const login = yield* identity.beginLogin("/", browser);
        expect(searchOf(login).get("max_age")).toBe("0");
        const completed = yield* complete(login, fresh);
        const session = yield* identity.createSession(
          {
            type: "browser",
            code: completed.handoff!.code,
            verifier,
            environmentId: browser.environmentId,
          },
          CLIENT,
          browser.origin,
        );
        expect(session.scope.split(" ")).toEqual(vaultScopes);
        expect(test.issued.at(-1)?.client?.label).toBe("My phone (Vault access)");

        // An ordinary app-window sign-in on the same host keeps the standard scopes.
        const { access: _access, ...ordinary } = browser;
        const plain = yield* complete(yield* identity.beginLogin("/", ordinary), fresh);
        expect(plain.scopes).toEqual([...PocketId.PocketIdStandardScopes]);
      }).pipe(Effect.provide(test.layer));
    }),
);
