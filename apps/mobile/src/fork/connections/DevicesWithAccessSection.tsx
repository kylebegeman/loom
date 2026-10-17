import { createAuthEnvironmentAtoms } from "@t3tools/client-runtime/state/auth";
import { AuthAccessReadScope, type EnvironmentId } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";

const authEnvironment = createAuthEnvironmentAtoms(connectionAtomRuntime);

export function DevicesWithAccessSection({
  environmentId,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const access = useEnvironmentQuery(
    connected && canRead ? authEnvironment.accessChanges({ environmentId, input: null }) : null,
  );
  const sessions = access.data?.type === "snapshot" ? access.data.payload.clientSessions : [];
  return (
    <SettingsSection
      title="Devices with access"
      footer="These devices have permission to connect to this computer. Manage or revoke their access from Connections on the computer."
    >
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
            <View key={session.sessionId} className="gap-1 p-4">
              <Text className="text-base text-foreground">
                {device.label ?? device.os ?? device.deviceType}
                {session.current ? " (this device)" : ""}
              </Text>
              <Text className="text-sm text-foreground-muted">
                {session.connected ? "Connected" : "Not connected"}
                {device.browser ? ` · ${device.browser}` : ""}
              </Text>
            </View>
          );
        })
      )}
    </SettingsSection>
  );
}
