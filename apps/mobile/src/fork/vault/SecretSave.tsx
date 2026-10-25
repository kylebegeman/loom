import { useState } from "react";
import { View, Switch } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { createVaultCoreAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import * as Redacted from "effect/Redacted";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
const vault = createVaultCoreAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
export function useSecretVaultSave(environmentId: EnvironmentId, initialName: string) {
  const config = useEnvironmentServerConfig(environmentId);
  const allowed = useAtomValue(vault.save.permissionAtom(environmentId));
  const supported = supportsLoomFeature(config?.environment.capabilities, "vault-core");
  const save = useAtomCommand(vault.save, { reportFailure: false, reportDefect: false });
  const [id] = useState(newId);
  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState(initialName.slice(0, 200));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const beforeReply = async (secret: string) => {
    if (!enabled || saved) return true;
    if (!allowed || !supported || !name.trim()) {
      setError("Enter a Vault name and check your write access to this computer.");
      return false;
    }
    const result = await save({
      environmentId,
      input: {
        id,
        operationId: id,
        expectedVersion: 0,
        label: name.trim(),
        kind: "secret",
        value: Redacted.make(secret),
      },
    });
    if (result._tag === "Failure") {
      setError(
        "Could not confirm the Vault save. Retry with the same name and value, or turn this option off to answer only.",
      );
      return false;
    }
    setSaved(true);
    setError(null);
    return true;
  };
  const control = (disabled: boolean) =>
    supported || enabled ? (
      <View className="gap-2">
        <View className="flex-row items-center gap-2">
          <Switch
            accessibilityLabel="Also save to Vault"
            value={enabled}
            disabled={disabled || saved || (!allowed && !enabled)}
            onValueChange={setEnabled}
          />
          <Text>Also save to Vault as</Text>
        </View>
        {enabled ? (
          <TextInput
            accessibilityLabel="Vault item name"
            value={name}
            maxLength={200}
            editable={!disabled && !saved && allowed}
            onChangeText={setName}
          />
        ) : null}
        {saved ? (
          <Text accessibilityRole="summary">
            Saved to Vault as {name}. The private request still needs to finish.
          </Text>
        ) : null}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      </View>
    ) : null;
  return { beforeReply, control, saved };
}
