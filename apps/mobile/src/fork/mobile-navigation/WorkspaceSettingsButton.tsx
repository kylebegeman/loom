import { useNavigation } from "@react-navigation/native";

import { Toolbar } from "../../components/ui/Toolbar";

export function WorkspaceSettingsButton() {
  const navigation = useNavigation();
  return (
    <Toolbar placement="left">
      <Toolbar.Button
        identifier="workspace-settings"
        accessibilityLabel="Settings"
        icon="gearshape"
        separateBackground
        onPress={() => navigation.navigate("Settings")}
      />
    </Toolbar>
  );
}
