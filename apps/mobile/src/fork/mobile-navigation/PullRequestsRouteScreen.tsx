import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import { PullRequestsScreen } from "../../features/pull-requests/PullRequestsScreen";

export function PullRequestsRouteScreen() {
  const navigation = useNavigation();
  return (
    <View className="flex-1 bg-screen">
      <AppBar title="Pull requests" onBack={() => navigation.goBack()} />
      <PullRequestsScreen />
    </View>
  );
}
