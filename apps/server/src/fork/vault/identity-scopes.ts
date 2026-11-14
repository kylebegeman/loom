import {
  AuthVaultReadScope,
  AuthVaultWriteScope,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";

// Only the single, passkey-verified account owner gets Vault capabilities, never access/relay administration.
export function accountIdentityVaultScopes(
  scopes: ReadonlyArray<AuthEnvironmentScope>,
  environment: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<AuthEnvironmentScope> {
  const owners =
    environment.LOOM_IDENTITY_ALLOWED_SUBJECTS?.split(",")
      .map((subject) => subject.trim())
      .filter(Boolean) ?? [];
  return environment.LOOM_LIBRARY_AUTHORITY === "true" &&
    environment.LOOM_IDENTITY_REQUIRE_PASSKEY === "true" &&
    owners.length === 1
    ? [...new Set([...scopes, AuthVaultReadScope, AuthVaultWriteScope])]
    : scopes;
}
