import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import { PullRequestsScreen } from "../../features/pull-requests/PullRequestsScreen";
import { WorkspaceToolbar } from "../../features/layout/workspace/WorkspaceToolbar.ios";

export function PullRequestsRouteScreen() {
  const navigation = useNavigation();
  const goBack = () => navigation.goBack();
  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title="Pull requests"
        onBack={goBack}
        backInSplitView={{ accessibilityLabel: "Back", icon: "chevron.left", onPress: goBack }}
      />
      <PullRequestsScreen />
      <WorkspaceToolbar searchTab="pullRequests" showCompose={false} />
    </View>
  );
}
