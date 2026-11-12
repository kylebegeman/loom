import { useAtomValue } from "@effect/atom-react";
import { squashLibraryCommandFailure } from "@t3tools/client-runtime/fork";
import { ACCOUNT_COMPUTERS_FEATURE, type AccountComputerStatus } from "@t3tools/contracts/fork";
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { library, useLibraryAuthority } from "../library/libraryState";

export function AccountComputers() {
  const authority = useLibraryAuthority();
  const environmentId = authority.environmentId;
  const available =
    authority.ready && authority.info.data?.features?.includes(ACCOUNT_COMPUTERS_FEATURE);
  const canRemove = useAtomValue(library.removeAccountComputer.permissionAtom(environmentId));
  const computers = useEnvironmentQuery(
    available && environmentId !== null
      ? library.accountComputers({ environmentId, input: {} })
      : null,
  );
  const remove = useAtomCommand(library.removeAccountComputer, { reportFailure: false });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ authorityId: string; message: string } | null>(null);
  if (!available || environmentId === null) return null;
  const endAccess = async (computer: AccountComputerStatus) => {
    if (!canRemove || pending !== null) return;
    setPending(computer.environmentId);
    setError(null);
    const result = await remove({
      environmentId,
      input: {
        environmentId: computer.environmentId,
        membershipRevision: computer.membershipRevision,
        requestId: uuidv4(),
      },
    });
    if (result._tag === "Failure") {
      const cause = squashLibraryCommandFailure(result);
      setError({
        authorityId: environmentId,
        message:
          cause instanceof Error
            ? cause.message
            : "The computer could not be removed. Refresh and try again.",
      });
    }
    computers.refresh();
    setPending(null);
  };
  const confirm = (computer: AccountComputerStatus) => {
    if (computer.state === "removing") {
      void endAccess(computer);
      return;
    }
    Dialog.confirm({
      title: `Remove ${computer.label}?`,
      message:
        "This ends its publishing and remote account access. Saved conversations and projects stay in the Library. Add the computer again to reconnect it.",
      confirmText: "Remove computer",
      destructive: true,
      onConfirm: () => void endAccess(computer),
    });
  };
  return (
    <SettingsSection title="Account computers">
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">
          Remove a retired or lost computer here. Your saved work stays in the Library.
        </Text>
        {error?.authorityId === environmentId || computers.error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error?.authorityId === environmentId ? error.message : computers.error}
          </Text>
        ) : null}
        <Button
          label={computers.data === null ? "Load computers" : "Refresh computers"}
          size="compact"
          onPress={computers.refresh}
        />
        {computers.data?.length === 0 ? (
          <Text className="text-sm text-foreground-muted">
            No computers added. Add a computer to use it from your other devices.
          </Text>
        ) : null}
      </View>
      {computers.data?.map((computer) => (
        <View key={computer.environmentId} className="gap-3 border-t border-border p-4">
          <Text className="text-base font-semibold text-foreground">{computer.label}</Text>
          <Text className="text-sm text-foreground-muted">
            {computer.state === "active"
              ? "Account access enabled"
              : computer.state === "removing"
                ? "Account access ended. Cleanup pending."
                : "Removed. Saved work kept."}
          </Text>
          {computer.state === "removing" ? (
            <Text className="text-sm text-foreground-muted">
              {computer.publishingEnded ? "Publishing ended." : "Publishing cleanup pending."}{" "}
              {computer.routeRemoved ? "Remote route removed." : "Remote route cleanup pending."}{" "}
              {computer.directoryRemoved
                ? "Registration removed."
                : "Registration cleanup pending."}
            </Text>
          ) : null}
          {computer.detail ? (
            <Text className="text-sm text-danger-foreground">{computer.detail}</Text>
          ) : null}
          {computer.state !== "removed" ? (
            <Button
              size="compact"
              disabled={!canRemove || pending !== null}
              accessibilityLabel={`${computer.state === "removing" ? "Retry cleanup for" : "Remove"} ${computer.label}`}
              onPress={() => confirm(computer)}
              label={
                pending === computer.environmentId
                  ? "Removing..."
                  : computer.state === "removing"
                    ? "Retry cleanup"
                    : "Remove computer"
              }
            />
          ) : null}
        </View>
      ))}
    </SettingsSection>
  );
}
