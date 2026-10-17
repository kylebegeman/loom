import { useAuth } from "@clerk/expo";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthRelayWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentScope, readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { useConnectionController } from "../../features/connection/useConnectionController";
import { refreshManagedRelayEnvironments } from "../../features/cloud/managedRelayState";
import {
  hasCloudPublicConfig,
  resolveRelayClerkTokenOptions,
} from "../../features/cloud/publicConfig";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";
import {
  getSelectedComputerConnectState,
  linkSelectedComputer,
  unlinkSelectedComputer,
  type SelectedComputerTarget,
  type SelectedComputerAccount,
} from "./rpc/selectedComputer";

const selectedHostScheduler = createAtomCommandScheduler();
const selectedHostConcurrency = {
  mode: "serial" as const,
  key: (input: { target: SelectedComputerTarget }) => input.target.environmentId,
};
const link = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connect:link-selected-host",
  scheduler: selectedHostScheduler,
  concurrency: selectedHostConcurrency,
  execute: (input: { target: SelectedComputerTarget; account: SelectedComputerAccount }) =>
    linkSelectedComputer(input.target, input.account),
});
const unlink = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connect:unlink-selected-host",
  scheduler: selectedHostScheduler,
  concurrency: selectedHostConcurrency,
  execute: (input: { target: SelectedComputerTarget; account: SelectedComputerAccount }) =>
    unlinkSelectedComputer(input.target, input.account),
});

function confirm(
  title: string,
  message: string,
  label: string,
  action: () => void,
  destructive = false,
) {
  Dialog.confirm({ title, message, confirmText: label, onConfirm: action, destructive });
}

export function ComputerConnectSection(props: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  if (!hasCloudPublicConfig()) {
    return (
      <SettingsSection title="Connect account">
        <View className="p-4">
          <AppText className="text-sm text-foreground-muted">
            Account-linked computers are unavailable in this app build. Direct pairing remains
            available.
          </AppText>
        </View>
      </SettingsSection>
    );
  }
  return <ConfiguredComputerConnectSection {...props} />;
}

function ConfiguredComputerConnectSection({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const navigation = useNavigation();
  const connection = useSavedRemoteConnection(environmentId);
  const allowed = useEnvironmentScope(environmentId, AuthRelayWriteScope);
  const controller = useConnectionController();
  const linkHost = useAtomCommand(link, { reportFailure: false });
  const unlinkHost = useAtomCommand(unlink, { reportFailure: false });
  const [pending, setPending] = useState<"link" | "unlink" | null>(null);
  const [cleanupNeeded, setCleanupNeeded] = useState(false);
  const [actionError, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const [actionAccount, setActionAccount] = useState<string | null>(null);
  const target = useMemo<SelectedComputerTarget>(
    () => ({
      environmentId,
      connection,
      canConfigure: () => readEnvironmentScope(environmentId, AuthRelayWriteScope),
    }),
    [environmentId, connection],
  );
  const paired =
    Boolean(connection?.bearerToken) &&
    connection?.authenticationMethod !== "dpop" &&
    connection?.relayManaged !== true;

  const ready = connected && allowed && paired;
  const queryAtom = useMemo(
    () => (ready ? connectionAtomRuntime.atom(getSelectedComputerConnectState(target)) : null),
    [ready, target],
  );
  const query = useEnvironmentQuery(queryAtom);
  const state = query.data;
  const loading = query.isPending;
  const actionMatchesAccount = actionAccount === userId;
  const error = ready ? ((actionMatchesAccount ? actionError : null) ?? query.error) : null;
  const needsCleanup = actionMatchesAccount && cleanupNeeded;
  const session = useAtomValue(managedRelaySessionAtom);
  const signedInAccount = isSignedIn && userId && session?.accountId === userId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run(kind: "link" | "unlink") {
    if (busy.current || !userId || !signedInAccount || !ready) return;
    busy.current = true;
    setActionAccount(userId);
    setPending(kind);
    setError(null);
    setNotice(null);
    try {
      const token = await getToken(resolveRelayClerkTokenOptions());
      if (!token) throw new Error("Sign in to Connect again before managing this computer.");
      const account: SelectedComputerAccount = {
        accountId: userId,
        clerkToken: token,
        isCurrent: () => appAtomRegistry.get(managedRelaySessionAtom)?.accountId === userId,
      };
      const result = await (kind === "link" ? linkHost : unlinkHost)({ target, account });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      if (!mounted.current) return;
      setCleanupNeeded(false);
      setNotice(
        kind === "link"
          ? "This computer is linked to your Connect account."
          : "This computer is unlinked from Connect.",
      );
      refreshManagedRelayEnvironments();
      await controller.refreshRelayEnvironments();
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof Error ? cause.message : "The account link could not be updated.");
      if (
        kind === "unlink" ||
        (cause &&
          typeof cause === "object" &&
          "reason" in cause &&
          cause.reason === "previous-link")
      )
        setCleanupNeeded(true);
    } finally {
      busy.current = false;
      if (mounted.current) {
        query.refresh();
        setPending(null);
      }
    }
  }

  const mismatch = state?.linked === true && state.cloudUserId !== userId;
  const disabled =
    !connected ||
    !allowed ||
    !paired ||
    !isLoaded ||
    !signedInAccount ||
    loading ||
    pending !== null ||
    !query.isSuccess ||
    state === null ||
    mismatch;
  const label = connection?.environmentLabel ?? "this computer";
  return (
    <SettingsSection
      title="Connect account"
      footer="Linked computers appear on devices signed in to the same account."
    >
      <View className="gap-3 p-4">
        <AppText className="text-sm text-foreground-muted">
          {!connected
            ? "Reconnect to manage this computer's account link."
            : !allowed
              ? "Connect management permission is required on this computer."
              : !paired
                ? "Choose a directly paired connection route to manage this computer's account link."
                : !isLoaded
                  ? "Loading your Connect account…"
                  : !isSignedIn
                    ? "Sign in to make this computer available on your other devices."
                    : !signedInAccount
                      ? "Preparing your Connect account…"
                      : loading
                        ? "Checking this computer's account link…"
                        : query.error
                          ? "Could not check this computer's account link. Refresh and try again."
                          : mismatch
                            ? "This computer is linked to another account. Sign in to that account to manage it."
                            : state?.linked
                              ? "Linked to your Connect account."
                              : "This computer is not linked to your Connect account."}
        </AppText>
        {ready && actionMatchesAccount && notice ? (
          <AppText className="text-sm">{notice}</AppText>
        ) : null}
        {error ? (
          <AppText selectable className="text-sm text-danger-foreground">
            {error}
          </AppText>
        ) : null}
      </View>
      {!isSignedIn ? (
        <SettingsActionRow
          icon="person.crop.circle"
          label="Sign in to Connect"
          disabled={!isLoaded || pending !== null}
          onPress={() => navigation.navigate("SettingsSheet", { screen: "SettingsAuth" })}
        />
      ) : null}
      {state?.linked || needsCleanup ? (
        <SettingsActionRow
          icon="cloud"
          label={needsCleanup ? "Finish unlinking this computer" : "Unlink this computer"}
          tone="danger"
          loading={pending === "unlink"}
          disabled={disabled}
          onPress={() =>
            confirm(
              `Unlink ${label}?`,
              "Remove this computer from your Connect account and stop its managed connection. Your devices can still use their direct pairing routes.",
              "Unlink",
              () => void run("unlink"),
              true,
            )
          }
        />
      ) : (
        <SettingsActionRow
          icon="cloud"
          label="Link this computer"
          loading={pending === "link"}
          disabled={disabled}
          onPress={() =>
            confirm(
              `Link ${label}?`,
              "Make this computer available to devices signed in to your Connect account. A small connection helper may be installed on this computer.",
              "Link",
              () => void run("link"),
            )
          }
        />
      )}
      {error && connected && allowed && paired ? (
        <SettingsActionRow
          icon="arrow.clockwise"
          label="Refresh account link"
          disabled={loading || pending !== null}
          onPress={() => {
            setError(null);
            query.refresh();
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
