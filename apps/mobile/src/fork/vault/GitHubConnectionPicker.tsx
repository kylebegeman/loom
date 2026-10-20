import { useState } from "react";
import { View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultGitHubInfo } from "@t3tools/contracts/fork";
import { createVaultGitHubAtoms } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
const atoms = createVaultGitHubAtoms(connectionAtomRuntime);
export function VaultGitHubConnectionPicker({
  environmentId,
  connected,
  onSelect,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  onSelect: (id: string, repository: string) => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useEnvironmentQuery(
    connected ? atoms.list({ environmentId, input: { cursor } }) : null,
  );
  const disabled = !connected || page.isPending || !!page.error;
  return (
    <View className="gap-3">
      <Text>
        Choose a dedicated GitHub connection and an allowed repository. Manage connections in Vault
        GitHub connections.
      </Text>
      <Button
        label="Refresh available GitHub connections"
        disabled={!connected}
        onPress={page.refresh}
      />
      {page.isPending ? <Text>Loading GitHub connections…</Text> : null}
      {page.error ? (
        <Text accessibilityRole="alert">
          Could not load GitHub connections. Check Vault access and refresh.
        </Text>
      ) : null}
      {page.data?.items.length === 0 ? (
        <Text>No GitHub connections in this page. Continue if more pages are available.</Text>
      ) : null}
      {page.data?.items.map((info) => (
        <Choice
          key={`${info.item.id}:${info.item.version}`}
          info={info}
          disabled={disabled}
          onSelect={onSelect}
        />
      ))}
      <Button
        label="First available GitHub connections"
        disabled={disabled || !cursor}
        onPress={() => setCursor(null)}
      />
      <Button
        label="More available GitHub connections"
        disabled={disabled || !page.data?.nextCursor}
        onPress={() => setCursor(page.data?.nextCursor ?? null)}
      />
    </View>
  );
}
function Choice({
  info,
  disabled,
  onSelect,
}: {
  info: VaultGitHubInfo;
  disabled: boolean;
  onSelect: (id: string, repo: string) => void;
}) {
  const [index, setIndex] = useState(0),
    repository = info.repositories[index]!;
  return (
    <View className="gap-2 rounded-lg bg-subtle p-3">
      <Text>
        {info.item.label} · {info.account} · {info.item.state}
      </Text>
      <Button
        label={`Allowed repository: ${repository}`}
        disabled={disabled || info.repositories.length < 2}
        onPress={() => setIndex((index + 1) % info.repositories.length)}
      />
      <Button
        label={`Bind GitHub connection ${info.item.label}`}
        disabled={disabled || info.item.state !== "active"}
        onPress={() => onSelect(info.item.id, repository)}
      />
    </View>
  );
}
