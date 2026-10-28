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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the module bus for vault access open requests and unsubscribes on unmount
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the module bus for vault ssh open requests and unsubscribes on unmount
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the module bus for vault profiles open requests and unsubscribes on unmount
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the module bus for vault health open requests and unsubscribes on unmount
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the module bus for vault migration open requests and unsubscribes on unmount
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the module bus for vault test accounts open requests and unsubscribes on unmount
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
