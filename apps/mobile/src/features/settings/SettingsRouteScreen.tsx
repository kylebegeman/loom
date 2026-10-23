import { BRAND_NAME } from "@t3tools/shared/brand"; // fork: brand
import { Toolbar } from "../../components/ui/Toolbar";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAuth, useUser } from "@clerk/expo";
import { useNavigation } from "@react-navigation/native";
import { Platform, View } from "react-native";
import { deriveProjectGroupLabel } from "@t3tools/client-runtime/state/project-grouping";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { SettingsComputerNotice } from "./components/SettingsComputerNotice";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";

export function SettingsRouteScreen() {
  const navigation = useNavigation();
  const { layout } = useAdaptiveWorkspaceLayout();
  const content = hasCloudPublicConfig() ? (
    <ConfiguredSettingsRouteScreen />
  ) : (
    <LocalSettingsRouteScreen />
  );

  return (
    <>
      {Platform.OS === "ios" ? (
        <NativeStackScreenOptions options={{ headerBackVisible: !layout.usesSplitView }} />
      ) : null}
      {Platform.OS === "ios" && layout.usesSplitView ? (
        <>
          <Toolbar placement="left">
            <Toolbar.Button
              accessibilityLabel="Go back"
              icon="chevron.left"
              onPress={() => navigation.goBack()}
            />
          </Toolbar>
        </>
      ) : null}
      <SettingsEnvironmentFilterHeader closeSettings />
      {Platform.OS === "android" ? (
        <SettingsScreen title="Settings" trailing={<AndroidSettingsEnvironmentFilter />}>
          {content}
        </SettingsScreen>
      ) : (
        content
      )}
    </>
  );
}

function ConfiguredSettingsRouteScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const accountLabel = !isLoaded
    ? "Checking"
    : !isSignedIn
      ? "Sign in"
      : (user?.primaryEmailAddress?.emailAddress ?? "Signed in");

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title="Connections">
          <SettingsRow
            icon="person.crop.circle"
            label="Loom account"
            value={accountLabel}
            disabled={!isLoaded}
            onPress={() => navigation.navigate("SettingsSheet", { screen: "SettingsAuth" })}
          />
          <SettingsRow
            icon="desktopcomputer"
            label="Computers" // fork: fleet-connections - The settings inventory contains work hosts.
            value={`${Object.keys(savedConnectionsById).length}`}
            valuePosition="trailing"
            target="SettingsEnvironments"
          />
          <SettingsRow icon="bell.badge" label="Notifications" target="SettingsNotifications" />
        </SettingsSection>

        <SettingsIndexSections />
      </ScrollView>
    </View>
  );
}

function LocalSettingsRouteScreen() {
  const insets = useSafeAreaInsets();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const environmentCount = Object.keys(savedConnectionsById).length;

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
        }}
      >
        <SettingsSection title="Connections">
          <SettingsRow
            icon="desktopcomputer"
            label="Computers" // fork: fleet-connections - The settings inventory contains work hosts.
            value={`${environmentCount}`}
            valuePosition="trailing"
            target="SettingsEnvironments"
          />
        </SettingsSection>

        <SettingsIndexSections />
      </ScrollView>
    </View>
  );
}

function SettingsIndexSections() {
  const navigation = useNavigation();
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
    scopedProjectMembers.length > 0
      ? deriveProjectGroupLabel({
          representative: scopedProjectMembers[0]!,
          members: scopedProjectMembers,
        })
      : (selectedProject?.label ?? "Unavailable project");
  return (
    <>
      <SettingsSection title="App preferences">
        <SettingsRow icon="paintbrush" label="Appearance" target="SettingsAppearance" />
        {Platform.OS === "ios" ? (
          <>
            <SettingsRow icon="keyboard" label="Keyboard" target="SettingsKeyboard" />
            <SettingsRow icon="mic" label="Microphone" target="SettingsMicrophone" />
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Automations">
        {/* fork: bots */}
        <SettingsRow icon="bolt.circle" label="Bots" onPress={() => navigation.navigate("Bots")} />
        <SettingsRow icon="clock" label="Scheduled tasks" target="SettingsScheduledTasks" />
      </SettingsSection>

      <SettingsSection title="Projects & conversations">
        <SettingsRow
          icon="folder"
          label="Projects"
          onPress={() => navigation.navigate("Library")}
        />
        <SettingsRow
          icon="server.rack"
          label="Library connection"
          onPress={() => navigation.navigate("LibrarySettings")}
        />
        {selectedProjectKey !== null ? (
          <SettingsRow
            icon="folder"
            label="Computer folders"
            value={projectLabel}
            target="SettingsProjectOverview"
          />
        ) : null}
        {/* fork: project-home - Storage review is reachable without a project filter. */}
        <SettingsRow
          icon="internaldrive"
          label="Files on computers"
          onPress={() => navigation.navigate("ProjectStorageInventory")}
        />
        <SettingsRow icon="folder" label="Organization" target="SettingsOrganization" />
        <SettingsRow icon="text.bubble" label="Conversation behavior" target="SettingsThreads" />
        <SettingsRow icon="arrow.turn.left.up" label="Follow-ups" target="SettingsFollowUp" />
        <SettingsRow icon="archivebox" label="Archived conversations" target="SettingsArchive" />
      </SettingsSection>

      <SettingsSection
        title="Computer settings"
        footer={
          noServerTargets
            ? undefined
            : "Applies to the selected computers. Use the filter above to choose computers or a project."
        }
      >
        {noServerTargets ? <SettingsComputerNotice /> : null}
        <SettingsRow
          icon="person.crop.circle"
          label="Agent accounts"
          target="SettingsProviderAccounts"
          disabled={noServerTargets}
        />
        <SettingsRow
          icon="text.bubble"
          label="New conversations"
          target="SettingsEnvironmentNewThreads"
          disabled={noServerTargets}
        />
        <SettingsRow
          icon="arrow.triangle.branch"
          label="Source control"
          target="SettingsEnvironmentSourceControl"
          disabled={noServerTargets}
        />
        <SettingsRow
          icon="text.alignleft"
          label="Agent behavior"
          target="SettingsEnvironmentAgentBehavior"
          disabled={noServerTargets}
        />
        <SettingsRow
          icon="arrow.clockwise"
          label="Maintenance"
          target="SettingsEnvironmentMaintenance"
          disabled={noServerTargets}
        />
        {/* fork: preview-links */}
        <SettingsRow icon="globe" label="Previews" target="PreviewLinks" />
      </SettingsSection>

      <SettingsSection title="App">
        <SettingsRow icon="chart.bar.xaxis" label="Usage" target="SettingsUsage" />
        <SettingsRow icon="info.circle" label={`About ${BRAND_NAME}`} target="SettingsAbout" />
      </SettingsSection>
    </>
  );
}
