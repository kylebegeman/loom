import { View } from "react-native";

import { SegmentedControl } from "../../components/SegmentedControl";
import type { ProjectNavigationView } from "./useProjectNavigation";

const OPTIONS = [
  { value: "threads", label: "Threads", accessibilityLabel: "Show threads" },
  { value: "projects", label: "Projects", accessibilityLabel: "Show projects" },
] as const;

export function ProjectNavigationControl(props: {
  readonly view: ProjectNavigationView;
  readonly onChange: (view: ProjectNavigationView) => void;
}) {
  return (
    <View className="px-4 pt-2 pb-3">
      <SegmentedControl
        options={OPTIONS}
        selected={props.view}
        onSelect={props.onChange}
        role="tab"
      />
    </View>
  );
}
