import { useNavigation, useNavigationState, useRoute } from "@react-navigation/native";

import { workspaceRoutesOf } from "../../features/layout/workspace-overlay-routes";

/** Whether a root route heads the workspace's list column, chosen as projectWorkspaceStack does. */
export function isWorkspacePrimaryRoute(
  routes: readonly { readonly key: string; readonly name: string }[],
  key: string,
) {
  const { workspace } = workspaceRoutesOf(routes);
  const primary =
    workspace.find((route) => route.name === "Home") ??
    workspace.find((route) => route.name === "Library");
  return primary?.key === key;
}

/**
 * Back for a fork page: none while it heads the workspace, otherwise the screen below, or Home
 * when nothing is below. iOS draws its own back button and leaves column roots without one.
 */
export function useWorkspacePageBack() {
  const navigation = useNavigation();
  const { key } = useRoute();
  const primary = useNavigationState((state) => isWorkspacePrimaryRoute(state.routes, key));
  if (primary) return undefined;
  return () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Home");
  };
}
