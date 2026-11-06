import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import { SettingsRouteScreen } from "../../features/settings/SettingsRouteScreen";
import { WorkspaceToolbar } from "../../features/workspace/WorkspaceToolbar.ios";

export function MobileSettingsRouteScreen() {
  const navigation = useNavigation();
  return (
    <View className="flex-1 bg-screen">
      <AppBar title="Settings" options={{ headerBackVisible: false }} />
      <SettingsRouteScreen
        trailingHeaderItems={[
          {
            type: "button",
            label: "Done",
            accessibilityLabel: "Done",
            variant: "done",
            sharesBackground: false,
            onPress: () => navigation.goBack(),
          },
        ]}
      />
      <WorkspaceToolbar searchTab="settings" showCompose={false} />
    </View>
  );
}
