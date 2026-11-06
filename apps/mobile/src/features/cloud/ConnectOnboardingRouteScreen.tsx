import { AppBar } from "../../components/ui/AppBar";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";

import { useAuth } from "@clerk/expo";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { reportAtomCommandResult, settlePromise } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { CloudEnvironmentRows } from "../connection/CloudEnvironmentRows";
import { splitEnvironmentSections } from "../connection/environmentSections";
import { useConnectionController } from "../connection/useConnectionController";
import { optOutOfConnectOnboarding } from "./connectOnboardingOptOut";
import { hasCloudPublicConfig } from "./publicConfig";

// fork: fleet-connect - Account onboarding consumes previously linked computers.
// Only reachable with cloud config: onboarding is requested after a T3 Connect
// sign-in, and appLinking drops the deep link otherwise.
export function ConnectOnboardingRouteScreen() {
  return hasCloudPublicConfig() ? <ConfiguredConnectOnboardingRouteScreen /> : null;
}

// fork: mobile-design
function ConfiguredConnectOnboardingRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const { connectedEnvironments, onSetEnvironmentEnabled, onRemoveEnvironmentPress } =
    useRemoteConnections();
  const { refreshRelayEnvironments } = useConnectionController();
  const { connectedCloudEnvironments } = splitEnvironmentSections({
    connectedEnvironments,
    cloudEnvironments: null,
  });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = () => {
    setIsRefreshing(true);
    void refreshRelayEnvironments().finally(() => setIsRefreshing(false));
  };

  const handleClose = () => {
    navigation.goBack();
  };

  // Persist before dismissing so quick sign-out/sign-in cannot outrun the write.
  const handleDontShowAgain = () => {
    void (async () => {
      if (userId) {
        const result = await settlePromise(() => optOutOfConnectOnboarding(userId));
        reportAtomCommandResult(result, { label: "connect onboarding opt-out" });
      }
      navigation.goBack();
    })();
  };

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <AppBar
        title="Set up Loom Connect"
        onClose={handleClose}
        refresh={{
          accessibilityLabel: "Refresh environments",
          disabled: isRefreshing,
          onPress: handleRefresh,
        }}
      />
      <ScrollView
        nestedScrollEnabled
        alwaysBounceVertical
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
        contentContainerStyle={{
          gap: 16,
          paddingHorizontal: 20,
          paddingTop: 16,
        }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      >
        {isSignedIn ? (
          <>
            <View className="gap-2 px-1 pb-2">
              <Text textRole="title" className="font-t3-bold text-foreground">
                Your computers
              </Text>
              <Text textRole="body" className="text-foreground-muted">
                Connect to run agents and continue work from this device.
              </Text>
            </View>
            <CloudEnvironmentRows
              connectedCloudEnvironments={connectedCloudEnvironments}
              onSetEnvironmentEnabled={onSetEnvironmentEnabled}
              onRemoveEnvironment={onRemoveEnvironmentPress}
              showHeader={false}
            />
          </>
        ) : (
          <View collapsable={false} className="gap-3 px-1 py-4">
            <Text textRole="title" className="font-t3-bold text-foreground">
              Connect your computers
            </Text>
            <Text textRole="body" className="text-foreground-muted">
              Sign in to your Loom Connect account to find your computers.
            </Text>
            <View className="self-start">
              <Button
                label="Sign in"
                tone="primary"
                onPress={() => navigation.navigate("SettingsAuth")}
              />
            </View>
          </View>
        )}

        {userId ? (
          <Button label={"Don't show this again"} tone="text" onPress={handleDontShowAgain} />
        ) : null}
      </ScrollView>
    </View>
  );
}
