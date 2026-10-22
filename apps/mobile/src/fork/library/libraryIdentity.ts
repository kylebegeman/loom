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
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

const decodeMetadata = Schema.decodeUnknownSync(LoomIdentityMetadata);
const decodeToken = Schema.decodeUnknownSync(AuthAccessTokenResult);
const decodeIdentitySession = Schema.decodeUnknownSync(LoomIdentitySessionResult);
const decodeDiscovery = Schema.decodeUnknownSync(
  Schema.Struct({
    issuer: Schema.String,
    authorization_endpoint: Schema.String,
    token_endpoint: Schema.String,
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

function secureIdentityEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("The computer returned an insecure Identity configuration.");
  return url;
}

type IdentityOptions = {
  readonly expectedIdentity?: LoomIdentityAccount;
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
  return {
    authorizationEndpoint: discovery.authorization_endpoint,
    tokenEndpoint: discovery.token_endpoint,
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
  options?: IdentityOptions & { readonly metadata: LoomIdentityMetadata },
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
  if (!response.ok)
    throw new Error(
      "This account could not sign in to the computer. Check its allowed accounts and try again.",
    );
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
