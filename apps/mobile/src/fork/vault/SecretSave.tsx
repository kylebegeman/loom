import { useState } from "react";
import { View, Switch } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  createVaultCoreAtoms,
  supportsLoomFeature,
  secretSaveTarget,
  VAULT_SEARCH_DEBOUNCE_MS,
} from "@t3tools/client-runtime/fork";
import { VAULT_SECRET_FEATURE } from "@t3tools/contracts/fork";
import { useEnvironmentQuery } from "../../state/query";
import { useDebouncedValue } from "../../state/queries";
import { Button } from "../../components/ui/Button";
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
  const [saveAsNew, setSaveAsNew] = useState(false);
  const query = useDebouncedValue(name.trim().slice(0, 100), VAULT_SEARCH_DEBOUNCE_MS);
  const matchingSupported = supportsLoomFeature(
    config?.environment.capabilities,
    VAULT_SECRET_FEATURE,
  );
  const matches = useEnvironmentQuery(
    matchingSupported
      ? vault.list({
          environmentId,
          input: { cursor: null, includeArchived: false, query, sort: "label" },
        })
      : null,
  );
  const target = secretSaveTarget(matches.data?.items ?? [], name, saveAsNew);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const beforeReply = async (secret: string) => {
    if (!enabled || saved) return true;
    if (!allowed || !supported || !name.trim()) {
      setError("Enter a Vault name and check your write access to this computer.");
      return false;
    }
    if (
      matchingSupported &&
      (query !== name.trim().slice(0, 100) || matches.isPending || !matches.isSuccess)
    ) {
      setError("Wait for the saved-item lookup, or retry if Vault is unavailable.");
      return false;
    }
    const result = await save({
      environmentId,
      input: {
        id: target?.id ?? id,
        operationId: id,
        expectedVersion: target?.version ?? 0,
        label: name.trim(),
        kind: target?.kind ?? "secret",
        value: Redacted.make(secret),
      },
    });
    if (result._tag === "Failure") {
      setError(
        "Could not save this item. It may have changed. Refresh and retry, or turn this option off to answer only.",
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
          <Text>{target ? `Replace value of ${target.label}` : "Also save to Vault as"}</Text>
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
        {enabled && matchingSupported ? (
          <Button
            label={saveAsNew ? "Use matching item" : "Save as new"}
            tone="text"
            disabled={disabled || saved}
            onPress={() => setSaveAsNew(!saveAsNew)}
          />
        ) : null}
        {saved ? (
          <Text accessibilityRole="summary">
            Saved to Vault as {name}. The private request still needs to finish.
          </Text>
        ) : null}
        {error && matchingSupported ? (
          <Button
            label="Refresh matching item"
            tone="text"
            disabled={disabled}
            onPress={() => {
              matches.refresh();
              setError(null);
            }}
          />
        ) : null}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      </View>
    ) : null;
  return { beforeReply, control, saved };
}
