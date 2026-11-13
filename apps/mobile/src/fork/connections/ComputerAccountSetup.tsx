import * as Schema from "effect/Schema";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomValue } from "@effect/atom-react";
import {
  accountComputerEnrollmentReady,
  squashLibraryCommandFailure,
} from "@t3tools/client-runtime/fork";
import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { LibraryError, type DirectoryReporting } from "@t3tools/contracts/fork";
import * as SecureStore from "expo-secure-store";
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { library, useLibraryAuthority } from "../library/libraryState";
import { LibrarySignInAgainButton } from "../library/LibrarySignInStatus";

const isLibraryError = Schema.is(LibraryError);

export function ComputerAccountSetup({
  environmentId,
  label,
  connected,
  report,
  remoteEnabled,
  onRefresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly report: DirectoryReporting | null;
  readonly remoteEnabled: boolean;
  readonly onRefresh: () => void;
}) {
  const authority = useLibraryAuthority();
  const source = useEnvironmentQuery(connected ? library.info({ environmentId, input: {} }) : null);
  const computers = useEnvironmentQuery(
    authority.ready && authority.environmentId
      ? library.accountComputers({ environmentId: authority.environmentId, input: {} })
      : null,
  );
  const canInstall = useAtomValue(library.enrollComputer.permissionAtom(environmentId));
  const canApprove = useEnvironmentScope(authority.environmentId, AuthSettingsWriteScope);
  const enroll = useAtomCommand(library.enrollComputer, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const identity = `${environmentId}/${authority.environmentId}`;
  const [finishedFor, setFinishedFor] = useState<string | null>(null);
  const finished = finishedFor === identity;
  if (authority.environmentId === environmentId) return null;
  const ready = accountComputerEnrollmentReady({
    libraryEnvironmentId: authority.environmentId,
    sourceLibraryEnvironmentId: source.data?.destination?.environmentId ?? null,
    membership: computers.isSuccess
      ? (computers.data?.find((computer) => computer.environmentId === environmentId) ?? null)
      : null,
    signedIn: report?.signIn?.state === "ready" || report?.signIn?.state === "expiring",
    remoteEnabled,
  });
  const available = connected && authority.ready && canInstall && canApprove;
  const start = async () => {
    if (busy || !available || !authority.environmentId) return;
    setBusy(true);
    setError(null);
    try {
      const key = `loom.enrollment.v1.${Array.from(
        new TextEncoder().encode(`${environmentId}/${authority.environmentId}`),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")}`;
      let requestId = await SecureStore.getItemAsync(key);
      if (requestId === null) requestId = uuidv4();
      await SecureStore.setItemAsync(key, requestId);
      const result = await enroll({
        environmentId,
        input: { authorityEnvironmentId: authority.environmentId, requestId },
      });
      if (result._tag === "Failure") {
        const cause = squashLibraryCommandFailure(result);
        if (isLibraryError(cause)) {
          if (cause.reason === "request-conflict") await SecureStore.deleteItemAsync(key);
        }
        if (cause instanceof Error) setError(cause);
        else setError(new Error("Setup could not finish. Resume to continue."));
      } else {
        setFinishedFor(identity);
        onRefresh();
        source.refresh();
        computers.refresh();
        await SecureStore.deleteItemAsync(key);
      }
    } catch (cause) {
      if (cause instanceof Error) setError(cause);
      else setError(new Error("Setup could not finish. Resume to continue."));
    }
    setBusy(false);
  };
  return (
    <SettingsSection title="Account access">
      <View className="gap-2 px-4 py-3">
        <Text className="text-base text-foreground">
          {!authority.ready
            ? "Sign in to add this computer"
            : ready
              ? `${label} is ready for your other devices`
              : `Add ${label} to your account`}
        </Text>
        <Text className="text-sm text-foreground-muted">
          {!authority.ready
            ? "Use your Loom account to connect this computer to your other devices."
            : ready
              ? "Open this computer’s conversations from your phone, browser and other Macs."
              : "Approve this computer once to open its conversations from your other devices."}
        </Text>
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error.message}
          </Text>
        ) : null}
        {computers.error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {computers.error}
          </Text>
        ) : null}
        {finished ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
            Computer added. Remote access starts automatically.
          </Text>
        ) : null}
        {!authority.ready ? <LibrarySignInAgainButton kind="library-sign-in" /> : null}
        {authority.ready && !available ? (
          <Text className="text-sm text-foreground-muted">
            {!connected
              ? "Reconnect this computer to finish setup."
              : "Full settings access is needed on this computer and your Library."}
          </Text>
        ) : null}
      </View>
      {authority.ready && !ready ? (
        <ListActionRow
          icon="desktopcomputer"
          label={
            isLibraryError(error) && error.reason === "request-conflict"
              ? "Start setup again"
              : error
                ? "Resume setup"
                : "Add computer"
          }
          loading={busy}
          disabled={!available || !computers.isSuccess || computers.isPending}
          onPress={() => void start()}
        />
      ) : null}
      {computers.error ? (
        <ListActionRow
          icon="arrow.clockwise"
          label="Check account setup again"
          onPress={computers.refresh}
        />
      ) : null}
    </SettingsSection>
  );
}
