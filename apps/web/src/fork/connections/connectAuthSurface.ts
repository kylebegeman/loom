import { clerkFrontendApiUrlFromPublishableKey } from "@t3tools/shared/relayAuth";
import type { CloudPublicConfig } from "~/cloud/publicConfig";
import { configuredHostedAppUrl } from "~/hostedPairing";

type PublicAuthenticationConfig = Pick<
  CloudPublicConfig,
  "clerkPublishableKey" | "clerkJwtTemplate" | "relayUrl"
>;
export interface ConnectAuthSurface {
  readonly kind: "disabled" | "invalid-config" | "available" | "unsupported-origin";
  readonly primaryDomain: string | null;
  readonly hostedAppUrl: string | null;
}
function isWithinDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
function validHostedOrigin(value: string | null | undefined, domain: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      (domain === null || isWithinDomain(url.hostname, domain))
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/** Browser session cookies follow the production key's primary domain; native clients have their own transport. */
export function resolveConnectAuthSurface(input: {
  readonly config: PublicAuthenticationConfig;
  readonly currentUrl: string | null;
  readonly isElectron: boolean;
  readonly hostedAppUrl?: string | null;
}): ConnectAuthSurface {
  const { clerkPublishableKey, clerkJwtTemplate, relayUrl } = input.config;
  const unavailable = { primaryDomain: null, hostedAppUrl: null };
  if (!clerkPublishableKey || !clerkJwtTemplate || !relayUrl)
    return { ...unavailable, kind: "disabled" };
  let frontendApi: string;
  try {
    if (!/^pk_(?:live|test)_[A-Za-z0-9+/=_-]+$/.test(clerkPublishableKey))
      return { ...unavailable, kind: "invalid-config" };
    const frontendUrl = new URL(clerkFrontendApiUrlFromPublishableKey(clerkPublishableKey));
    if (
      frontendUrl.username ||
      frontendUrl.password ||
      frontendUrl.port ||
      frontendUrl.pathname !== "/" ||
      frontendUrl.search ||
      frontendUrl.hash
    )
      return { ...unavailable, kind: "invalid-config" };
    frontendApi = frontendUrl.hostname;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/.test(frontendApi))
      return { ...unavailable, kind: "invalid-config" };
  } catch {
    return { ...unavailable, kind: "invalid-config" };
  }
  const production = clerkPublishableKey.startsWith("pk_live_");
  // Custom Frontend API hosts use clerk.<production domain>; a provider host scopes to itself.
  const primaryDomain = production ? frontendApi.replace(/^clerk\./u, "") : null;
  const hostedAppUrl = validHostedOrigin(input.hostedAppUrl, primaryDomain);
  if (input.isElectron || primaryDomain === null)
    return { kind: "available", primaryDomain, hostedAppUrl };
  try {
    const origin = new URL(input.currentUrl ?? "");
    if (
      origin.protocol === "https:" &&
      origin.port === "" &&
      isWithinDomain(origin.hostname, primaryDomain)
    )
      return { kind: "available", primaryDomain, hostedAppUrl };
  } catch {
    /* A missing or malformed browser origin cannot establish a production session. */
  }
  return { kind: "unsupported-origin", primaryDomain, hostedAppUrl };
}
export function resolveCurrentConnectAuthSurface(
  config: PublicAuthenticationConfig,
): ConnectAuthSurface {
  return resolveConnectAuthSurface({
    config,
    // Read at call time: non-browser contexts and the Electron shell have their own auth runtime.
    isElectron: typeof window === "undefined" || window.desktopBridge !== undefined,
    currentUrl: typeof window === "undefined" ? null : window.location.href,
    hostedAppUrl: configuredHostedAppUrl(),
  });
}
