import { Platform } from "react-native";
import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu } from "../../components/ui/AppBar.types";
import { isDuoDevice } from "../../lib/device-type";
import { useDeviceType } from "../../native/native-layout-metrics";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";

export function ThreadHeader(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly onOpenDetails?: () => void; // fork: library
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
}) {
  const goBack = useWorkspaceBackNavigation("threads");
  const deviceType = useDeviceType();
  const { layout, toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const actions: AppBarAction[] = props.hasThreadCwd
    ? [
        {
          accessibilityLabel: filesVisible ? "Close files" : "Open files",
          icon: "folder",
          selected: filesVisible,
          disabled: !props.gitControls.canOpenFiles,
          separateBackground: false,
          onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
        },
      ]
    : [];
  // fork: library
  if (props.onOpenDetails)
    actions.push({
      accessibilityLabel: "Conversation details",
      icon: "info.circle",
      onPress: props.onOpenDetails,
    });
  const actionMenus = [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);
  // fork: native-menus
  const compactMenus = Platform.OS === "ios" && !layout.usesSplitView && !isDuoDevice(deviceType);
  const menus: AppBarMenu[] =
    compactMenus && actionMenus.length > 0
      ? [
          {
            title: "Thread tools",
            icon: "ellipsis",
            separateBackground: false,
            items: actionMenus.map((menu) => ({
              id: menu.title,
              title: menu === gitMenu ? "Source control" : menu.title,
              icon: typeof menu.icon === "string" ? menu.icon : menu.icon.ios,
              items: menu.items,
            })),
          },
        ]
      : actionMenus;

  // fork: mobile-navigation
  return (
    <AppBar
      title={props.title}
      subtitle={props.subtitle}
      onBackToList={goBack}
      onCompose={props.draft || panes.primarySidebarVisible ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: "Return to chat",
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      hideBottomBorder
    />
  );
}
