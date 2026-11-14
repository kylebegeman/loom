import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthRelayWriteScope,
  AuthStandardClientScopes,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import {
  accountVaultDetail,
  accountVaultState,
  connectsWithIdentity,
  foldsComputerVault,
  settleAccountVaultAccess,
  vaultAccessUntil,
  VAULT_SIGN_IN_ACTION,
  type AccountVaultInput,
} from "./account-vault.ts";

const signedIn: AccountVaultInput = {
  authorityId: "library",
  supported: true,
  connected: true,
  identity: true,
  session: { authenticated: true, permissions: [...AuthStandardClientScopes] },
  sessionFailed: false,
  vaultSignIn: true,
};
const without = (...removed: ReadonlyArray<string>) =>
  AuthStandardClientScopes.filter((scope) => !removed.includes(scope));
/** What a default Identity sign-in holds: no access or relay management. */
const standardIdentity = without(AuthAccessReadScope, AuthAccessWriteScope, AuthRelayWriteScope);

describe("accountVaultState", () => {
  it("opens the account Vault only when this device can inspect the Library's Vault", () => {
    expect(accountVaultState(signedIn)).toEqual({ kind: "open" });
    expect(accountVaultState({ ...signedIn, supported: false })).toEqual({ kind: "none" });
    expect(accountVaultState({ ...signedIn, authorityId: null })).toEqual({ kind: "none" });
    expect(accountVaultState({ ...signedIn, connected: false })).toEqual({ kind: "reconnect" });
  });

  it("opens for a Vault sign-in, which adds both access scopes but not relay management", () => {
    const permissions = [...standardIdentity, AuthAccessReadScope, AuthAccessWriteScope];
    expect(
      accountVaultState({ ...signedIn, session: { authenticated: true, permissions } }),
    ).toEqual({ kind: "open" });
  });

  it("offers a Vault sign-in to an Identity device on a Library that supports it", () => {
    const session = { authenticated: true, permissions: standardIdentity };
    expect(accountVaultState({ ...signedIn, session })).toEqual({
      kind: "no-access",
      identity: true,
      vaultSignIn: true,
    });
    for (const vaultSignIn of [false, undefined])
      expect(accountVaultState({ ...signedIn, session, vaultSignIn })).toEqual({
        kind: "no-access",
        identity: true,
        vaultSignIn: false,
      });
    // A pairing cannot sign in again with Identity, whatever the Library supports.
    expect(accountVaultState({ ...signedIn, identity: false, session })).toEqual({
      kind: "no-access",
      identity: false,
      vaultSignIn: false,
    });
  });

  it("does not open for a session that can only inspect or only change the Vault", () => {
    for (const permissions of [without(AuthAccessWriteScope), without(AuthAccessReadScope)])
      expect(
        accountVaultState({ ...signedIn, session: { authenticated: true, permissions } }),
      ).toEqual({ kind: "no-access", identity: true, vaultSignIn: true });
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

describe("accountVaultDetail", () => {
  const noAccess = (identity: boolean, vaultSignIn: boolean) =>
    ({ kind: "no-access", identity, vaultSignIn }) as const;

  it("explains the one-step sign-in, an older Library and a pairing in plain words", () => {
    const oneStep = accountVaultDetail(noAccess(true, true), "Dorothy");
    expect(oneStep).toBe(
      "Vault access needs its own sign-in on this device. Confirm with your passkey; access lasts up to an hour.",
    );
    expect(accountVaultDetail(noAccess(true, false), "Dorothy")).toBe(
      "Update Dorothy to sign in for Vault access from this device. Until then, use each computer's own Vault.",
    );
    expect(accountVaultDetail(noAccess(false, false), "Dorothy")).toContain(
      "Pair it again with a link that includes View access and Manage access.",
    );
    const all = [true, false].flatMap((identity) =>
      [true, false].map((vaultSignIn) =>
        accountVaultDetail(noAccess(identity, vaultSignIn), "Dorothy"),
      ),
    );
    for (const text of [...all, VAULT_SIGN_IN_ACTION]) {
      expect(text).not.toContain("—");
      expect(text).not.toContain("LOOM_IDENTITY_ALLOW_ADMIN");
    }
    expect(VAULT_SIGN_IN_ACTION).toBe("Sign in for Vault access");
  });

  it("says until when Vault access lasts once the session reports its end", () => {
    const expiresAt = DateTime.makeUnsafe("2026-11-14T15:42:00Z");
    expect(vaultAccessUntil(expiresAt, { locale: "en-US", timeZone: "UTC" })).toMatch(
      /^Vault access until 3:42\sPM\.$/u,
    );
    expect(
      vaultAccessUntil(expiresAt.epochMilliseconds, { locale: "en-GB", timeZone: "UTC" }),
    ).toBe("Vault access until 15:42.");
    expect(accountVaultDetail({ kind: "open" }, "Dorothy")).toBe("Managed by Dorothy.");
    expect(accountVaultDetail({ kind: "open" }, "Dorothy", expiresAt)).toMatch(
      /^Managed by Dorothy\. Vault access until .+\.$/u,
    );
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
    access = settleAccountVaultAccess(access, {
      kind: "no-access",
      identity: true,
      vaultSignIn: true,
    });
    expect(access).toBe("denied");
    access = settleAccountVaultAccess(access, { kind: "reconnect" });
    expect(foldsComputerVault({ elsewhere: true, state: { kind: "reconnect" }, access })).toBe(
      false,
    );
  });

  it("unfolds the computer's own Vault once a Vault sign-in's session ends", () => {
    const elevated = accountVaultState(signedIn);
    let access = settleAccountVaultAccess("unknown", elevated);
    expect(foldsComputerVault({ elsewhere: true, state: elevated, access })).toBe(true);
    // The elevated socket closes at its expiry and reconnects on the standard renewal.
    access = settleAccountVaultAccess(access, { kind: "reconnect" });
    expect(access).toBe("granted");
    const renewed = accountVaultState({
      ...signedIn,
      session: { authenticated: true, permissions: standardIdentity },
    });
    access = settleAccountVaultAccess(access, renewed);
    expect(access).toBe("denied");
    expect(foldsComputerVault({ elsewhere: true, state: renewed, access })).toBe(false);
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
