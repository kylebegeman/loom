import {
  AuthAccessTokenResult,
  AuthAccessTokenType,
  AuthTokenExchangeGrantType,
  type EnvironmentId,
} from "@t3tools/contracts";
import { LOOM_IDENTITY_METADATA_PATH, LoomIdentityMetadata } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

const decodeMetadata = Schema.decodeUnknownSync(LoomIdentityMetadata);
const decodeToken = Schema.decodeUnknownSync(AuthAccessTokenResult);

export function libraryIdentityResourceParameters(
  metadata: LoomIdentityMetadata,
): Record<string, string> {
  return metadata.resource ? { resource: metadata.resource } : {};
}

/** Sign-in follows the explicitly entered library address and verifies a saved destination. */
export function libraryIdentityAddress(address: string) {
  const url = new URL(address.trim());
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error(
      "Enter the library server's HTTP or HTTPS address without a path or credentials.",
    );
  const ws = new URL("/ws", url);
  ws.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return { httpBaseUrl: url.origin, wsBaseUrl: ws.toString() };
}

export async function loadLibraryIdentity(
  httpBaseUrl: string,
  expectedEnvironmentId?: EnvironmentId,
  request: typeof fetch = fetch,
) {
  const response = await request(new URL(LOOM_IDENTITY_METADATA_PATH, httpBaseUrl), {
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("The library sign-in settings could not be loaded.");
  let metadata: LoomIdentityMetadata;
  try {
    metadata = decodeMetadata(await response.json());
  } catch {
    throw new Error("The library returned invalid sign-in settings.");
  }
  if (expectedEnvironmentId && metadata.environmentId !== expectedEnvironmentId)
    throw new Error("This address reaches another library server. Review the selected connection.");
  if (
    !metadata.enabled ||
    !metadata.nativeClientId ||
    !metadata.authorizationEndpoint ||
    !metadata.tokenEndpoint
  )
    throw new Error(
      "Native library sign-in is not configured on this server. Use pairing or contact its administrator.",
    );
  return {
    ...metadata,
    nativeClientId: metadata.nativeClientId,
    authorizationEndpoint: metadata.authorizationEndpoint,
    tokenEndpoint: metadata.tokenEndpoint,
  };
}

export async function exchangeLibraryIdentityToken(
  httpBaseUrl: string,
  accessToken: string,
  request: typeof fetch = fetch,
) {
  if (!accessToken.trim()) throw new Error("The account did not return an access token.");
  const response = await request(new URL("/oauth/token", httpBaseUrl), {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: AuthTokenExchangeGrantType,
      subject_token_type: AuthAccessTokenType,
      requested_token_type: AuthAccessTokenType,
      subject_token: accessToken,
      client_label: "Loom mobile",
      client_device_type: "mobile",
    }).toString(),
  });
  if (!response.ok)
    throw new Error(
      "This account could not sign in to the library. Check its allowed accounts and try again.",
    );
  let token: AuthAccessTokenResult;
  try {
    token = decodeToken(await response.json());
  } catch {
    throw new Error("The library returned an invalid mobile session.");
  }
  if (token.token_type !== "Bearer" || token.expires_in <= 0)
    throw new Error("The library returned an unsupported or expired mobile session.");
  return token;
}
