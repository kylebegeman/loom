import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { useNavigation } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import { managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useRef, useState } from "react";
import { Platform, RefreshControl, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { AppText as Text } from "../../components/AppText";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";
import { hasCloudPublicConfig } from "../../features/cloud/publicConfig";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsScreen } from "../../features/settings/components/SettingsScreen";
import { AndroidAnchoredMenu } from "../../components/AndroidAnchoredMenu";
import { AndroidHeaderIconButton } from "../../components/AndroidScreenHeader";
import { CloudEnvironmentRows } from "../../features/connection/CloudEnvironmentRows";
import { LocalEnvironmentList } from "../../features/connection/LocalEnvironmentList";
import { GitHubRoutingSettings } from "../../features/connection/GitHubRoutingSettings";
import { splitEnvironmentSections } from "../../features/connection/environmentSections";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { relayEnvironmentDiscovery } from "../../state/relay";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  applyShowcaseLocalEnvironmentDisplayUrls,
  resolveShowcaseEnvironmentUpdateDisplayUrl,
  SHOWCASE_AVAILABLE_CLOUD_ENVIRONMENTS,
  SHOWCASE_CONNECTED_CLOUD_ENVIRONMENTS,
} from "../../features/showcase/showcaseEnvironmentRows";

const SHOWCASE_ENABLED = process.env.EXPO_PUBLIC_SHOWCASE === "1";

export function ConnectionsScreen() {
  const {
    connectedEnvironments,
    onReconnectEnvironment,
    onRemoveEnvironmentPress,
    onSetEnvironmentEnabled,
    onUpdateEnvironment,
  } = useRemoteConnections();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentSections = splitEnvironmentSections({
    connectedEnvironments,
    cloudEnvironments: null,
  });
  const localEnvironments = SHOWCASE_ENABLED
    ? applyShowcaseLocalEnvironmentDisplayUrls(environmentSections.localEnvironments)
    : connectedEnvironments;
  const connectedCloudEnvironments = SHOWCASE_ENABLED ? SHOWCASE_CONNECTED_CLOUD_ENVIRONMENTS : [];
  const relaySession = useAtomValue(managedRelaySessionAtom);
  const refreshRelayEnvironments = useAtomCommand(
    relayEnvironmentDiscovery.refresh,
    "relay environment refresh",
  );
  const [isRefreshingCloud, setIsRefreshingCloud] = useState(false);
  const cloudRefreshPendingRef = useRef(false);
  async function refreshCloudEnvironments() {
    if (!relaySession || cloudRefreshPendingRef.current) return;
    cloudRefreshPendingRef.current = true;
    setIsRefreshingCloud(true);
    try {
      await refreshRelayEnvironments();
    } finally {
      cloudRefreshPendingRef.current = false;
      setIsRefreshingCloud(false);
    }
  }

  const openEnvironment = useCallback(
    (environmentId: EnvironmentId) => {
      navigation.navigate("SettingsSheet", {
        screen: "SettingsContent",
        params: { screen: "SettingsEnvironmentDetail", params: { environmentId } },
      });
    },
    [navigation],
  );
  const handleUpdateEnvironment = useCallback(
    (
      environmentId: EnvironmentId,
      updates: { readonly label: string; readonly displayUrl: string },
    ) => {
      if (!SHOWCASE_ENABLED) return onUpdateEnvironment(environmentId, updates);
      const actualEnvironment = environmentSections.localEnvironments.find(
        (environment) => environment.environmentId === environmentId,
      );
      const presentedEnvironment = localEnvironments.find(
        (environment) => environment.environmentId === environmentId,
      );
      return onUpdateEnvironment(environmentId, {
        ...updates,
        displayUrl:
          actualEnvironment && presentedEnvironment
            ? resolveShowcaseEnvironmentUpdateDisplayUrl({
                actualDisplayUrl: actualEnvironment.displayUrl,
                presentedDisplayUrl: presentedEnvironment.displayUrl,
                submittedDisplayUrl: updates.displayUrl,
              })
            : updates.displayUrl,
      });
    },
    [environmentSections.localEnvironments, localEnvironments, onUpdateEnvironment],
  );

  return (
    <SettingsScreen
      title="Connections"
      trailing={
        Platform.OS === "android" && relaySession ? (
          <AndroidAnchoredMenu
            title="Computer options"
            actions={[
              {
                id: "refresh",
                title: "Refresh account computers",
                attributes: { disabled: isRefreshingCloud },
              },
            ]}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === "refresh") void refreshCloudEnvironments();
            }}
          >
            {(open) => (
              <AndroidHeaderIconButton
                accessibilityLabel="Computer options"
                icon="ellipsis"
                onPress={open}
              />
            )}
          </AndroidAnchoredMenu>
        ) : undefined
      }
      actions={[
        {
          accessibilityLabel: "Connect computer",
          icon: "plus",
          onPress: () =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsContent",
              params: { screen: "SettingsEnvironmentNew" },
            }),
        },
      ]}
    >
      <ScrollView
        alwaysBounceVertical
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
        }}
        refreshControl={
          relaySession ? (
            <RefreshControl
              refreshing={isRefreshingCloud}
              onRefresh={() => void refreshCloudEnvironments()}
            />
          ) : undefined
        }
      >
        <View className="gap-2 px-1">
          <Text className="text-xl font-t3-bold text-foreground">Your computers</Text>
          <Text className="text-sm leading-normal text-foreground-muted">
            Choose a computer to start or continue work. Each keeps its own projects and
            conversations.
          </Text>
        </View>
        <LocalEnvironmentList
          environments={localEnvironments}
          expandedId={null}
          onToggle={openEnvironment}
          opensDetails
          onReconnect={onReconnectEnvironment}
          onRemove={onRemoveEnvironmentPress}
          onSetEnabled={onSetEnvironmentEnabled}
          onUpdate={handleUpdateEnvironment}
        />

        {/* Always mounted: already-connected relay environments must stay
            visible (and removable) even when cloud config is missing or the
            user is signed out — the component gates discovery itself. */}
        <CloudEnvironmentRows
          connectedCloudEnvironments={connectedCloudEnvironments}
          onOpenEnvironment={openEnvironment}
          onSetEnvironmentEnabled={onSetEnvironmentEnabled}
          onRemoveEnvironment={onRemoveEnvironmentPress}
          {...(SHOWCASE_ENABLED
            ? {
                showcaseAvailableEnvironments: SHOWCASE_AVAILABLE_CLOUD_ENVIRONMENTS,
                showcaseSignedIn: true,
              }
            : {})}
        />
        <AccountSettings />
        <GitHubRoutingSettings />
      </ScrollView>
    </SettingsScreen>
  );
}

function AccountSettings() {
  return hasCloudPublicConfig() ? <ConfiguredAccountSettings /> : null;
}

function ConfiguredAccountSettings() {
  const navigation = useNavigation();
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  return (
    <SettingsSection
      title="T3 Connect account"
      footer="Sign in to the same account on your devices to find your linked computers. Direct pairing stays available."
    >
      <SettingsActionRow
        icon="person.crop.circle"
        label={isSignedIn ? "Manage account" : "Sign in to find your computers"}
        disabled={!isLoaded}
        onPress={() => navigation.navigate("SettingsSheet", { screen: "SettingsAuth" })}
      />
    </SettingsSection>
  );
}
