import {
  AuthAccessReadScope,
  sessionGrantsScope,
  type SessionGrantInput,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import { connectionRoutes } from "../connection/routes.ts";

export interface AccountVaultInput {
  readonly authorityId: string | null;
  readonly supported: boolean;
  readonly connected: boolean;
  readonly identity: boolean;
  readonly session: SessionGrantInput | null;
  readonly sessionFailed: boolean;
}

export type AccountVaultState =
  | { readonly kind: "none" }
  | { readonly kind: "checking" }
  | { readonly kind: "open" }
  | { readonly kind: "reconnect" }
  | { readonly kind: "signed-out" }
  | { readonly kind: "no-access"; readonly identity: boolean };

/** The account Vault lives on the Library, so managing it needs Vault inspection there. */
export function accountVaultState(input: AccountVaultInput): AccountVaultState {
  if (!input.authorityId || !input.supported) return { kind: "none" };
  if (!input.connected || input.sessionFailed) return { kind: "reconnect" };
  if (input.session === null) return { kind: "checking" };
  if (!input.session.authenticated) return { kind: "signed-out" };
  return sessionGrantsScope(input.session, AuthAccessReadScope)
    ? { kind: "open" }
    : { kind: "no-access", identity: input.identity };
}

/** Settled access: whether this device's Library session was last known to lack Vault access. */
export type AccountVaultAccess = "unknown" | "granted" | "denied";

/**
 * Settles access so the Vault page layout ignores reconnects and session reloads, which would
 * otherwise remount the computer's Vault and drop unsaved drafts.
 */
export function settleAccountVaultAccess(
  previous: AccountVaultAccess,
  state: AccountVaultState,
): AccountVaultAccess {
  if (state.kind === "open") return "granted";
  if (state.kind === "no-access") return "denied";
  if (state.kind === "none") return "unknown";
  return previous;
}

/** Whether a computer's own Vault folds below the Account Vault card. */
export function foldsComputerVault(input: {
  readonly elsewhere: boolean;
  readonly state: AccountVaultState;
  readonly access: AccountVaultAccess;
}): boolean {
  return input.elsewhere && input.state.kind !== "none" && input.access !== "denied";
}

/** What the Account Vault card tells the owner in each state. */
export function accountVaultDetail(
  state: Exclude<AccountVaultState, { readonly kind: "none" }>,
  library: string,
): string {
  switch (state.kind) {
    case "checking":
      return `Checking this device's access to ${library}...`;
    case "open":
      return `Managed by ${library}.`;
    case "reconnect":
      return "Reconnect your account to manage saved connections.";
    case "signed-out":
      return `Sign in to ${library} again to manage saved connections.`;
    case "no-access":
      return state.identity
        ? `Your sign-in to ${library} does not include Vault access, so the account Vault cannot be managed from this device. To allow it, set LOOM_IDENTITY_ALLOW_ADMIN=true on ${library}, restart it and sign in again. Until then, use each computer's own Vault.`
        : `This device's pairing with ${library} does not include Vault access, so the account Vault cannot be managed from this device. Pair it again with a link that includes View access and Manage access. Until then, use each computer's own Vault.`;
  }
}

/**
 * Whether this device signs in to the Library with Identity rather than a pairing: through a saved
 * Identity route, or through the Library's own Identity browser session.
 */
export function connectsWithIdentity(
  entry: ConnectionCatalogEntry | undefined,
  session?: { readonly sessionMethod?: string; readonly identity?: unknown } | null,
): boolean {
  if (session?.sessionMethod === "browser-session-cookie" && session.identity !== undefined)
    return true;
  return entry
    ? connectionRoutes(entry).some((route) => {
        const profile = Option.getOrNull(route.profile);
        return profile?._tag === "BearerConnectionProfile" && profile.identity;
      })
    : false;
}
