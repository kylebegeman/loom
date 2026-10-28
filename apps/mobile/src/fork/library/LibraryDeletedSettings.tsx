import { useAtomValue } from "@effect/atom-react";
import { LIBRARY_DELETED_FEATURE } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { library, useLibraryAuthority, useLoomFeature } from "./libraryState";

export function LibraryDeletedSettings() {
  const authority = useLibraryAuthority();
  const supported = useLoomFeature(authority.environmentId, LIBRARY_DELETED_FEATURE);
  const allowed = useAtomValue(
    library.setDeletedPreferences.permissionAtom(authority.environmentId),
  );
  const preferences = useEnvironmentQuery(
    supported && authority.environmentId
      ? library.deletedPreferences({ environmentId: authority.environmentId, input: {} })
      : null,
  );
  const save = useAtomCommand(library.setDeletedPreferences, { reportFailure: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  if (!supported) return null;
  const value = draft ?? String(preferences.data?.retentionDays ?? 30);
  const days = Number(value);
  const valid = /^\d+$/.test(value) && Number.isInteger(days) && days >= 1 && days <= 3650;
  const disabled =
    !authority.ready || !allowed || busy || preferences.isPending || !preferences.data;
  const submit = async () => {
    if (disabled || !valid || !authority.environmentId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    await save({
      environmentId: authority.environmentId,
      input: { requestId: uuidv4(), retentionDays: days },
    })
      .then((result) => {
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        setDraft(String(result.value.retentionDays));
        preferences.refresh();
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not save Library retention."),
      )
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };
  return (
    <SettingsSection title="Recently deleted">
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground">
          Erase deleted conversations after this many days
        </Text>
        <TextInput
          accessibilityLabel="Erase deleted conversations after days"
          keyboardType="number-pad"
          value={value}
          onChangeText={setDraft}
          editable={!disabled}
        />
        <Text className="text-xs text-foreground-muted">
          Choose 1 to 3650 days. Deleted conversations remain readable and can be continued until
          they are erased.
        </Text>
        {!allowed ? (
          <Text className="text-sm text-foreground-muted">
            Only the Library owner can change retention.
          </Text>
        ) : null}
        <Button
          label={busy ? "Saving…" : "Save retention"}
          disabled={disabled || !valid}
          onPress={() => void submit()}
        />
        {preferences.isPending ? (
          <Text className="text-sm text-foreground-muted">Loading Library retention…</Text>
        ) : null}
        {error || preferences.error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error ?? preferences.error}
          </Text>
        ) : null}
        {preferences.error ? (
          <Button label="Reload retention" onPress={preferences.refresh} />
        ) : null}
      </View>
    </SettingsSection>
  );
}
