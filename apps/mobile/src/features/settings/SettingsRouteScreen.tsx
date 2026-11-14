import { BOTS_NAVIGATION_VISIBLE } from "@t3tools/client-runtime/fork"; // fork: bots
import { LEGACY_CONNECT_UI_ENABLED } from "@t3tools/client-runtime/fork"; // fork: connect-ui
import { BRAND_NAME } from "@t3tools/shared/brand"; // fork: brand
import {
  navigationCustomizationAvailable,
  overflowNavigationTabs,
} from "../layout/workspace/navigation-tab-order";
import {
  NAVIGATION_TAB_ICONS,
  WORKSPACE_TAB_LABELS,
  useNavigationTabOrder,
  useHiddenNavigationTabs,
} from "../layout/workspace/navigation-tabs";
import { currentWorkspaceSelections } from "../layout/workspace/workspace-selection-store";
import { rememberedSettingsPage } from "../layout/workspace/workspace-tab-navigation";
import { useSelectWorkspaceTab } from "../layout/workspace/useSelectWorkspaceTab";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { EmptyState } from "../../components/ui/EmptyState";
import { useAuth, useUser } from "@clerk/expo";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { use, type ComponentProps, type ReactNode } from "react"; // fork: fleet-connections
import { Platform, View } from "react-native";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { deriveProjectGroupLabel } from "@t3tools/client-runtime/state/project-grouping";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { SettingsComputerNotice } from "./components/SettingsComputerNotice"; // fork: fleet-connections
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection, SettingsSidebarContext } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";
import type { SettingsPageTarget } from "./components/settings-page-targets";
import { useSettingsEnvironmentMenu } from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import { filterSettingsSections } from "./settings-search";
import * as LibraryPush from "../../fork/library-push/LibraryNotifications"; // fork: library-push
import { useLibrarySignInStatus } from "../../fork/library/LibrarySignInStatus"; // fork: library-sign-in
import { usePaneRole } from "../../components/ui/Pane";
import { I18nProvider, useGT, useLanguagePreference } from "../../i18n/I18nProvider";
import { nativeLanguageName } from "@t3tools/client-runtime/locales";
import { SUPPORTED_LOCALES } from "../../i18n/locales";

export function SettingsRouteScreen(props: { readonly trailing?: ReactNode } = {}) {
  const list = useSettingsListPlacement();
  return (
    <SettingsListScreen sidebar={list.sidebar} selected={list.selected} trailing={props.trailing} />
  );
}

/** The Settings list inside a workspace shell that draws its bar, title and search itself. */
export function WorkspaceSettingsList() {
  const list = useSettingsListPlacement();
  return (
    <SettingsSidebarContext value={list.sidebar ? { selected: list.selected } : null}>
      <View className="flex-1 bg-screen">
        <I18nProvider>
          <SettingsListContent />
        </I18nProvider>
      </View>
    </SettingsSidebarContext>
  );
}

function useSettingsListPlacement() {
  const sidebar = usePaneRole() === "sidebar";
  // The page open beside the list: the route right above the Settings tab's route. While
  // another tab is open this list stays mounted, hidden, and must keep showing the page Settings
  // reopens on; otherwise returning shows it unselected for a frame before the page arrives.
  const selected = useNavigationState((state) => {
    const list = state.routes.findIndex((route) => route.name === "Settings");
    return list < 0
      ? rememberedSettingsPage(currentWorkspaceSelections())
      : (state.routes[list + 1]?.name ?? null);
  });
  return { sidebar, selected };
}

function SettingsListContent() {
  return LEGACY_CONNECT_UI_ENABLED && hasCloudPublicConfig() ? (
    <ConfiguredSettingsRouteScreen />
  ) : (
    <LocalSettingsRouteScreen />
  );
}

// fork: mobile-navigation
export function SettingsListScreen(props: {
  readonly sidebar: boolean;
  readonly selected: string | null;
  readonly trailing?: ReactNode;
}) {
  return (
    <I18nProvider>
      <TranslatedSettingsListScreen {...props} />
    </I18nProvider>
  );
}

function TranslatedSettingsListScreen(props: {
  readonly sidebar: boolean;
  readonly selected: string | null;
  readonly trailing?: ReactNode; // fork: mobile-navigation
}) {
  const gt = useGT();
  const workspace = useWorkspaceTabs();
  const environmentMenu = useSettingsEnvironmentMenu();
  return (
    <SettingsSidebarContext value={props.sidebar ? { selected: props.selected } : null}>
      <View className="flex-1 bg-screen">
        <SettingsScreen
          title={gt("Settings")}
          workspaceRoot={props.sidebar}
          menus={[environmentMenu]}
          trailing={props.trailing}
          search={
            workspace
              ? {
                  value: workspace.state.tabs.settings.query,
                  onChangeText: (query) =>
                    workspace.dispatch({ type: "query", tab: "settings", query }),
                  placeholder: gt("Search settings"),
                }
              : undefined
          }
        >
          <SettingsListContent />
        </SettingsScreen>
      </View>
    </SettingsSidebarContext>
  );
}

type SettingsListRow = ComponentProps<typeof SettingsRow> & { readonly id: string };

interface SettingsListSection {
  readonly title?: string;
  readonly rows: readonly SettingsListRow[];
  // fork: fleet-connections - Computer settings explain an empty computer selection.
  readonly notice?: ReactNode;
}

function ConfiguredSettingsRouteScreen() {
  const gt = useGT();
  const navigation = useNavigation();
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const libraryRow = useLibraryRow(); // fork: library-sign-in
  const accountLabel = !isLoaded
    ? gt("Checking")
    : !isSignedIn
      ? gt("Sign in")
      : (user?.primaryEmailAddress?.emailAddress ?? gt("Signed in"));

  return (
    <SettingsList
      connections={[
        {
          id: "account",
          icon: "person.crop.circle",
          label: "Loom account", // fork: brand
          value: accountLabel,
          disabled: !isLoaded,
          onPress: () => navigation.navigate("SettingsAuth"),
        },
        // fork: fleet-connections - The settings inventory contains work hosts.
        environmentsRow("Computers", Object.keys(savedConnectionsById).length),
        libraryRow, // fork: library-sign-in
        {
          id: "SettingsNotifications",
          icon: "bell.badge",
          label: gt("Notifications"),
          target: "SettingsNotifications",
        },
      ]}
    />
  );
}

function LocalSettingsRouteScreen() {
  const gt = useGT();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const libraryRow = useLibraryRow(); // fork: library-sign-in
  return (
    <SettingsList
      connections={[
        // fork: fleet-connections - The settings inventory contains work hosts.
        environmentsRow("Computers", Object.keys(savedConnectionsById).length),
        libraryRow, // fork: library-sign-in
        ...LibraryPush.rows(), // fork: library-push
        ...(!LibraryPush.isSupported()
          ? [
              {
                id: "SettingsNotifications",
                icon: "bell.badge" as const,
                label: gt("Notifications"),
                target: "SettingsNotifications" as const,
              },
            ]
          : []),
      ]}
    />
  );
}

/** The Library's sign-in state, one tap from its sign-in. */
function useLibraryRow(): SettingsListRow {
  const navigation = useNavigation();
  const status = useLibrarySignInStatus();
  return {
    id: "LibrarySettings",
    icon: "server.rack",
    label: "Account",
    value: status.environmentId === null ? "Not connected" : status.stateLabel,
    valuePosition: "trailing",
    onPress: () => navigation.navigate("LibrarySettings"),
  };
}

function environmentsRow(label: string, count: number): SettingsListRow {
  return {
    id: "SettingsEnvironments",
    icon: "desktopcomputer",
    label,
    value: `${count}`,
    valuePosition: "trailing",
    target: "SettingsEnvironments",
  };
}

function SettingsList(props: { readonly connections: readonly SettingsListRow[] }) {
  const gt = useGT();
  // UIKit's scroll-edge material takes the scroll view's own color; like the chat list, match
  // the sidebar's surface so the bar doesn't darken over content at rest.
  // Grouped cards only lift off the screen surface; the drawer is as dark as they are.
  const sidebar = use(SettingsSidebarContext);
  const listSurface = sidebar ? "bg-drawer" : "bg-screen";
  const insets = useSafeAreaInsets();
  // UIKit insets the scroll view by its column's safe area, which this context can report as 0.
  const bottomSafeArea = useNativeColumnLayoutMetrics()?.safeArea.bottom ?? insets.bottom;
  const workspace = useWorkspaceTabs();
  const query = workspace?.state.tabs.settings.query ?? "";
  const overflowRows = useOverflowRows();
  const indexSections = useSettingsIndexSections();
  const connections: SettingsListSection = { title: gt("Connections"), rows: props.connections };
  const sections = filterSettingsSections(
    Platform.OS === "ios"
      ? [...indexSections.slice(0, 1), connections, ...indexSections.slice(1)]
      : [{ rows: overflowRows }, connections, ...indexSections],
    query,
  );

  return (
    <View collapsable={false} className="flex-1">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className={`flex-1 ${listSurface}`}
        contentContainerClassName="gap-7 px-5"
        contentContainerStyle={{
          // Keep clearance inside the scroll view so its native blur reaches the sheet's top.
          // fork: native-scroll-edge
          paddingTop: Platform.OS === "ios" && !sidebar ? 28 : 16,
          // The workspace's clearance keeps the last row above its search field and keyboard.
          paddingBottom:
            Platform.OS === "ios"
              ? Math.max(Math.max(bottomSafeArea, 18) + 18, workspace?.bottomClearance ?? 0) -
                bottomSafeArea
              : Math.max(Math.max(insets.bottom, 18) + 18, workspace?.bottomClearance ?? 0),
        }}
      >
        {sections.length ? (
          sections.map((section, index) => (
            <SettingsSection key={section.title ?? `untitled-${index}`} title={section.title}>
              {/* fork: fleet-connections */}
              {section.notice}
              {section.rows.map(({ id, ...row }) => (
                <SettingsRow key={id} {...row} />
              ))}
            </SettingsSection>
          ))
        ) : (
          <EmptyState
            variant="plain"
            title={gt("No results")}
            detail={gt("No settings match “{query}”.", { query: query.trim() })}
          />
        )}
      </ScrollView>
    </View>
  );
}

// fork: mobile-navigation
function useSettingsIndexSections(): SettingsListSection[] {
  const navigation = useNavigation(); // fork: project-home
  const gt = useGT();
  const language = useLanguagePreference();
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const noServerTargets = selectedTargets.length === 0;
  const selectedProject = projectGroups.find((group) => group.key === selectedProjectKey);
  const scopedProjectMembers =
    selectedProject?.members
      .map((member) => member.project)
      .filter((project) =>
        selectedTargets.some((target) => target.environmentId === project.environmentId),
      ) ?? [];
  const projectLabel =
    selectedProject && scopedProjectMembers.length > 0
      ? deriveProjectGroupLabel({
          groupKey: selectedProject.key,
          representative: scopedProjectMembers[0]!,
          members: scopedProjectMembers,
        })
      : (selectedProject?.label ?? gt("Unavailable project"));
  const page = (
    target: SettingsPageTarget,
    icon: SettingsListRow["icon"],
    label: string,
    extra?: Pick<SettingsListRow, "disabled" | "value">,
  ): SettingsListRow => ({ id: target, icon, label, target, ...extra });
  const serverPage = (target: SettingsPageTarget, icon: SettingsListRow["icon"], label: string) =>
    page(target, icon, label, { disabled: noServerTargets });
  // fork: library
  const route = (
    id:
      | "Bots"
      | "Library"
      | "LibrarySettings"
      | "AccountVault"
      | "ProjectStorageInventory"
      | "PullRequests",
    icon: SettingsListRow["icon"],
    label: string,
  ): SettingsListRow => ({ id, icon, label, onPress: () => navigation.navigate(id) });
  if (Platform.OS === "ios") {
    return [
      {
        title: "Work",
        rows: [
          page("SettingsUsage", "chart.bar.xaxis", "Usage & limits"),
          route("Library", "briefcase", "Projects"),
          ...(BOTS_NAVIGATION_VISIBLE ? [route("Bots", "bolt.circle", "Bots")] : []),
          route("PullRequests", PullRequestGlyph.pullRequest, "Pull requests"),
          page("SettingsArchive", "archivebox", gt("Archive")),
        ],
      },
      {
        title: "App",
        rows: [
          page("SettingsOrganization", "gearshape", gt("General")),
          page("SettingsAppearance", "paintbrush", gt("Appearance")),
          page("SettingsLanguage", "globe", gt("Language"), {
            value: SUPPORTED_LOCALES.includes(language)
              ? nativeLanguageName(language)
              : gt("System default"),
          }),
          page("SettingsFollowUp", "bubble.left.and.bubble.right", gt("Chat")),
          ...(navigationCustomizationAvailable()
            ? [page("SettingsNavigation", "line.3.horizontal", gt("Navigation tabs"))]
            : []),
          page("SettingsKeyboard", "keyboard", gt("Keyboard")),
          page("SettingsVoice", "mic", gt("Voice")),
          page("SettingsAbout", "info.circle", `About ${BRAND_NAME}`),
        ],
      },
      {
        title: gt("Agents"),
        ...(noServerTargets ? { notice: <SettingsComputerNotice /> } : {}),
        rows: [
          serverPage("SettingsProviderAccounts", "person.crop.circle", gt("Providers")),
          route("AccountVault", { ios: "lock", android: "lock" }, "Vault"),
          serverPage("SettingsThreads", "text.bubble", gt("Threads")),
          page("SettingsScheduledTasks", "clock", gt("Scheduled tasks")),
        ],
      },
      {
        title: "Development tools",
        rows: [
          page(
            "SettingsProjectOverview",
            "folder",
            "Computer folders",
            selectedProjectKey !== null ? { value: projectLabel } : undefined,
          ),
          route("ProjectStorageInventory", "internaldrive", "Working files"),
          serverPage(
            "SettingsEnvironmentSourceControl",
            "arrow.triangle.branch",
            gt("Source control"),
          ),
          serverPage("SettingsWorktrees", "square.on.square", gt("Worktrees")),
          page("SettingsPreviewLinks", "globe", "Previews"),
          serverPage("SettingsEnvironmentMaintenance", "arrow.clockwise", gt("Maintenance")),
          page("SettingsLabs", "flask", gt("Labs")),
        ],
      },
    ];
  }
  // The same pages and groups as Settings on web, minus what mobile has no setting for.
  return [
    {
      rows: [
        page("SettingsOrganization", "gearshape", gt("General")),
        page("SettingsAppearance", "paintbrush", gt("Appearance")),
        page("SettingsLanguage", "globe", gt("Language"), {
          value: SUPPORTED_LOCALES.includes(language)
            ? nativeLanguageName(language)
            : gt("System default"),
        }),
        page("SettingsFollowUp", "bubble.left.and.bubble.right", gt("Chat")),
        ...(navigationCustomizationAvailable()
          ? [page("SettingsNavigation", "line.3.horizontal", gt("Navigation tabs"))]
          : []),
        page("SettingsKeyboard", "keyboard", gt("Keyboard")),
        page("SettingsVoice", "mic", gt("Voice")),
      ],
    },
    {
      title: gt("Agents"),
      // fork: fleet-connections - Computer pages below are disabled until a computer is selected.
      ...(noServerTargets ? { notice: <SettingsComputerNotice /> } : {}),
      rows: [
        serverPage("SettingsProviderAccounts", "person.crop.circle", gt("Providers")),
        route("AccountVault", { ios: "lock", android: "lock" }, "Vault"),
        serverPage("SettingsThreads", "text.bubble", gt("Threads")),
        ...(BOTS_NAVIGATION_VISIBLE ? [route("Bots", "bolt.circle", "Bots")] : []), // fork: bots
        page("SettingsScheduledTasks", "clock", gt("Scheduled tasks")),
      ],
    },
    {
      title: gt("Code"),
      rows: [
        // fork: project-home - Library projects are Projects; a computer's checkouts are its folders.
        route("Library", "briefcase", "Projects"),
        page(
          "SettingsProjectOverview",
          "folder",
          "Computer folders",
          selectedProjectKey !== null ? { value: projectLabel } : undefined,
        ),
        // fork: project-home - Storage review is reachable without a project filter.
        route("ProjectStorageInventory", "internaldrive", "Working files"),
        serverPage(
          "SettingsEnvironmentSourceControl",
          "arrow.triangle.branch",
          gt("Source control"),
        ),
        serverPage("SettingsWorktrees", "square.on.square", gt("Worktrees")),
        page("SettingsPreviewLinks", "globe", "Previews"), // fork: preview-links
      ],
    },
    {
      rows: [
        serverPage("SettingsEnvironmentMaintenance", "arrow.clockwise", gt("Maintenance")),
        page("SettingsLabs", "flask", gt("Labs")),
        page("SettingsAbout", "info.circle", `About ${BRAND_NAME}`), // fork: brand
        page("SettingsArchive", "archivebox", gt("Archive")),
      ],
    },
  ];
}

function useOverflowRows(): SettingsListRow[] {
  const order = useNavigationTabOrder();
  const hidden = useHiddenNavigationTabs();
  const { layout } = useAdaptiveWorkspaceLayout();
  const tabs =
    Platform.OS === "android" && layout.usesSplitView ? [] : overflowNavigationTabs(order, hidden);
  const selectTab = useSelectWorkspaceTab();
  return tabs.map((tab) => ({
    id: tab,
    icon: NAVIGATION_TAB_ICONS[tab],
    label: WORKSPACE_TAB_LABELS[tab],
    onPress: () => selectTab(tab),
  }));
}
