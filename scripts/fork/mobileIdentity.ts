/** Fork-owned iOS identity and cloud distribution boundaries. */
import { resolveLoomAccountPortalUrl } from "./connect-config.ts";
export type MobileAppVariant = "development" | "preview" | "production";

type Environment = Readonly<Record<string, string | undefined>>;

const VARIANTS = {
  development: {
    appName: "Loom Dev",
    scheme: "loom-dev",
    iosBundleIdentifier: "com.kylebegeman.loom.dev",
  },
  preview: {
    appName: "Loom Preview",
    scheme: "loom-preview",
    iosBundleIdentifier: "com.kylebegeman.loom.preview",
  },
  production: { appName: "Loom", scheme: "loom", iosBundleIdentifier: "com.kylebegeman.loom" },
} as const;

const UPSTREAM_TEAM_ID = "ARK85ZXQ4Z";
const UPSTREAM_EXPO_PROJECT_ID = "d763fcb8-d37c-41ea-a773-b54a0ab4a454";

function configured(env: Environment, key: string): string | undefined {
  return env[key]?.trim() || undefined;
}

function flag(env: Environment, key: string): boolean {
  const value = configured(env, key);
  if (value !== undefined && value !== "0" && value !== "1") {
    throw new Error(`${key} must be 0 or 1.`);
  }
  return value === "1";
}

export function resolveMobileAppVariant(value: string | undefined): MobileAppVariant {
  if (value === undefined || value.trim() === "") return "production";
  if (value === "development" || value === "preview" || value === "production") return value;
  throw new Error("APP_VARIANT must be development, preview, or production.");
}

export function resolveLoomMobileIdentity(env: Environment) {
  const appVariant = resolveMobileAppVariant(env.APP_VARIANT);
  const variant = VARIANTS[appVariant];
  const personalTeam = env.T3CODE_IOS_PERSONAL_TEAM === "1";
  const personalBundle = configured(env, "T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID");
  if (
    personalTeam &&
    (!personalBundle ||
      !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(personalBundle) ||
      personalBundle.startsWith("com.t3tools."))
  ) {
    throw new Error(
      "Personal Team builds require a bundle identifier you control via T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID, such as com.example.loom.dev.",
    );
  }
  const teamId = configured(env, "LOOM_IOS_TEAM_ID");
  if (teamId && (!/^[A-Z0-9]{10}$/.test(teamId) || teamId === UPSTREAM_TEAM_ID)) {
    throw new Error("LOOM_IOS_TEAM_ID must be your own 10-character Apple team identifier.");
  }
  const iosBuildNumber = configured(env, "LOOM_IOS_BUILD_NUMBER");
  if (iosBuildNumber && !/^[1-9]\d{0,3}(?:\.(?:0|[1-9]\d?)){0,2}$/.test(iosBuildNumber)) {
    throw new Error(
      "LOOM_IOS_BUILD_NUMBER must have a major number from 1 to 9999 and up to two components from 0 to 99, without leading zeroes.",
    );
  }
  const sourceCommit = configured(env, "LOOM_IOS_SOURCE_SHA");
  if (sourceCommit && !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error("LOOM_IOS_SOURCE_SHA must be the full lowercase source commit SHA.");
  }
  const expoProjectId = configured(env, "LOOM_MOBILE_EXPO_PROJECT_ID");
  const expoOwner = configured(env, "LOOM_MOBILE_EXPO_OWNER");
  if (
    expoProjectId &&
    (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expoProjectId) ||
      expoProjectId.toLowerCase() === UPSTREAM_EXPO_PROJECT_ID)
  ) {
    throw new Error("LOOM_MOBILE_EXPO_PROJECT_ID must identify your own Expo project.");
  }
  if (
    expoOwner &&
    (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(expoOwner) || expoOwner.toLowerCase() === "pingdotgg")
  ) {
    throw new Error("LOOM_MOBILE_EXPO_OWNER must identify your own Expo account.");
  }
  if (Boolean(expoProjectId) !== Boolean(expoOwner)) {
    throw new Error("Set LOOM_MOBILE_EXPO_PROJECT_ID and LOOM_MOBILE_EXPO_OWNER together.");
  }
  const updatesEnabled = flag(env, "LOOM_MOBILE_UPDATES_ENABLED");
  if (updatesEnabled && !expoProjectId) {
    throw new Error("Loom OTA updates require your own Expo project and owner.");
  }
  const connectEnabled = flag(env, "LOOM_MOBILE_CONNECT_ENABLED");
  const relayUrl = configured(env, "T3CODE_RELAY_URL");
  const publishableKey = configured(env, "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
  const jwtTemplate = configured(env, "EXPO_PUBLIC_CLERK_JWT_TEMPLATE");
  if (connectEnabled && (!relayUrl || !publishableKey || !jwtTemplate)) {
    throw new Error(
      "Loom Connect requires an explicitly configured relay, Clerk publishable key, and JWT template for this app.",
    );
  }
  if (connectEnabled && relayUrl) {
    const url = new URL(relayUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error(
        "Loom Connect requires an HTTPS relay URL without credentials, query, or fragment.",
      );
    }
  }
  const authDomain = configured(env, "LOOM_MOBILE_AUTH_DOMAIN");
  if (
    authDomain &&
    (!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(authDomain) ||
      authDomain.toLowerCase() === "clerk.t3.codes")
  ) {
    throw new Error("LOOM_MOBILE_AUTH_DOMAIN must be your own authentication domain.");
  }
  const accountPortalUrl = resolveLoomAccountPortalUrl(
    configured(env, "LOOM_MOBILE_ACCOUNT_PORTAL_URL"),
    publishableKey,
  );
  if (connectEnabled && !authDomain && !accountPortalUrl) {
    throw new Error(
      "Email-based Loom Connect requires the deployment's hosted account portal URL.",
    );
  }
  const pushEnabled = flag(env, "LOOM_MOBILE_PUSH_ENABLED");
  const appleSignInEnabled = flag(env, "LOOM_MOBILE_APPLE_SIGN_IN_ENABLED");
  if ((pushEnabled || appleSignInEnabled) && (!connectEnabled || !teamId || personalTeam)) {
    throw new Error(
      "Loom cloud push and Apple sign-in require configured Connect and an eligible Apple team.",
    );
  }
  // Library push keeps aps-environment without enabling the relay or widget push paths, which
  // would hand the native and Live Activity tokens to a relay Loom does not run.
  const libraryPushEnabled = flag(env, "LOOM_MOBILE_LIBRARY_PUSH_ENABLED");
  if (libraryPushEnabled && (!teamId || personalTeam)) {
    throw new Error("Loom Library push requires an eligible Apple team.");
  }
  return {
    ...variant,
    appVariant,
    iosBundleIdentifier: personalTeam ? personalBundle! : variant.iosBundleIdentifier,
    personalTeam,
    teamId,
    iosBuildNumber,
    sourceCommit,
    expoProjectId,
    expoOwner,
    updatesEnabled,
    connectEnabled,
    pushEnabled,
    libraryPushEnabled,
    appleSignInEnabled,
    associatedDomains:
      connectEnabled && authDomain
        ? [`applinks:${authDomain}`, `webcredentials:${authDomain}`]
        : [],
    relayUrl: connectEnabled ? relayUrl : undefined,
    clerkPublishableKey: connectEnabled ? publishableKey : undefined,
    clerkJwtTemplate: connectEnabled ? jwtTemplate : undefined,
    accountPortalUrl: connectEnabled ? accountPortalUrl : undefined,
  };
}
