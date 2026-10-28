import { useAtomValue } from "@effect/atom-react";
import { createComputerNamingAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId } from "@t3tools/contracts";
import { COMPUTER_NAME_MAX_LENGTH } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ConnectionFormField } from "../../features/connection/ConnectionFormField";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";

const naming = createComputerNamingAtoms(connectionAtomRuntime);

export function ComputerNameSection({
  environmentId,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const supported = supportsLoomFeature(config?.environment.capabilities, "computer-naming");
  const allowed = useAtomValue(naming.rename.permissionAtom(environmentId));
  const query = useEnvironmentQuery(
    supported && connected && allowed ? naming.get({ environmentId, input: {} }) : null,
  );
  const rename = useAtomCommand(naming.rename, { reportFailure: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const liveLabel = config?.environment.label;
  const name = draft ?? liveLabel ?? query.data?.label ?? "";
  const observedLabel = useRef(liveLabel);
  const refreshNaming = query.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches naming metadata from the server when another client renames the host
  useEffect(() => {
    if (!supported || !connected || !allowed || liveLabel === undefined) return;
    const previous = observedLabel.current;
    observedLabel.current = liveLabel;
    // Another client can rename this host while these details remain open.
    // The stream owns the visible name; reload override metadata for Reset.
    if (previous !== undefined && previous !== liveLabel) refreshNaming();
  }, [supported, connected, allowed, liveLabel, refreshNaming]);
  const canSave = connected && allowed && !pending;

  async function save(nextName: string | null) {
    if (!canSave || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await rename({ environmentId, input: { name: nextName } });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      setDraft(null);
      query.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The computer name could not be saved.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  if (!supported) return null;
  return (
    <SettingsSection
      title="Computer name"
      footer="Saved on this computer and shown across your connected devices. Its identity, projects and connection routes stay the same."
    >
      <View className="gap-3 p-4">
        <ConnectionFormField
          label="Name"
          value={name}
          onChangeText={setDraft}
          maxLength={COMPUTER_NAME_MAX_LENGTH}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (name.trim()) void save(name.trim());
          }}
          editable={canSave}
        />
        {!connected ? (
          <Text className="text-sm text-foreground-muted">Reconnect to rename this computer.</Text>
        ) : !allowed ? (
          <Text className="text-sm text-foreground-muted">
            Settings permission is required to rename this computer.
          </Text>
        ) : null}
        {(error ?? query.error) ? (
          <Text selectable className="text-sm text-danger-foreground">
            {error ?? query.error}
          </Text>
        ) : null}
      </View>
      <SettingsActionRow
        icon="checkmark"
        label="Save name"
        disabled={!canSave || name.trim().length === 0 || name.trim() === config?.environment.label}
        loading={pending}
        onPress={() => {
          void save(name.trim());
        }}
      />
      <SettingsActionRow
        icon="arrow.uturn.backward"
        label="Use computer's system name"
        disabled={!canSave || query.data?.name == null}
        onPress={() => {
          void save(null);
        }}
      />
    </SettingsSection>
  );
}
