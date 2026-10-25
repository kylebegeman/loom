import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
} from "@t3tools/client-runtime/connection";
import {
  AuthAccessTokenResult,
  AuthAccessTokenType,
  AuthTokenExchangeGrantType,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  LOOM_IDENTITY_METADATA_PATH,
  LOOM_IDENTITY_SESSION_PATH,
  LoomIdentityMetadata,
  LoomIdentitySessionResult,
  type LoomIdentityAccount,
  type LoomIdentityDirectoryAddresses,
  LOOM_IDENTITY_PASSKEY_REQUIRED,
  LOOM_IDENTITY_SIGN_IN_EXPIRED,
} from "@t3tools/contracts/fork";
import {
  IDENTITY_FRESH_SIGN_IN_TEXT,
  IDENTITY_PASSKEY_REQUIRED_TEXT,
  type IdentityGrant,
  identityAddressOrigin,
  identityAddressRefusal,
  identityGrantKey,
  identityResourceRefusal,
  identitySignInMaxAge,
} from "@t3tools/shared/fork/identity-grant";
import * as Schema from "effect/Schema";

const decodeMetadata = Schema.decodeUnknownSync(LoomIdentityMetadata);
const decodeToken = Schema.decodeUnknownSync(AuthAccessTokenResult);
const decodeIdentitySession = Schema.decodeUnknownSync(LoomIdentitySessionResult);
const decodeDiscovery = Schema.decodeUnknownSync(
  Schema.Struct({
    issuer: Schema.String,
    authorization_endpoint: Schema.String,
    token_endpoint: Schema.String,
    end_session_endpoint: Schema.optional(Schema.String),
  }),
);

export function libraryIdentityResourceParameters(
  metadata: LoomIdentityMetadata,
): Record<string, string> {
  return metadata.resource ? { resource: metadata.resource } : {};
}

/** The entered host is the destination; directory membership does not authorize access. */
export function libraryIdentityAddress(address: string) {
  const trimmed = address.trim();
  const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error("Enter the computer's HTTP or HTTPS address without a path or credentials.");
  const ws = new URL("/ws", url);
  ws.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return { httpBaseUrl: url.origin, wsBaseUrl: ws.toString() };
}

/**
 * Whether a sign-in address gets the Library's address check: anything but an address this device
 * already saved for the computer it is signing in to again, which may be one the Library never
 * lists, such as a home network address.
 */
export function identityAddressNeedsCheck(
  address: string,
  savedAddresses: ReadonlyArray<string | undefined>,
): boolean {
  let typed: string | null;
  try {
    typed = identityAddressOrigin(libraryIdentityAddress(address).httpBaseUrl);
  } catch {
    return true;
  }
  return !savedAddresses.some(
    (saved) => saved !== undefined && typed !== null && identityAddressOrigin(saved) === typed,
  );
}

function secureIdentityEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("The computer returned an insecure Identity configuration.");
  return url;
}

/** Only ending a grant uses these, so an unusable one is dropped instead of failing sign-in. */
function optionalSecureIdentityEndpoint(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    secureIdentityEndpoint(value);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Only a computer that caps sign-in age makes a refresh grant end, so only there does the phone
 * ask for one with `offline_access`; the metadata's scope list never adds it.
 */
export function nativeIdentityRenewable(metadata: LoomIdentityMetadata): boolean {
  return metadata.sessionExchangeEnabled === true && metadata.maxSessionAgeSeconds !== undefined;
}

export function nativeIdentityScopes(metadata: LoomIdentityMetadata): ReadonlyArray<string> {
  return [
    ...new Set([
      "openid",
      ...metadata.scopes.filter((scope) => scope !== "offline_access"),
      ...(nativeIdentityRenewable(metadata) ? ["offline_access"] : []),
    ]),
  ];
}

/** The authorization request's extra parameters; the code exchange takes only the resource. */
export function nativeIdentityAuthorizationParameters(
  metadata: LoomIdentityMetadata,
): Record<string, string> {
  return {
    ...libraryIdentityResourceParameters(metadata),
    ...(metadata.maxSessionAgeSeconds === undefined
      ? {}
      : { max_age: identitySignInMaxAge(metadata.maxSessionAgeSeconds) }),
  };
}

export type IdentityOptions = {
  readonly expectedIdentity?: LoomIdentityAccount;
  /**
   * The issuer this computer must use, checked before the provider sign-in opens. A computer
   * found through the Library's directory is pinned to the Library's own issuer.
   */
  readonly expectedIssuer?: string;
  /**
   * For an address the user typed: where the Library says its computers are. A computer it
   * knows at other addresses is refused before the provider opens (`identityAddressRefusal`).
   */
  readonly directory?: LoomIdentityDirectoryAddresses | null;
  readonly requireSessionExchange?: boolean;
  readonly signal?: AbortSignal;
};

export async function loadLibraryIdentity(
  httpBaseUrl: string,
  expectedEnvironmentId?: EnvironmentId,
  request: typeof fetch = fetch,
  options: IdentityOptions = {},
) {
  const response = await request(new URL(LOOM_IDENTITY_METADATA_PATH, httpBaseUrl), {
    redirect: "error",
    headers: { Accept: "application/json" },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw new Error("The computer's sign-in settings could not be loaded.");
  let metadata: LoomIdentityMetadata;
  try {
    metadata = decodeMetadata(await response.json());
  } catch {
    throw new Error("The computer returned invalid sign-in settings.");
  }
  if (expectedEnvironmentId && metadata.environmentId !== expectedEnvironmentId)
    throw new Error("This address reaches another computer. Review the selected connection.");
  const addressRefusal = identityAddressRefusal({
    httpBaseUrl,
    environmentId: metadata.environmentId,
    directory: options.directory,
  });
  if (addressRefusal !== null) throw new Error(addressRefusal);
  if (
    !metadata.enabled ||
    !metadata.nativeClientId ||
    !metadata.issuer ||
    !metadata.authorizationEndpoint ||
    !metadata.tokenEndpoint
  )
    throw new Error(
      "Native Identity sign-in is not configured on this computer. Use pairing or contact its administrator.",
    );
  if (options.requireSessionExchange && !metadata.sessionExchangeEnabled)
    throw new Error(
      "Update this computer to enable Identity account binding, or use a pairing link.",
    );
  if (options.expectedIdentity && metadata.issuer !== options.expectedIdentity.issuer)
    throw new Error(
      "This computer's Identity provider changed. Remove the saved connection before signing in again.",
    );
  if (options.expectedIssuer !== undefined && metadata.issuer !== options.expectedIssuer)
    throw new Error("This computer uses a different sign-in provider than your Library.");
  const resourceRefusal = identityResourceRefusal(metadata);
  if (resourceRefusal !== null) throw new Error(resourceRefusal);
  secureIdentityEndpoint(metadata.issuer);
  secureIdentityEndpoint(metadata.authorizationEndpoint);
  secureIdentityEndpoint(metadata.tokenEndpoint);
  return {
    ...metadata,
    nativeClientId: metadata.nativeClientId,
    issuer: metadata.issuer,
    authorizationEndpoint: metadata.authorizationEndpoint,
    tokenEndpoint: metadata.tokenEndpoint,
  };
}

export async function loadNativeIdentityDiscovery(
  metadata: LoomIdentityMetadata,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  if (!metadata.issuer) throw new Error("Identity issuer is missing.");
  const response = await request(
    `${secureIdentityEndpoint(metadata.issuer).href.replace(/\/$/, "")}/.well-known/openid-configuration`,
    { redirect: "error", ...(signal ? { signal } : {}) },
  );
  if (!response.ok) throw new Error("The Identity provider configuration could not be loaded.");
  const discovery = decodeDiscovery(await response.json());
  if (
    discovery.issuer !== metadata.issuer ||
    discovery.authorization_endpoint !== metadata.authorizationEndpoint ||
    discovery.token_endpoint !== metadata.tokenEndpoint
  )
    throw new Error("The computer's Identity configuration changed. Reload and try again.");
  const endSessionEndpoint = optionalSecureIdentityEndpoint(discovery.end_session_endpoint);
  return {
    authorizationEndpoint: discovery.authorization_endpoint,
    tokenEndpoint: discovery.token_endpoint,
    ...(endSessionEndpoint ? { endSessionEndpoint } : {}),
  };
}

/** Recheck before sending an account token to the selected host after an interactive sign-in. */
export function assertNativeIdentityUnchanged(
  before: LoomIdentityMetadata,
  after: LoomIdentityMetadata,
) {
  if (
    before.environmentId !== after.environmentId ||
    before.issuer !== after.issuer ||
    before.nativeClientId !== after.nativeClientId ||
    before.audience !== after.audience ||
    before.resource !== after.resource ||
    before.authorizationEndpoint !== after.authorizationEndpoint ||
    before.tokenEndpoint !== after.tokenEndpoint ||
    before.sessionExchangeEnabled !== after.sessionExchangeEnabled
  )
    throw new Error("The computer's Identity configuration changed. Retry sign-in.");
}

export async function exchangeLibraryIdentityToken(
  httpBaseUrl: string,
  accessToken: string,
  request: typeof fetch = fetch,
  options?: IdentityOptions & {
    readonly metadata: LoomIdentityMetadata;
    /** Carries `auth_time`, which the computer uses to cap how long a renewed sign-in lasts. */
    readonly idToken?: string;
  },
): Promise<
  AuthAccessTokenResult & {
    readonly identity?: LoomIdentityAccount;
    readonly environmentId?: EnvironmentId;
  }
> {
  if (!accessToken.trim()) throw new Error("The account did not return an access token.");
  const modern = options?.metadata.sessionExchangeEnabled === true;
  const response = await request(
    new URL(modern ? LOOM_IDENTITY_SESSION_PATH : "/oauth/token", httpBaseUrl),
    {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": modern ? "application/json" : "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      ...(options?.signal ? { signal: options.signal } : {}),
      body: modern
        ? JSON.stringify({
            type: "native",
            accessToken,
            ...(options?.idToken ? { idToken: options.idToken } : {}),
            environmentId: options!.metadata.environmentId,
            ...(options?.expectedIdentity ? { expectedIdentity: options.expectedIdentity } : {}),
          })
        : new URLSearchParams({
            grant_type: AuthTokenExchangeGrantType,
            subject_token_type: AuthAccessTokenType,
            requested_token_type: AuthAccessTokenType,
            subject_token: accessToken,
            client_label: "Loom mobile",
            client_device_type: "mobile",
          }).toString(),
    },
  );
  if (!response.ok) {
    const failure: unknown = await response.json().catch(() => null);
    const code =
      typeof failure === "object" && failure !== null && "error" in failure ? failure.error : null;
    if (code === LOOM_IDENTITY_SIGN_IN_EXPIRED) throw new Error(IDENTITY_FRESH_SIGN_IN_TEXT);
    if (code === LOOM_IDENTITY_PASSKEY_REQUIRED) throw new Error(IDENTITY_PASSKEY_REQUIRED_TEXT);
    throw new Error(
      "This account could not sign in to the computer. Check its allowed accounts and try again.",
    );
  }
  const body: unknown = await response.json();
  let token: AuthAccessTokenResult & {
    readonly identity?: LoomIdentityAccount;
    readonly environmentId?: EnvironmentId;
  };
  try {
    token = modern ? decodeIdentitySession(body) : decodeToken(body);
  } catch {
    throw new Error("The computer returned an invalid mobile session.");
  }
  if (token.token_type !== "Bearer" || token.expires_in <= 0 || token.expires_in > 3600)
    throw new Error("The computer returned an unsupported or expired mobile session.");
  if (
    modern &&
    (token.environmentId !== options!.metadata.environmentId ||
      token.identity?.issuer !== options!.metadata.issuer ||
      (options?.expectedIdentity && token.identity?.subject !== options.expectedIdentity.subject))
  )
    throw new Error(
      "This session belongs to another computer or Identity account. Sign in with the saved account.",
    );
  return token;
}

/** What expo-auth-session returns from the authorization code exchange. */
export type NativeIdentityTokens = {
  readonly tokenType: string;
  readonly accessToken: string;
  readonly idToken?: string | undefined;
  readonly refreshToken?: string | undefined;
  /** Epoch seconds. */
  readonly issuedAt: number;
  readonly expiresIn?: number | undefined;
};

/**
 * Rechecks the computer, exchanges the account tokens there and builds the saved connection. The
 * refresh grant comes back only when the provider issued one; sign-in works without it.
 */
export async function completeNativeIdentitySignIn(input: {
  readonly destination: ReturnType<typeof libraryIdentityAddress>;
  readonly metadata: Awaited<ReturnType<typeof loadLibraryIdentity>>;
  readonly discovery: Awaited<ReturnType<typeof loadNativeIdentityDiscovery>>;
  readonly tokens: NativeIdentityTokens;
  readonly label: string;
  readonly options: IdentityOptions;
  readonly request: typeof fetch;
  readonly now: () => number;
}): Promise<{
  readonly registration: BearerConnectionRegistration;
  readonly grantKey: string;
  readonly grant: IdentityGrant | null;
}> {
  const { destination, metadata, discovery, tokens, options } = input;
  if (tokens.tokenType.toLowerCase() !== "bearer")
    throw new Error("The Identity provider returned an unsupported token type.");
  const current = await loadLibraryIdentity(
    destination.httpBaseUrl,
    metadata.environmentId,
    input.request,
    options,
  );
  assertNativeIdentityUnchanged(metadata, current);
  const session = await exchangeLibraryIdentityToken(
    destination.httpBaseUrl,
    tokens.accessToken,
    input.request,
    { ...options, metadata, ...(tokens.idToken ? { idToken: tokens.idToken } : {}) },
  );
  if (options.signal?.aborted) throw new Error("Sign-in cancelled.");
  if (!session.identity || session.environmentId !== metadata.environmentId)
    throw new Error(
      "The computer did not return verified Identity access. Update it or use pairing.",
    );
  const now = input.now();
  const expiresAt = Math.min(
    now + session.expires_in * 1000,
    tokens.expiresIn === undefined
      ? Number.MAX_SAFE_INTEGER
      : (tokens.issuedAt + tokens.expiresIn) * 1000,
  );
  if (expiresAt <= now) throw new Error("Identity access expired. Sign in again.");
  const environmentId = metadata.environmentId;
  const connectionId = `bearer:${environmentId}:${destination.httpBaseUrl}`;
  const account = { issuer: session.identity.issuer, subject: session.identity.subject };
  return {
    registration: new BearerConnectionRegistration({
      target: new BearerConnectionTarget({ environmentId, label: input.label, connectionId }),
      profile: new BearerConnectionProfile({
        connectionId,
        environmentId,
        label: input.label,
        ...destination,
        identity: account,
      }),
      credential: new BearerConnectionCredential({
        token: session.access_token,
        identity: { ...account, environmentId, expiresAt },
      }),
    }),
    grantKey: identityGrantKey({ ...account, environmentId }),
    grant:
      tokens.refreshToken && tokens.idToken && nativeIdentityRenewable(metadata)
        ? {
            version: 1,
            ...account,
            environmentId,
            httpBaseUrl: destination.httpBaseUrl,
            clientId: metadata.nativeClientId,
            tokenEndpoint: discovery.tokenEndpoint,
            ...(discovery.endSessionEndpoint
              ? { endSessionEndpoint: discovery.endSessionEndpoint }
              : {}),
            ...(metadata.resource ? { resource: metadata.resource } : {}),
            refreshToken: tokens.refreshToken,
            idToken: tokens.idToken,
            grantedAt: now,
            updatedAt: now,
          }
        : null,
  };
}
