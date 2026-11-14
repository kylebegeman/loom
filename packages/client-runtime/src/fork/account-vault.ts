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
  | { readonly kind: "no-access"; readonly identity: boolean };

/** The account Vault lives on the Library, so managing it needs Vault inspection there. */
export function accountVaultState(input: AccountVaultInput): AccountVaultState {
  if (!input.authorityId || !input.supported) return { kind: "none" };
  if (!input.connected || input.sessionFailed) return { kind: "reconnect" };
  if (input.session === null) return { kind: "checking" };
  if (!input.session.authenticated) return { kind: "reconnect" };
  return sessionGrantsScope(input.session, AuthAccessReadScope)
    ? { kind: "open" }
    : { kind: "no-access", identity: input.identity };
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
    case "no-access":
      return state.identity
        ? `Your sign-in to ${library} does not include Vault access, so the account Vault cannot be managed from this device. To allow it, set LOOM_IDENTITY_ALLOW_ADMIN=true on ${library}, restart it and sign in again. Until then, use each computer's own Vault.`
        : `This device's pairing with ${library} does not include Vault access, so the account Vault cannot be managed from this device. Pair it again with a link that includes View access and Manage access. Until then, use each computer's own Vault.`;
  }
}

/** Whether a saved connection signs in with Identity rather than a pairing. */
export function connectsWithIdentity(entry: ConnectionCatalogEntry | undefined): boolean {
  return entry
    ? connectionRoutes(entry).some((route) => {
        const profile = Option.getOrNull(route.profile);
        return profile?._tag === "BearerConnectionProfile" && profile.identity;
      })
    : false;
}
