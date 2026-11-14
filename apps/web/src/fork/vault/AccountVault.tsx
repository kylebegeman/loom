import { Link } from "@tanstack/react-router";
import { ACCOUNT_VAULT_FEATURE } from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { useEnvironmentSessionState } from "~/state/session";
import { identityProfile } from "../identity/identityProfile";
import { useLibraryAuthority } from "../project-library/state";
import { accountVaultState, type AccountVaultState } from "./account-vault";

export function useAccountVault() {
  const authority = useLibraryAuthority();
  const session = useEnvironmentSessionState(authority.authorityId);
  const state = accountVaultState({
    authorityId: authority.authorityId,
    supported: supportsLoomFeature(
      authority.environment?.serverConfig?.environment.capabilities,
      ACCOUNT_VAULT_FEATURE,
    ),
    connected: authority.connected,
    identity: identityProfile(authority.environment?.entry) !== undefined,
    session: session.data,
    sessionFailed: session.hasError,
  });
  return { authority, state };
}

export function AccountVault() {
  const { authority, state } = useAccountVault();
  if (state.kind === "none") return null;
  const library = authority.environment?.label ?? "your Library";
  return (
    <SettingsSection title="Account Vault" id="account-vault">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div className="max-w-prose space-y-1">
          <p className="text-sm">Saved connections and secrets for your approved computers.</p>
          <p className="text-xs text-muted-foreground">{accountVaultDetail(state, library)}</p>
        </div>
        {state.kind === "no-access" ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={state.kind !== "open"}
            render={
              <Link
                to="/settings/vault"
                search={{ machine: authority.authorityId ?? undefined }}
                hash="loom-vault"
              />
            }
          >
            Manage account Vault
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}

function accountVaultDetail(state: Exclude<AccountVaultState, { kind: "none" }>, library: string) {
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
