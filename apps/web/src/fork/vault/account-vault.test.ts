import { AuthAccessReadScope, AuthStandardClientScopes } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { accountVaultState, type AccountVaultInput } from "./account-vault";

const signedIn: AccountVaultInput = {
  authorityId: "library",
  supported: true,
  connected: true,
  identity: true,
  session: { authenticated: true, permissions: [...AuthStandardClientScopes] },
  sessionFailed: false,
};

describe("accountVaultState", () => {
  it("opens the account Vault only when this device can inspect the Library's Vault", () => {
    expect(accountVaultState(signedIn)).toEqual({ kind: "open" });
    expect(accountVaultState({ ...signedIn, supported: false })).toEqual({ kind: "none" });
    expect(accountVaultState({ ...signedIn, authorityId: null })).toEqual({ kind: "none" });
    expect(accountVaultState({ ...signedIn, connected: false })).toEqual({ kind: "reconnect" });
  });

  it("does not offer the account Vault to a Library session without Vault inspection", () => {
    const permissions = AuthStandardClientScopes.filter((scope) => scope !== AuthAccessReadScope);
    expect(
      accountVaultState({ ...signedIn, session: { authenticated: true, permissions } }),
    ).toEqual({ kind: "no-access", identity: true });
    expect(
      accountVaultState({
        ...signedIn,
        identity: false,
        session: { authenticated: true, permissions },
      }),
    ).toEqual({ kind: "no-access", identity: false });
  });

  it("asks to sign in again when the Library no longer accepts the session", () => {
    expect(accountVaultState({ ...signedIn, session: { authenticated: false } })).toEqual({
      kind: "reconnect",
    });
    expect(accountVaultState({ ...signedIn, session: null, sessionFailed: true })).toEqual({
      kind: "reconnect",
    });
    expect(accountVaultState({ ...signedIn, session: null })).toEqual({ kind: "checking" });
  });
});
