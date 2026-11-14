import { Link } from "@tanstack/react-router";
import { ACCOUNT_VAULT_FEATURE } from "@t3tools/contracts/fork";
import {
  accountVaultDetail,
  accountVaultState,
  connectsWithIdentity,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { useEnvironmentSessionState } from "~/state/session";
import { useLibraryAuthority } from "../project-library/state";

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
    identity: connectsWithIdentity(authority.environment?.entry),
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
