import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Switch, View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultPolicySnapshot } from "@t3tools/contracts/fork";
import {
  createVaultAccessAtoms,
  createVaultCoreAtoms,
  createVaultBrokerAtoms,
  createVaultHealthAtoms,
  createVaultSshAtoms,
  supportsLoomFeature,
  vaultOwnerAccessSummary,
  VAULT_OWNER_SETUP_HELP,
  vaultStatusMessage,
  vaultHealthMessage,
  vaultHealthVisibleState,
  vaultBrokerState,
} from "@t3tools/client-runtime/fork";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { VaultSshSheet } from "./SshSheet";
import { VaultGitHubSettingsSection } from "./GitHubSettingsSection";
import { VaultBrokerSettingsSection } from "./BrokerSettingsSection";
import { VaultHealthSettingsSection } from "./HealthSettingsSection";
import { VaultAccessSettingsSection } from "./AccessSettingsSection";
import { VaultProfileSettingsSection } from "./ProfileSettingsSection";
import { VaultTestAccountSettingsSection } from "./TestAccountSettingsSection";
import { VaultMigrationInventorySettingsSection } from "./MigrationInventorySettingsSection";
import { VaultMigrationSettingsSection } from "./MigrationSettingsSection";
import { useVaultTime } from "./useVaultTime";

const access = createVaultAccessAtoms(connectionAtomRuntime);
const core = createVaultCoreAtoms(connectionAtomRuntime);
const brokers = createVaultBrokerAtoms(connectionAtomRuntime);
const health = createVaultHealthAtoms(connectionAtomRuntime);
const ssh = createVaultSshAtoms(connectionAtomRuntime);
const failureMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Could not update agent access. Refresh and try again.";

export function VaultOwnerSettings({
  environmentId,
  connected,
  advancedItems,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  advancedItems: ReactNode;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const registry = useContext(RegistryContext);
  const supported = supportsLoomFeature(config?.environment.capabilities, "vault-owner-trusted");
  const canChange = useAtomValue(access.setOwnerPolicy.permissionAtom(environmentId));
  const change = useAtomCommand(access.setOwnerPolicy, { reportFailure: false });
  const [snapshot, setSnapshot] = useState<VaultPolicySnapshot | null>(null);
  const [request, setRequest] = useState({ environmentId, input: {} });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [help, setHelp] = useState(false);
  const [repair, setRepair] = useState<"broker" | "health" | null>(null);
  useEffect(() => {
    if (!supported || !connected) return;
    const controller = new AbortController();
    void executeAtomQuery(registry, access.snapshot(request), {
      refresh: true,
      signal: controller.signal,
      reportFailure: false,
      reportDefect: false,
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result._tag === "Failure") {
        setError(failureMessage(squashAtomCommandFailure(result)));
        return;
      }
      setSnapshot(result.value);
    });
    return () => controller.abort();
  }, [connected, registry, supported, request]);
  const loading = supported && connected && !snapshot && !error;
  const policy = supported && connected && !loading ? snapshot?.ownerPolicy : undefined;
  const summary = vaultOwnerAccessSummary(policy);
  const changePolicy = async () => {
    if (!connected || !supported || !policy || !snapshot || !canChange || loading || busy) return;
    if (!summary.enabled && !confirmed) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    await change({
      environmentId,
      input: {
        operationId: uuidv4().replaceAll("-", ""),
        expectedRevision: snapshot.revision,
        mode: summary.enabled ? "restricted" : "owner-trusted",
      },
    })
      .then((result) => {
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        setSnapshot(result.value);
        setConfirmed(false);
        setNotice(
          result.value.ownerPolicy?.mode === "owner-trusted"
            ? "Owner access enabled for this environment."
            : "Restricted access restored. Saved access rules apply again.",
        );
      })
      .catch((cause: unknown) => {
        setSnapshot(null);
        setConfirmed(false);
        setError(failureMessage(cause));
      })
      .finally(() => setBusy(false));
  };
  const openRepair = useCallback((section: "broker" | "health") => setRepair(section), []);
  return (
    <>
      <SettingsSection title="Vault">
        <View className="gap-4 p-4">
          <View className="gap-1">
            <Text className="font-t3-semibold">
              {config?.environment.label ?? "This environment"}
            </Text>
            <Text className="text-foreground-muted">
              Development credentials and agent access on this computer.
            </Text>
          </View>
          {!connected ? (
            <Text>Reconnect this environment to check connections and change agent access.</Text>
          ) : loading ? (
            <Text>Checking agent access…</Text>
          ) : error && !snapshot ? (
            <Text>Agent access is unknown. Refresh before making changes.</Text>
          ) : (
            <View className="gap-2">
              <Text className="font-t3-semibold">{summary.title}</Text>
              <Text>{summary.description}</Text>
              {supported && policy ? (
                <>
                  {!summary.enabled ? (
                    <View className="flex-row items-center gap-3">
                      <Text className="flex-1">This is my personal environment</Text>
                      <Switch
                        accessibilityLabel="This is my personal environment"
                        value={confirmed}
                        disabled={busy || !canChange}
                        onValueChange={setConfirmed}
                      />
                    </View>
                  ) : null}
                  <Button
                    label={busy ? "Saving agent access…" : summary.actionLabel}
                    tone={summary.enabled ? "secondary" : "primary"}
                    disabled={busy || !canChange || (!summary.enabled && !confirmed)}
                    onPress={() => void changePolicy()}
                  />
                  {!canChange ? (
                    <Text>Owner access is required to change this setting.</Text>
                  ) : null}
                </>
              ) : (
                <Text>
                  This server supports restricted access. Update Loom to enable owner access.
                </Text>
              )}
            </View>
          )}
          {error ? <Text accessibilityRole="alert">{error}</Text> : null}
          {notice ? <Text accessibilityRole="summary">{notice}</Text> : null}
          {supported ? (
            <Button
              label="Refresh agent access"
              tone="text"
              disabled={!connected || loading || busy}
              onPress={() => {
                setNotice(null);
                setSnapshot(null);
                setConfirmed(false);
                setError(null);
                setRequest({ environmentId, input: {} });
              }}
            />
          ) : null}
        </View>
      </SettingsSection>
      <VaultConnections
        environmentId={environmentId}
        connected={connected}
        ownerMode={summary.enabled}
        onRepair={openRepair}
      />
      <VaultGitHubSettingsSection
        environmentId={environmentId}
        connected={connected}
        ownerMode={summary.enabled}
      />
      {repair === "broker" ? (
        <VaultBrokerSettingsSection environmentId={environmentId} connected={connected} />
      ) : repair === "health" ? (
        <VaultHealthSettingsSection environmentId={environmentId} connected={connected} />
      ) : null}
      {repair ? (
        <Button label="Close repair details" tone="text" onPress={() => setRepair(null)} />
      ) : null}
      <SettingsSection title="Setup help">
        <View className="gap-3 p-4">
          <Button
            label={help ? "Hide setup help" : "Set up SSH, brokers and GitHub"}
            tone="text"
            onPress={() => setHelp(!help)}
          />
          {help
            ? VAULT_OWNER_SETUP_HELP.map((item) => (
                <View key={item.id} className="gap-1">
                  <Text className="font-t3-semibold">{item.title}</Text>
                  <Text>{item.description}</Text>
                </View>
              ))
            : null}
        </View>
      </SettingsSection>
      <SettingsSection title="Advanced">
        <View className="gap-3 p-4">
          <Text>
            {summary.enabled
              ? "Profiles are optional. Keep restricted access rules for switching back, or manage other Vault items and maintenance."
              : "Manage restricted access rules, optional project profiles, other Vault items and maintenance."}
          </Text>
          <Button
            label={advanced ? "Hide advanced Vault settings" : "Advanced Vault settings"}
            tone="text"
            onPress={() => setAdvanced(!advanced)}
          />
        </View>
      </SettingsSection>
      {advanced ? (
        <>
          {advancedItems}
          <VaultAccessSettingsSection environmentId={environmentId} connected={connected} />
          <VaultProfileSettingsSection environmentId={environmentId} connected={connected} />
          {repair !== "broker" ? (
            <VaultBrokerSettingsSection environmentId={environmentId} connected={connected} />
          ) : null}
          {repair !== "health" ? (
            <VaultHealthSettingsSection environmentId={environmentId} connected={connected} />
          ) : null}
          <VaultTestAccountSettingsSection environmentId={environmentId} connected={connected} />
          <VaultMigrationInventorySettingsSection
            environmentId={environmentId}
            connected={connected}
          />
          <VaultMigrationSettingsSection environmentId={environmentId} connected={connected} />
        </>
      ) : null}
    </>
  );
}

function VaultConnections({
  environmentId,
  connected,
  ownerMode,
  onRepair,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  ownerMode: boolean;
  onRepair: (section: "broker" | "health") => void;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const capabilities = config?.environment.capabilities;
  const sshEnabled = supportsLoomFeature(capabilities, "vault-ssh-management");
  const brokerEnabled = supportsLoomFeature(capabilities, "vault-brokers");
  const healthEnabled = supportsLoomFeature(capabilities, "vault-health");
  const status = useEnvironmentQuery(connected ? core.status({ environmentId, input: {} }) : null);
  const ready =
    connected && status.isSuccess && !status.isPending && status.data?.state === "ready";
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useEnvironmentQuery(
    ready ? core.list({ environmentId, input: { cursor, includeArchived: false } }) : null,
  );
  const broker = useEnvironmentQuery(
    connected && brokerEnabled ? brokers.snapshot({ environmentId, input: {} }) : null,
  );
  const maintenance = useEnvironmentQuery(
    ready && healthEnabled ? health.snapshot({ environmentId, input: {} }) : null,
  );
  const now = useVaultTime([
    ...(broker.data?.machines.map((machine) => machine.leaseUntil) ?? []),
    ...(maintenance.data?.issues.map((issue) => issue.snoozedUntil) ?? []),
  ]);
  const [sshItem, setSshItem] = useState<string | null | undefined>(undefined);
  const canCreate = useAtomValue(ssh.generate.permissionAtom(environmentId));
  const issues =
    maintenance.isSuccess && !maintenance.isPending
      ? (maintenance.data?.issues.filter(
          (issue) => vaultHealthVisibleState(issue, now) === "open",
        ) ?? [])
      : [];
  const sshItems = page.data?.items.filter((item) => item.kind === "ssh-key") ?? [];
  const refresh = () => {
    status.refresh();
    page.refresh();
    broker.refresh();
    maintenance.refresh();
  };
  return (
    <SettingsSection title="Connections and setup">
      <View className="gap-4 p-4">
        {!connected ? (
          <Text>Reconnect to check Vault setup.</Text>
        ) : status.error ? (
          <Text accessibilityRole="alert">{status.error}</Text>
        ) : status.isPending || !status.data ? (
          <Text>Checking Vault connection…</Text>
        ) : (
          <Text>{vaultStatusMessage(status.data)}</Text>
        )}
        <Button label="Refresh connections" tone="text" disabled={!connected} onPress={refresh} />
        {connected && status.data && !status.isPending && status.data.state !== "ready" ? (
          <Text>
            On this computer, check Loom's OpenBao connection, storage mount and service token.
            Unlock the backend if it is sealed, then refresh here.
          </Text>
        ) : null}
        {sshEnabled ? (
          <View className="gap-3">
            <Text className="font-t3-semibold">SSH hosts</Text>
            {!ready ? (
              <Text>SSH connections will appear when Vault is connected.</Text>
            ) : page.error ? (
              <Text accessibilityRole="alert">
                Could not load SSH hosts. Refresh connections to try again.
              </Text>
            ) : page.isPending || !page.data ? (
              <Text>Loading SSH hosts…</Text>
            ) : (
              <>
                {sshItems.length === 0 ? (
                  <Text>
                    No SSH hosts on this page. Create a key to connect a development host.
                  </Text>
                ) : null}
                {sshItems.map((item) => (
                  <SshConnection
                    key={`${item.id}:${item.version}`}
                    environmentId={environmentId}
                    id={item.id}
                    label={item.label}
                    connected={connected}
                    ownerMode={ownerMode}
                    onOpen={() => setSshItem(item.id)}
                  />
                ))}
                {cursor ? <Button label="First SSH hosts" onPress={() => setCursor(null)} /> : null}
                {page.data.nextCursor ? (
                  <Button
                    label="More SSH hosts"
                    onPress={() => setCursor(page.data?.nextCursor ?? null)}
                  />
                ) : null}
              </>
            )}
            <Button
              label="Create SSH key"
              disabled={!ready || !canCreate}
              onPress={() => setSshItem(null)}
            />
          </View>
        ) : null}
        {brokerEnabled ? (
          <View className="gap-2">
            <Text className="font-t3-semibold">Agent connection</Text>
            {!connected ? (
              <Text>Broker status is unknown while disconnected.</Text>
            ) : broker.error ? (
              <Text accessibilityRole="alert">
                Could not check agent connections. Review broker setup.
              </Text>
            ) : broker.isPending || !broker.data ? (
              <Text>Checking agent connections…</Text>
            ) : broker.data.machines.length === 0 ? (
              <Text>
                No broker is enrolled. Configure the Vault broker on the execution computer and
                enroll its public identity.
              </Text>
            ) : (
              broker.data.machines.map((machine) => (
                <Text key={machine.id}>
                  {machine.label}: {vaultBrokerState(machine, now)}
                </Text>
              ))
            )}
            <Text className="text-foreground-muted">
              A running, configured broker is required for brokered agent access. Owner access does
              not configure it.
            </Text>
            <Button
              label="Repair broker setup"
              disabled={!connected}
              onPress={() => onRepair("broker")}
            />
          </View>
        ) : null}
        {healthEnabled ? (
          <View className="gap-2">
            <Text className="font-t3-semibold">Needs attention</Text>
            {!ready ? (
              <Text>Connect Vault to check reported problems.</Text>
            ) : maintenance.error ? (
              <Text accessibilityRole="alert">
                Could not load maintenance reports. Refresh connections to try again.
              </Text>
            ) : maintenance.isPending || !maintenance.data ? (
              <Text>Checking reported problems…</Text>
            ) : issues.length === 0 ? (
              <Text>
                No open maintenance reports. Test each connection after changing its setup.
              </Text>
            ) : (
              <>
                <Text className="font-t3-semibold">{issues[0]!.itemLabel}</Text>
                <Text>{vaultHealthMessage(issues[0]!)}</Text>
                {issues.length > 1 ? (
                  <Text>{issues.length - 1} more reported problems.</Text>
                ) : null}
              </>
            )}
            <Button
              label="Review and repair access"
              disabled={!ready}
              onPress={() => onRepair("health")}
            />
          </View>
        ) : null}
      </View>
      {sshItem !== undefined ? (
        <VaultSshSheet
          key={`${environmentId}:${sshItem ?? "new"}`}
          environmentId={environmentId}
          connected={connected}
          itemId={sshItem}
          ownerMode={ownerMode}
          onClose={() => {
            setSshItem(undefined);
            refresh();
          }}
        />
      ) : null}
    </SettingsSection>
  );
}

function SshConnection({
  environmentId,
  id,
  label,
  connected,
  ownerMode,
  onOpen,
}: {
  environmentId: EnvironmentId;
  id: string;
  label: string;
  connected: boolean;
  ownerMode: boolean;
  onOpen: () => void;
}) {
  const query = useEnvironmentQuery(connected ? ssh.info({ environmentId, input: { id } }) : null);
  const info = query.isSuccess && !query.isPending ? query.data : null;
  return (
    <View className="gap-2 rounded-xl bg-subtle p-3">
      <Text className="font-t3-semibold">{label}</Text>
      {query.error ? (
        <Text accessibilityRole="alert">Could not inspect this host. Open SSH setup to retry.</Text>
      ) : !info ? (
        <Text>Checking host setup…</Text>
      ) : (
        <>
          <Text selectable>{info.destination}</Text>
          <Text>
            {info.target.hostKey
              ? "Host key pinned. Copy the public key to the destination and test SSH to verify enrollment."
              : "Host trust is missing. Verify and pin the destination's host key, then register this public key on that host."}
          </Text>
          <Text className="text-foreground-muted">
            {ownerMode
              ? "Owner access permits agents to use this host after setup succeeds."
              : "Agents need restricted access to this host."}
          </Text>
        </>
      )}
      <Button label={`Set up or test ${label}`} disabled={!connected} onPress={onOpen} />
    </View>
  );
}
