import { useVaultEnvironment } from "./useVaultEnvironment";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthVaultReadScope,
  AuthVaultWriteScope,
  AuthProvidersManageScope,
  ProviderInstanceEnvironmentVariableName,
  ProviderInstanceId,
  type EnvironmentId,
  type SecretReference,
} from "@t3tools/contracts";
import {
  VAULT_PROVIDER_CREDENTIALS_FEATURE,
  isVaultProviderReference,
  vaultProviderBinding,
  vaultProviderReference,
  type VaultReference,
} from "@t3tools/contracts/fork";
import { createVaultReferenceAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { VaultReferenceSearch } from "./ReferenceSearch";

const references = createVaultReferenceAtoms(connectionAtomRuntime);
const isVariableName = Schema.is(ProviderInstanceEnvironmentVariableName);
const authorizationMessage = (failure: unknown, fallback: string) =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "EnvironmentAuthorizationError" &&
  "message" in failure &&
  typeof failure.message === "string"
    ? failure.message
    : fallback;

export function VaultProviderCredentials({
  environmentId,
  connected,
  computerName,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly computerName: string;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const [editing, setEditing] = useState<ProviderInstanceId | null>(null);
  if (!supportsLoomFeature(config?.environment.capabilities, VAULT_PROVIDER_CREDENTIALS_FEATURE))
    return null;
  const instances = Object.entries(config?.settings.providerInstances ?? {});
  return (
    <View className="gap-3 p-4">
      <Text className="font-t3-medium">Vault credentials</Text>
      <Text className="text-sm text-foreground-muted">
        Supply a saved Vault secret to an agent provider on {computerName}. The provider receives
        the value; settings keep only its reference.
      </Text>
      {instances.length === 0 ? (
        <Text className="text-sm text-foreground-muted">
          Add a provider in Loom Settings on your computer to configure its Vault credentials.
        </Text>
      ) : null}
      {instances.map(([id, instance]) => {
        const count = (instance.environment ?? []).filter((variable) =>
          isVaultProviderReference(variable.value),
        ).length;
        const name =
          instance.displayName ??
          config?.providers.find((provider) => provider.instanceId === id)?.displayName ??
          id;
        return (
          <Button
            key={id}
            label={`${name}${count > 0 ? ` · ${count} Vault ${count === 1 ? "credential" : "credentials"}` : ""}`}
            disabled={!connected}
            onPress={() => setEditing(ProviderInstanceId.make(id))}
          />
        );
      })}
      {editing ? (
        <ProviderCredentialEditor
          key={`${environmentId}:${editing}`}
          environmentId={environmentId}
          instanceId={editing}
          computerName={computerName}
          connected={connected}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

function ProviderCredentialEditor({
  environmentId,
  instanceId,
  computerName,
  connected,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly computerName: string;
  readonly connected: boolean;
  readonly onClose: () => void;
}) {
  const { vaultEnvironmentId, resolved } = useVaultEnvironment(environmentId);
  const config = useEnvironmentServerConfig(environmentId);
  const instance = config?.settings.providerInstances[instanceId];
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const canWrite = useEnvironmentScope(environmentId, AuthVaultWriteScope);
  const canRead = useEnvironmentScope(vaultEnvironmentId, AuthVaultReadScope);
  const canUpdate = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(environmentId, {
      patch: {},
      ...(instance
        ? { providerInstanceMutation: { operation: "upsert", instanceId, instance } }
        : {}),
    }),
  );
  const update = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
    reportDefect: false,
  });
  const canRefresh = useAtomValue(
    serverEnvironment.refreshProviders.permissionAtom(environmentId, {
      instanceId,
      reloadSecrets: true,
    }),
  );
  const [name, setName] = useState(
    () =>
      instance?.environment?.find((variable) => isVaultProviderReference(variable.value))?.name ??
      instance?.environment?.find((variable) => variable.sensitive)?.name ??
      "",
  );
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<VaultReference | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const variableName = name.trim();
  const validName = isVariableName(variableName);
  const variable = instance?.environment?.find((entry) => entry.name === variableName);
  const value = variable?.value ?? "";
  const binding = vaultProviderBinding(value);
  const bound = isVaultProviderReference(value);
  const item = useEnvironmentQuery(
    connected &&
      canRead &&
      (binding?.environmentId === environmentId || binding?.environmentId === vaultEnvironmentId)
      ? references.describe({ environmentId: vaultEnvironmentId, input: { id: binding.itemId } })
      : null,
  );
  const provider = config?.providers.find((entry) => entry.instanceId === instanceId);
  const providerName = instance?.displayName ?? provider?.displayName ?? instanceId;
  const providerError =
    provider?.unavailableReason ?? (provider?.status === "error" ? provider.message : null);
  const disabled =
    !resolved || !connected || !instance || !canManage || !canWrite || !canUpdate || pending;

  function chooseVariable(next: string) {
    setName(next);
    setPicking(false);
    setSelected(null);
    setError(null);
    setNotice(null);
  }

  async function save(reference: SecretReference | null) {
    if (disabled || !validName || pendingRef.current) return;
    const current = appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId));
    const currentInstance = current?.settings.providerInstances[instanceId];
    if (!currentInstance) {
      setError("This provider is no longer available. Close this sheet and refresh its settings.");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    const nextVariable = { name: variableName, value: reference ?? "", sensitive: true };
    const environment = currentInstance.environment ?? [];
    const exists = environment.some((entry) => entry.name === variableName);
    await update({
      environmentId,
      input: {
        patch: {},
        providerInstanceMutation: {
          operation: "upsert",
          instanceId,
          instance: {
            ...currentInstance,
            environment: exists
              ? environment.map((entry) => (entry.name === variableName ? nextVariable : entry))
              : [...environment, nextVariable],
          },
        },
      },
    })
      .then((result) => {
        if (result._tag === "Success") {
          setPicking(false);
          setSelected(null);
          setNotice(reference ? "Vault credential saved." : "Vault credential removed.");
          item.refresh();
        } else if (!isAtomCommandInterrupted(result)) {
          setError(
            authorizationMessage(
              squashAtomCommandFailure(result),
              "Could not update the Vault credential. Refresh the provider settings and try again.",
            ),
          );
        }
      })
      .catch(() => {
        setError(
          "Could not update the Vault credential. Refresh the provider settings and try again.",
        );
      })
      .finally(() => {
        pendingRef.current = false;
        setPending(false);
      });
  }

  async function refreshCredentials() {
    if (pendingRef.current || !connected || !canRefresh) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    await refresh({
      environmentId,
      input: { instanceId, reloadSecrets: true },
    })
      .then((result) => {
        if (result._tag === "Success") {
          item.refresh();
          const refreshed = result.value.providers.find((entry) => entry.instanceId === instanceId);
          if (
            !refreshed ||
            refreshed.availability === "unavailable" ||
            refreshed.status === "error"
          ) {
            setError(
              refreshed?.unavailableReason ??
                refreshed?.message ??
                "Provider credentials remain unavailable. Check Vault and the selected item version.",
            );
          } else setNotice("Provider credentials refreshed.");
        } else if (!isAtomCommandInterrupted(result)) {
          setError(
            authorizationMessage(
              squashAtomCommandFailure(result),
              "Could not refresh provider credentials. Check Vault and try again.",
            ),
          );
        }
      })
      .catch(() => setError("Could not refresh provider credentials. Check Vault and try again."))
      .finally(() => {
        pendingRef.current = false;
        setPending(false);
      });
  }

  return (
    <Sheet title={`${providerName} credentials`} onClose={onClose} dismissible={!pending}>
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 pt-4 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <Text>
          Choose the environment variable this provider uses for its API key. The selected secret is
          supplied to {providerName} on {computerName}.
        </Text>
        {!canManage || !canWrite ? (
          <Text accessibilityRole="alert">
            Provider management and Vault write permissions are required to change credentials.
          </Text>
        ) : null}
        {!instance ? <Text accessibilityRole="alert">This provider is unavailable.</Text> : null}
        {providerError ? <Text accessibilityRole="alert">{providerError}</Text> : null}
        {(instance?.environment ?? []).map((entry) => (
          <Button
            key={entry.name}
            label={`${entry.name} · ${isVaultProviderReference(entry.value) ? "Vault" : "Configured"}`}
            disabled={disabled}
            onPress={() => chooseVariable(entry.name)}
          />
        ))}
        <TextInput
          accessibilityLabel="Provider API key environment variable"
          placeholder="OPENAI_API_KEY"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={128}
          editable={!disabled}
          value={name}
          onChangeText={chooseVariable}
        />
        {name.length > 0 && !validName ? (
          <Text accessibilityRole="alert">
            Use a variable name containing letters, numbers and underscores, starting with a letter
            or underscore.
          </Text>
        ) : null}
        {bound ? (
          <View className="gap-2 rounded-lg bg-subtle p-3">
            <Text>
              {item.data?.item.label ?? "Saved Vault item"}
              {binding ? ` · Version ${binding.expectedVersion}` : ""}
            </Text>
            {binding &&
            item.data &&
            (item.data.item.version !== binding.expectedVersion ||
              item.data.item.state !== "active") ? (
              <Text accessibilityRole="alert">
                This item changed or is inactive. Choose an active version before using it again.
              </Text>
            ) : null}
            {!binding ||
            (binding.environmentId !== environmentId &&
              binding.environmentId !== vaultEnvironmentId) ? (
              <Text accessibilityRole="alert">Choose a Vault item from this computer.</Text>
            ) : item.error ? (
              <Text accessibilityRole="alert">{item.error}</Text>
            ) : item.isSuccess && item.data === null ? (
              <Text accessibilityRole="alert">This Vault item is no longer available.</Text>
            ) : null}
            <Button
              label="Remove Vault credential"
              tone="danger"
              disabled={disabled}
              onPress={() => void save(null)}
            />
          </View>
        ) : variable &&
          (typeof value !== "string" || value.length > 0 || variable.valueRedacted) ? (
          <Text className="text-sm text-foreground-muted">
            Selecting a Vault item replaces this variable's current credential source.
          </Text>
        ) : null}
        <Button
          label={
            picking
              ? "Cancel Vault selection"
              : bound
                ? "Change Vault credential"
                : "Choose Vault credential"
          }
          disabled={disabled || !validName || !canRead}
          onPress={() => {
            setPicking(!picking);
            setSelected(null);
            setError(null);
            setNotice(null);
          }}
        />
        {!canRead ? <Text>Vault inspection permission is required to choose a secret.</Text> : null}
        {picking ? (
          <VaultReferenceSearch
            environmentId={vaultEnvironmentId}
            connected={connected}
            kind="secret"
            disabled={disabled}
            onSelect={setSelected}
          />
        ) : null}
        {selected ? (
          <View className="gap-3 rounded-lg bg-subtle p-3">
            <Text>
              Use {selected.item.label}, version {selected.item.version}, for {variableName}?
            </Text>
            <Text className="text-sm text-foreground-muted">
              Rotation requires selecting the new version. Removing or archiving the item blocks new
              provider use.
            </Text>
            <Button
              label="Save Vault credential"
              tone="primary"
              disabled={disabled || !validName || selected.environmentId !== vaultEnvironmentId}
              loading={pending}
              onPress={() =>
                void save(
                  vaultProviderReference({
                    environmentId: vaultEnvironmentId,
                    itemId: selected.item.id,
                    expectedVersion: selected.item.version,
                  }),
                )
              }
            />
          </View>
        ) : null}
        <Button
          label="Refresh provider credentials"
          disabled={!connected || !canRefresh || pending}
          loading={pending}
          onPress={() => void refreshCredentials()}
        />
        {notice ? <Text accessibilityRole="summary">{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
        {bound ? (
          <Button
            label="Refresh Vault item"
            disabled={pending || !connected}
            onPress={item.refresh}
          />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
