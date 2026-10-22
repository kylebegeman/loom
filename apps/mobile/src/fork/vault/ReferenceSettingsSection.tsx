import { useState } from "react";
import { Pressable, View } from "react-native";
import { AuthAccessReadScope, type EnvironmentId } from "@t3tools/contracts";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { VaultReferenceSearch } from "./ReferenceSearch";

export function VaultReferenceSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState(environmentId);
  const source = environments.find((e) => e.environmentId === selected);
  return (
    <View className="gap-3">
      <Text>Search on computer</Text>
      <Text>
        Each computer checks its own inspection permission. References grant no access and do not
        move credentials or bindings.
      </Text>
      <View accessibilityRole="radiogroup" className="gap-2">
        {environments.map((e) => (
          <Pressable
            key={e.environmentId}
            accessibilityRole="radio"
            accessibilityState={{ checked: e.environmentId === selected }}
            onPress={() => setSelected(e.environmentId)}
            className="min-h-12 justify-center rounded-lg bg-subtle p-3"
          >
            <Text>
              {e.label} ({e.environmentId}){e.environmentId === selected ? " · Selected" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {!source ? (
        <Text accessibilityRole="summary">
          The selected computer is unavailable. Choose a connected computer.
        </Text>
      ) : (
        <ReferenceSearchTarget
          key={selected}
          environmentId={selected}
          connected={source.connection.phase === "connected"}
        />
      )}
    </View>
  );
}
function ReferenceSearchTarget({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  if (!connected)
    return (
      <Text accessibilityRole="summary">Connect the selected computer to search its Vault.</Text>
    );
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-references"))
    return <Text>Reference search needs a server with Vault reference support.</Text>;
  if (!canRead)
    return <Text>Your connection to this computer does not include Vault inspection.</Text>;
  return <VaultReferenceSearch environmentId={environmentId} connected />;
}
