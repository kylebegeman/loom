import { resolveHiddenNavigationTabs } from "../../features/workspace/navigation-tab-order";

export function hiddenNavigationTabsForPlatform(platform: string, saved?: readonly unknown[]) {
  return resolveHiddenNavigationTabs([...(saved ?? []), ...(platform === "ios" ? ["usage"] : [])]);
}
