import { LIBRARY_SIGN_IN_NOT_CURRENT_TEXT } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";

import {
  librarySignIn,
  librarySignInText,
  loomIdentityAccountLabel,
  needsLibrarySignIn,
  type LibrarySignInTarget,
} from "./library-sign-in.ts";

const NOW = 1_000_000_000_000;
const MINUTE = 60_000;
const at = (at: number) => `T+${(at - NOW) / MINUTE}m`;

const target = (overrides: Partial<LibrarySignInTarget> = {}): LibrarySignInTarget => ({
  connection: { phase: "connected", identity: true },
  session: { authenticated: true, expiresAt: NOW + 40 * MINUTE },
  renews: false,
  now: NOW,
  ...overrides,
});

describe("library sign-in state", () => {
  it("is signed out without a connection, and offers sign-in", () => {
    const signIn = librarySignIn(target({ connection: null, session: null }));
    expect(signIn).toMatchObject({ state: "signed-out", canSignIn: true });
    expect(librarySignInText(signIn, NOW, at)).toBe("This device is not signed in to a Library.");
  });

  it("is current until the session ends, and says when a browser must sign in again", () => {
    const signIn = librarySignIn(target());
    expect(signIn).toMatchObject({ state: "current", canSignIn: false });
    expect(librarySignInText(signIn, NOW, at)).toBe(
      "Current until T+40m. Sign in again after that.",
    );
  });

  it("says the app renews a current sign-in on its own", () => {
    expect(librarySignInText(librarySignIn(target({ renews: true })), NOW, at)).toBe(
      "Current until T+40m. Loom renews it on its own before then.",
    );
  });

  it("is renewing inside the renewal window, only where the app renews", () => {
    const session = { authenticated: true, expiresAt: NOW + 5 * MINUTE };
    const renewing = librarySignIn(target({ session, renews: true }));
    expect(renewing.state).toBe("renewing");
    expect(librarySignInText(renewing, NOW, at)).toBe("Renewing now. Current until T+5m.");
    expect(librarySignIn(target({ session })).state).toBe("current");
  });

  it("is expired once the session lapses, even while the socket stays connected", () => {
    const lapsed = librarySignIn(
      target({ session: { authenticated: true, expiresAt: NOW - MINUTE } }),
    );
    expect(lapsed).toMatchObject({ state: "expired", canSignIn: true });
    expect(librarySignInText(lapsed, NOW, at)).toBe(
      "Expired at T+-1m. Sign in again to keep using your Library.",
    );
    expect(
      librarySignIn(target({ session: { authenticated: false, expiresAt: null } })).state,
    ).toBe("expired");
  });

  it("is expired when an Identity connection fails, and unreachable when a pairing does", () => {
    expect(
      librarySignIn(target({ connection: { phase: "error", identity: true }, session: null })),
    ).toMatchObject({ state: "expired", canSignIn: true });
    expect(
      librarySignIn(target({ connection: { phase: "error", identity: false }, session: null }))
        .state,
    ).toBe("unreachable");
  });

  it("asks a lapsed pairing to pair again rather than sign in", () => {
    const signIn = librarySignIn(
      target({
        connection: { phase: "connected", identity: false },
        session: { authenticated: false, expiresAt: null },
      }),
    );
    expect(signIn).toMatchObject({ state: "expired", canSignIn: false });
    expect(librarySignInText(signIn, NOW, at)).toContain("Pair it again");
  });

  it("checks while connecting or loading, and cannot tell while offline", () => {
    expect(librarySignIn(target({ session: null })).state).toBe("checking");
    expect(librarySignIn(target({ session: null, sessionFailed: true })).state).toBe("unreachable");
    expect(
      librarySignIn(target({ connection: { phase: "connecting", identity: true } })).state,
    ).toBe("checking");
    expect(librarySignIn(target({ connection: { phase: "offline", identity: true } })).state).toBe(
      "unreachable",
    );
  });
});

describe("identity account label", () => {
  it("prefers the name with the email, then either, then nothing", () => {
    const account = { issuer: "https://id.example", subject: "u1" };
    expect(loomIdentityAccountLabel({ ...account, name: "Kyle", email: "k@example.test" })).toBe(
      "Kyle (k@example.test)",
    );
    expect(loomIdentityAccountLabel({ ...account, email: "k@example.test" })).toBe(
      "k@example.test",
    );
    expect(loomIdentityAccountLabel(account)).toBeNull();
  });
});

describe("library sign-in repair", () => {
  it("is offered for the Library's sign-in denial and expired access, not other failures", () => {
    expect(needsLibrarySignIn(LIBRARY_SIGN_IN_NOT_CURRENT_TEXT)).toBe(true);
    expect(needsLibrarySignIn("Identity access expired. Sign in again on this computer.")).toBe(
      true,
    );
    expect(needsLibrarySignIn("This operation belongs to another signed-in session.")).toBe(false);
    expect(needsLibrarySignIn(null)).toBe(false);
  });
});
