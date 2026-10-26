import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ConnectionFormField } from "../../features/connection/ConnectionFormField";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";

/** Where this computer puts new projects and prepared Library files. Shown once it resolves one. */
export function ComputerProjectsFolderSection({
  environmentId,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const allowed = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const saved = config?.settings.projectsDirectory ?? "";
  const value = draft ?? saved;
  const canSave = connected && allowed && !pending;

  async function save(projectsDirectory: string) {
    if (!canSave || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const result = await updateSettings({ environmentId, input: { patch: { projectsDirectory } } });
    pendingRef.current = false;
    setPending(false);
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "The Projects folder could not be saved.");
      return;
    }
    setDraft(null);
  }

  if (!config?.folders) return null;
  return (
    <SettingsSection
      title="Projects folder"
      footer="Folder where Loom puts new projects and prepared Library files on this computer. Existing projects stay where they are. Leave empty to use the Loom home folder."
    >
      <View className="gap-3 p-4">
        <ConnectionFormField
          label="Folder"
          value={value}
          onChangeText={setDraft}
          placeholder={config.folders.projects}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void save(value.trim())}
          editable={canSave}
        />
        {!connected ? (
          <Text className="text-sm text-foreground-muted">
            Reconnect to change this computer's Projects folder.
          </Text>
        ) : !allowed ? (
          <Text className="text-sm text-foreground-muted">
            Settings permission is required to change the Projects folder.
          </Text>
        ) : null}
        {error ? (
          <Text selectable className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
      </View>
      <SettingsActionRow
        icon="checkmark"
        label="Save folder"
        disabled={!canSave || value.trim() === saved}
        loading={pending}
        onPress={() => void save(value.trim())}
      />
      <SettingsActionRow
        icon="arrow.uturn.backward"
        label="Use the Loom home folder"
        disabled={!canSave || saved === ""}
        onPress={() => void save("")}
      />
    </SettingsSection>
  );
}
