import { VaultTestAccountSettingsSection } from "./TestAccountSettingsSection";
import { VaultMigrationInventorySettingsSection } from "./MigrationInventorySettingsSection";
import { VaultMigrationSettingsSection } from "./MigrationSettingsSection";
import { VaultHealthSettingsSection } from "./HealthSettingsSection";
import { VaultGitHubSettingsSection } from "./GitHubSettingsSection";
import { VaultProfileSettingsSection } from "./ProfileSettingsSection";
import { VaultSshSheet } from "./SshSheet";
import { VaultBrokerSettingsSection } from "./BrokerSettingsSection";
import { VaultAccessSettingsSection, VaultAccessCheckSheet } from "./AccessSettingsSection";
import { useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { VaultFileContent, VaultItemKind, type VaultItemSummary } from "@t3tools/contracts/fork";
import {
  createVaultCoreAtoms,
  supportsLoomFeature,
  vaultStatusMessage,
  VAULT_KIND_LABELS,
  VAULT_FILE_LIMIT_BYTES,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Redacted from "effect/Redacted";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import * as Dialog from "../../components/ui/Dialog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { downloadAttachmentForPreview } from "../../lib/attachmentDownload";

const vault = createVaultCoreAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
const encodeFile = Schema.encodeSync(Schema.fromJsonString(VaultFileContent));
const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(VaultFileContent));
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The Vault operation failed. Try again.";

export function VaultSettingsSection({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-core")) return null;
  return (
    <>
      <SettingsSection title="Vault">
        {canRead ? (
          <VaultItems
            key={`${environmentId}:${canWrite}:${connected}`}
            environmentId={environmentId}
            connected={connected}
          />
        ) : (
          <Text>Your access to this computer does not include Vault inspection.</Text>
        )}
      </SettingsSection>
      <VaultTestAccountSettingsSection environmentId={environmentId} connected={connected} />
      <VaultMigrationInventorySettingsSection environmentId={environmentId} connected={connected} />
      <VaultMigrationSettingsSection environmentId={environmentId} connected={connected} />
      <VaultHealthSettingsSection environmentId={environmentId} connected={connected} />
      <VaultBrokerSettingsSection environmentId={environmentId} connected={connected} />
      <VaultGitHubSettingsSection environmentId={environmentId} connected={connected} />
      <VaultAccessSettingsSection environmentId={environmentId} connected={connected} />
      <VaultProfileSettingsSection environmentId={environmentId} connected={connected} />
    </>
  );
}
function VaultItems({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const sshEnabled = supportsLoomFeature(config?.environment.capabilities, "vault-ssh-management");
  const [sshItem, setSshItem] = useState<string | null | undefined>(undefined);
  const status = useEnvironmentQuery(connected ? vault.status({ environmentId, input: {} }) : null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [cursors, setCursors] = useState<ReadonlyArray<string | null>>([null]);
  const page = useEnvironmentQuery(
    connected && status.data?.state === "ready"
      ? vault.list({
          environmentId,
          input: { cursor: cursors[cursors.length - 1] ?? null, includeArchived },
        })
      : null,
  );
  const canSave = useAtomValue(vault.save.permissionAtom(environmentId));
  const canChange = useAtomValue(vault.change.permissionAtom(environmentId));
  const canReveal = useAtomValue(vault.reveal.permissionAtom(environmentId));
  const saveChange = useAtomCommand(vault.change, { reportFailure: false });
  const revealItem = useAtomCommand(vault.reveal, { reportFailure: false });
  const [checkingItem, setCheckingItem] = useState<string | null>(null);
  const [editing, setEditing] = useState<VaultItemSummary | "new" | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setRevealed(null);
    status.refresh();
    page.refresh();
  };
  const act = async (work: () => Promise<unknown>) => {
    if (busy || !connected) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const change = (item: VaultItemSummary, action: "archive" | "restore" | "delete") =>
    act(async () => {
      const result = await saveChange({
        environmentId,
        input: { id: item.id, operationId: newId(), expectedVersion: item.version, action },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      refresh();
    });
  const remove = (item: VaultItemSummary) =>
    Dialog.alert(
      `Delete ${item.label}?`,
      "The current value will be removed. Encrypted prior versions remain subject to your backend's retention policy.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete item", style: "destructive", onPress: () => void change(item, "delete") },
      ],
    );
  const reveal = (item: VaultItemSummary) =>
    act(async () => {
      if (revealed?.id === item.id) {
        setRevealed(null);
        return;
      }
      const result = await revealItem({
        environmentId,
        input: { id: item.id, expectedVersion: item.version },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const value = Redacted.value(result.value.value);
      if (item.kind === "secure-file") {
        const decoded = decodeFile(value);
        if (Option.isNone(decoded))
          throw new Error("This record does not contain a supported file.");
        const controller = new AbortController();
        const preview = await downloadAttachmentForPreview({
          url: `vault:${item.id}`,
          attachment: {
            name: decoded.value.name,
            mimeType: decoded.value.mediaType || "application/octet-stream",
          },
          signal: controller.signal,
          download: async (file) => {
            file.create();
            file.write(decoded.value.base64, { encoding: "base64" });
          },
        });
        try {
          await preview?.share(controller.signal);
        } finally {
          preview?.dispose();
        }
      } else setRevealed({ id: item.id, value });
    });
  return (
    <View className="gap-3">
      <Text className="text-foreground-muted">Development access for this computer</Text>
      {!connected ? (
        <Text>Reconnect this computer to manage Vault.</Text>
      ) : status.data ? (
        <Text>{vaultStatusMessage(status.data)}</Text>
      ) : (
        <Text>{status.error ?? "Checking Vault connection…"}</Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        <Button label="Refresh" disabled={!connected || busy} onPress={refresh} />
        {sshEnabled ? (
          <Button
            label="Create SSH key"
            disabled={!connected || !canSave || busy || status.data?.state !== "ready"}
            onPress={() => setSshItem(null)}
          />
        ) : null}
        <Button
          label="Add item"
          tone="primary"
          disabled={!connected || !canSave || busy || status.data?.state !== "ready"}
          onPress={() => setEditing("new")}
        />
      </View>
      {error || page.error ? <Text accessibilityRole="alert">{error ?? page.error}</Text> : null}
      {status.data?.state === "ready" && (
        <>
          <View className="flex-row items-center justify-between gap-2">
            <Text>Include archived items</Text>
            <Switch
              accessibilityLabel="Include archived Vault items"
              value={includeArchived}
              onValueChange={(next) => {
                setIncludeArchived(next);
                setCursors([null]);
                setRevealed(null);
              }}
            />
          </View>
          {page.isPending && !page.data ? <Text>Loading Vault items…</Text> : null}
          {page.data?.items.length === 0 ? (
            <Text>No items on this page. Add a development credential or check the next page.</Text>
          ) : null}
          {page.data?.items.map((item) => (
            <View key={item.id} className="gap-2 rounded-2xl bg-subtle p-3">
              <Text className="font-t3-semibold">{item.label}</Text>
              <Text className="text-foreground-muted">
                {VAULT_KIND_LABELS[item.kind]} · Version {item.version}
                {item.state === "archived" ? " · Archived" : ""}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label="Why this access?"
                  disabled={!connected || busy}
                  onPress={() => {
                    setRevealed(null);
                    setCheckingItem(item.id);
                  }}
                />
                {sshEnabled && item.kind === "ssh-key" ? (
                  <Button
                    label="Manage SSH key"
                    disabled={!connected || busy}
                    onPress={() => {
                      setRevealed(null);
                      setSshItem(item.id);
                    }}
                  />
                ) : null}
                <Button
                  label={
                    item.kind === "secure-file"
                      ? "Share file"
                      : revealed?.id === item.id
                        ? "Hide value"
                        : "Reveal value"
                  }
                  disabled={!connected || !canReveal || busy}
                  onPress={() => void reveal(item)}
                />
                {item.state === "active" ? (
                  <Button
                    label="Edit"
                    disabled={!connected || !canSave || busy}
                    onPress={() => {
                      setRevealed(null);
                      setEditing(item);
                    }}
                  />
                ) : null}
                <Button
                  label={item.state === "active" ? "Archive" : "Restore"}
                  disabled={!connected || !canChange || busy}
                  onPress={() => void change(item, item.state === "active" ? "archive" : "restore")}
                />
                <Button
                  label="Delete"
                  tone="text"
                  disabled={!connected || !canChange || busy}
                  onPress={() => remove(item)}
                />
              </View>
              {revealed?.id === item.id ? <Text selectable>{revealed.value}</Text> : null}
            </View>
          ))}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Previous"
              disabled={cursors.length <= 1 || busy}
              onPress={() => {
                setCursors((previous) => previous.slice(0, -1));
                setRevealed(null);
              }}
            />
            <Button
              label="Next page"
              disabled={!page.data?.nextCursor || busy}
              onPress={() => {
                if (page.data?.nextCursor)
                  setCursors((previous) => [...previous, page.data!.nextCursor]);
                setRevealed(null);
              }}
            />
          </View>
        </>
      )}
      {checkingItem !== null ? (
        <VaultAccessCheckSheet
          environmentId={environmentId}
          itemId={checkingItem}
          onClose={() => setCheckingItem(null)}
        />
      ) : null}
      {sshItem !== undefined ? (
        <VaultSshSheet
          key={`${environmentId}:${sshItem ?? "new"}`}
          environmentId={environmentId}
          itemId={sshItem}
          connected={connected}
          onClose={() => setSshItem(undefined)}
        />
      ) : null}
      {editing !== null ? (
        <VaultEditor
          key={editing === "new" ? "new" : editing.id}
          environmentId={environmentId}
          item={editing === "new" ? null : editing}
          connected={connected}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}
function VaultEditor({
  environmentId,
  item,
  connected,
  onSaved,
  onClose,
}: {
  environmentId: EnvironmentId;
  item: VaultItemSummary | null;
  connected: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [id] = useState(() => item?.id ?? newId());
  const [operationId, setOperationId] = useState(newId);
  const [label, setLabel] = useState(item?.label ?? "");
  const [kind, setKind] = useState<VaultItemKind>(item?.kind ?? "secret");
  const [replace, setReplace] = useState(item === null);
  const [value, setValue] = useState("");
  const [multiline, setMultiline] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = useAtomValue(vault.save.permissionAtom(environmentId));
  const saveItem = useAtomCommand(vault.save, { reportFailure: false });
  const changed = () => setOperationId(newId());
  const pickFile = async () => {
    let file: File | undefined;
    setBusy(true);
    try {
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
      if (!label) setLabel(asset.name);
      changed();
      setError(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
      try {
        if (file?.uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
      } catch {
        setError(
          "The imported cache copy could not be removed. Clear the app cache when finished.",
        );
      }
    }
  };
  const save = async () => {
    if (busy || !connected || !allowed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveItem({
        environmentId,
        input: {
          id,
          operationId,
          expectedVersion: item?.version ?? 0,
          label,
          kind,
          ...(replace ? { value: Redacted.make(value) } : {}),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setValue("");
      onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
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
          {item
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
        {item ? (
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
        <Text>Kind</Text>
        <View className="flex-row flex-wrap gap-2">
          {VaultItemKind.literals.map((next) => (
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
                setMultiline(next === "ssh-key" || next === "secure-note");
                changed();
              }}
            />
          ))}
        </View>
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
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
        <View className="flex-row flex-wrap gap-2">
          <Button label="Cancel" disabled={busy} onPress={onClose} />
          <Button
            label={busy ? "Saving…" : "Save item"}
            tone="primary"
            disabled={
              !connected ||
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
