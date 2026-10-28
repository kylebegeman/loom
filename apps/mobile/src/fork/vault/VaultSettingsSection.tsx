import { VaultItemEditorSheet } from "./VaultItemEditorSheet";
import { VaultPasswordGeneratorSection } from "./PasswordGeneratorSection";
import { VaultOwnerSettings } from "./OwnerSettingsSection";
import { VaultSshSheet } from "./SshSheet";
import { VaultAccessCheckSheet } from "./AccessSettingsSection";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { VaultGitHubSettingsSection } from "./GitHubSettingsSection";
import { AppState, ScrollView, Switch, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import {
  VaultFileContent,
  VAULT_ITEM_SEARCH_FEATURE,
  vaultReferenceText,
  type VaultItemKind,
  type VaultItemSummary,
} from "@t3tools/contracts/fork";
import {
  createVaultCoreAtoms,
  createVaultAccessAtoms,
  supportsLoomFeature,
  vaultStatusMessage,
  VAULT_KIND_LABELS,
  VAULT_REVEAL_DURATION_MS,
  VAULT_SEARCH_DEBOUNCE_MS,
  vaultItemActions,
  vaultItemChanges,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Redacted from "effect/Redacted";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import * as Dialog from "../../components/ui/Dialog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useDebouncedValue } from "../../state/queries";
import { useAtomCommand } from "../../state/use-atom-command";
import { appAtomRegistry } from "../../state/atom-registry";
import { uuidv4 } from "../../lib/uuid";
import { downloadAttachmentForPreview } from "../../lib/attachmentDownload";

const vault = createVaultCoreAtoms(connectionAtomRuntime);
const access = createVaultAccessAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
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
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-core"))
    return <VaultPasswordGeneratorSection />;
  return (
    <>
      {canRead ? (
        <VaultOwnerSettings
          key={`${environmentId}:${canWrite}:${connected}:${supportsLoomFeature(config?.environment.capabilities, "vault-owner-trusted")}`}
          environmentId={environmentId}
          connected={connected}
          items={
            <SettingsSection title="Vault items">
              <VaultItems environmentId={environmentId} connected={connected} />
            </SettingsSection>
          }
        />
      ) : (
        <SettingsSection title="Vault">
          <Text>Your access to this computer does not include Vault inspection.</Text>
        </SettingsSection>
      )}
      <VaultPasswordGeneratorSection environmentId={environmentId} connected={connected} />
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
  const githubEnabled = supportsLoomFeature(config?.environment.capabilities, "vault-github");
  const [githubOpen, setGithubOpen] = useState(false);
  const [sshItem, setSshItem] = useState<string | null | undefined>(undefined);
  const status = useEnvironmentQuery(connected ? vault.status({ environmentId, input: {} }) : null);
  const searchSupported = supportsLoomFeature(
    config?.environment.capabilities,
    VAULT_ITEM_SEARCH_FEATURE,
  );
  const [typedQuery, setTypedQuery] = useState("");
  const query = useDebouncedValue(typedQuery.trim(), VAULT_SEARCH_DEBOUNCE_MS);
  const [kind, setKind] = useState<VaultItemKind | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedCursors, setArchivedCursors] = useState<ReadonlyArray<string | null>>([null]);
  const [cursors, setCursors] = useState<ReadonlyArray<string | null>>([null]);
  const page = useEnvironmentQuery(
    connected && status.data?.state === "ready"
      ? vault.list({
          environmentId,
          input: {
            cursor: cursors[cursors.length - 1] ?? null,
            includeArchived: searchSupported ? false : includeArchived,
            ...(searchSupported
              ? { query, ...(kind ? { kind } : {}), sort: "label" as const }
              : {}),
          },
        })
      : null,
  );
  const archived = useEnvironmentQuery(
    searchSupported && archivedOpen && connected && status.data?.state === "ready"
      ? vault.archivedPage({
          environmentId,
          input: {
            cursor: archivedCursors[archivedCursors.length - 1] ?? null,
            includeArchived: true,
            query,
            ...(kind ? { kind } : {}),
            sort: "label",
          },
        })
      : null,
  );
  const searchPending = searchSupported && typedQuery.trim() !== query;
  const archivedCount = page.data?.archivedCount ?? archived.data?.total;
  const canSave = useAtomValue(vault.save.permissionAtom(environmentId));
  const canChange = useAtomValue(vault.change.permissionAtom(environmentId));
  const canReveal = useAtomValue(vault.reveal.permissionAtom(environmentId));
  const saveChange = useAtomCommand(vault.change, { reportFailure: false });
  const revealItem = useAtomCommand(vault.reveal, { reportFailure: false });
  const [checkingItem, setCheckingItem] = useState<string | null>(null);
  const [editing, setEditing] = useState<VaultItemSummary | "new" | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);
  const revealGeneration = useRef(0);
  const clearRevealed = useCallback(() => {
    revealGeneration.current++;
    setRevealed(null);
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears revealed values and invalidates pending reveals when the app leaves the foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") clearRevealed();
    });
    return () => {
      revealGeneration.current++;
      subscription.remove();
    };
  }, [clearRevealed]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- limits each revealed value's lifetime with a timer cleared on replacement and unmount
  useEffect(() => {
    if (revealed === null) return;
    const timer = setTimeout(clearRevealed, VAULT_REVEAL_DURATION_MS);
    return () => clearTimeout(timer);
  }, [revealed, clearRevealed]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => {
    setRevealed(null);
    status.refresh();
    const signal = vaultItemChanges(environmentId);
    appAtomRegistry.set(signal, appAtomRegistry.get(signal) + 1);
  };
  const act = async (work: () => Promise<unknown>) => {
    if (busy || !connected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    await work()
      .catch((cause: unknown) => setError(message(cause)))
      .finally(() => setBusy(false));
  };
  const change = (item: VaultItemSummary, action: "archive" | "restore" | "delete") =>
    act(async () => {
      const result = await saveChange({
        environmentId,
        input: { id: item.id, operationId: newId(), expectedVersion: item.version, action },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setCursors([null]);
      setArchivedCursors([null]);
      clearRevealed();
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
      const generation = ++revealGeneration.current;
      const result = await revealItem({
        environmentId,
        input: { id: item.id, expectedVersion: item.version },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if (generation !== revealGeneration.current || AppState.currentState !== "active") return;
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
        if (preview) await preview.share(controller.signal).finally(() => preview.dispose());
      } else setRevealed({ id: item.id, value });
    });
  const renderItem = (item: VaultItemSummary) => (
    <View key={item.id} className="gap-2 rounded-2xl bg-subtle p-3">
      <Text className="font-t3-semibold">{item.label}</Text>
      <Text className="text-foreground-muted">
        {VAULT_KIND_LABELS[item.kind]} · Version {item.version}
        {item.state === "archived" ? " · Archived" : ""}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Copy reference"
          disabled={busy || !connected}
          onPress={() =>
            void act(async () => {
              const copied = await Clipboard.setStringAsync(
                vaultReferenceText(environmentId, item.id),
              );
              if (!copied) throw new Error("The reference could not be copied. Try again.");
              setNotice("Reference copied. It contains no credential value.");
            })
          }
        />
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
        {githubEnabled && item.kind === "service-connection" ? (
          <Button
            label="GitHub for agents"
            disabled={!connected || busy}
            onPress={() => {
              clearRevealed();
              setGithubOpen(true);
            }}
          />
        ) : null}
        {vaultItemActions(item.kind).revealValue ? (
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
        ) : null}
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
      {revealed?.id === item.id ? (
        <View className="gap-2">
          <Text selectable>{revealed.value}</Text>
          <Button
            label="Copy value"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                const copied = await Clipboard.setStringAsync(revealed.value, {
                  android: { isSensitive: true },
                });
                if (!copied) throw new Error("The value could not be copied. Try again.");
              })
            }
          />
        </View>
      ) : null}
    </View>
  );
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
      {notice ? <Text accessibilityRole="summary">{notice}</Text> : null}
      {status.data?.state === "ready" && (
        <>
          {searchSupported ? (
            <View className="gap-3">
              <TextInput
                accessibilityLabel="Search Vault items"
                placeholder="Search names and metadata"
                value={typedQuery}
                maxLength={100}
                autoCapitalize="none"
                autoCorrect={false}
                editable={connected && !busy}
                onChangeText={(value) => {
                  setTypedQuery(value);
                  setCursors([null]);
                  setArchivedCursors([null]);
                  clearRevealed();
                }}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
                  <Button
                    label="All kinds"
                    accessibilityLabel={kind === null ? "All kinds, selected" : "All kinds"}
                    tone={kind === null ? "primary" : "secondary"}
                    disabled={busy}
                    onPress={() => {
                      setKind(null);
                      setCursors([null]);
                      setArchivedCursors([null]);
                      clearRevealed();
                    }}
                  />
                  {(Object.keys(VAULT_KIND_LABELS) as VaultItemKind[]).map((value) => (
                    <Button
                      key={value}
                      label={VAULT_KIND_LABELS[value]}
                      accessibilityLabel={`${VAULT_KIND_LABELS[value]}${kind === value ? ", selected" : ""}`}
                      tone={kind === value ? "primary" : "secondary"}
                      disabled={busy}
                      onPress={() => {
                        setKind(value);
                        setCursors([null]);
                        setArchivedCursors([null]);
                        clearRevealed();
                      }}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : (
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
          )}
          {page.isPending || searchPending ? <Text>Loading Vault items…</Text> : null}
          {page.data?.items.length === 0 ? (
            <Text>
              {searchSupported
                ? query || kind
                  ? "No matching Vault items."
                  : "No Vault items yet. Add an item to get started."
                : "No items on this page. Add an item or check the next page."}
            </Text>
          ) : null}
          {page.data?.items.map(renderItem)}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Previous"
              disabled={cursors.length <= 1 || busy || page.isPending || searchPending}
              onPress={() => {
                setCursors((previous) => previous.slice(0, -1));
                setRevealed(null);
              }}
            />
            <Button
              label="Next page"
              disabled={!page.data?.nextCursor || busy || page.isPending || searchPending}
              onPress={() => {
                if (page.data?.nextCursor)
                  setCursors((previous) => [...previous, page.data!.nextCursor]);
                setRevealed(null);
              }}
            />
          </View>
          {searchSupported ? (
            <View className="gap-3">
              <Button
                label={`${archivedOpen ? "Hide archived" : "Archived"}${archivedCount === undefined ? "" : ` (${archivedCount})`}`}
                disabled={!connected || busy}
                onPress={() => {
                  setArchivedOpen(!archivedOpen);
                  clearRevealed();
                }}
              />
              {archivedOpen ? (
                <>
                  {archived.isPending || searchPending ? (
                    <Text>Loading archived items…</Text>
                  ) : null}
                  {archived.error ? <Text accessibilityRole="alert">{archived.error}</Text> : null}
                  {archived.error ? (
                    <Button label="Retry archived items" onPress={refresh} />
                  ) : null}
                  {archived.data?.items.length === 0 ? (
                    <Text>
                      {archived.data.nextCursor
                        ? "Continue to the next page to find archived items."
                        : "No archived items match these filters."}
                    </Text>
                  ) : null}
                  {archived.data?.items.map(renderItem)}
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      label="Previous archived items"
                      disabled={
                        archivedCursors.length <= 1 || busy || archived.isPending || searchPending
                      }
                      onPress={() => {
                        setArchivedCursors((previous) => previous.slice(0, -1));
                        clearRevealed();
                      }}
                    />
                    <Button
                      label="Next archived items"
                      disabled={
                        !archived.data?.nextCursor || busy || archived.isPending || searchPending
                      }
                      onPress={() => {
                        if (archived.data?.nextCursor)
                          setArchivedCursors((previous) => [
                            ...previous,
                            archived.data!.nextCursor,
                          ]);
                        clearRevealed();
                      }}
                    />
                  </View>
                </>
              ) : null}
            </View>
          ) : null}
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
      {githubOpen ? (
        <VaultGitHubSheet
          environmentId={environmentId}
          connected={connected}
          onClose={() => setGithubOpen(false)}
        />
      ) : null}
      {editing !== null ? (
        <VaultItemEditorSheet
          key={editing === "new" ? "new" : editing.id}
          environmentId={environmentId}
          item={editing === "new" ? null : editing}
          connected={connected}
          onCreateSsh={
            sshEnabled
              ? () => {
                  setEditing(null);
                  setSshItem(null);
                }
              : undefined
          }
          onConnectGitHub={
            githubEnabled
              ? () => {
                  setEditing(null);
                  setGithubOpen(true);
                }
              : undefined
          }
          onSaved={() => {
            setEditing(null);
            setCursors([null]);
            setArchivedCursors([null]);
            clearRevealed();
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

function VaultGitHubSheet({
  environmentId,
  connected,
  onClose,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  onClose: () => void;
}) {
  const snapshot = useEnvironmentQuery(
    connected ? access.snapshot({ environmentId, input: {} }) : null,
  );
  return (
    <Sheet title="GitHub for agents" onClose={onClose}>
      <ScrollView contentContainerClassName="gap-4 px-5 pb-8">
        {snapshot.data ? (
          <VaultGitHubSettingsSection
            environmentId={environmentId}
            connected={connected}
            ownerMode={snapshot.data.ownerPolicy?.mode === "owner-trusted"}
          />
        ) : (
          <Text>
            {!connected
              ? "Reconnect this computer to manage GitHub."
              : (snapshot.error ?? "Checking GitHub access…")}
          </Text>
        )}
        {snapshot.error ? <Button label="Retry" onPress={snapshot.refresh} /> : null}
      </ScrollView>
    </Sheet>
  );
}
