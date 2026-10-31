import { useState } from "react";
import { View, Switch } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  createVaultCoreAtoms,
  supportsLoomFeature,
  secretSaveTarget,
  VAULT_SEARCH_DEBOUNCE_MS,
  VAULT_KIND_LABELS,
} from "@t3tools/client-runtime/fork";
import { VAULT_SECRET_FEATURE } from "@t3tools/contracts/fork";
import { useEnvironmentQuery } from "../../state/query";
import { useDebouncedValue } from "../../state/queries";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
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
  const matchingItem = secretSaveTarget(matches.data?.items ?? [], name, false);
  const target = saveAsNew ? null : matchingItem;
  const lookupPending =
    matchingSupported && (query !== name.trim().slice(0, 100) || matches.isPending);
  const lookupFailed = matchingSupported && !matches.isPending && !matches.isSuccess;
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
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <Switch
            accessibilityLabel="Also save a copy to Vault"
            value={enabled}
            disabled={disabled || saved || (!allowed && !enabled)}
            onValueChange={setEnabled}
          />
          <Text className="flex-1 text-sm">Also save a copy to Vault</Text>
        </View>
        {enabled ? (
          <View className="gap-2">
            <Text className="text-xs font-t3-medium text-foreground-muted">Vault item name</Text>
            <TextInput
              accessibilityLabel="Vault item name"
              value={name}
              maxLength={200}
              editable={!disabled && !saved && allowed}
              onChangeText={setName}
            />
            {lookupPending ? (
              <Text accessibilityRole="summary" className="text-xs text-foreground-muted">
                Checking saved items…
              </Text>
            ) : lookupFailed ? (
              <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
                Could not check saved items. Refresh the lookup before saving to Vault.
              </Text>
            ) : matchingItem ? (
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="How to save this Vault copy"
                className="overflow-hidden rounded-xl border border-border-subtle"
              >
                <ListChoiceRow
                  label="Update existing item"
                  description={`${matchingItem.label} · ${VAULT_KIND_LABELS[matchingItem.kind]} · Version ${matchingItem.version} · ${matchingItem.id.slice(0, 8)}`}
                  selected={!saveAsNew}
                  disabled={disabled || saved || !allowed}
                  onPress={() => setSaveAsNew(false)}
                />
                <ListChoiceRow
                  label="Create new item"
                  description="Keep the existing item unchanged."
                  selected={saveAsNew}
                  separated
                  disabled={disabled || saved || !allowed}
                  onPress={() => setSaveAsNew(true)}
                />
              </View>
            ) : name.trim() ? (
              <Text className="text-xs text-foreground-muted">
                A new Vault item will be created.
              </Text>
            ) : null}
          </View>
        ) : null}
        {saved ? (
          <Text accessibilityRole="summary" className="text-xs text-foreground-muted">
            Saved to Vault as {name}. The private request still needs to finish.
          </Text>
        ) : null}
        {enabled && matchingSupported && (error || lookupFailed) ? (
          <Button
            label="Refresh matching item"
            tone="text"
            disabled={disabled || saved}
            onPress={() => {
              matches.refresh();
              setError(null);
            }}
          />
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
            {error}
          </Text>
        ) : null}
      </View>
    ) : null;
  return { beforeReply, control, saved };
}
