import type { LoomIdentityAccount } from "@t3tools/contracts/fork";

import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";
import { connectionFailingSinceText } from "./connection-health.ts";
import { IDENTITY_RENEWAL_MAX_LEAD_MS } from "./identity-renewal-worker.ts";

export type LibrarySignInState =
  | "current"
  | "renewing"
  | "expired"
  | "signed-out"
  | "checking"
  | "unreachable";

export interface LibrarySignInTarget {
  /** Null when this device has no enabled connection to its Library. */
  readonly connection: {
    readonly phase: EnvironmentConnectionPhase;
    /** Signs in with an Identity account rather than a pairing link. */
    readonly identity: boolean;
  } | null;
  readonly session: {
    readonly authenticated: boolean;
    readonly expiresAt: number | null;
  } | null;
  /** The session check itself failed, so its state is unknown. */
  readonly sessionFailed?: boolean;
  /** This app renews the sign-in on its own, and the Library allows it. */
  readonly renews: boolean;
  readonly now: number;
}

export interface LibrarySignIn {
  readonly state: LibrarySignInState;
  readonly identity: boolean;
  readonly renews: boolean;
  readonly expiresAt: number | null;
  /** Signing in again is the repair, or the way back after signing out. */
  readonly canSignIn: boolean;
}

/**
 * Identity access lasts an hour, and once it lapses the socket can stay connected while the
 * Library stops granting scopes, so the session decides, not the connection phase.
 */
export function librarySignIn(target: LibrarySignInTarget): LibrarySignIn {
  const { connection, session, now } = target;
  const identity = connection?.identity ?? false;
  const expiresAt = session?.expiresAt ?? null;
  const result = (state: LibrarySignInState): LibrarySignIn => ({
    state,
    identity,
    renews: identity && target.renews,
    expiresAt,
    canSignIn: state === "signed-out" || (identity && state === "expired"),
  });
  if (connection === null) return result("signed-out");
  if (connection.phase === "error" && identity) return result("expired");
  if (connection.phase === "connecting") return result("checking");
  if (connection.phase !== "connected") return result("unreachable");
  if (session === null) return result(target.sessionFailed ? "unreachable" : "checking");
  if (!session.authenticated || (expiresAt !== null && expiresAt <= now)) return result("expired");
  if (
    identity &&
    target.renews &&
    expiresAt !== null &&
    expiresAt - now <= IDENTITY_RENEWAL_MAX_LEAD_MS
  )
    return result("renewing");
  return result("current");
}

/**
 * Library denials carry no code, so their wording is the only sign that signing in repairs them.
 * The server's own denial is `LIBRARY_SIGN_IN_NOT_CURRENT_TEXT`.
 */
export function needsLibrarySignIn(message: string | null | undefined): boolean {
  return typeof message === "string" && /\bsign in again\b/i.test(message);
}

/** A short label for a row's trailing value. */
export const LIBRARY_SIGN_IN_STATE_LABEL: Record<LibrarySignInState, string> = {
  current: "Current",
  renewing: "Renewing",
  expired: "Expired",
  "signed-out": "Signed out",
  checking: "Checking",
  unreachable: "Offline",
};

/** "Kyle Begeman (kyle@example.com)", either alone, or null when the sign-in named neither. */
export function loomIdentityAccountLabel(account: LoomIdentityAccount): string | null {
  const { name, email } = account;
  if (name && email && name !== email) return `${name} (${email})`;
  return name || email || null;
}

/** One sentence on the sign-in, shared by every client so they never disagree. */
export function librarySignInText(
  signIn: LibrarySignIn,
  now: number,
  formatTime: (at: number, now: number) => string = connectionFailingSinceText,
): string {
  const until = signIn.expiresAt === null ? null : formatTime(signIn.expiresAt, now);
  switch (signIn.state) {
    case "signed-out":
      return "This device is not signed in to a Library.";
    case "checking":
      return "Checking the sign-in...";
    case "unreachable":
      return "Your Library is not reachable right now. Its sign-in is checked when it reconnects.";
    case "renewing":
      return `Renewing now. Current until ${until}.`;
    case "expired":
      if (!signIn.identity)
        return "Your Library no longer accepts this device's pairing. Pair it again to continue.";
      return `${until === null ? "Expired" : `Expired at ${until}`}. Sign in again to keep using your Library.`;
    case "current":
      if (!signIn.identity)
        return until === null ? "Connected with a pairing link." : `Paired until ${until}.`;
      if (until === null) return "Current.";
      return signIn.renews
        ? `Current until ${until}. Loom renews it on its own before then.`
        : `Current until ${until}. Sign in again after that.`;
  }
}
