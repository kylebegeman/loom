import {
  LoomIdentityMetadata,
  LOOM_IDENTITY_METADATA_PATH,
  LOOM_IDENTITY_LOGIN_PATH,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

const decodeMetadata = Schema.decodeUnknownSync(LoomIdentityMetadata);

/** Public metadata is available before pairing. A login URL always targets the selected host. */
export function loomIdentityUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  if (base.username || base.password) return null;
  return new URL(path, base.origin).href;
}

export async function readLoomIdentity(baseUrl: string, signal?: AbortSignal, refresh = false) {
  const url = loomIdentityUrl(baseUrl, LOOM_IDENTITY_METADATA_PATH);
  if (!url) return null;
  // The metadata is public and served with a wildcard origin, which browsers refuse
  // for credentialed requests from another origin.
  const response = await fetch(url, {
    credentials: "omit",
    ...(refresh ? { cache: "no-store" as const } : {}),
    ...(signal ? { signal } : {}),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not check Loom sign-in on this server.");
  return decodeMetadata(await response.json());
}

export function loomBrowserLoginUrl(
  baseUrl: string,
  metadata: LoomIdentityMetadata | null,
  currentUrl?: string,
) {
  if (
    !metadata?.enabled ||
    !metadata.browserLoginEnabled ||
    !metadata.clientId ||
    !metadata.issuer ||
    !metadata.authorizationEndpoint ||
    !metadata.tokenEndpoint
  )
    return null;
  const login = loomIdentityUrl(baseUrl, LOOM_IDENTITY_LOGIN_PATH);
  if (!login || !currentUrl) return login;
  const target = new URL(login);
  const current = new URL(currentUrl);
  if (current.origin === target.origin)
    target.searchParams.set("returnTo", current.pathname + current.search + current.hash);
  return target.href;
}
