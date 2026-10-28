import { VaultSettingsSection } from "../../fork/vault/VaultSettingsSection"; // fork: vault-core
// fork: brand - Remote hosts may run upstream T3 Code or Loom.
import * as Dialog from "../../components/ui/Dialog";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  AuthProvidersManageScope,
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ServerProvider,
} from "@t3tools/contracts";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  OS_MANAGED_RUNTIME_NOTE,
  runtimeManagedByOperatingSystem,
} from "@t3tools/client-runtime/fork"; // fork: runtime-owner
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { environmentSession, useEnvironmentScope, readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  useRemoteConnections,
  useSavedRemoteConnection,
} from "../../state/use-remote-environment-registry";
// fork: fleet-connections - Computer work and access live beside its routes and permissions.
import { ComputerNameSection } from "../../fork/connections/ComputerNameSection"; // fork: computer-naming
import { ComputerConnectSection } from "../../fork/connect/ComputerConnectSection"; // fork: fleet-connect
import { ComputerProjectsFolderSection } from "../../fork/connections/ComputerProjectsFolderSection"; // fork: file-placement
import { ComputerReachSection } from "../../fork/connections/ComputerReachSection"; // fork: reach
import { ComputerWorkSection } from "../../fork/connections/ComputerWorkSection";
import { DevicesWithAccessSection } from "../../fork/connections/DevicesWithAccessSection";
import { describeServerUpdateImpact } from "../../fork/connections/serverUpdateImpact"; // fork: machine-updates
import { IdentityAccessText } from "../../fork/identity-renewal/IdentityAccessText"; // fork: identity-renewal
import { ConnectionEnvironmentRow } from "../connection/ConnectionEnvironmentRow";
import { EnvironmentRoutesSection } from "./EnvironmentRoutesSection";
import { OutdatedServerUpdateSection } from "./OutdatedServerUpdateSection";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { openSettings } from "./settings-navigation"; // fork: fleet-connections
import {
  canMaintainEnvironment,
  canUpdateEnvironmentProvider,
  supportsEnvironmentUpdate,
} from "./environment-maintenance";
import { environmentReleaseCheckAtom, releaseCheckValue } from "./environmentUpdateCheck";

export function SettingsEnvironmentDetailRouteScreen({
  route,
}: StaticScreenProps<{
  readonly environmentId: EnvironmentId;
}>) {
  return (
    <EnvironmentDetail
      key={route.params.environmentId}
      environmentId={route.params.environmentId}
    />
  );
}

function EnvironmentDetail({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const connections = useRemoteConnections();
  const savedConnection = useSavedRemoteConnection(environmentId); // fork: library-sign-in
  const environment = connections.connectedEnvironments.find(
    (entry) => entry.environmentId === environmentId,
  );
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const sessionResult = useAtomValue(environmentSession.sessionStateAtom(environmentId));
  const updateState = useAtomValue(serverEnvironment.updateStateAtom(environmentId));
  const outdated =
    useAtomValue(environmentPresentations.presentationAtom(environmentId))?.entry
      .serverUpdateRequired === true;
  const updateServer = useAtomCommand(serverEnvironment.updateServer);
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders);
  // fork: everyday-workflows
  const [connectionExpanded, setConnectionExpanded] = useState(
    environment?.isEnabled !== true || environment.connectionState !== "connected",
  );
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [releaseCheck, checkRelease] = useAtom(environmentReleaseCheckAtom(environmentId), {
    mode: "promiseExit",
  });
  const release = releaseCheckValue(releaseCheck);

  const connected = environment?.isEnabled === true && environment.connectionState === "connected";
  const allowed =
    !AsyncResult.isFailure(sessionResult) && canMaintainEnvironment(session, connected);
  const running = updateState.status === "running";
  const providerBusy =
    config?.providers.some(
      (provider) =>
        provider.updateState?.status === "running" || provider.updateState?.status === "queued",
    ) ?? false;
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const busy = !connected || pending !== null || running || providerBusy;
  const disabled = !allowed || busy;
  const version = config?.environment.serverVersion;
  const checkedRelease = release?.fromVersion === version ? release : null;
  const capabilities = config?.environment.capabilities;
  const osManaged = runtimeManagedByOperatingSystem(capabilities); // fork: runtime-owner

  async function run(label: string, action: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(label);
    setError(null);
    setNotice(null);
    const result = await settlePromise(action);
    pendingRef.current = false;
    setPending(null);
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : "The action could not be completed. Try again.",
      );
    }
  }

  function requestServerUpdate() {
    const targetVersion = checkedRelease?.targetVersion;
    if (disabled || !targetVersion || !capabilities || !supportsEnvironmentUpdate(capabilities))
      return;
    // fork: machine-updates: name the work this restart stops, as desktop and web do.
    const impact = describeServerUpdateImpact(
      environmentId,
      capabilities.serverUpdateThreadContinuation === true &&
        config?.settings.continueThreadsAfterServerUpdate === true,
    );
    Dialog.alert(
      `Update ${environment?.environmentLabel ?? "environment"}?`,
      `Install server version ${targetVersion}. ${capabilities.serverSelfUpdate === "desktop-managed" ? "The desktop app will close and relaunch." : "The server will restart and reconnect."}${impact === "" ? "" : ` ${impact}`}`, // fork: machine-updates
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Update",
          onPress: () =>
            void run("server", async () => {
              if (
                AsyncResult.isFailure(
                  appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId)),
                ) ||
                !canMaintainEnvironment(
                  appAtomRegistry.get(environmentSession.sessionStateValueAtom(environmentId)),
                  connected,
                )
              )
                return;
              const result = await updateServer({
                environmentId,
                input: { targetVersion },
              });
              if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
              setNotice(`Updated to ${result.value.targetVersion}.`);
            }),
        },
      ],
    );
  }

  function requestProviderUpdate(provider: ServerProvider) {
    if (
      busy ||
      !readEnvironmentScope(environmentId, AuthProvidersManageScope) ||
      !canUpdateEnvironmentProvider(provider)
    )
      return;
    void run(provider.instanceId, async () => {
      const result = await updateProvider({
        environmentId,
        input: {
          provider: provider.driver,
          instanceId: provider.instanceId,
        },
      });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
    });
  }

  return (
    // fork: fleet-connections
    <SettingsScreen title={environment?.environmentLabel ?? "Computer"}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        // fork: fleet-connections
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {!environment ? (
          // fork: everyday-workflows
          <SettingsSection>
            <Text className="p-4 text-base text-foreground-muted">
              This computer is no longer saved on this device.
            </Text>
            <SettingsActionRow
              icon="desktopcomputer"
              label="Manage computers" // fork: everyday-workflows
              onPress={() => openSettings(navigation, "SettingsEnvironments")}
            />
          </SettingsSection>
        ) : (
          <>
            <SettingsSection title="Connection">
              <ConnectionEnvironmentRow
                environment={environment}
                expanded={connectionExpanded}
                onToggle={() => setConnectionExpanded((value) => !value)}
                onReconnect={connections.onReconnectEnvironment}
                onRemove={connections.onRemoveEnvironmentPress}
                onSetEnabled={connections.onSetEnvironmentEnabled}
                onUpdate={connections.onUpdateEnvironment}
              />
            </SettingsSection>
            {savedConnection?.identity ? (
              <SettingsSection title="Identity access">
                {/* fork: identity-renewal */}
                <IdentityAccessText
                  environmentId={environmentId}
                  issuer={savedConnection.identity.issuer}
                  httpBaseUrl={savedConnection.identityHttpBaseUrl}
                />
                <SettingsActionRow
                  icon="person.crop.circle"
                  label="Sign in again with Identity"
                  onPress={() =>
                    navigation.navigate("IdentitySignIn", {
                      environmentId,
                      ...(savedConnection.identityHttpBaseUrl
                        ? { address: savedConnection.identityHttpBaseUrl }
                        : {}),
                    })
                  }
                />
              </SettingsSection>
            ) : null}
            {/* fork: fleet-connections - Preserve work actions and access in the shared details. */}
            <ComputerWorkSection environmentId={environmentId} connected={connected} />
            {/* fork: computer-naming - One name follows the computer across clients. */}
            <ComputerNameSection environmentId={environmentId} connected={connected} />
            {/* fork: file-placement - Each computer names where new project files go. */}
            <ComputerProjectsFolderSection environmentId={environmentId} connected={connected} />
            <ComputerConnectSection environmentId={environmentId} connected={connected} />
            {/* fork: reach - Reach is per computer; the phone is never a reach host. */}
            <ComputerReachSection environmentId={environmentId} connected={connected} />
            {/* fork: vault-core */}
            <VaultSettingsSection environmentId={environmentId} connected={connected} />
            {/* fork: fleet-connections - Show authorized devices for the selected host. */}
            <DevicesWithAccessSection environmentId={environmentId} connected={connected} />
            <EnvironmentRoutesSection
              environmentId={environmentId}
              connected={connected}
              onAddRoute={() =>
                navigation.navigate("SettingsEnvironmentNew", { routeFor: environmentId })
              }
            />
            {outdated ? (
              <OutdatedServerUpdateSection
                environmentId={environmentId}
                label={environment.environmentLabel}
              />
            ) : !connected ? (
              <Text className="px-2 text-sm text-foreground-muted">
                {/* fork: fleet-connections */}
                Connect this computer to manage it.
              </Text>
            ) : !allowed ? (
              <Text className="px-2 text-sm text-foreground-muted">
                {AsyncResult.isFailure(sessionResult)
                  ? "Could not verify your permissions. Reconnect to try again."
                  : session === null
                    ? "Checking permissions…"
                    : // fork: fleet-connections
                      "This connection does not have permission to manage this computer."}
              </Text>
            ) : null}
            {error ? (
              <Text selectable className="px-2 text-sm text-danger-foreground">
                {error}
              </Text>
            ) : null}
            {notice ? <Text className="px-2 text-sm text-foreground-muted">{notice}</Text> : null}
            {config && !outdated ? (
              <>
                {/* fork: brand */}
                <SettingsSection title="Server">
                  <View className="gap-1 p-4">
                    <Text className="text-base text-foreground">Version {version}</Text>
                    {running ? (
                      <Text className="text-sm text-foreground-muted">
                        {updateState.stage === "resuming"
                          ? "Restarting and reconnecting…"
                          : "Downloading update…"}
                      </Text>
                    ) : updateState.status === "failed" ? (
                      <Text selectable className="text-sm text-danger-foreground">
                        {updateState.message}
                      </Text>
                    ) : null}
                    {checkedRelease ? (
                      <Text className="text-sm text-foreground-muted">
                        {checkedRelease.targetVersion
                          ? `Version ${checkedRelease.targetVersion} is available.`
                          : "You are up to date."}
                      </Text>
                    ) : null}
                    {osManaged ? ( // fork: runtime-owner
                      <Text className="text-sm text-foreground-muted">
                        {OS_MANAGED_RUNTIME_NOTE}
                      </Text> // fork: runtime-owner
                    ) : checkedRelease?.targetVersion &&
                      !supportsEnvironmentUpdate(config.environment.capabilities) ? ( // fork: runtime-owner
                      <Text className="text-sm text-foreground-muted">
                        {capabilities?.serverSelfUpdate === "desktop-managed"
                          ? "Update the desktop app on this machine."
                          : // fork: brand
                            "Update and restart the server on this machine."}
                      </Text>
                    ) : null}
                  </View>
                  <SettingsActionRow
                    icon="arrow.clockwise"
                    label="Check for updates"
                    disabled={disabled || osManaged} // fork: runtime-owner
                    loading={pending === "check"}
                    onPress={() => {
                      if (disabled) return;
                      const fromVersion = config.environment.serverVersion;
                      void run("check", async () => {
                        const exit = await checkRelease(async () => fromVersion);
                        // `run` owns the error message, so a failed lookup rethrows to it.
                        if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
                      });
                    }}
                  />
                  {checkedRelease?.targetVersion &&
                  supportsEnvironmentUpdate(config.environment.capabilities) ? (
                    <SettingsActionRow
                      icon="arrow.up.circle"
                      label={`Update to ${checkedRelease.targetVersion}`}
                      disabled={disabled}
                      loading={pending === "server" || running}
                      onPress={requestServerUpdate}
                    />
                  ) : null}
                </SettingsSection>
                {/* fork: everyday-workflows */}
                <SettingsSection title="Agents">
                  <SettingsActionRow
                    icon="arrow.clockwise"
                    label="Refresh agents" // fork: everyday-workflows
                    disabled={busy || !canRead}
                    loading={pending === "refresh"}
                    onPress={() => {
                      if (busy || !canRead) return;
                      void run("refresh", async () => {
                        if (!readEnvironmentScope(environmentId, AuthOrchestrationReadScope))
                          return;
                        const result = await refreshProviders({ environmentId, input: {} });
                        if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
                        setNotice("Agent status refreshed."); // fork: everyday-workflows
                      });
                    }}
                  />
                  {config.providers
                    .filter((provider) => provider.enabled)
                    .map((provider) => (
                      <View key={provider.instanceId}>
                        <View className="gap-1 p-4">
                          <View className="flex-row items-center gap-2">
                            <ProviderIcon provider={provider.driver} size={18} />
                            <Text className="min-w-0 flex-1 text-base font-t3-medium text-foreground">
                              {provider.displayName ?? provider.driver}
                            </Text>
                          </View>
                          <Text className="text-sm text-foreground-muted">
                            {provider.installed
                              ? (provider.version ?? "Version unknown")
                              : "Not installed"}
                            {provider.versionAdvisory?.latestVersion
                              ? ` · Latest ${provider.versionAdvisory.latestVersion}`
                              : ""}
                          </Text>
                          {provider.updateState && provider.updateState.status !== "idle" ? (
                            <Text
                              selectable
                              className={
                                provider.updateState.status === "failed"
                                  ? "text-sm text-danger-foreground"
                                  : "text-sm text-foreground-muted"
                              }
                            >
                              {provider.updateState.message ??
                                `Update ${provider.updateState.status}`}
                            </Text>
                          ) : null}
                          {provider.compatibilityAdvisory?.message ? (
                            <Text selectable className="text-sm text-foreground-muted">
                              {provider.compatibilityAdvisory.message}
                            </Text>
                          ) : null}
                          {provider.unavailableReason || provider.message ? (
                            <Text selectable className="text-sm text-foreground-muted">
                              {provider.unavailableReason ?? provider.message}
                            </Text>
                          ) : null}
                          {provider.versionAdvisory?.status === "behind_latest" &&
                          !provider.versionAdvisory.canUpdate ? (
                            <Text className="text-sm text-foreground-muted">
                              {/* fork: everyday-workflows */}
                              Update this agent on the computer.
                            </Text>
                          ) : null}
                        </View>
                        {canUpdateEnvironmentProvider(provider) ? (
                          <SettingsActionRow
                            icon="arrow.up.circle"
                            label={`Update ${provider.displayName ?? provider.driver}`}
                            disabled={busy || !canManageProviders}
                            loading={pending === provider.instanceId}
                            onPress={() => requestProviderUpdate(provider)}
                          />
                        ) : null}
                      </View>
                    ))}
                </SettingsSection>
              </>
            ) : null}
          </>
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}
