import { AuthAccessReadScope, AuthStandardClientScopes } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  accountVaultState,
  connectsWithIdentity,
  foldsComputerVault,
  settleAccountVaultAccess,
  type AccountVaultInput,
} from "./account-vault.ts";

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
      kind: "signed-out",
    });
    expect(accountVaultState({ ...signedIn, session: null, sessionFailed: true })).toEqual({
      kind: "reconnect",
    });
    expect(accountVaultState({ ...signedIn, session: null })).toEqual({ kind: "checking" });
  });
});

describe("foldsComputerVault", () => {
  it("keeps the layout through reconnects and session reloads once access is known", () => {
    let access = settleAccountVaultAccess("unknown", { kind: "open" });
    expect(access).toBe("granted");
    for (const state of [{ kind: "reconnect" }, { kind: "checking" }] as const) {
      access = settleAccountVaultAccess(access, state);
      expect(foldsComputerVault({ elsewhere: true, state, access })).toBe(true);
    }
    access = settleAccountVaultAccess(access, { kind: "no-access", identity: true });
    expect(access).toBe("denied");
    access = settleAccountVaultAccess(access, { kind: "reconnect" });
    expect(foldsComputerVault({ elsewhere: true, state: { kind: "reconnect" }, access })).toBe(
      false,
    );
  });

  it("never folds the Library's own Vault or a Library without account Vault", () => {
    expect(
      foldsComputerVault({ elsewhere: false, state: { kind: "open" }, access: "granted" }),
    ).toBe(false);
    expect(
      foldsComputerVault({ elsewhere: true, state: { kind: "none" }, access: "unknown" }),
    ).toBe(false);
  });
});

describe("connectsWithIdentity", () => {
  it("counts the Library's own Identity browser session as an Identity sign-in", () => {
    const identity = { issuer: "https://id.example", subject: "owner" };
    expect(
      connectsWithIdentity(undefined, { sessionMethod: "browser-session-cookie", identity }),
    ).toBe(true);
    expect(connectsWithIdentity(undefined, { sessionMethod: "browser-session-cookie" })).toBe(
      false,
    );
    expect(connectsWithIdentity(undefined, null)).toBe(false);
  });
});
