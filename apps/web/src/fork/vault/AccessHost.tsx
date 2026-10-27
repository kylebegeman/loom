import { onOpenVaultTestAccounts } from "./test-accounts-navigation";
import { onOpenVaultMigration } from "./migration-navigation";
import { onOpenVaultHealth } from "./health-navigation";
import { onOpenVaultProfiles } from "./profile-navigation";
import { onOpenVaultSsh } from "./ssh-navigation";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { onOpenVaultAccess } from "./access-navigation";
import { forkSettingsTarget } from "../settings/navigation";
export function VaultAccessHost() {
  const navigate = useNavigate();
  useEffect(
    () =>
      onOpenVaultAccess((target) => {
        void navigate({
          ...forkSettingsTarget("vault-access"),
          search: { machine: target.environmentId, project: undefined, checkout: undefined },
        });
      }),
    [navigate],
  );
  useEffect(
    () =>
      onOpenVaultSsh((environmentId) => {
        void navigate({
          ...forkSettingsTarget("vault"),
          search: { machine: environmentId, project: undefined, checkout: undefined },
        });
      }),
    [navigate],
  );
  useEffect(
    () =>
      onOpenVaultProfiles(({ environmentId, section }) => {
        void navigate({
          ...forkSettingsTarget(`vault-${section}`),
          search: { machine: environmentId, project: undefined, checkout: undefined },
        });
      }),
    [navigate],
  );
  useEffect(
    () =>
      onOpenVaultHealth((environmentId) => {
        void navigate({
          ...forkSettingsTarget("vault-health"),
          search: { machine: environmentId, project: undefined, checkout: undefined },
        });
      }),
    [navigate],
  );
  useEffect(
    () =>
      onOpenVaultMigration((environmentId, section) => {
        void navigate({
          ...forkSettingsTarget(
            section === "inventory" ? "vault-migration-inventory" : "vault-migration",
          ),
          search: { machine: environmentId, project: undefined, checkout: undefined },
        });
      }),
    [navigate],
  );
  useEffect(
    () =>
      onOpenVaultTestAccounts((environmentId) => {
        void navigate({
          ...forkSettingsTarget("vault-test-accounts"),
          search: { machine: environmentId, project: undefined, checkout: undefined },
        });
      }),
    [navigate],
  );
  return null;
}
