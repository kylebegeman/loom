import * as Schema from "effect/Schema";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomValue } from "@effect/atom-react";
import { squashLibraryCommandFailure } from "@t3tools/client-runtime/fork";
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
  connected,
  report,
  remoteEnabled,
  onRefresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly report: DirectoryReporting | null;
  readonly remoteEnabled: boolean;
  readonly onRefresh: () => void;
}) {
  const authority = useLibraryAuthority();
  const source = useEnvironmentQuery(connected ? library.info({ environmentId, input: {} }) : null);
  const canInstall = useAtomValue(library.enrollComputer.permissionAtom(environmentId));
  const canApprove = useEnvironmentScope(authority.environmentId, AuthSettingsWriteScope);
  const enroll = useAtomCommand(library.enrollComputer, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const identity = `${environmentId}/${authority.environmentId}`;
  const [finishedFor, setFinishedFor] = useState<string | null>(null);
  const finished = finishedFor === identity;
  if (authority.environmentId === environmentId) return null;
  const ready =
    finished ||
    (source.data?.destination?.environmentId === authority.environmentId &&
      remoteEnabled &&
      (report?.signIn?.state === "ready" || report?.signIn?.state === "expiring"));
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
          {ready ? "Connected to your account" : "Use this computer from your other devices"}
        </Text>
        <Text className="text-sm text-foreground-muted">
          {ready
            ? "Your Library keeps this computer’s saved work. Your other devices use the same account sign-in."
            : "Add it once. Loom connects your Library, saves conversations and sets up remote access."}
        </Text>
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error.message}
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
                : "Add to my account"
          }
          loading={busy}
          disabled={!available}
          onPress={() => void start()}
        />
      ) : null}
    </SettingsSection>
  );
}
