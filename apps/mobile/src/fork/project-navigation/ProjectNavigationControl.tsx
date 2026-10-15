import { useNavigation } from "@react-navigation/native";
import { Pressable } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { View } from "react-native";

import { SegmentedControl } from "../../components/SegmentedControl";
import type { ProjectNavigationView } from "./useProjectNavigation";

const OPTIONS = [
  {
    value: "threads",
    label: "Threads",
    accessibilityLabel: "Show threads",
    icon: { ios: "text.bubble.fill", android: "chat_bubble" },
  },
  {
    value: "projects",
    label: "Folders",
    accessibilityLabel: "Show computer folders",
    icon: { ios: "folder.fill", android: "folder" },
  },
] as const;

export function ProjectNavigationControl(props: {
  readonly view: ProjectNavigationView;
  readonly onChange: (view: ProjectNavigationView) => void;
}) {
  const navigation = useNavigation();
  return (
    <View className="mt-2 mb-3 flex-row items-center justify-between gap-3 px-4">
      <SegmentedControl
        iconOnly
        size="compact"
        options={OPTIONS}
        selected={props.view}
        onSelect={props.onChange}
        role="tab"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Projects"
        onPress={() => navigation.navigate("Library")}
        className="min-h-[44px] flex-row items-center gap-2 rounded-full px-2 active:opacity-70"
      >
        <SymbolView name="folder" size={16} tintColorClassName="accent-icon-muted" />
        <Text className="text-xs font-t3-medium text-foreground-muted">Projects</Text>
      </Pressable>
    </View>
  );
}
