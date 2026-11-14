import { useAtomValue } from "@effect/atom-react";
import { squashLibraryCommandFailure } from "@t3tools/client-runtime/fork";
import type { AuthMcpClientAccess } from "@t3tools/contracts";
import { ACCOUNT_LINKS_LIBRARY_FEATURE, type AccountLinkPolicy } from "@t3tools/contracts/fork";
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { RUNTIME_MODE_CHOICES } from "../../features/threads/thread-settings-options";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useLibraryAuthority } from "../library/libraryState";
import { accountLinks } from "./accountLinksState";

const ACCESS_CHOICES: ReadonlyArray<{
  readonly mode: AuthMcpClientAccess;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "read-only",
    label: "Read only",
    description: "Read projects and threads. Cannot start, message or change anything.",
  },
  ...RUNTIME_MODE_CHOICES,
];

/** The owner's choice, kept on the Library, of whether agents on one computer may work on the others. */
export function AccountLinksPolicy() {
  const authority = useLibraryAuthority();
  const environmentId = authority.environmentId;
  const available =
    authority.ready &&
    authority.info.data?.features?.includes(ACCOUNT_LINKS_LIBRARY_FEATURE) === true;
  const canChange = useAtomValue(accountLinks.setPolicy.permissionAtom(environmentId));
  const policy = useEnvironmentQuery(
    available && environmentId ? accountLinks.policy({ environmentId, input: {} }) : null,
  );
  const setPolicy = useAtomCommand(accountLinks.setPolicy, { reportFailure: false });
  const [saving, setSaving] = useState<AccountLinkPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!available || !environmentId) return null;
  const shown = saving ?? policy.data;
  const save = async (next: AccountLinkPolicy) => {
    if (saving !== null) return;
    setSaving(next);
    setError(null);
    const result = await setPolicy({ environmentId, input: next });
    if (result._tag === "Failure") {
      const cause = squashLibraryCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : "The change could not be saved. Try again.",
      );
    }
    policy.refresh();
    setSaving(null);
  };
  const disabled = !canChange || saving !== null;
  return (
    <SettingsSection title="Agents across your computers">
      {shown === null ? (
        policy.error ? null : (
          <View className="p-4">
            <Text accessibilityRole="text" className="text-sm text-foreground-muted">
              Loading agent access…
            </Text>
          </View>
        )
      ) : (
        <>
          <ListToggleRow
            label="Let agents work across your computers"
            description="Agents on one of your computers can start, message and wait on threads on your others. Loom links your computers and keeps the links renewed. Turning this off removes them within a few minutes."
            value={shown.enabled}
            disabled={disabled}
            onValueChange={(enabled) => void save({ ...shown, enabled })}
          />
          {shown.enabled
            ? ACCESS_CHOICES.map((choice) => (
                <ListChoiceRow
                  key={choice.mode}
                  label={choice.label}
                  description={choice.description}
                  selected={shown.access === choice.mode}
                  separated
                  disabled={disabled}
                  onPress={() => void save({ ...shown, access: choice.mode })}
                />
              ))
            : null}
        </>
      )}
      {error || policy.error ? (
        <View className="p-4">
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error ?? policy.error}
          </Text>
        </View>
      ) : null}
    </SettingsSection>
  );
}
