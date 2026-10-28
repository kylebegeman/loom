import { useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId } from "@t3tools/contracts";
import {
  VaultFileContent,
  type VaultItemKind,
  type VaultItemSummary,
} from "@t3tools/contracts/fork";
import {
  createVaultCoreAtoms,
  VAULT_FILE_LIMIT_BYTES,
  VAULT_GENERIC_ITEM_KINDS,
  VAULT_KIND_LABELS,
  vaultItemActions,
  vaultStatusMessage,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
const vault = createVaultCoreAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
const encodeFile = Schema.encodeSync(Schema.fromJsonString(VaultFileContent));
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The Vault operation failed. Try again.";
const removeCacheCopy = (file: File | undefined) => {
  if (file?.uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
};

export function VaultItemEditorSheet({
  environmentId,
  item,
  connected,
  initialLabel = "",
  initialKind = "secret",
  initialValue = "",
  fixedKind,
  onCreateSsh,
  onConnectGitHub,
  onSaved,
  onClose,
}: {
  environmentId: EnvironmentId;
  item: VaultItemSummary | null;
  connected: boolean;
  initialLabel?: string;
  initialKind?: VaultItemKind;
  initialValue?: string;
  fixedKind?: VaultItemKind | undefined;
  onCreateSsh?: (label: string) => void;
  onConnectGitHub?: (label: string) => void;
  onSaved: (item: VaultItemSummary) => void;
  onClose: () => void;
}) {
  const managed = item !== null && !vaultItemActions(item.kind).replaceValue;
  const [id] = useState(() => item?.id ?? newId());
  const [operationId, setOperationId] = useState(newId);
  const [label, setLabel] = useState(item?.label ?? initialLabel);
  const [kind, setKind] = useState<VaultItemKind>(item?.kind ?? initialKind);
  const [replace, setReplace] = useState(item === null);
  const [value, setValue] = useState(initialValue);
  const [multiline, setMultiline] = useState(initialKind === "secure-note");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = useAtomValue(vault.save.permissionAtom(environmentId));
  const saveItem = useAtomCommand(vault.save, { reportFailure: false });
  const status = useEnvironmentQuery(connected ? vault.status({ environmentId, input: {} }) : null);
  const ready = connected && status.data?.state === "ready";
  const changed = () => setOperationId(newId());
  const pickFile = async () => {
    let file: File | undefined;
    setBusy(true);
    // Stands in for try/finally, which the React Compiler cannot lower. Every return and throw,
    // synchronous ones included, still reaches the cleanup.
    await (async () => {
      const selection = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (selection.canceled) return;
      const asset = selection.assets[0];
      if (!asset) return;
      file = new File(asset.uri);
      if (file.size > VAULT_FILE_LIMIT_BYTES)
        throw new Error("Choose a file no larger than 512 KB.");
      const base64 = await file.base64();
      setValue(
        encodeFile({
          name: asset.name,
          mediaType: asset.mimeType ?? "application/octet-stream",
          base64,
        }),
      );
      setFileName(asset.name);
      setKind("secure-file");
      setReplace(true);
      if (!label.trim()) setLabel(asset.name);
      changed();
      setError(null);
    })()
      .catch((cause: unknown) => setError(message(cause)))
      .finally(() => {
        setBusy(false);
        try {
          removeCacheCopy(file);
        } catch {
          setError(
            "The imported cache copy could not be removed. Clear the app cache when finished.",
          );
        }
      });
  };
  const save = async () => {
    if (busy || !ready || !allowed) return;
    setBusy(true);
    setError(null);
    await saveItem({
      environmentId,
      input: {
        id,
        operationId,
        expectedVersion: item?.version ?? 0,
        label,
        kind,
        ...(replace ? { value: Redacted.make(value) } : {}),
      },
    })
      .then((result) => {
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        setValue("");
        onSaved(result.value);
      })
      .catch((cause: unknown) => setError(message(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <Sheet
      title={item ? "Edit Vault item" : "Add Vault item"}
      dismissible={!busy}
      onClose={onClose}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerClassName="gap-4 px-5 pb-8"
      >
        <Text>
          {managed
            ? "Rename this item here. Manage its connection in the dedicated settings."
            : item
              ? "Rename this item without changing its value, or replace the value explicitly."
              : "Save development access separately from your personal accounts."}
        </Text>
        <View className="gap-2">
          <Text>Name</Text>
          <TextInput
            accessibilityLabel="Vault item name"
            value={label}
            maxLength={200}
            editable={!busy}
            autoCorrect={false}
            onChangeText={(next) => {
              setLabel(next);
              changed();
            }}
          />
        </View>
        {item && !managed ? (
          <View className="flex-row items-center justify-between">
            <Text>Replace value</Text>
            <Switch
              accessibilityLabel="Replace Vault value"
              disabled={busy}
              value={replace}
              onValueChange={(next) => {
                setReplace(next);
                setKind(item.kind);
                setValue("");
                setFileName(null);
                changed();
              }}
            />
          </View>
        ) : null}
        {!item && !fixedKind ? (
          <View className="flex-row flex-wrap gap-2">
            {onCreateSsh ? (
              <Button label="Create SSH key" onPress={() => onCreateSsh(label)} />
            ) : null}
            {onConnectGitHub ? (
              <Button label="Connect GitHub" onPress={() => onConnectGitHub(label)} />
            ) : null}
          </View>
        ) : null}
        {!managed && !fixedKind ? (
          <>
            <Text>Kind</Text>
            <View className="flex-row flex-wrap gap-2">
              {VAULT_GENERIC_ITEM_KINDS.map((next) => (
                <Button
                  key={next}
                  label={VAULT_KIND_LABELS[next]}
                  tone={next === kind ? "primary" : "secondary"}
                  disabled={busy || (item !== null && !replace)}
                  onPress={() => {
                    setKind(next);
                    setReplace(true);
                    setValue("");
                    setFileName(null);
                    setMultiline(next === "secure-note");
                    changed();
                  }}
                />
              ))}
            </View>
          </>
        ) : null}
        {replace ? (
          kind === "secure-file" ? (
            <View className="gap-2">
              <Text>File, up to 512 KB</Text>
              <Button
                label={fileName ?? "Choose file"}
                disabled={busy}
                onPress={() => void pickFile()}
              />
            </View>
          ) : (
            <View className="gap-2">
              <Text>Value</Text>
              {!fixedKind ? (
                <Button label="Choose file" disabled={busy} onPress={() => void pickFile()} />
              ) : null}
              <TextInput
                accessibilityLabel="Vault item value"
                value={value}
                editable={!busy}
                secureTextEntry={!multiline}
                multiline={multiline}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                onChangeText={(next) => {
                  setValue(next);
                  changed();
                }}
              />
              <Button
                label={multiline ? "Use hidden single-line entry" : "Use visible multiline entry"}
                disabled={busy || (multiline && value.includes("\n"))}
                tone="text"
                onPress={() => setMultiline((previous) => !previous)}
              />
            </View>
          )
        ) : null}
        {!ready ? (
          <View className="gap-2">
            <Text accessibilityRole="alert">
              {!connected
                ? "Reconnect this computer to save a Vault item."
                : (status.error ??
                  (status.data ? vaultStatusMessage(status.data) : "Checking Vault connection…"))}
            </Text>
            <Button
              label="Refresh Vault connection"
              disabled={!connected || busy}
              onPress={status.refresh}
            />
          </View>
        ) : null}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
        <View className="flex-row flex-wrap gap-2">
          <Button label="Cancel" disabled={busy} onPress={onClose} />
          <Button
            label={busy ? "Saving…" : "Save item"}
            tone="primary"
            disabled={
              !ready ||
              !allowed ||
              busy ||
              !label.trim() ||
              (replace && kind === "secure-file" && !fileName)
            }
            onPress={() => void save()}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}
