import {
  accountClientSessions,
  createAuthEnvironmentAtoms,
} from "@t3tools/client-runtime/state/auth";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  type AuthClientSession,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { Button } from "../../components/ui/Button";
import { useAtomCommand } from "../../state/use-atom-command";
import * as Dialog from "../../components/ui/Dialog";

const authEnvironment = createAuthEnvironmentAtoms(connectionAtomRuntime);

export function DevicesWithAccessSection({
  environmentId,
  connected,
  account = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly account?: boolean;
}) {
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  const access = useEnvironmentQuery(
    connected && canRead ? authEnvironment.accessChanges({ environmentId, input: null }) : null,
  );
  const allSessions = access.data?.type === "snapshot" ? access.data.payload.clientSessions : [];
  const sessions = account ? accountClientSessions(allSessions) : allSessions;
  const revoke = useAtomCommand(authEnvironment.revokeClient, { reportFailure: false });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endAccess = (session: AuthClientSession) => {
    if (!canWrite || pending !== null) return;
    // oxlint-disable-next-line t3code/no-rpc-permission-bypass -- AuthClientSession.client holds device metadata.
    const { client: device } = session;
    Dialog.confirm({
      title: `End access for ${device.label ?? device.os ?? device.deviceType}?`,
      message: account
        ? "It will need to sign in again to access your account and computers. Your saved work stays in your account. An already authenticated external connection may continue until it ends."
        : "It will need to reconnect to use this computer again. Your saved work stays on the computer.",
      confirmText: "End access",
      destructive: true,
      onConfirm: () => {
        setPending(session.sessionId);
        setError(null);
        void revoke({ environmentId, input: { sessionId: session.sessionId } }).then((result) => {
          if (result._tag === "Failure") {
            const cause = squashAtomCommandFailure(result);
            setError(
              cause instanceof Error
                ? cause.message
                : "Access could not be ended. Refresh and try again.",
            );
          }
          setPending(null);
        });
      },
    });
  };
  return (
    <SettingsSection
      title={account ? "Signed-in devices" : "Devices with access"}
      footer={
        account
          ? "End access here if a phone or browser is lost. This ends its online access across your account’s computers."
          : "These devices have permission to connect to this computer."
      }
    >
      {error ? (
        <Text accessibilityRole="alert" className="p-4 text-sm text-danger-foreground">
          {error}
        </Text>
      ) : null}
      {!connected ? (
        <Text className="p-4 text-sm text-foreground-muted">
          Reconnect to view devices with access.
        </Text>
      ) : !canRead ? (
        <Text className="p-4 text-sm text-foreground-muted">
          This connection does not have permission to view devices with access.
        </Text>
      ) : access.error ? (
        <>
          <Text selectable className="p-4 text-sm text-danger-foreground">
            {access.error}
          </Text>
          <SettingsActionRow icon="arrow.clockwise" label="Try again" onPress={access.refresh} />
        </>
      ) : access.data === null ? (
        <Text className="p-4 text-sm text-foreground-muted">Loading devices…</Text>
      ) : sessions.length === 0 ? (
        <Text className="p-4 text-sm text-foreground-muted">No paired devices.</Text>
      ) : (
        sessions.map((session) => {
          // oxlint-disable-next-line t3code/no-rpc-permission-bypass -- AuthClientSession.client is device metadata, not an RPC client.
          const { client: device } = session;
          return (
            <View
              key={session.sessionId}
              className="flex-row flex-wrap items-center justify-between gap-3 p-4"
            >
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-base text-foreground">
                  {device.label ?? device.os ?? device.deviceType}
                  {session.current ? " (this device)" : ""}
                </Text>
                <Text className="text-sm text-foreground-muted">
                  {session.connected ? "Connected" : "Not connected"}
                  {device.browser ? ` · ${device.browser}` : ""}
                </Text>
              </View>
              {canWrite ? (
                <Button
                  label="End access"
                  accessibilityLabel={`End access for ${device.label ?? device.os ?? device.deviceType}`}
                  size="compact"
                  loading={pending === session.sessionId}
                  disabled={pending !== null}
                  onPress={() => endAccess(session)}
                />
              ) : null}
            </View>
          );
        })
      )}
    </SettingsSection>
  );
}
