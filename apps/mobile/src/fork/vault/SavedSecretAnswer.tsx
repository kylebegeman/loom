import { useRef, useState } from "react";
import { View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { VAULT_SECRET_FEATURE, type VaultItemSummary } from "@t3tools/contracts/fork";
import {
  createVaultCoreAtoms,
  createVaultSecretAtoms,
  secretRequestAcceptsItem,
  supportsLoomFeature,
  VAULT_SEARCH_DEBOUNCE_MS,
  VAULT_KIND_LABELS,
} from "@t3tools/client-runtime/fork";
import type { SecretRequestItem } from "@t3tools/client-runtime/secret-request";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useDebouncedValue } from "../../state/queries";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";

const secret = createVaultSecretAtoms(connectionAtomRuntime);
const vault = createVaultCoreAtoms(connectionAtomRuntime);
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Could not use this saved item. Refresh and try again.";

export function SavedSecretAnswer({
  environmentId,
  request,
  disabled,
  onBusyChange,
  onAnswered,
}: {
  environmentId: EnvironmentId;
  request: SecretRequestItem;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onAnswered: () => void;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const supported = supportsLoomFeature(config?.environment.capabilities, VAULT_SECRET_FEATURE);
  const allowed = useAtomValue(secret.answerFromItem.permissionAtom(environmentId));
  const answer = useAtomCommand(secret.answerFromItem, {
    reportFailure: false,
    reportDefect: false,
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(request.label.slice(0, 100));
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const search = useDebouncedValue(query.trim(), VAULT_SEARCH_DEBOUNCE_MS);
  const page = useEnvironmentQuery(
    supported
      ? vault.list({
          environmentId,
          input: { cursor, includeArchived: false, query: search, sort: "label" },
        })
      : null,
  );
  const items =
    page.data?.items.filter((item) =>
      secretRequestAcceptsItem(item, request.delivery === "file"),
    ) ?? [];
  const exact = items.find(
    (item) => item.label.toLowerCase() === request.label.trim().toLowerCase(),
  );
  const answerWithItem = async (item: VaultItemSummary) => {
    if (busy.current || disabled || !allowed) return;
    busy.current = true;
    onBusyChange(true);
    setError(null);
    await (async () => {
      const response = await answer({
        environmentId,
        input: {
          threadId: request.threadId,
          turnItemId: request.id,
          itemId: item.id,
          expectedVersion: item.version,
        },
      });
      if (response._tag === "Success") onAnswered();
      else setError(message(squashAtomCommandFailure(response)));
    })()
      .catch((cause: unknown) => setError(message(cause)))
      .finally(() => {
        busy.current = false;
        onBusyChange(false);
      });
  };
  if (!supported) return null;
  return (
    <View className="gap-2">
      <Button
        label={exact && !open ? `Use saved item: ${exact.label}` : "Use saved item"}
        tone="secondary"
        disabled={disabled || !allowed || page.isPending}
        onPress={() => (exact && !open ? void answerWithItem(exact) : setOpen(!open))}
      />
      {exact && !open ? (
        <Button
          label="Choose another"
          tone="text"
          disabled={disabled}
          onPress={() => setOpen(true)}
        />
      ) : null}
      {open ? (
        <View className="gap-2">
          <TextInput
            accessibilityLabel="Find saved item"
            value={query}
            maxLength={100}
            editable={!disabled}
            onChangeText={(value) => {
              setQuery(value);
              setCursor(null);
            }}
          />
          {page.isPending || search !== query.trim() ? (
            <Text accessibilityRole="summary">Finding saved items…</Text>
          ) : null}
          {page.error ? <Text accessibilityRole="alert">{page.error}</Text> : null}
          {!page.isPending && page.isSuccess && items.length === 0 ? (
            <Text>No matching saved item.</Text>
          ) : null}
          {items.map((item) => (
            <Button
              key={item.id}
              label={`${item.label} · ${VAULT_KIND_LABELS[item.kind]}`}
              tone="secondary"
              disabled={disabled || !allowed || search !== query.trim()}
              onPress={() => void answerWithItem(item)}
            />
          ))}
          {page.data?.nextCursor ? (
            <Button
              label="More items"
              tone="text"
              disabled={disabled || page.isPending}
              onPress={() => setCursor(page.data!.nextCursor)}
            />
          ) : null}
        </View>
      ) : null}
      {error || open ? (
        <Button
          label="Refresh saved items"
          tone="text"
          disabled={disabled}
          onPress={() => {
            page.refresh();
            setError(null);
          }}
        />
      ) : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
