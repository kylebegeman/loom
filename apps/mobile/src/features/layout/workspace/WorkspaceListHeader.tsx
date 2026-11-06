import { useProjectNavigation } from "../../../fork/project-navigation/useProjectNavigation"; // fork: project-navigation
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { useHardwareKeyboardCommand } from "../../keyboard/hardwareKeyboardCommands";
import { getConnectionAwareBrandHeaderOptions } from "./brand-header-options";
import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";
import { createWorkspaceListHeaderItems } from "./workspace-list-header-items";
import {
  workspaceListFilterIcon,
  type WorkspaceListHeaderProps,
} from "./WorkspaceListHeader.types";

export function WorkspaceListHeader(props: WorkspaceListHeaderProps) {
  return props.sidebar ? <SidebarColumnHeader {...props} sidebar={props.sidebar} /> : null;
}

function SidebarColumnHeader(
  props: WorkspaceListHeaderProps & {
    readonly sidebar: NonNullable<WorkspaceListHeaderProps["sidebar"]>;
  },
) {
  const { sidebar } = props;
  const { view } = useProjectNavigation(); // fork: project-navigation
  const selectTab = useSelectWorkspaceTab();
  // fork: mobile-navigation
  useHardwareKeyboardCommand("focusSearch", () => {
    selectTab("search");
    return true;
  });
  const items = createWorkspaceListHeaderItems({
    filter: {
      accessibilityLabel: view === "projects" ? "Filter projects" : "Filter threads", // fork: project-navigation
      icon: workspaceListFilterIcon(props.filter.customized),
      title: view === "projects" ? "Project list options" : "Thread list options", // fork: project-navigation
      items: props.filter.items,
    },
    onOpenSettings: props.onOpenSettings,
  });

  return (
    <NativeStackScreenOptions
      optionsVersion={[items, sidebar.width]}
      options={{
        ...getConnectionAwareBrandHeaderOptions({
          headerWidth: sidebar.width,
          trailingItemCount: items.length,
          onOpenEnvironments: props.onOpenEnvironments,
          fallbackTitleStyle: { fontSize: 18, fontWeight: "800" },
        }),
        headerSearchBarOptions: undefined,
        unstable_headerRightItems: () => items,
      }}
    />
  );
}
