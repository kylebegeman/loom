import { hiddenNavigationTabsForPlatform } from "../../../fork/usage-navigation/tabs"; // fork: usage-navigation
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Platform } from "react-native";
import {
  NAVIGATION_TAB_LABELS,
  navigationCustomizationAvailable,
  navigationTabsForPlatform,
  enabledNavigationTabs,
  type NavigationTab,
} from "./navigation-tab-order";
import type { AppSymbolName } from "../../../components/ui/AppSymbol";
import { mobilePreferencesAtom } from "../../../state/preferences";
import { PullRequestGlyph } from "../../pull-requests/pullRequestGlyphs";
import { resolveWorkspaceTabOrder } from "./workspace-tabs-state";

export const WORKSPACE_TAB_LABELS = {
  ...NAVIGATION_TAB_LABELS,
  ...(Platform.OS === "ios" ? { pullRequests: "PRs" } : {}),
};

export const NAVIGATION_TAB_ICONS = {
  threads: "text.bubble",
  pullRequests: PullRequestGlyph.pullRequest,
  usage: "chart.bar.xaxis",
  sites: "globe",
  search: "magnifyingglass",
} as const satisfies Readonly<Record<NavigationTab, AppSymbolName>>;

export function useNavigationTabOrder(): readonly NavigationTab[] {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const saved = AsyncResult.isSuccess(preferences)
    ? preferences.value.navigationTabOrder
    : undefined;
  return navigationTabsForPlatform(Platform.OS, resolveWorkspaceTabOrder(saved));
}

export function useHiddenNavigationTabs() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const saved = AsyncResult.isSuccess(preferences)
    ? preferences.value.hiddenNavigationTabs
    : undefined;
  // fork: usage-navigation
  return hiddenNavigationTabsForPlatform(
    Platform.OS,
    navigationCustomizationAvailable() ? saved : undefined,
  );
}

// fork: mobile-navigation
export function useEnabledNavigationTabs(): readonly NavigationTab[] {
  const order = useNavigationTabOrder();
  const hidden = useHiddenNavigationTabs();
  return Platform.OS === "ios" ? order : enabledNavigationTabs(order, hidden);
}
