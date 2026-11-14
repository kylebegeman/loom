// @effect-diagnostics-next-line nodeBuiltinImport:off -- Policy fingerprints are deterministic host-local credential bindings.
import * as NodeCrypto from "node:crypto";

const POLICY_KEYS = [
  "LOOM_IDENTITY_ISSUER",
  "LOOM_IDENTITY_AUDIENCE",
  "LOOM_IDENTITY_RESOURCE",
  "LOOM_IDENTITY_BROWSER_ORIGINS",
  "LOOM_IDENTITY_CLIENT_ID",
  "LOOM_IDENTITY_NATIVE_CLIENT_ID",
  "LOOM_IDENTITY_ALLOWED_SUBJECTS",
  "LOOM_IDENTITY_REQUIRED_GROUPS",
  "LOOM_IDENTITY_ALLOW_ADMIN",
] as const;
/** Added after hosts already issued sessions, so they count only when set and an upgrade keeps those. */
const ADDED_POLICY_KEYS = [
  "LOOM_IDENTITY_MAX_SESSION_AGE",
  "LOOM_IDENTITY_REQUIRE_PASSKEY",
  "LOOM_ACCESS_TEAM_DOMAIN",
  "LOOM_ACCESS_AUDIENCE",
  // Never in POLICY_KEYS: that would sign out every Identity device on upgrade.
  "LOOM_IDENTITY_VAULT_SIGN_IN",
] as const;

/** The only value LOOM_IDENTITY_VAULT_SIGN_IN accepts; PocketId refuses to start on any other. */
const VAULT_SIGN_IN_OFF = "off";

const MIN_SESSION_AGE_SECONDS = 60 * 60;
const MAX_SESSION_AGE_SECONDS = 365 * 24 * 60 * 60;
const SESSION_AGE_UNITS = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 } as const;

/**
 * Parses LOOM_IDENTITY_MAX_SESSION_AGE: whole seconds, or a whole number with an s, m, h or d
 * suffix. Returns `null` for anything outside one hour to 365 days so the host refuses to start
 * Identity with a limit nobody meant.
 */
export function parseMaxSessionAge(value: string): number | null {
  const match = /^(\d{1,9})([smhd]?)$/.exec(value.trim());
  if (match === null) return null;
  const unit = match[2] === "" ? "s" : (match[2] as keyof typeof SESSION_AGE_UNITS);
  const seconds = Number(match[1]) * SESSION_AGE_UNITS[unit];
  return seconds >= MIN_SESSION_AGE_SECONDS && seconds <= MAX_SESSION_AGE_SECONDS ? seconds : null;
}

/**
 * Identity needs an issuer, an audience and an allowlist. Exported so reach can warn about it
 * from the environment without depending on the PocketId service.
 */
export function identityConfigured(environment: NodeJS.ProcessEnv) {
  return Boolean(
    environment.LOOM_IDENTITY_ISSUER?.trim() &&
    environment.LOOM_IDENTITY_AUDIENCE?.trim() &&
    environment.LOOM_IDENTITY_ALLOWED_SUBJECTS?.trim(),
  );
}

/** Only the exact value `true` turns it on; PocketId refuses to start Identity on any other. */
export function passkeyRequired(environment: NodeJS.ProcessEnv) {
  return environment.LOOM_IDENTITY_REQUIRE_PASSKEY?.trim() === "true";
}

/**
 * Vault sign-in is on unless LOOM_IDENTITY_VAULT_SIGN_IN=off. It still needs a fresh passkey for
 * each sign-in, so being on grants nothing by itself.
 */
export function vaultSignInEnabled(environment: NodeJS.ProcessEnv) {
  return environment.LOOM_IDENTITY_VAULT_SIGN_IN?.trim() !== VAULT_SIGN_IN_OFF;
}

/** Whether LOOM_IDENTITY_VAULT_SIGN_IN holds a value other than `off`, which PocketId refuses. */
export function vaultSignInMisconfigured(environment: NodeJS.ProcessEnv) {
  const value = environment.LOOM_IDENTITY_VAULT_SIGN_IN?.trim();
  return Boolean(value) && value !== VAULT_SIGN_IN_OFF;
}

/** Sessions issued from an Identity sign-in, current or from an earlier policy. */
export function isIdentitySessionSubject(subject: string) {
  return subject.startsWith("identity:") || subject.startsWith("pocket-id:");
}

/**
 * Whether a session may pass access and relay management on: to a pairing link, or by approving
 * an MCP client. An Identity session holds them without LOOM_IDENTITY_ALLOW_ADMIN only after a
 * Vault sign-in, for at most an hour, and must not turn that into a longer-lived credential.
 */
export function mayDelegateManagement(subject: string, environment: NodeJS.ProcessEnv) {
  return (
    !isIdentitySessionSubject(subject) || environment.LOOM_IDENTITY_ALLOW_ADMIN?.trim() === "true"
  );
}

/** What a sign-in to this computer is issued for: the resource indicator, else the first audience. */
export function identityResource(environment: NodeJS.ProcessEnv) {
  return (
    environment.LOOM_IDENTITY_RESOURCE?.trim() ||
    environment.LOOM_IDENTITY_AUDIENCE?.split(",")
      .map((value) => value.trim())
      .find(Boolean) ||
    null
  );
}

/** A host configuration change invalidates earlier Identity grants after restart. */
export function identitySessionPrefix(environment: NodeJS.ProcessEnv) {
  if (!identityConfigured(environment)) return null;
  const policy = [...POLICY_KEYS, ...ADDED_POLICY_KEYS.filter((key) => environment[key]?.trim())]
    .map((key) => {
      const value = environment[key]?.trim() ?? "";
      return `${key.length}:${key}${value.length}:${value}`;
    })
    .join("");
  return `identity:${NodeCrypto.createHash("sha256").update(policy).digest("base64url")}:`;
}

export function isCurrentIdentitySession(subject: string, prefix: string | null) {
  if (subject.startsWith("pocket-id:")) return false;
  return !subject.startsWith("identity:") || (prefix !== null && subject.startsWith(prefix));
}

export function identityAccountFromSession(subject: string, environment: NodeJS.ProcessEnv) {
  const prefix = identitySessionPrefix(environment);
  if (!prefix || !subject.startsWith(prefix)) return undefined;
  const encoded = subject.slice(prefix.length);
  const bytes = Buffer.from(encoded, "base64url");
  const id = bytes.toString("utf8");
  if (!id || Buffer.from(id).toString("base64url") !== encoded) return undefined;
  return { issuer: environment.LOOM_IDENTITY_ISSUER!.trim(), subject: id };
}

/** Only the current policy proves a legacy subject's issuer; unknown fingerprints stay opaque. */
export function identityOwnershipSubject(subject: string, environment: NodeJS.ProcessEnv) {
  const account = identityAccountFromSession(subject, environment);
  if (!account) return subject;
  const principal = JSON.stringify([account.issuer, account.subject]);
  return `identity-principal:v1:${NodeCrypto.createHash("sha256").update(principal).digest("base64url")}`;
}
