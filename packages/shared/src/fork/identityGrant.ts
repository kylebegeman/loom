// @effect-diagnostics globalTimers:off -- A Promise API shared by Electron main and React Native; both provide setTimeout, not every runtime has AbortSignal.timeout.
import { sha256 } from "@noble/hashes/sha2";
import { EnvironmentId } from "@t3tools/contracts";
import {
  LOOM_IDENTITY_PASSKEY_REQUIRED,
  LOOM_IDENTITY_SESSION_PATH,
  LOOM_IDENTITY_SIGN_IN_EXPIRED,
  type LoomDesktopSignInResult,
  type LoomIdentityAccount,
  type LoomIdentityDirectoryAddresses,
  type LoomIdentityMetadata,
  LoomIdentitySessionRequest,
  LoomIdentitySessionResult,
  loomIdentityAccount,
} from "@t3tools/contracts/fork";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/**
 * One Pocket ID refresh grant for one computer. A refresh keeps the original audience, and every
 * computer has its own, so a device holds a grant per (issuer, subject, environmentId).
 */
export const IdentityGrant = Schema.Struct({
  version: Schema.Literal(1),
  issuer: Schema.String,
  subject: Schema.String,
  environmentId: EnvironmentId,
  httpBaseUrl: Schema.String,
  clientId: Schema.String,
  /** Recorded from the issuer's discovery document at sign-in, never from a computer. */
  tokenEndpoint: Schema.String,
  endSessionEndpoint: Schema.optional(Schema.String),
  resource: Schema.optional(Schema.String),
  refreshToken: Schema.String,
  idToken: Schema.String,
  /** Epoch milliseconds. */
  grantedAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type IdentityGrant = typeof IdentityGrant.Type;

export interface IdentityGrantStore {
  readonly get: (key: string) => Promise<IdentityGrant | null>;
  readonly put: (grant: IdentityGrant) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
}

/** Only `[a-z0-9.-]`, so the key also works as an iOS Keychain item name. */
export function identityGrantKey(account: {
  readonly issuer: string;
  readonly subject: string;
  readonly environmentId: string;
}): string {
  const parts = encodeKeyParts([account.issuer, account.subject, account.environmentId]);
  return `identity-grant.${Hex.encode(sha256(new TextEncoder().encode(parts)))}`;
}

/** Thrown for failures worth retrying later: network, timeouts, 5xx and unreadable replies. */
export class IdentityGrantTransientError extends Error {
  readonly _tag = "IdentityGrantTransientError";
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "IdentityGrantTransientError";
  }
}

export interface IdentitySignInRequired {
  readonly _tag: "SignInRequired";
  readonly reason: string;
}

export type IdentityGrantFetch = (url: string, init: RequestInit) => Promise<Response>;

export type IdentityGrantRefreshResult =
  | {
      readonly _tag: "Refreshed";
      readonly accessToken: string;
      readonly grant: IdentityGrant;
    }
  | IdentitySignInRequired;

export type IdentityRenewedSession = LoomDesktopSignInResult & {
  readonly identity: LoomIdentityAccount;
  readonly expiresAt: number;
};

export type NativeIdentitySessionResult =
  | { readonly _tag: "Session"; readonly session: IdentityRenewedSession }
  | IdentitySignInRequired;

export type IdentityGrantRenewResult =
  | {
      readonly _tag: "Renewed";
      readonly grant: IdentityGrant;
      readonly session: IdentityRenewedSession;
    }
  | IdentitySignInRequired;

const REQUEST_TIMEOUT_MS = 15_000;
const END_SESSION_TIMEOUT_MS = 10_000;
const MAX_SESSION_SECONDS = 3600;

/**
 * The native authorization request's `max_age` for a computer that caps sign-in age. It makes the
 * provider sign in afresh rather than reuse a browser session whose `auth_time` is near the cap,
 * leaving at least one full computer session, as the computer's own browser sign-in does.
 */
export function identitySignInMaxAge(maxSessionAgeSeconds: number): string {
  return String(Math.max(0, Math.floor(maxSessionAgeSeconds) - MAX_SESSION_SECONDS));
}

/**
 * Pocket ID reapplies the browser session's sign-in method to every grant, so signing in again
 * only helps once that session ends.
 */
export const IDENTITY_PASSKEY_REQUIRED_TEXT =
  "This computer accepts passkey sign-ins only. Sign out of Loom Identity in your browser, then sign in with your passkey.";

/** A provider that ignores `max_age` hands back its old browser sign-in, past the computer's cap. */
export const IDENTITY_FRESH_SIGN_IN_TEXT =
  "This computer needs a fresh Loom sign-in. Sign out of Loom Identity in your browser, then sign in again.";

/**
 * Reach resources are the likeliest cause: values copied from another computer's Reach section,
 * whose button copies them as "sign-in values".
 */
export const IDENTITY_RESOURCE_MISMATCH_TEXT =
  "This computer's Loom sign-in is set up for a different computer. Copy the sign-in values from this computer's own Reach section, then restart Loom on it.";

/** The path of the resource the Library derives for each computer (`reachResource`). */
const PER_COMPUTER_RESOURCE_PATH = /^\/computers\/([^/]+)$/u;

/**
 * The environment a per-computer resource names, or null for any other value, such as an audience
 * several computers share. Trailing slashes go first because Pocket ID strips them before its
 * lookup, so `<resource>/` still reaches that computer's resource.
 */
export function identityResourceEnvironment(resource: string): string | null {
  let url: URL;
  try {
    url = new URL(resource.replace(/\/+$/u, ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return PER_COMPUTER_RESOURCE_PATH.exec(url.pathname)?.[1] ?? null;
}

/**
 * Null when a computer may receive the sign-in it asks for, else the refusal line. Check it, after
 * confirming the metadata names the expected computer, before the provider opens. Only another
 * computer's own resource is refused, since that computer accepts the token. A shared audience
 * passes, so a computer can move to its own resource and back.
 */
export function identityResourceRefusal(
  metadata: Pick<LoomIdentityMetadata, "audience" | "resource" | "environmentId">,
): string | null {
  const owner = identityResourceEnvironment(metadata.resource || metadata.audience);
  return owner === null || owner === metadata.environmentId
    ? null
    : IDENTITY_RESOURCE_MISMATCH_TEXT;
}

const DEFAULT_PORTS: Readonly<Record<string, string>> = { "http:": "80", "https:": "443" };

/**
 * An address in the form sign-in compares: scheme, lowercase host without a trailing dot (a fully
 * qualified name reaches the same host), and a port only when it is not the scheme's default.
 * The path never matters, since sign-in always uses the origin. Null for anything not http(s).
 */
export function identityAddressOrigin(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (host === "") return null;
  const port = url.port === DEFAULT_PORTS[url.protocol] ? "" : url.port;
  return `${url.protocol}//${host}${port ? `:${port}` : ""}`;
}

/**
 * Null when a native first sign-in to a typed address may go ahead, else the refusal line. Check it
 * with the environment the metadata claims, before any token request. Metadata can be copied, so a
 * computer the Library knows must be at one of its directory routes or this device's Library
 * addresses. An unknown computer, or no directory, passes.
 */
export function identityAddressRefusal(input: {
  readonly httpBaseUrl: string;
  readonly environmentId: string;
  readonly directory: LoomIdentityDirectoryAddresses | null | undefined;
}): string | null {
  const { directory, environmentId } = input;
  if (!directory) return null;
  const library = directory.library.environmentId === environmentId ? directory.library : null;
  const listed = directory.computers.filter((computer) => computer.environmentId === environmentId);
  const known = [
    ...(library?.addresses ?? []),
    ...listed.flatMap((computer) => computer.addresses),
  ];
  if (listed.length === 0 && known.length === 0) return null;
  const typed = identityAddressOrigin(input.httpBaseUrl);
  if (typed !== null && known.some((address) => identityAddressOrigin(address) === typed))
    return null;
  // The Library goes by the name this device saved it under; a computer by its reported name.
  const label = (library?.label.trim() || listed[0]?.label.trim()) ?? "";
  if (library !== null)
    return label
      ? `This address says it is your Library, ${label}, but this device knows ${label} at other addresses. Sign in at its saved address, or use a pairing link.`
      : "This address says it is your Library, but this device knows your Library at other addresses. Sign in at its saved address, or use a pairing link.";
  const name = label || "this computer";
  return known.length > 0
    ? `This address says it is ${name}, but your Library lists ${name} at other addresses. Sign in from your Library's computer list, or use a pairing link.`
    : `This address says it is ${name}, but your Library has no address for ${name}. Use a pairing link.`;
}

const encodeKeyParts = Schema.encodeSync(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String, Schema.String])),
);
const encodeSessionRequest = Schema.encodeSync(Schema.fromJsonString(LoomIdentitySessionRequest));
const decodeErrorCode = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ error: Schema.String })),
);
// Every field is optional so a JSON reply missing one is a final answer, not a retry.
const decodeTokenReply = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      token_type: Schema.optional(Schema.String),
      access_token: Schema.optional(Schema.String),
      id_token: Schema.optional(Schema.String),
      refresh_token: Schema.optional(Schema.String),
    }),
  ),
);
const decodeSessionReply = Schema.decodeUnknownOption(
  Schema.fromJsonString(LoomIdentitySessionResult),
);
const decodeAccessClaims = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ exp: Schema.optional(Schema.Number) })),
);

const DEVICE_REFUSED_TEXT = "Loom Identity no longer accepts this device's sign-in. Sign in again.";
/**
 * Token endpoint errors that no retry fixes. Pocket ID rechecks a refresh grant's resource and the
 * client's access to it, so a resource deleted by Retire answers `invalid_target` and a revoked
 * grant `access_denied` (403).
 */
const REFRESH_REFUSALS: ReadonlyMap<string, string> = new Map([
  ["invalid_grant", "Your Loom sign-in ended. Sign in again."],
  ["invalid_client", DEVICE_REFUSED_TEXT],
  ["unauthorized_client", DEVICE_REFUSED_TEXT],
  ["access_denied", DEVICE_REFUSED_TEXT],
  ["invalid_target", "This computer's Loom sign-in changed. Sign in again."],
]);

const signInRequired = (reason: string): IdentitySignInRequired => ({
  _tag: "SignInRequired",
  reason,
});

async function withTimeout<A>(ms: number, run: (signal: AbortSignal) => Promise<A>): Promise<A> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    return await run(abort.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function send(
  fetch: IdentityGrantFetch,
  url: string,
  init: RequestInit,
  failure: string,
): Promise<{ readonly status: number; readonly body: string }> {
  try {
    return await withTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await fetch(url, { ...init, signal });
      return { status: response.status, body: await response.text() };
    });
  } catch (cause) {
    throw new IdentityGrantTransientError(failure, { cause });
  }
}

function accessTokenExpiresAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (payload === undefined) return null;
  const text = Base64Url.decodeString(payload);
  if (Result.isFailure(text)) return null;
  const exp = Option.getOrUndefined(decodeAccessClaims(text.success))?.exp;
  return exp === undefined ? null : exp * 1000;
}

/**
 * Rotates the grant at the issuer's token endpoint, the only place its refresh token is sent.
 * Pocket ID revokes the whole grant when a rotated token is replayed after a minute, so callers
 * must run this single-flight per grant and persist the returned grant before using it.
 */
export async function refreshIdentityGrant(
  grant: IdentityGrant,
  options: { readonly fetch: IdentityGrantFetch; readonly now: () => number },
): Promise<IdentityGrantRefreshResult> {
  const reply = await send(
    options.fetch,
    grant.tokenEndpoint,
    {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: grant.refreshToken,
        client_id: grant.clientId,
        ...(grant.resource ? { resource: grant.resource } : {}),
      }).toString(),
    },
    "Could not reach Loom Identity to renew access.",
  );
  if (reply.status >= 400 && reply.status < 500) {
    const code = Option.getOrUndefined(decodeErrorCode(reply.body))?.error;
    const reason = code === undefined ? undefined : REFRESH_REFUSALS.get(code);
    if (reason !== undefined) return signInRequired(reason);
  }
  if (reply.status < 200 || reply.status >= 300)
    throw new IdentityGrantTransientError(
      `Loom Identity could not renew access (HTTP ${reply.status}).`,
    );
  const tokens = decodeTokenReply(reply.body);
  if (Option.isNone(tokens))
    throw new IdentityGrantTransientError("Loom Identity returned an unreadable renewal.");
  const { token_type, access_token, id_token, refresh_token } = tokens.value;
  if (token_type?.toLowerCase() !== "bearer" || !access_token || !id_token)
    return signInRequired("Loom Identity returned an incomplete renewal. Sign in again.");
  return {
    _tag: "Refreshed",
    accessToken: access_token,
    grant: {
      ...grant,
      refreshToken: refresh_token || grant.refreshToken,
      idToken: id_token,
      updatedAt: options.now(),
    },
  };
}

/** Trades fresh Identity tokens for a computer session at that computer's native endpoint. */
export async function exchangeNativeIdentitySession(input: {
  readonly httpBaseUrl: string;
  readonly environmentId: EnvironmentId;
  readonly accessToken: string;
  readonly idToken: string;
  readonly expectedIdentity: LoomIdentityAccount;
  /** The computer carries its open WebSocket over from this session to the new one. */
  readonly currentToken?: string | null | undefined;
  readonly fetch: IdentityGrantFetch;
  readonly now: () => number;
}): Promise<NativeIdentitySessionResult> {
  const accessExpiresAt = accessTokenExpiresAt(input.accessToken);
  if (accessExpiresAt === null || accessExpiresAt <= input.now())
    return signInRequired("Identity access expired. Sign in again.");
  const origin = new URL(input.httpBaseUrl).origin;
  const reply = await send(
    input.fetch,
    `${origin}${LOOM_IDENTITY_SESSION_PATH}`,
    {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(input.currentToken ? { authorization: `Bearer ${input.currentToken}` } : {}),
      },
      body: encodeSessionRequest({
        type: "native",
        accessToken: input.accessToken,
        idToken: input.idToken,
        environmentId: input.environmentId,
        expectedIdentity: input.expectedIdentity,
      }),
    },
    "Could not reach this computer to renew Loom access.",
  );
  const refusal = reply.status === 401 ? Option.getOrUndefined(decodeErrorCode(reply.body)) : null;
  if (refusal?.error === LOOM_IDENTITY_SIGN_IN_EXPIRED)
    return signInRequired("Your Loom sign-in reached its time limit. Sign in again.");
  if (refusal?.error === LOOM_IDENTITY_PASSKEY_REQUIRED)
    return signInRequired(IDENTITY_PASSKEY_REQUIRED_TEXT);
  if (reply.status >= 500 || reply.status === 408 || reply.status === 429)
    throw new IdentityGrantTransientError(
      `This computer could not renew Loom access (HTTP ${reply.status}).`,
    );
  // Renewal may use any of a computer's addresses, and one that now reaches another server must
  // not cost the grant; only a refusal from Loom itself carries its error document.
  if ((reply.status < 200 || reply.status >= 300) && Option.isNone(decodeErrorCode(reply.body)))
    throw new IdentityGrantTransientError(
      `This address did not answer as a Loom computer (HTTP ${reply.status}).`,
    );
  if (reply.status < 200 || reply.status >= 300)
    return signInRequired("This computer did not accept the Loom sign-in. Sign in again.");
  const session = decodeSessionReply(reply.body);
  if (Option.isNone(session))
    throw new IdentityGrantTransientError("This computer returned an unreadable Loom session.");
  const issued = session.value;
  if (
    issued.environmentId !== input.environmentId ||
    issued.identity.issuer !== input.expectedIdentity.issuer ||
    issued.identity.subject !== input.expectedIdentity.subject
  )
    return signInRequired(
      "This computer returned a session for another computer or Loom account. Sign in again.",
    );
  if (
    issued.token_type !== "Bearer" ||
    issued.expires_in <= 0 ||
    issued.expires_in > MAX_SESSION_SECONDS
  )
    return signInRequired("This computer returned an unsupported Loom session. Sign in again.");
  return {
    _tag: "Session",
    session: {
      httpBaseUrl: origin,
      environmentId: issued.environmentId,
      accessToken: issued.access_token,
      identity: loomIdentityAccount(issued.identity),
      expiresAt: Math.min(
        input.now() + Math.min(issued.expires_in, MAX_SESSION_SECONDS) * 1000,
        accessExpiresAt,
      ),
    },
  };
}

/** Refreshes the grant, persists the rotation, then exchanges the new tokens at the computer. */
export async function renewIdentityGrant(
  grant: IdentityGrant,
  options: {
    readonly currentToken?: string | null | undefined;
    /**
     * Any address of the computer the grant was made for; the reply must still name its
     * environment and account. Defaults to the address used at sign-in.
     */
    readonly httpBaseUrl?: string | undefined;
    readonly fetch: IdentityGrantFetch;
    readonly now: () => number;
    /** Must durably save the rotated grant; the previous refresh token dies a minute later. */
    readonly onRotated: (grant: IdentityGrant) => Promise<void>;
  },
): Promise<IdentityGrantRenewResult> {
  const refreshed = await refreshIdentityGrant(grant, options);
  if (refreshed._tag === "SignInRequired") return refreshed;
  try {
    await options.onRotated(refreshed.grant);
  } catch (cause) {
    throw new IdentityGrantTransientError("Could not save the renewed Loom sign-in.", { cause });
  }
  const exchanged = await exchangeNativeIdentitySession({
    httpBaseUrl: options.httpBaseUrl ?? grant.httpBaseUrl,
    environmentId: grant.environmentId,
    accessToken: refreshed.accessToken,
    idToken: refreshed.grant.idToken,
    expectedIdentity: { issuer: grant.issuer, subject: grant.subject },
    currentToken: options.currentToken,
    fetch: options.fetch,
    now: options.now,
  });
  if (exchanged._tag === "SignInRequired") return exchanged;
  return { _tag: "Renewed", grant: refreshed.grant, session: exchanged.session };
}

/**
 * Pocket ID has no revocation endpoint, so ending its session with the grant's ID token is how a
 * device ends the grant. Best effort: the caller forgets the grant locally either way.
 */
export async function endIdentityGrant(
  grant: IdentityGrant,
  options: { readonly fetch: IdentityGrantFetch },
): Promise<void> {
  const endpoint = grant.endSessionEndpoint;
  if (!endpoint) return;
  const query = new URLSearchParams({
    id_token_hint: grant.idToken,
    client_id: grant.clientId,
  }).toString();
  try {
    await withTimeout(END_SESSION_TIMEOUT_MS, (signal) =>
      options.fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}${query}`, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        signal,
      }),
    );
  } catch {
    // The endpoint always answers with a redirect; any failure leaves only a local forget.
  }
}

/**
 * Concurrent callers for one key share one in-flight promise, cleared once it settles. Read the
 * stored grant inside `run`, so a caller that waited never replays a refresh token already rotated.
 */
export function makeKeyedSingleFlight<A>() {
  const inFlight = new Map<string, Promise<A>>();
  return (key: string, run: () => Promise<A>): Promise<A> => {
    const current = inFlight.get(key);
    if (current) return current;
    const next = Promise.resolve()
      .then(run)
      .finally(() => {
        if (inFlight.get(key) === next) inFlight.delete(key);
      });
    inFlight.set(key, next);
    return next;
  };
}
