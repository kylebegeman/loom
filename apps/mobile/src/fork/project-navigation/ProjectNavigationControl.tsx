import { useNavigation } from "@react-navigation/native";
import { Pressable } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { View } from "react-native";

import type { ProjectNavigationView } from "./useProjectNavigation";

export function ProjectNavigationControl(_props: {
  readonly view: ProjectNavigationView;
  readonly onChange: (view: ProjectNavigationView) => void;
}) {
  const navigation = useNavigation();
  return (
    <View className="mt-2 mb-3 flex-row items-center justify-between gap-3 px-4">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Projects"
        onPress={() => navigation.navigate("Library")}
        className="min-h-[44px] flex-row items-center gap-2 rounded-full px-2 active:opacity-70"
      >
        <SymbolView name="folder" size={16} tintColorClassName="accent-icon-muted" />
        <Text className="text-xs font-t3-medium text-foreground-muted">Projects</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Bots"
        onPress={() => navigation.navigate("Bots")}
        className="min-h-[44px] flex-row items-center gap-2 rounded-full px-2 active:opacity-70"
      >
        <SymbolView name="bolt.circle" size={16} tintColorClassName="accent-icon-muted" />
        <Text className="text-xs font-t3-medium text-foreground-muted">Bots</Text>
      </Pressable>
    </View>
  );
}
