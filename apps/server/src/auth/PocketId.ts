import {
  AuthAccessReadScope,
  AuthAccessTokenType,
  AuthAccessWriteScope,
  AuthRelayWriteScope,
  AuthStandardClientScopes,
  type AuthAccessTokenResult,
  type AuthClientMetadata,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import {
  LOOM_IDENTITY_CALLBACK_PATH,
  type LoomIdentityMetadata,
  type LoomIdentityAccount,
  type LoomIdentityBrowserRequest,
  type LoomIdentitySessionRequest,
  type LoomIdentitySessionResult,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Jose from "jose";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { IDENTITY_PASSKEY_REQUIRED_TEXT } from "@t3tools/shared/fork/identity-grant";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SessionStore from "./SessionStore.ts";
import { signPayload, timingSafeEqualBase64Url } from "./utils.ts";
import { identitySessionPrefix, parseMaxSessionAge, passkeyRequired } from "./identityPolicy.ts";

const ManagementScopes: ReadonlySet<AuthEnvironmentScope> = new Set([
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthRelayWriteScope,
]);

/**
 * What a Pocket ID session gets without LOOM_IDENTITY_ALLOW_ADMIN=true: the
 * pairing default minus access and relay management. Upstream folded those into
 * the default grant, but Library sign-in keeps them behind the explicit flag.
 */
export const PocketIdStandardScopes = AuthStandardClientScopes.filter(
  (scope) => !ManagementScopes.has(scope),
);

const LOGIN_TTL_MS = 5 * 60 * 1000;
const HOST_SESSION_TTL = Duration.hours(1);
const HOST_SESSION_SECONDS = Duration.toSeconds(HOST_SESSION_TTL);
const MAX_PENDING_LOGINS = 1000;
const JWKS_TTL_MS = 5 * 60 * 1000;
const JWKS_REFRESH_COOLDOWN_MS = 30 * 1000;
const OIDC_SCOPES = ["openid", "profile", "email", "groups"] as const;
const SIGNING_ALGORITHMS = ["RS256", "ES256", "EdDSA"];
/** OIDC Core 3.1.3.6: `at_hash` uses the hash of the ID token's signing algorithm. */
const AT_HASH_DIGESTS: ReadonlyMap<string, Crypto.DigestAlgorithm> = new Map([
  ["RS256", "SHA-256"],
  ["ES256", "SHA-256"],
  ["PS256", "SHA-256"],
  ["EdDSA", "SHA-512"],
]);
/** The `amr` value Pocket ID sets only for a passkey sign-in (`webauthn/service.go`). */
const PASSKEY_AUTH_METHOD = "phr";
const Discovery = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  jwks_uri: Schema.String,
  userinfo_endpoint: Schema.optional(Schema.String),
  code_challenge_methods_supported: Schema.Array(Schema.String),
});
const JwkSet = Schema.Struct({ keys: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) });
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  id_token: Schema.String,
  token_type: Schema.String,
  expires_in: Schema.optional(Schema.Number),
});
const Claims = Schema.Struct({
  sub: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  exp: Schema.Int,
  client_id: Schema.optional(Schema.String),
  nonce: Schema.optional(Schema.String),
  groups: Schema.optional(Schema.Array(Schema.String)),
  at_hash: Schema.optional(Schema.String),
  azp: Schema.optional(Schema.String),
  auth_time: Schema.optional(Schema.Finite),
  amr: Schema.optional(Schema.Array(Schema.String)),
});
const decodeClaims = Schema.decodeUnknownEffect(Claims);
const readUserInfo = HttpClientResponse.schemaBodyJson(
  Schema.Struct({
    sub: Schema.String.check(Schema.isMinLength(1)),
    groups: Schema.optional(Schema.Array(Schema.String)),
  }),
);
const readDiscovery = HttpClientResponse.schemaBodyJson(Discovery);
const readKeys = HttpClientResponse.schemaBodyJson(JwkSet);
const readTokenResponse = HttpClientResponse.schemaBodyJson(TokenResponse);

export class PocketIdError extends Schema.TaggedError<PocketIdError>()("PocketIdError", {
  reason: Schema.Literals([
    "disabled",
    "configuration",
    "discovery",
    "token",
    "subject",
    "scope",
    "state",
    "capacity",
    "session",
    "expired",
    "revoked",
    "passkey",
  ]),
  cause: Schema.optional(Schema.Defect()),
  /**
   * The app window a failed browser sign-in reports to. Set only once the callback matched its
   * pending sign-in, so the origin is one this computer allows and the state is that window's.
   */
  handoff: Schema.optional(Schema.Struct({ origin: Schema.String, state: Schema.String })),
}) {
  override get message(): string {
    switch (this.reason) {
      case "disabled":
        return "Loom sign-in is unavailable on this computer.";
      case "configuration":
        return "Loom sign-in needs this computer's identity configuration.";
      case "expired":
        return "Your Loom sign-in reached this computer's time limit. Sign in again.";
      case "passkey":
        return IDENTITY_PASSKEY_REQUIRED_TEXT;
      default:
        return "Loom could not complete sign-in. Try again.";
    }
  }
}

interface VerifiedIdentity {
  readonly subject: string;
  readonly account: LoomIdentityAccount;
  readonly expiresAt: DateTime.Utc;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
}
interface PendingLogin {
  readonly returnTo: string;
  readonly verifier: string;
  readonly nonce: string;
  readonly expiresAt: number;
  readonly browser?: LoomIdentityBrowserRequest;
}

/** Verifies identity; the allowlist and grants remain local to this execution host. */
export class PocketId extends Context.Service<
  PocketId,
  {
    readonly metadata: Effect.Effect<LoomIdentityMetadata, PocketIdError>;
    readonly cookieName: string;
    readonly beginLogin: (
      returnTo?: string,
      browser?: LoomIdentityBrowserRequest,
    ) => Effect.Effect<
      {
        readonly authorizationUrl: string;
        readonly cookieValue: string;
        readonly expiresAt: DateTime.Utc;
      },
      PocketIdError
    >;
    readonly completeLogin: (input: {
      readonly state: string;
      readonly cookieValue: string;
      readonly code: string;
      readonly issuer?: string;
      readonly client: AuthClientMetadata;
    }) => Effect.Effect<
      SessionStore.IssuedSession & {
        readonly returnTo: string;
        readonly handoff?: {
          readonly code: string;
          readonly state: string;
          readonly origin: string;
          readonly environmentId: string;
        };
      },
      PocketIdError
    >;
    readonly logout: (input: {
      readonly bearerToken?: string;
      readonly cookieToken?: string;
      readonly origin?: string;
    }) => Effect.Effect<void, PocketIdError>;
    /**
     * `currentToken` is the caller's live host session; a native session issued with it becomes
     * that session's successor, so a socket bound to it carries over instead of closing.
     */
    readonly createSession: (
      input: LoomIdentitySessionRequest,
      client: AuthClientMetadata,
      origin?: string,
      currentToken?: string,
    ) => Effect.Effect<LoomIdentitySessionResult, PocketIdError>;
    readonly verifyAccessToken: (token: string) => Effect.Effect<VerifiedIdentity, PocketIdError>;
    readonly exchangeAccessToken: (input: {
      readonly token: string;
      readonly requestedScopes?: ReadonlyArray<AuthEnvironmentScope>;
      readonly client: AuthClientMetadata;
      readonly proofKeyThumbprint?: string;
    }) => Effect.Effect<AuthAccessTokenResult, PocketIdError>;
  }
>()("t3/auth/PocketId") {}

const make = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment;
  const crypto = yield* Crypto.Crypto;
  const http = yield* HttpClient.HttpClient;
  const sessions = yield* SessionStore.SessionStore;
  const hostIdentity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const environmentId = yield* hostIdentity.getEnvironmentId;
  const optional = (key: string) => environment[key]?.trim() || null;
  const csv = (key: string) => [
    ...new Set(
      (optional(key) ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const issuer = optional("LOOM_IDENTITY_ISSUER");
  const clientId = optional("LOOM_IDENTITY_CLIENT_ID");
  const nativeClientId = optional("LOOM_IDENTITY_NATIVE_CLIENT_ID");
  const redirectUri = optional("LOOM_IDENTITY_REDIRECT_URI");
  const desktopRedirectUri = optional("LOOM_IDENTITY_DESKTOP_REDIRECT_URI");
  const resource = optional("LOOM_IDENTITY_RESOURCE");
  const clientSecret =
    optional("LOOM_IDENTITY_CLIENT_SECRET") === null
      ? null
      : Redacted.make(optional("LOOM_IDENTITY_CLIENT_SECRET")!);
  const allowedSubjects = csv("LOOM_IDENTITY_ALLOWED_SUBJECTS");
  const requiredGroups = csv("LOOM_IDENTITY_REQUIRED_GROUPS");
  const browserOrigins = csv("LOOM_IDENTITY_BROWSER_ORIGINS");
  const sessionPrefix = identitySessionPrefix(environment);
  const maxSessionAgeSetting = optional("LOOM_IDENTITY_MAX_SESSION_AGE");
  const maxSessionAgeSeconds =
    maxSessionAgeSetting === null ? null : parseMaxSessionAge(maxSessionAgeSetting);
  const requirePasskeySetting = optional("LOOM_IDENTITY_REQUIRE_PASSKEY");
  const requirePasskey = passkeyRequired(environment);
  const audiences = csv("LOOM_IDENTITY_AUDIENCE");
  if (audiences.length === 0) audiences.push(environmentId);
  const grantedScopes =
    optional("LOOM_IDENTITY_ALLOW_ADMIN") === "true"
      ? AuthStandardClientScopes
      : PocketIdStandardScopes;
  const stateSecret = yield* crypto.randomBytes(32).pipe(Effect.orDie);
  const cookieName = `loom_identity_state_${Base64Url.encode(yield* crypto.digest("SHA-256", new TextEncoder().encode(environmentId)).pipe(Effect.orDie)).slice(0, 16)}`;
  const pending = yield* Ref.make<ReadonlyMap<string, PendingLogin>>(new Map());
  const handoffs = yield* Ref.make<
    ReadonlyMap<
      string,
      {
        readonly browser: LoomIdentityBrowserRequest;
        readonly identity: VerifiedIdentity;
        readonly expiresAt: number;
      }
    >
  >(new Map());
  const discoveryCache = yield* Ref.make<{
    readonly value: typeof Discovery.Type;
    readonly expiresAt: number;
  } | null>(null);
  const keyCache = yield* Ref.make<{
    readonly resolver: ReturnType<typeof Jose.createLocalJWKSet>;
    readonly fetchedAt: number;
  } | null>(null);
  const discoveryLock = yield* Semaphore.make(1);
  const keyLock = yield* Semaphore.make(1);
  const enabled =
    issuer !== null && allowedSubjects.length > 0 && optional("LOOM_IDENTITY_AUDIENCE") !== null;
  const browserLoginEnabled = enabled && clientId !== null && redirectUri !== null;
  const secureUrl = (value: string) =>
    Effect.try({
      try: () => {
        const url = new URL(value);
        if (
          url.protocol !== "https:" ||
          !url.hostname ||
          url.username ||
          url.password ||
          url.hash ||
          url.search
        )
          throw new Error("Invalid identity endpoint");
        return url;
      },
      catch: (cause) => new PocketIdError({ reason: "configuration", cause }),
    });
  const checkConfig = Effect.gen(function* () {
    if (!enabled || issuer === null) return yield* new PocketIdError({ reason: "disabled" });
    yield* secureUrl(issuer);
    if (clientId === null && nativeClientId === null)
      return yield* new PocketIdError({ reason: "configuration" });
    if (maxSessionAgeSetting !== null && maxSessionAgeSeconds === null)
      return yield* new PocketIdError({ reason: "configuration" });
    if (requirePasskeySetting !== null && !requirePasskey)
      return yield* new PocketIdError({ reason: "configuration" });
    for (const origin of browserOrigins) {
      const url = yield* secureUrl(origin);
      if (url.origin !== origin) return yield* new PocketIdError({ reason: "configuration" });
    }
    if (resource !== null) {
      yield* secureUrl(resource);
      if (!audiences.includes(resource))
        return yield* new PocketIdError({ reason: "configuration" });
    }
    if (desktopRedirectUri !== null) {
      const desktop = yield* Effect.try({
        try: () => new URL(desktopRedirectUri),
        catch: (cause) => new PocketIdError({ reason: "configuration", cause }),
      });
      if (
        desktop.protocol !== "http:" ||
        desktop.hostname !== "127.0.0.1" ||
        !desktop.port ||
        desktop.username ||
        desktop.password ||
        desktop.search ||
        desktop.hash ||
        desktop.pathname !== "/loom/identity/callback"
      )
        return yield* new PocketIdError({ reason: "configuration" });
    }
    if (browserLoginEnabled && redirectUri !== null) {
      const redirect = yield* secureUrl(redirectUri);
      if (redirect.pathname !== LOOM_IDENTITY_CALLBACK_PATH)
        return yield* new PocketIdError({ reason: "configuration" });
    }
    return issuer;
  });
  const discovery = discoveryLock.withPermit(
    Effect.gen(function* () {
      const expectedIssuer = yield* checkConfig;
      const now = yield* DateTime.now;
      const cached = yield* Ref.get(discoveryCache);
      if (cached !== null && cached.expiresAt > now.epochMilliseconds) return cached.value;
      const value = yield* http
        .get(`${expectedIssuer.replace(/\/$/, "")}/.well-known/openid-configuration`)
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(readDiscovery),
          Effect.timeout("15 seconds"),
          Effect.mapError((cause) => new PocketIdError({ reason: "discovery", cause })),
        );
      if (
        value.issuer !== expectedIssuer ||
        !value.code_challenge_methods_supported.includes("S256")
      )
        return yield* new PocketIdError({ reason: "discovery" });
      const issuerOrigin = (yield* secureUrl(expectedIssuer)).origin;
      for (const endpoint of [
        value.authorization_endpoint,
        value.token_endpoint,
        value.jwks_uri,
        ...(value.userinfo_endpoint ? [value.userinfo_endpoint] : []),
      ]) {
        if ((yield* secureUrl(endpoint)).origin !== issuerOrigin)
          return yield* new PocketIdError({ reason: "discovery" });
      }
      yield* Ref.set(discoveryCache, { value, expiresAt: now.epochMilliseconds + JWKS_TTL_MS });
      return value;
    }),
  );
  const keys = (refresh: boolean) =>
    keyLock.withPermit(
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const cached = yield* Ref.get(keyCache);
        if (
          cached !== null &&
          (refresh
            ? cached.fetchedAt + JWKS_REFRESH_COOLDOWN_MS > now.epochMilliseconds
            : cached.fetchedAt + JWKS_TTL_MS > now.epochMilliseconds)
        )
          return cached.resolver;
        const metadata = yield* discovery;
        const jwksUrl = optional("LOOM_IDENTITY_JWKS_URL") ?? metadata.jwks_uri;
        yield* secureUrl(jwksUrl);
        const value = yield* http.get(jwksUrl).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(readKeys),
          Effect.timeout("15 seconds"),
          Effect.mapError((cause) => new PocketIdError({ reason: "discovery", cause })),
        );
        const resolver = yield* Effect.try({
          try: () => Jose.createLocalJWKSet({ keys: [...value.keys] }),
          catch: (cause) => new PocketIdError({ reason: "discovery", cause }),
        });
        yield* Ref.set(keyCache, { resolver, fetchedAt: now.epochMilliseconds });
        return resolver;
      }),
    );
  const verifyJwt = Effect.fnUntraced(function* (
    token: string,
    audience: string | ReadonlyArray<string>,
    type?: string,
  ) {
    yield* checkConfig;
    if (token.length > 32768) return yield* new PocketIdError({ reason: "token" });
    const now = yield* DateTime.now;
    const verify = (resolver: ReturnType<typeof Jose.createLocalJWKSet>) =>
      Effect.tryPromise({
        try: () =>
          Jose.jwtVerify(token, resolver, {
            issuer: issuer!,
            audience: typeof audience === "string" ? audience : [...audience],
            algorithms: SIGNING_ALGORITHMS,
            requiredClaims: ["sub", "exp"],
            currentDate: DateTime.toDate(now),
            ...(type === undefined ? {} : { typ: type }),
          }),
        catch: (cause) => new PocketIdError({ reason: "token", cause }),
      });
    const first = yield* Effect.result(verify(yield* keys(false)));
    if (first._tag === "Success") return first.success;
    if (first.failure.cause instanceof Jose.errors.JWKSNoMatchingKey)
      return yield* verify(yield* keys(true));
    return yield* first.failure;
  });
  const grant = Effect.fnUntraced(function* (payload: Jose.JWTPayload) {
    const claims = yield* decodeClaims(payload).pipe(
      Effect.mapError((cause) => new PocketIdError({ reason: "token", cause })),
    );
    if (
      !allowedSubjects.includes(claims.sub) ||
      requiredGroups.some((group) => !claims.groups?.includes(group))
    )
      return yield* new PocketIdError({ reason: "subject" });
    const now = yield* DateTime.now;
    const expiration = DateTime.make(claims.exp * 1000);
    if (expiration._tag === "None" || expiration.value.epochMilliseconds <= now.epochMilliseconds)
      return yield* new PocketIdError({ reason: "token" });
    return {
      subject: `${sessionPrefix}${Base64Url.encode(new TextEncoder().encode(claims.sub))}`,
      account: { issuer: issuer!, subject: claims.sub },
      expiresAt: DateTime.toUtc(expiration.value),
      scopes: grantedScopes,
    } satisfies VerifiedIdentity;
  });
  const verifyAccessToken = Effect.fn("PocketId.verifyAccessToken")(function* (token: string) {
    const verified = yield* verifyJwt(token, audiences, "at+jwt");
    const claims = yield* decodeClaims(verified.payload).pipe(
      Effect.mapError((cause) => new PocketIdError({ reason: "token", cause })),
    );
    const acceptedClients = [clientId, nativeClientId].filter((id) => id !== null);
    if (
      acceptedClients.length > 0 &&
      (claims.client_id === undefined || !acceptedClients.includes(claims.client_id))
    )
      return yield* new PocketIdError({ reason: "token" });
    if (!allowedSubjects.includes(claims.sub))
      return yield* new PocketIdError({ reason: "subject" });
    if (requiredGroups.length > 0 && claims.groups === undefined) {
      // Pocket ID 2.18 places group claims in UserInfo/ID tokens, not its RFC 9068 resource JWT.
      // Validate the bearer first, then bind the issuer's current group response to that exact subject.
      const endpoint = (yield* discovery).userinfo_endpoint;
      if (!endpoint) return yield* new PocketIdError({ reason: "discovery" });
      const response = yield* http
        .execute(
          HttpClientRequest.get(endpoint).pipe(HttpClientRequest.bearerToken(Redacted.make(token))),
        )
        .pipe(
          Effect.timeout("15 seconds"),
          Effect.mapError((cause) => new PocketIdError({ reason: "discovery", cause })),
        );
      // Pocket ID being briefly down must read as retryable, not as a rejected sign-in.
      if (response.status >= 500) return yield* new PocketIdError({ reason: "discovery" });
      if (response.status !== 200) return yield* new PocketIdError({ reason: "token" });
      const info = yield* readUserInfo(response).pipe(
        Effect.mapError((cause) => new PocketIdError({ reason: "token", cause })),
      );
      if (info.sub !== claims.sub) return yield* new PocketIdError({ reason: "token" });
      return yield* grant({ ...verified.payload, groups: info.groups });
    }
    return yield* grant(verified.payload);
  });
  /** Verifies an ID token issued to `audience` and binds it to the access token it came with. */
  const verifyIdToken = Effect.fnUntraced(function* (input: {
    readonly idToken: string;
    readonly accessToken: string;
    readonly audience: string;
    readonly nonce?: string;
    readonly requireAtHash: boolean;
  }) {
    const verified = yield* verifyJwt(input.idToken, input.audience);
    const claims = yield* decodeClaims(verified.payload).pipe(
      Effect.mapError((cause) => new PocketIdError({ reason: "token", cause })),
    );
    if (
      (input.nonce !== undefined && claims.nonce !== input.nonce) ||
      (claims.azp !== undefined && claims.azp !== input.audience) ||
      (Array.isArray(verified.payload.aud) &&
        verified.payload.aud.length > 1 &&
        claims.azp !== input.audience)
    )
      return yield* new PocketIdError({ reason: "token" });
    if (claims.at_hash === undefined) {
      if (input.requireAtHash) return yield* new PocketIdError({ reason: "token" });
      return claims;
    }
    const algorithm = AT_HASH_DIGESTS.get(verified.protectedHeader.alg);
    if (algorithm === undefined) return yield* new PocketIdError({ reason: "token" });
    const hash = yield* crypto
      .digest(algorithm, new TextEncoder().encode(input.accessToken))
      .pipe(Effect.orDie);
    if (!timingSafeEqualBase64Url(claims.at_hash, Base64Url.encode(hash.slice(0, hash.length / 2))))
      return yield* new PocketIdError({ reason: "token" });
    return claims;
  });
  /**
   * Access tokens carry no `auth_time` and refreshes reset their `iat`, so the ID token's
   * `auth_time` is the only clock that a refresh grant cannot extend.
   */
  const capSignInAge = Effect.fnUntraced(function* (
    identity: VerifiedIdentity,
    authTime: number | undefined,
  ) {
    if (maxSessionAgeSeconds === null) return identity;
    if (authTime === undefined) return yield* new PocketIdError({ reason: "token" });
    const now = yield* DateTime.now;
    const limit = (authTime + maxSessionAgeSeconds) * 1000;
    if (limit <= now.epochMilliseconds) return yield* new PocketIdError({ reason: "expired" });
    return limit < identity.expiresAt.epochMilliseconds
      ? { ...identity, expiresAt: DateTime.makeUnsafe(limit) }
      : identity;
  });
  /**
   * Pocket ID keeps a grant's `amr` through every refresh, so a sign-in that began with a one-time
   * code never passes; it runs before `capSignInAge` so that grant gets this actionable refusal.
   */
  const checkPasskey = (amr: ReadonlyArray<string> | undefined) =>
    requirePasskey && !amr?.includes(PASSKEY_AUTH_METHOD)
      ? Effect.fail(new PocketIdError({ reason: "passkey" }))
      : Effect.void;
  const issue = Effect.fnUntraced(function* (
    identity: VerifiedIdentity,
    input: {
      readonly client: AuthClientMetadata;
      readonly method: "browser-session-cookie" | "bearer-access-token" | "dpop-access-token";
      readonly requestedScopes?: ReadonlyArray<AuthEnvironmentScope>;
      readonly proofKeyThumbprint?: string;
    },
  ) {
    const scopes =
      input.requestedScopes === undefined ? identity.scopes : [...new Set(input.requestedScopes)];
    if (scopes.length === 0 || scopes.some((scope) => !identity.scopes.includes(scope)))
      return yield* new PocketIdError({ reason: "scope" });
    const now = yield* DateTime.now;
    if (identity.expiresAt.epochMilliseconds <= now.epochMilliseconds)
      return yield* new PocketIdError({ reason: "token" });
    // Host revocation remains local; identity-based sessions never outlive their accepted token.
    return yield* sessions
      .issue({
        subject: identity.subject,
        method: input.method,
        scopes,
        client: input.client,
        ttl: Duration.millis(
          Math.min(
            Duration.toMillis(HOST_SESSION_TTL),
            identity.expiresAt.epochMilliseconds - now.epochMilliseconds,
          ),
        ),
        ...(input.proofKeyThumbprint === undefined
          ? {}
          : { proofKeyThumbprint: input.proofKeyThumbprint }),
      })
      .pipe(Effect.mapError((cause) => new PocketIdError({ reason: "session", cause })));
  });
  const metadata = Effect.gen(function* () {
    const endpoints = enabled ? yield* discovery : null;
    return {
      enabled,
      browserLoginEnabled,
      issuer,
      clientId,
      ...(nativeClientId === null ? {} : { nativeClientId }),
      ...(desktopRedirectUri === null ? {} : { desktopRedirectUri }),
      authorizationEndpoint: endpoints?.authorization_endpoint ?? null,
      tokenEndpoint: endpoints?.token_endpoint ?? null,
      scopes: OIDC_SCOPES,
      audience: audiences[0]!,
      ...(resource === null ? {} : { resource }),
      environmentId,
      sessionExchangeEnabled: true,
      browserOrigins,
      ...(maxSessionAgeSeconds === null ? {} : { maxSessionAgeSeconds }),
    } satisfies LoomIdentityMetadata;
  });
  const beginLogin = Effect.fn("PocketId.beginLogin")(function* (
    requestedReturnTo = "/",
    browser?: LoomIdentityBrowserRequest,
  ) {
    // Keep the destination in single-use server state, never in callback parameters.
    const returnTo =
      requestedReturnTo.startsWith("/") &&
      !requestedReturnTo.startsWith("//") &&
      !/[\\\s\p{Cc}]/u.test(requestedReturnTo) &&
      requestedReturnTo.length <= 2048
        ? requestedReturnTo
        : "/";
    if (!browserLoginEnabled || clientId === null || redirectUri === null)
      return yield* new PocketIdError({ reason: "disabled" });
    const endpoints = yield* discovery;
    if (
      browser &&
      (!browserOrigins.includes(browser.origin) ||
        browser.environmentId !== environmentId ||
        !/^[A-Za-z0-9_-]{43}$/.test(browser.challenge) ||
        !/^[A-Za-z0-9_-]{43}$/.test(browser.state) ||
        (browser.expectedIdentity !== undefined && browser.expectedIdentity.issuer !== issuer))
    )
      return yield* new PocketIdError({ reason: "state" });
    const now = yield* DateTime.now;
    const random = () =>
      crypto.randomBytes(32).pipe(
        Effect.map(Base64Url.encode),
        Effect.mapError((cause) => new PocketIdError({ reason: "state", cause })),
      );
    const state = yield* random();
    const verifier = yield* random();
    const nonce = yield* random();
    const challenge = Base64Url.encode(
      yield* crypto.digest("SHA-256", new TextEncoder().encode(verifier)).pipe(Effect.orDie),
    );
    const accepted = yield* Ref.modify(pending, (current) => {
      const next = new Map(
        [...current].filter(([, entry]) => entry.expiresAt > now.epochMilliseconds),
      );
      if (next.size >= MAX_PENDING_LOGINS) return [false, next] as const;
      next.set(state, {
        verifier,
        nonce,
        returnTo,
        ...(browser ? { browser } : {}),
        expiresAt: now.epochMilliseconds + LOGIN_TTL_MS,
      });
      return [true, next] as const;
    });
    if (!accepted) return yield* new PocketIdError({ reason: "capacity" });
    const authorization = new URL(endpoints.authorization_endpoint);
    for (const [name, value] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: OIDC_SCOPES.join(" "),
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }))
      authorization.searchParams.set(name, value);
    if (resource !== null) authorization.searchParams.set("resource", resource);
    // An older Pocket ID sign-in would be refused at the callback, so ask for one that still
    // leaves a full host session before the limit.
    if (maxSessionAgeSeconds !== null)
      authorization.searchParams.set(
        "max_age",
        String(maxSessionAgeSeconds - HOST_SESSION_SECONDS),
      );
    return {
      authorizationUrl: authorization.toString(),
      cookieValue: `${state}.${signPayload(state, stateSecret)}`,
      expiresAt: DateTime.add(now, { milliseconds: LOGIN_TTL_MS }),
    };
  });
  const completeLogin: PocketId["Service"]["completeLogin"] = Effect.fn("PocketId.completeLogin")(
    function* (input) {
      if (!browserLoginEnabled || clientId === null || redirectUri === null)
        return yield* new PocketIdError({ reason: "disabled" });
      if (input.issuer !== undefined && input.issuer !== issuer)
        return yield* new PocketIdError({ reason: "state" });
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(input.state) ||
        input.code.length === 0 ||
        input.code.length > 8192
      )
        return yield* new PocketIdError({ reason: "state" });
      const [cookieState, signature, extra] = input.cookieValue.split(".");
      if (
        cookieState !== input.state ||
        signature === undefined ||
        extra !== undefined ||
        !timingSafeEqualBase64Url(signature, signPayload(input.state, stateSecret))
      )
        return yield* new PocketIdError({ reason: "state" });
      const now = yield* DateTime.now;
      const entry = yield* Ref.modify(pending, (current) => {
        const stored = current.get(input.state);
        const next = new Map(current);
        next.delete(input.state);
        return [
          stored !== undefined && stored.expiresAt > now.epochMilliseconds ? stored : null,
          next,
        ] as const;
      });
      if (entry === null) return yield* new PocketIdError({ reason: "state" });
      const browser = entry.browser;
      return yield* Effect.gen(function* () {
        const endpoints = yield* discovery;
        const form: Record<string, string> = {
          grant_type: "authorization_code",
          code: input.code,
          client_id: clientId,
          redirect_uri: redirectUri,
          code_verifier: entry.verifier,
        };
        if (clientSecret !== null) form.client_secret = Redacted.value(clientSecret);
        const tokens = yield* http
          .execute(
            HttpClientRequest.post(endpoints.token_endpoint).pipe(
              HttpClientRequest.bodyUrlParams(form),
            ),
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(readTokenResponse),
            Effect.timeout("15 seconds"),
            Effect.mapError((cause) => new PocketIdError({ reason: "token", cause })),
          );
        if (tokens.token_type.toLowerCase() !== "bearer")
          return yield* new PocketIdError({ reason: "token" });
        const claims = yield* verifyIdToken({
          idToken: tokens.id_token,
          accessToken: tokens.access_token,
          audience: clientId,
          nonce: entry.nonce,
          requireAtHash: false,
        });
        yield* checkPasskey(claims.amr);
        const identity = yield* verifyAccessToken(tokens.access_token);
        if (
          identity.account.subject !== claims.sub ||
          (entry.browser?.expectedIdentity &&
            (entry.browser.expectedIdentity.issuer !== identity.account.issuer ||
              entry.browser.expectedIdentity.subject !== identity.account.subject))
        )
          return yield* new PocketIdError({ reason: "subject" });
        const expiration = DateTime.make(claims.exp * 1000);
        if (expiration._tag === "None") return yield* new PocketIdError({ reason: "token" });
        const acceptedIdentity = yield* capSignInAge(
          {
            ...identity,
            expiresAt: DateTime.toUtc(
              expiration.value.epochMilliseconds < identity.expiresAt.epochMilliseconds
                ? expiration.value
                : identity.expiresAt,
            ),
          },
          claims.auth_time,
        );
        const session = yield* issue(acceptedIdentity, {
          client: input.client,
          method: "browser-session-cookie",
        });
        if (!entry.browser) return { ...session, returnTo: entry.returnTo };
        const code = Base64Url.encode(yield* crypto.randomBytes(32).pipe(Effect.orDie));
        const accepted = yield* Ref.modify(handoffs, (current) => {
          const next = new Map(
            [...current].filter(([, value]) => value.expiresAt > now.epochMilliseconds),
          );
          if (next.size >= MAX_PENDING_LOGINS) return [false, next] as const;
          next.set(code, {
            browser: entry.browser!,
            identity: acceptedIdentity,
            expiresAt: now.epochMilliseconds + 60_000,
          });
          return [true, next] as const;
        });
        if (!accepted) return yield* new PocketIdError({ reason: "capacity" });
        return {
          ...session,
          returnTo: entry.returnTo,
          handoff: {
            code,
            origin: entry.browser.origin,
            state: entry.browser.state,
            environmentId,
          },
        };
      }).pipe(
        Effect.mapError((error) =>
          browser === undefined
            ? error
            : new PocketIdError({
                reason: error.reason,
                ...(error.cause === undefined ? {} : { cause: error.cause }),
                handoff: { origin: browser.origin, state: browser.state },
              }),
        ),
      );
    },
  );
  return PocketId.of({
    cookieName,
    metadata,
    beginLogin,
    completeLogin,
    verifyAccessToken,
    logout: Effect.fn("PocketId.logout")(function* (input) {
      if (input.bearerToken === undefined) {
        if (redirectUri === null || input.origin !== (yield* secureUrl(redirectUri)).origin)
          return yield* new PocketIdError({ reason: "state" });
      }
      const token = input.bearerToken ?? input.cookieToken;
      if (!token) return;
      const session = yield* sessions.verify(token).pipe(
        Effect.catchIf(SessionStore.isSessionCredentialInvalidError, () => Effect.void),
        Effect.mapError((cause) => new PocketIdError({ reason: "session", cause })),
      );
      if (!session) return;
      if (!session.subject.startsWith("identity:") && !session.subject.startsWith("pocket-id:"))
        return yield* new PocketIdError({ reason: "subject" });
      // Revocation follows renewal links, so removing a connection ends every renewal of it.
      yield* sessions
        .revoke(session.sessionId)
        .pipe(Effect.mapError((cause) => new PocketIdError({ reason: "session", cause })));
    }),
    createSession: Effect.fn("PocketId.createSession")(
      function* (input, client, origin, currentToken) {
        if (input.environmentId !== environmentId)
          return yield* new PocketIdError({ reason: "state" });
        let identity: VerifiedIdentity;
        if (input.type === "native") {
          identity = yield* verifyAccessToken(input.accessToken);
          if (
            input.expectedIdentity &&
            (input.expectedIdentity.issuer !== identity.account.issuer ||
              input.expectedIdentity.subject !== identity.account.subject)
          )
            return yield* new PocketIdError({ reason: "subject" });
          // A refresh grant renews access tokens indefinitely; its ID token's `auth_time` is what
          // bounds the sign-in and its `amr` is what proves a passkey, so a host with a limit or a
          // passkey requirement cannot accept a native session without one.
          if (input.idToken !== undefined || maxSessionAgeSeconds !== null || requirePasskey) {
            if (input.idToken === undefined || nativeClientId === null)
              return yield* new PocketIdError({ reason: "token" });
            const claims = yield* verifyIdToken({
              idToken: input.idToken,
              accessToken: input.accessToken,
              audience: nativeClientId,
              requireAtHash: true,
            });
            if (claims.sub !== identity.account.subject)
              return yield* new PocketIdError({ reason: "subject" });
            yield* checkPasskey(claims.amr);
            identity = yield* capSignInAge(identity, claims.auth_time);
          }
        } else {
          const now = yield* DateTime.now;
          const entry = yield* Ref.get(handoffs).pipe(
            Effect.map((values) => values.get(input.code)),
          );
          if (
            !entry ||
            entry.expiresAt <= now.epochMilliseconds ||
            entry.browser.origin !== origin ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)
          )
            return yield* new PocketIdError({ reason: "state" });
          const challenge = Base64Url.encode(
            yield* crypto
              .digest("SHA-256", new TextEncoder().encode(input.verifier))
              .pipe(Effect.orDie),
          );
          if (!timingSafeEqualBase64Url(challenge, entry.browser.challenge))
            return yield* new PocketIdError({ reason: "state" });
          const consumed = yield* Ref.modify(handoffs, (values) => {
            const next = new Map(values);
            const found = next.delete(input.code);
            return [found, next] as const;
          });
          if (!consumed) return yield* new PocketIdError({ reason: "state" });
          identity = entry.identity;
        }
        if (
          input.expectedIdentity &&
          (input.expectedIdentity.issuer !== identity.account.issuer ||
            input.expectedIdentity.subject !== identity.account.subject)
        )
          return yield* new PocketIdError({ reason: "subject" });
        // A revoked device must not renew its way back in; refusing makes it drop its grant.
        if (
          input.type === "native" &&
          currentToken !== undefined &&
          (yield* sessions
            .isRevokedSessionToken(currentToken)
            .pipe(Effect.mapError((cause) => new PocketIdError({ reason: "session", cause }))))
        )
          return yield* new PocketIdError({ reason: "revoked" });
        const session = yield* issue(identity, { client, method: "bearer-access-token" });
        if (input.type === "native" && currentToken !== undefined)
          yield* sessions.linkSuccessor({
            currentToken,
            successor: {
              sessionId: session.sessionId,
              subject: identity.subject,
              method: session.method,
              expiresAt: session.expiresAt,
            },
          });
        const now = yield* DateTime.now;
        return {
          access_token: session.token,
          issued_token_type: AuthAccessTokenType,
          token_type: "Bearer" as const,
          expires_in: Math.max(
            0,
            Math.floor((session.expiresAt.epochMilliseconds - now.epochMilliseconds) / 1000),
          ),
          scope: session.scopes.join(" "),
          environmentId,
          identity: identity.account,
        };
      },
    ),
    exchangeAccessToken: Effect.fn("PocketId.exchangeAccessToken")(function* (input) {
      // Token exchange carries no ID token, so it would let a refresh grant outlive the limit and
      // leaves no `amr` to prove a passkey.
      if (maxSessionAgeSeconds !== null || requirePasskey)
        return yield* new PocketIdError({ reason: "token" });
      const identity = yield* verifyAccessToken(input.token);
      const session = yield* issue(identity, {
        ...input,
        method:
          input.proofKeyThumbprint === undefined ? "bearer-access-token" : "dpop-access-token",
      });
      const now = yield* DateTime.now;
      return {
        access_token: session.token,
        issued_token_type: AuthAccessTokenType,
        token_type: input.proofKeyThumbprint === undefined ? "Bearer" : "DPoP",
        expires_in: Math.max(
          0,
          Math.floor((session.expiresAt.epochMilliseconds - now.epochMilliseconds) / 1000),
        ),
        scope: session.scopes.join(" "),
      };
    }),
  });
});

export const layer = Layer.effect(PocketId, make);
