// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalFetch:off globalDate:off - Native OAuth owns a bounded loopback listener with abort cleanup.
import * as NodeHttp from "node:http";
import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
import {
  AuthAccessTokenResult,
  AuthAccessTokenType,
  AuthTokenExchangeGrantType,
} from "@t3tools/contracts";
import {
  LoomIdentityMetadata,
  LOOM_IDENTITY_METADATA_PATH,
  type LoomDesktopSignInResult,
  type LoomDesktopSignInRequest,
  LoomIdentitySessionResult,
  LOOM_IDENTITY_SESSION_PATH,
} from "@t3tools/contracts/fork";

const decodeMetadata = Schema.decodeUnknownSync(LoomIdentityMetadata);
const decodeIdentitySession = Schema.decodeUnknownSync(LoomIdentitySessionResult);
const decodeSession = Schema.decodeUnknownSync(AuthAccessTokenResult);
const decodeDiscovery = Schema.decodeUnknownSync(
  Schema.Struct({
    issuer: Schema.String,
    authorization_endpoint: Schema.String,
    token_endpoint: Schema.String,
    jwks_uri: Schema.String,
  }),
);
const decodeTokens = Schema.decodeUnknownSync(
  Schema.Struct({
    access_token: Schema.String,
    id_token: Schema.String,
    token_type: Schema.String,
  }),
);
const SIGN_IN_TIMEOUT_MS = 300_000;
const HTTP_TIMEOUT_MS = 15_000;
const activeSignIns = new Map<string, AbortController>();

export function loomHostOrigin(value: string) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Choose an http or https computer address without URL credentials.");
  return url.origin;
}

export function loomLoopbackRedirect(value?: string) {
  const uri = new URL(value ?? "http://127.0.0.1:0/loom/identity/callback");
  if (
    uri.protocol !== "http:" ||
    uri.hostname !== "127.0.0.1" ||
    uri.username ||
    uri.password ||
    uri.search ||
    uri.hash ||
    uri.pathname === "/"
  )
    throw new Error("Loom desktop sign-in needs a registered http://127.0.0.1 loopback callback.");
  return uri;
}

export function loomNativeAuthorization(input: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
  scopes: readonly string[];
  resource?: string;
}) {
  const url = new URL(input.authorizationEndpoint);
  url.search = "";
  const parameters = {
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: [
      ...new Set(["openid", ...input.scopes.filter((scope) => scope !== "offline_access")]),
    ].join(" "),
    state: input.state,
    nonce: input.nonce,
    code_challenge: NodeCrypto.createHash("sha256").update(input.verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...(input.resource ? { resource: input.resource } : {}),
  };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.href;
}

function loomCallbackUrl(value: string, redirectUri: string, state: string) {
  const url = new URL(value, redirectUri);
  const expected = new URL(redirectUri);
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.get("state") !== state
  )
    throw new Error("This response does not belong to the active Loom sign-in.");
  return url;
}

export function loomCallbackCode(value: string, redirectUri: string, state: string) {
  const url = loomCallbackUrl(value, redirectUri, state);
  if (url.searchParams.has("error")) throw new Error("Loom sign-in was declined. Try again.");
  const codes = url.searchParams.getAll("code");
  if (codes.length !== 1 || !codes[0])
    throw new Error("Loom sign-in did not return an authorization code.");
  return codes[0];
}

export async function verifyLoomIdToken(
  idToken: string,
  metadata: { issuer: string; clientId: string; jwksUri: string; nonce: string },
) {
  const verified = await jwtVerify(
    idToken,
    createRemoteJWKSet(new URL(metadata.jwksUri), { timeoutDuration: HTTP_TIMEOUT_MS }),
    {
      issuer: metadata.issuer,
      audience: metadata.clientId,
      algorithms: ["RS256", "ES256", "EdDSA"],
      clockTolerance: 30,
      maxTokenAge: "5m",
    },
  );
  if (
    verified.payload.nonce !== metadata.nonce ||
    typeof verified.payload.sub !== "string" ||
    (verified.payload.azp !== undefined && verified.payload.azp !== metadata.clientId) ||
    (Array.isArray(verified.payload.aud) &&
      verified.payload.aud.length > 1 &&
      verified.payload.azp !== metadata.clientId) ||
    verified.payload.exp === undefined ||
    verified.payload.iat === undefined
  )
    throw new Error("The Loom sign-in response could not be verified. Try again.");
  return verified.payload.sub;
}

async function jsonRequest(url: string, init: RequestInit, signal: AbortSignal) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)]),
  });
  if (!response.ok)
    throw new Error(
      "The Loom sign-in service rejected the request. Check the computer address and account access, then try again.",
    );
  return response.json() as Promise<unknown>;
}

export function cancelLoomSignIn(httpBaseUrl: string) {
  activeSignIns.get(loomHostOrigin(httpBaseUrl))?.abort();
}

/** Credentials stay in the main process until the host verifies the account and issues its own session. */
export async function signInToLoom(
  httpBaseUrl: string,
  openBrowser: (url: string) => Promise<boolean>,
  signal?: AbortSignal,
  expected?: Pick<LoomDesktopSignInRequest, "expectedEnvironmentId" | "expectedIdentity">,
): Promise<LoomDesktopSignInResult> {
  const origin = loomHostOrigin(httpBaseUrl);
  if (activeSignIns.has(origin)) throw new Error("Loom sign-in is already open for this computer.");
  const abort = new AbortController();
  const interrupted = () => abort.abort();
  signal?.addEventListener("abort", interrupted, { once: true });
  activeSignIns.set(origin, abort);
  let server: NodeHttp.Server | null = null;
  const timer = setTimeout(() => abort.abort(), SIGN_IN_TIMEOUT_MS);
  timer.unref();
  try {
    if (signal?.aborted) throw new Error("Loom sign-in cancelled.");
    const metadata = decodeMetadata(
      await jsonRequest(`${origin}${LOOM_IDENTITY_METADATA_PATH}`, {}, abort.signal),
    );
    if (
      !metadata.enabled ||
      !metadata.nativeClientId ||
      !metadata.issuer ||
      !metadata.authorizationEndpoint ||
      !metadata.tokenEndpoint
    )
      throw new Error("This computer has not enabled native Loom account sign-in.");
    if (
      expected?.expectedEnvironmentId &&
      expected.expectedEnvironmentId !== metadata.environmentId
    )
      throw new Error("This address reaches another computer. Review the saved connection.");
    if (expected?.expectedIdentity && expected.expectedIdentity.issuer !== metadata.issuer)
      throw new Error(
        "This computer's Identity provider changed. Remove the saved connection before signing in again.",
      );
    const discovery = decodeDiscovery(
      await jsonRequest(
        `${metadata.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
        {},
        abort.signal,
      ),
    );
    if (
      discovery.issuer !== metadata.issuer ||
      discovery.authorization_endpoint !== metadata.authorizationEndpoint ||
      discovery.token_endpoint !== metadata.tokenEndpoint
    )
      throw new Error("The computer Identity configuration changed. Reload and try again.");
    const state = NodeCrypto.randomBytes(32).toString("base64url");
    const nonce = NodeCrypto.randomBytes(32).toString("base64url");
    const verifier = NodeCrypto.randomBytes(32).toString("base64url");
    const redirect = loomLoopbackRedirect(metadata.desktopRedirectUri);
    const callback = Promise.withResolvers<string>();
    void callback.promise.catch(() => undefined);
    let consumed = false;
    server = NodeHttp.createServer((incoming, response) => {
      try {
        if (incoming.method !== "GET" || consumed || incoming.headers.host !== redirect.host)
          throw new Error("callback");
        loomCallbackUrl(incoming.url ?? "/", redirect.href, state);
      } catch {
        response
          .writeHead(400, { "content-type": "text/plain; charset=utf-8" })
          .end("This response does not belong to the active Loom sign-in.");
        return;
      }
      // Only a callback bound to this attempt can settle it, including a provider denial.
      consumed = true;
      response.setHeader("cache-control", "no-store");
      response.setHeader("referrer-policy", "no-referrer");
      response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
      try {
        const code = loomCallbackCode(incoming.url ?? "/", redirect.href, state);
        response
          .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
          .end(
            "Return to Loom. Your sign-in response was received and the connection is being verified. You can close this tab.",
          );
        callback.resolve(code);
      } catch (cause) {
        response
          .writeHead(400, { "content-type": "text/plain; charset=utf-8" })
          .end("Loom sign-in did not complete. Return to Loom to try again.");
        callback.reject(cause);
      }
    });
    const ownedServer = server;
    const cancelled = () =>
      callback.reject(new Error("Loom sign-in cancelled or expired. Try again."));
    abort.signal.addEventListener("abort", cancelled, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        ownedServer.once("error", () =>
          reject(
            new Error(
              "The Loom callback port is unavailable. Close the other sign-in and try again.",
            ),
          ),
        );
        ownedServer.listen(Number(redirect.port), "127.0.0.1", resolve);
      });
      const address = ownedServer.address();
      if (!address || typeof address === "string")
        throw new Error("Could not start the Loom sign-in callback.");
      redirect.port = String(address.port);
      if (abort.signal.aborted) throw new Error("Loom sign-in cancelled.");
      const authorizationUrl = loomNativeAuthorization({
        authorizationEndpoint: metadata.authorizationEndpoint,
        clientId: metadata.nativeClientId,
        redirectUri: redirect.href,
        state,
        nonce,
        verifier,
        scopes: metadata.scopes,
        ...(metadata.resource ? { resource: metadata.resource } : {}),
      });
      if (!(await openBrowser(authorizationUrl)))
        throw new Error("Could not open the sign-in browser.");
      const code = await callback.promise;
      let tokens: ReturnType<typeof decodeTokens>;
      try {
        tokens = decodeTokens(
          await jsonRequest(
            metadata.tokenEndpoint,
            {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                client_id: metadata.nativeClientId,
                redirect_uri: redirect.href,
                code_verifier: verifier,
              }).toString(),
            },
            abort.signal,
          ),
        );
      } catch {
        throw new Error("The identity provider did not return a valid sign-in response.");
      }
      if (tokens.token_type.toLowerCase() !== "bearer")
        throw new Error("The identity provider returned an unsupported token type.");
      const subject = await verifyLoomIdToken(tokens.id_token, {
        issuer: metadata.issuer,
        clientId: metadata.nativeClientId,
        jwksUri: discovery.jwks_uri,
        nonce,
      });
      if (expected?.expectedIdentity && expected.expectedIdentity.subject !== subject)
        throw new Error(
          "Sign in with the saved Identity account, or remove this connection to choose another account.",
        );
      const accessClaims = decodeJwt(tokens.access_token);
      if (typeof accessClaims.exp !== "number" || accessClaims.exp * 1000 <= Date.now())
        throw new Error("Identity access expired. Sign in again.");
      if (accessClaims.sub !== subject)
        throw new Error("The sign-in tokens do not identify the same Loom account.");
      const current = decodeMetadata(
        await jsonRequest(`${origin}${LOOM_IDENTITY_METADATA_PATH}`, {}, abort.signal),
      );
      if (
        current.environmentId !== metadata.environmentId ||
        current.issuer !== metadata.issuer ||
        current.nativeClientId !== metadata.nativeClientId ||
        current.audience !== metadata.audience ||
        current.resource !== metadata.resource ||
        current.authorizationEndpoint !== metadata.authorizationEndpoint ||
        current.tokenEndpoint !== metadata.tokenEndpoint ||
        current.sessionExchangeEnabled !== metadata.sessionExchangeEnabled
      )
        throw new Error("The computer's Identity configuration changed. Retry sign-in.");
      let session: ReturnType<typeof decodeSession>;
      try {
        session = metadata.sessionExchangeEnabled
          ? decodeIdentitySession(
              await jsonRequest(
                `${origin}${LOOM_IDENTITY_SESSION_PATH}`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    type: "native",
                    accessToken: tokens.access_token,
                    environmentId: metadata.environmentId,
                    ...(expected?.expectedIdentity
                      ? { expectedIdentity: expected.expectedIdentity }
                      : {}),
                  }),
                },
                abort.signal,
              ),
            )
          : decodeSession(
              await jsonRequest(
                `${origin}/oauth/token`,
                {
                  method: "POST",
                  headers: { "content-type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({
                    grant_type: AuthTokenExchangeGrantType,
                    subject_token: tokens.access_token,
                    subject_token_type: AuthAccessTokenType,
                    requested_token_type: AuthAccessTokenType,
                    client_label: "Loom Desktop",
                    client_device_type: "desktop",
                  }).toString(),
                },
                abort.signal,
              ),
            );
      } catch {
        throw new Error(
          "This Loom account is not authorized for this computer, or its session could not be issued.",
        );
      }
      if (metadata.sessionExchangeEnabled) {
        const enrolled = decodeIdentitySession(session);
        if (
          enrolled.environmentId !== metadata.environmentId ||
          enrolled.identity.issuer !== metadata.issuer ||
          enrolled.identity.subject !== subject
        )
          throw new Error(
            "The computer returned a session for another environment or Identity account.",
          );
      }
      if (session.token_type !== "Bearer" || session.expires_in <= 0)
        throw new Error("The computer returned an unsupported desktop session type.");
      return {
        httpBaseUrl: origin,
        environmentId: metadata.environmentId,
        accessToken: session.access_token,
        identity: { issuer: metadata.issuer, subject },
        expiresAt: Math.min(
          Date.now() + Math.min(session.expires_in, 3600) * 1000,
          (accessClaims.exp ?? 0) * 1000,
        ),
      };
    } finally {
      abort.signal.removeEventListener("abort", cancelled);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", interrupted);
    activeSignIns.delete(origin);
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  }
}
