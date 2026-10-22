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

/** A host configuration change invalidates earlier Identity grants after restart. */
export function identitySessionPrefix(environment: NodeJS.ProcessEnv) {
  if (
    !environment.LOOM_IDENTITY_ISSUER?.trim() ||
    !environment.LOOM_IDENTITY_AUDIENCE?.trim() ||
    !environment.LOOM_IDENTITY_ALLOWED_SUBJECTS?.trim()
  )
    return null;
  const policy = POLICY_KEYS.map((key) => {
    const value = environment[key]?.trim() ?? "";
    return `${key.length}:${key}${value.length}:${value}`;
  }).join("");
  return `identity:${NodeCrypto.createHash("sha256").update(policy).digest("base64url")}:`;
}

export function isCurrentIdentitySession(subject: string, prefix: string | null) {
  if (subject.startsWith("pocket-id:")) return false;
  return !subject.startsWith("identity:") || (prefix !== null && subject.startsWith(prefix));
}
