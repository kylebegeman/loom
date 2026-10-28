import { useState } from "react";
import { Switch, View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  VAULT_ITEM_SEARCH_FEATURE,
  type VaultReference,
  type VaultItemKind,
} from "@t3tools/contracts/fork";
import {
  createVaultReferenceAtoms,
  createVaultCoreAtoms,
  vaultAddPrefill,
  vaultPickerSelection,
  VAULT_KIND_LABELS,
  VAULT_SEARCH_DEBOUNCE_MS,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import * as Clipboard from "expo-clipboard";
import { useAtomValue } from "@effect/atom-react";
import { VaultAddSheet } from "./VaultAddSheet";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useDebouncedValue } from "../../state/queries";
const references = createVaultReferenceAtoms(connectionAtomRuntime);
const core = createVaultCoreAtoms(connectionAtomRuntime);
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Vault reference search failed. Refresh and try again.";
export function VaultReferenceSearch({
  environmentId,
  connected,
  onSelect,
  kind = null,
  disabled: inputDisabled = false,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  onSelect?: (r: VaultReference) => void;
  kind?: VaultItemKind | null;
  disabled?: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const canAdd = useAtomValue(core.save.permissionAtom(environmentId));
  const [adding, setAdding] = useState(false);
  const searchSupported = supportsLoomFeature(
    config?.environment.capabilities,
    VAULT_ITEM_SEARCH_FEATURE,
  );
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), VAULT_SEARCH_DEBOUNCE_MS);
  const activeQuery = searchSupported ? debouncedQuery : search;
  const searchPending = searchSupported && query.trim() !== debouncedQuery;
  const page = useEnvironmentQuery(
    connected
      ? references.search({
          environmentId,
          input: { query: activeQuery, kind, includeArchived: archived, cursor },
        })
      : null,
  );
  const disabled = inputDisabled || !connected || page.isPending || searchPending || !!page.error;
  const prefill = vaultAddPrefill(activeQuery, kind);
  return (
    <View className="gap-3">
      <Text>Search Vault references</Text>
      <TextInput
        accessibilityLabel="Search Vault references"
        value={query}
        maxLength={100}
        placeholder="Name or item ID"
        editable={connected && !inputDisabled}
        onChangeText={(value) => {
          setQuery(value);
          if (searchSupported) setCursor(null);
          setNotice(null);
        }}
        autoCapitalize="none"
      />
      {!searchSupported ? (
        <Button
          label="Search references"
          disabled={inputDisabled || !connected || page.isPending}
          onPress={() => {
            setSearch(query.trim());
            setCursor(null);
            setNotice(null);
            page.refresh();
          }}
        />
      ) : null}
      <View className="flex-row items-center gap-2">
        <Switch
          accessibilityLabel="Include archived references"
          value={archived}
          disabled={inputDisabled || !connected}
          onValueChange={(v) => {
            setArchived(v);
            setCursor(null);
          }}
        />
        <Text>Include archived references</Text>
      </View>
      {page.isPending || searchPending ? (
        <Text accessibilityRole="summary">Searching references…</Text>
      ) : null}
      {page.error ? <Text accessibilityRole="alert">{message(page.error)}</Text> : null}
      {page.error ? <Button label="Retry reference search" onPress={page.refresh} /> : null}
      {page.data?.items.length === 0 ? (
        <Text>
          {page.data.nextCursor
            ? "No matches in this page. Continue searching."
            : "No matching Vault references."}
        </Text>
      ) : null}
      {searchSupported &&
      onSelect &&
      !disabled &&
      page.data?.items.length === 0 &&
      cursor === null &&
      !page.data.nextCursor ? (
        <Button
          label={
            prefill.manager === "ssh"
              ? `Create SSH key${prefill.label ? ` named "${prefill.label}"` : ""}`
              : prefill.manager === "github"
                ? `Connect GitHub${prefill.label ? ` as "${prefill.label}"` : ""}`
                : `Add ${VAULT_KIND_LABELS[prefill.kind].toLowerCase()}${prefill.label ? ` named "${prefill.label}"` : ""}`
          }
          disabled={!canAdd}
          onPress={() => setAdding(true)}
        />
      ) : null}
      {page.data?.items.map((r) => (
        <View key={r.item.id} className="gap-2 rounded-lg bg-subtle p-3">
          <Text>{r.item.label}</Text>
          <Text>
            {VAULT_KIND_LABELS[r.item.kind]} · Version {r.item.version}
            {r.item.state === "archived" ? " · Archived" : ""}
          </Text>
          <Button
            label={onSelect ? `Use ${r.item.label}` : `Copy reference for ${r.item.label}`}
            disabled={disabled || (!!onSelect && r.item.state !== "active")}
            onPress={() => {
              if (onSelect) {
                onSelect(r);
                return;
              }
              void Clipboard.setStringAsync(r.reference).then(
                () => setNotice("Reference copied. It contains no credential value."),
                () => setNotice("The reference could not be copied. Try again."),
              );
            }}
          />
        </View>
      ))}
      {notice ? <Text accessibilityRole="summary">{notice}</Text> : null}
      {adding ? (
        <VaultAddSheet
          environmentId={environmentId}
          connected={connected}
          query={activeQuery}
          kind={kind}
          onClose={() => setAdding(false)}
          onSaved={(item) => {
            const selection = vaultPickerSelection(environmentId, item, kind);
            if (!selection) {
              setNotice("Choose an active Vault item of the required kind.");
              return;
            }
            setAdding(false);
            page.refresh();
            onSelect?.(selection);
          }}
        />
      ) : null}
      <Button
        label="First references"
        disabled={disabled || cursor === null}
        onPress={() => setCursor(null)}
      />
      <Button
        label="More references"
        disabled={disabled || !page.data?.nextCursor}
        onPress={() => setCursor(page.data?.nextCursor ?? null)}
      />
    </View>
  );
}
