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
    label: "Projects",
    accessibilityLabel: "Show projects",
    icon: { ios: "folder.fill", android: "folder" },
  },
] as const;

export function ProjectNavigationControl(props: {
  readonly view: ProjectNavigationView;
  readonly onChange: (view: ProjectNavigationView) => void;
}) {
  return (
    <View className="items-start px-4 pt-2 pb-3">
      <SegmentedControl
        iconOnly
        options={OPTIONS}
        selected={props.view}
        onSelect={props.onChange}
        role="tab"
      />
    </View>
  );
}
