import { Link } from "@tanstack/react-router";
import { ACCOUNT_VAULT_FEATURE } from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { useLibraryAuthority } from "../project-library/state";

export function AccountVault() {
  const authority = useLibraryAuthority();
  if (
    !authority.authorityId ||
    !supportsLoomFeature(
      authority.environment?.serverConfig?.environment.capabilities,
      ACCOUNT_VAULT_FEATURE,
    )
  )
    return null;
  return (
    <SettingsSection title="Account Vault" id="account-vault">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div className="max-w-prose space-y-1">
          <p className="text-sm">SSH and GitHub connections for your approved computers.</p>
          <p className="text-xs text-muted-foreground">
            {authority.connected
              ? `Managed by ${authority.environment?.label ?? "your Library"}.`
              : "Reconnect your account to manage saved connections."}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!authority.connected}
          render={
            <Link
              to="/settings/vault"
              search={{ machine: authority.authorityId }}
              hash="loom-vault"
            />
          }
        >
          Manage account Vault
        </Button>
      </div>
    </SettingsSection>
  );
}
