/** Explicit public Connect configuration for the fork's local release publisher. */
export type LoomConnectConfig = {
  readonly enabled: true;
  readonly mobileEnabled: boolean;
  readonly clerkPublishableKey: string;
  readonly clerkJwtTemplate: string;
  readonly clerkCliOAuthClientId: string;
  readonly relayUrl: string;
  readonly accountPortalUrl?: string;
  /** Set only after this Apple team and Loom bundle are registered with the auth service. */
  readonly nativeAuthDomain?: string;
};

type Environment = Readonly<Record<string, string | undefined>>;

const PUBLIC_CONFIG_KEYS = new Set([
  "enabled",
  "mobileEnabled",
  "clerkPublishableKey",
  "clerkJwtTemplate",
  "clerkCliOAuthClientId",
  "relayUrl",
  "nativeAuthDomain",
  "accountPortalUrl",
]);

export function resolveLoomAccountPortalUrl(value: string | undefined, publishableKey?: string) {
  const configured =
    value?.trim() ||
    (publishableKey === "pk_live_Y2xlcmsudDMuY29kZXMk" ? "https://accounts.t3.codes" : undefined);
  if (!configured) return undefined;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("Loom Connect accountPortalUrl must be an HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Loom Connect accountPortalUrl must be an HTTPS origin without credentials, path, query or fragment.",
    );
  }
  return url.origin;
}

export function parseLoomConnectConfig(input: unknown): LoomConnectConfig | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Loom Connect publishing configuration must be an object.");
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !PUBLIC_CONFIG_KEYS.has(key))) {
    throw new Error("Loom Connect configuration accepts only the documented public fields.");
  }
  if (value.enabled === false) return null;
  if (value.enabled !== true) throw new Error("Loom Connect requires an explicit enabled setting.");
  if (value.mobileEnabled !== undefined && typeof value.mobileEnabled !== "boolean") {
    throw new Error("Loom Connect mobileEnabled must be a boolean.");
  }
  const required = (key: string) => {
    const entry = value[key];
    if (typeof entry !== "string" || !entry.trim() || /[\r\n\0]/.test(entry)) {
      throw new Error(`Loom Connect ${key} must be a nonempty public configuration value.`);
    }
    return entry.trim();
  };
  const clerkPublishableKey = required("clerkPublishableKey");
  if (!/^pk_(?:live|test)_[A-Za-z0-9_-]+={0,2}$/.test(clerkPublishableKey)) {
    throw new Error("Loom Connect requires a Clerk publishable key, never a secret key.");
  }
  const relayUrl = required("relayUrl");
  let relay: URL;
  try {
    relay = new URL(relayUrl);
  } catch {
    throw new Error("Loom Connect relayUrl must be an HTTPS URL.");
  }
  if (
    relay.protocol !== "https:" ||
    relay.username ||
    relay.password ||
    relay.search ||
    relay.hash
  ) {
    throw new Error("Loom Connect relayUrl must use HTTPS without credentials, query or fragment.");
  }
  const nativeAuthDomain = value.nativeAuthDomain;
  if (
    nativeAuthDomain !== undefined &&
    (typeof nativeAuthDomain !== "string" ||
      !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(nativeAuthDomain) ||
      nativeAuthDomain.toLowerCase() === "clerk.t3.codes")
  ) {
    throw new Error("Loom nativeAuthDomain must be an explicitly qualified authentication domain.");
  }
  if (value.accountPortalUrl !== undefined && typeof value.accountPortalUrl !== "string") {
    throw new Error("Loom Connect accountPortalUrl must be an HTTPS origin.");
  }
  const accountPortalUrl = resolveLoomAccountPortalUrl(
    value.accountPortalUrl as string | undefined,
    clerkPublishableKey,
  );
  if (value.mobileEnabled === true && !nativeAuthDomain && !accountPortalUrl) {
    throw new Error("Email-based mobile Connect needs the deployment's hosted accountPortalUrl.");
  }
  return {
    enabled: true,
    mobileEnabled: value.mobileEnabled === true,
    clerkPublishableKey,
    clerkJwtTemplate: required("clerkJwtTemplate"),
    clerkCliOAuthClientId: required("clerkCliOAuthClientId"),
    relayUrl: relay.toString().replace(/\/+$/, ""),
    ...(accountPortalUrl ? { accountPortalUrl } : {}),
    ...(typeof nativeAuthDomain === "string" ? { nativeAuthDomain } : {}),
  };
}

/** Only canonical, public identifiers cross into a desktop, CLI or native build. */
export function loomConnectBuildEnvironment(config: LoomConnectConfig | null) {
  return config
    ? {
        T3CODE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
        T3CODE_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
        T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
        T3CODE_RELAY_URL: config.relayUrl,
        LOOM_MOBILE_CONNECT_ENABLED: config.mobileEnabled ? "1" : "0",
        ...(config.accountPortalUrl
          ? { LOOM_MOBILE_ACCOUNT_PORTAL_URL: config.accountPortalUrl }
          : {}),
        ...(config.nativeAuthDomain ? { LOOM_MOBILE_AUTH_DOMAIN: config.nativeAuthDomain } : {}),
      }
    : { LOOM_MOBILE_CONNECT_ENABLED: "0" };
}

/** Ambient desktop settings do not opt an independently signed mobile app into Connect. */
export function loomMobileConnectConfig(env: Environment): LoomConnectConfig | null {
  const enabled = env.LOOM_MOBILE_CONNECT_ENABLED?.trim();
  if (enabled !== undefined && enabled !== "0" && enabled !== "1") {
    throw new Error("LOOM_MOBILE_CONNECT_ENABLED must be 0 or 1.");
  }
  if (enabled !== "1") return null;
  return parseLoomConnectConfig({
    enabled: true,
    mobileEnabled: true,
    clerkPublishableKey: env.T3CODE_CLERK_PUBLISHABLE_KEY ?? env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
    clerkJwtTemplate: env.T3CODE_CLERK_JWT_TEMPLATE ?? env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE,
    clerkCliOAuthClientId: env.T3CODE_CLERK_CLI_OAUTH_CLIENT_ID,
    relayUrl: env.T3CODE_RELAY_URL,
    ...(env.LOOM_MOBILE_ACCOUNT_PORTAL_URL
      ? { accountPortalUrl: env.LOOM_MOBILE_ACCOUNT_PORTAL_URL }
      : {}),
    ...(env.LOOM_MOBILE_AUTH_DOMAIN ? { nativeAuthDomain: env.LOOM_MOBILE_AUTH_DOMAIN } : {}),
  });
}
