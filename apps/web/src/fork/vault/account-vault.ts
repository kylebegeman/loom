import {
  AuthAccessReadScope,
  sessionGrantsScope,
  type SessionGrantInput,
} from "@t3tools/contracts";

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
