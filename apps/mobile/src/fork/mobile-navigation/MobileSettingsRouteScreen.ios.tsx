import { useNavigation } from "@react-navigation/native";

import { Toolbar } from "../../components/ui/Toolbar";
import { SettingsRouteScreen } from "../../features/settings/SettingsRouteScreen";

export function MobileSettingsRouteScreen() {
  const navigation = useNavigation();
  return (
    <SettingsRouteScreen
      trailing={
        <Toolbar.Button
          label="Done"
          accessibilityLabel="Done"
          variant="done"
          separateBackground
          onPress={() => navigation.goBack()}
        />
      }
    />
  );
}
