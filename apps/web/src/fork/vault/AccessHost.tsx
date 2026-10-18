import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { onOpenVaultAccess } from "./access-navigation";
export function VaultAccessHost() {
  const navigate = useNavigate();
  useEffect(
    () =>
      onOpenVaultAccess((target) => {
        void navigate({
          to: "/settings/loom",
          search: { machine: target.environmentId, project: undefined, checkout: undefined },
          hash: "loom-vault-access",
        });
      }),
    [navigate],
  );
  return null;
}
