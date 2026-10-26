import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { openSettings } from "../settings-navigation";
import { useSettingsEnvironmentFilter } from "../settings-environment-filter";

export function SettingsComputerNotice() {
  const navigation = useNavigation();
  const { availableTargets, selectedTargets, selectedProjectKey, selectAll, selectProject } =
    useSettingsEnvironmentFilter();
  const hasConnectedComputers = availableTargets.length > 0;
  const projectUnavailable = selectedTargets.length > 0 && selectedProjectKey !== null;

  return (
    <View className="gap-3 p-4">
      <Text className="text-sm leading-normal text-foreground-muted">
        {projectUnavailable
          ? "This project has no folder on the selected connected computers. Choose all projects to change computer defaults."
          : hasConnectedComputers
            ? "No connected computers are selected. Choose a computer to view its settings."
            : "Connect a computer to view its settings. Your app preferences remain available while offline."}
      </Text>
      <Button
        label={
          projectUnavailable
            ? "Use all projects"
            : hasConnectedComputers
              ? "Use all connected computers"
              : "Manage computers"
        }
        tone="secondary"
        onPress={() => {
          if (projectUnavailable) selectProject(null);
          else if (hasConnectedComputers) {
            selectAll();
            selectProject(null);
          } else {
            openSettings(navigation, "SettingsEnvironments");
          }
        }}
      />
    </View>
  );
}
