import { expect, it } from "@effect/vitest";
import { AuthAccessWriteScope, AuthVaultReadScope, AuthVaultWriteScope } from "@t3tools/contracts";
import { accountIdentityVaultScopes } from "./identity-scopes.ts";
it("grants only Vault permissions for the single passkey-verified Library owner", () => {
  const policy = {
    LOOM_LIBRARY_AUTHORITY: "true",
    LOOM_IDENTITY_REQUIRE_PASSKEY: "true",
    LOOM_IDENTITY_ALLOWED_SUBJECTS: "owner",
  };
  expect(accountIdentityVaultScopes([], policy)).toEqual([AuthVaultReadScope, AuthVaultWriteScope]);
  expect(accountIdentityVaultScopes([], policy)).not.toContain(AuthAccessWriteScope);
  for (const changes of [
    { LOOM_LIBRARY_AUTHORITY: "false" },
    { LOOM_IDENTITY_REQUIRE_PASSKEY: "false" },
    { LOOM_IDENTITY_ALLOWED_SUBJECTS: "owner,guest" },
  ])
    expect(accountIdentityVaultScopes([], { ...policy, ...changes })).toEqual([]);
});
