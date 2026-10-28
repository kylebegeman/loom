import { useState } from "react";
import { View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultItemKind, VaultItemSummary } from "@t3tools/contracts/fork";
import { supportsLoomFeature, vaultAddPrefill } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { useEnvironmentServerConfig } from "../../state/entities";
import { VaultItemEditorSheet } from "./VaultItemEditorSheet";
import { VaultSshSheet } from "./SshSheet";
import { VaultGitHubConnectSheet } from "./GitHubSettingsSection";

export function VaultAddSheet({
  environmentId,
  connected,
  query = "",
  kind = null,
  value = "",
  onSaved,
  onClose,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  query?: string;
  kind?: VaultItemKind | null;
  value?: string;
  onSaved: (item: VaultItemSummary) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => vaultAddPrefill(query, kind));
  const config = useEnvironmentServerConfig(environmentId);
  const supported = (feature: string) =>
    supportsLoomFeature(config?.environment.capabilities, feature);
  if (
    (draft.manager === "ssh" && !supported("vault-ssh-management")) ||
    (draft.manager === "github" && !supported("vault-github"))
  )
    return (
      <Sheet title="Add Vault item" onClose={onClose}>
        <View className="gap-3 p-4">
          <Text>Update Loom on this computer to create this connection.</Text>
          <Button label="Close" onPress={onClose} />
        </View>
      </Sheet>
    );
  if (draft.manager === "ssh")
    return (
      <VaultSshSheet
        environmentId={environmentId}
        connected={connected}
        itemId={null}
        initialLabel={draft.label}
        onSelect={onSaved}
        onClose={onClose}
      />
    );
  if (draft.manager === "github")
    return (
      <VaultGitHubConnectSheet
        environmentId={environmentId}
        connected={connected}
        initialLabel={draft.label}
        onSaved={(info) => onSaved(info.item)}
        onClose={onClose}
      />
    );
  return (
    <VaultItemEditorSheet
      environmentId={environmentId}
      connected={connected}
      item={null}
      initialLabel={draft.label}
      initialKind={draft.kind}
      initialValue={value}
      fixedKind={kind ?? undefined}
      onSaved={onSaved}
      onClose={onClose}
      onCreateSsh={
        supported("vault-ssh-management")
          ? (label) => setDraft(vaultAddPrefill(label, "ssh-key"))
          : undefined
      }
      onConnectGitHub={
        supported("vault-github")
          ? (label) => setDraft(vaultAddPrefill(label, "service-connection"))
          : undefined
      }
    />
  );
}
