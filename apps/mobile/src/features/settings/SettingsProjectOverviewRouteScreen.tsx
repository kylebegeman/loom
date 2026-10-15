import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { deriveProjectGroupLabel } from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { AppText as Text, AppTextInput } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { ListChoiceRow } from "../../components/ListChoiceRow";
import { ProjectCheckoutSection } from "../../fork/project-checkout/ProjectCheckoutSection";
import { ProjectResourcesSection } from "../../fork/project-home/ProjectResourcesSection";
import { ProjectWorkingCopySection } from "../../fork/project-home/ProjectWorkingCopySection";
import { resolveProjectSettingsScope } from "../../fork/project-navigation/projectNavigation.logic";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsActionRow } from "./components/SettingsActionRow";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";

export function SettingsProjectOverviewRouteScreen({
  route,
}: StaticScreenProps<
  | { readonly initialEnvironmentId?: EnvironmentId; readonly initialProjectId?: ProjectId }
  | undefined
>) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const {
    selectedIds,
    selectedTargets,
    projectGroups,
    selectedProjectKey,
    selectProject,
    selectAll,
  } = useSettingsEnvironmentFilter();
  const { environments } = useEnvironments();
  const initialEnvironmentId = route.params?.initialEnvironmentId;
  const initialProjectId = route.params?.initialProjectId;
  const appliedProjectRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (initialEnvironmentId === undefined || initialProjectId === undefined) return;
    const projectRef = JSON.stringify([initialEnvironmentId, initialProjectId]);
    if (appliedProjectRef.current === projectRef) return;
    const settingsScope = resolveProjectSettingsScope(projectGroups, {
      environmentId: initialEnvironmentId,
      projectId: initialProjectId,
    });
    if (settingsScope === null) return;
    appliedProjectRef.current = projectRef;
    selectAll();
    selectProject(settingsScope);
  }, [initialEnvironmentId, initialProjectId, projectGroups, selectAll, selectProject]);
  const group = projectGroups.find((entry) => entry.key === selectedProjectKey);
  const members =
    group?.members
      .map((entry) => entry.project)
      .filter((project) => selectedIds === null || selectedIds.has(project.environmentId)) ?? [];
  const visibleGroups = projectGroups.filter((entry) =>
    entry.members.some(
      (member) => selectedIds === null || selectedIds.has(member.project.environmentId),
    ),
  );

  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Projects" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedProjectKey === null ? (
            <>
              <View className="gap-3 px-2">
                <Text className="text-base text-foreground-muted">
                  Open a project you already use, or add a new project from a repository or folder.
                </Text>
                <MaterialButton
                  label="Add project"
                  tone="primary"
                  disabled={selectedTargets.length === 0}
                  onPress={() =>
                    navigation.navigate("NewTaskSheet", {
                      screen: "AddProject",
                      ...(selectedTargets.length === 1
                        ? { params: { environmentId: selectedTargets[0]!.environmentId } }
                        : {}),
                    })
                  }
                />
                {selectedTargets.length === 0 ? (
                  <MaterialButton
                    label="Connect a computer"
                    tone="text"
                    onPress={() => navigation.navigate("Connections")}
                  />
                ) : null}
              </View>
              <SettingsSection title="Your projects">
                {visibleGroups.map((entry) => (
                  <SettingsActionRow
                    key={entry.key}
                    icon="folder"
                    label={entry.label}
                    onPress={() => selectProject(entry.key)}
                  />
                ))}
                {visibleGroups.length === 0 ? (
                  <View className="p-4">
                    <Text className="text-sm text-foreground-muted">
                      No projects on the selected computers. Add a project or change the filter.
                    </Text>
                  </View>
                ) : null}
              </SettingsSection>
            </>
          ) : members.length === 0 ? (
            <View className="gap-3 px-2">
              <Text className="text-base text-foreground-muted">
                This project is unavailable on the selected computers.
              </Text>
              <MaterialButton
                label="See all projects"
                tone="text"
                onPress={() => {
                  selectAll();
                  selectProject(null);
                }}
              />
            </View>
          ) : (
            <ProjectOverviewContent
              key={`${selectedProjectKey}:${members.map((member) => `${member.environmentId}:${member.id}:${member.workspaceRoot}`).join(",")}`}
              members={members}
              environments={environments}
              initialEnvironmentId={initialEnvironmentId}
              initialProjectId={initialProjectId}
              onBackToProjects={() => selectProject(null)}
            />
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function ProjectOverviewContent(props: {
  readonly members: readonly EnvironmentProject[];
  readonly environments: readonly EnvironmentPresentation[];
  readonly initialEnvironmentId: EnvironmentId | undefined;
  readonly initialProjectId: ProjectId | undefined;
  readonly onBackToProjects: () => void;
}) {
  const [chosenKey, setChosenKey] = useState(() => {
    const initial =
      props.members.find(
        (member) =>
          member.environmentId === props.initialEnvironmentId &&
          member.id === props.initialProjectId,
      ) ?? props.members[0]!;
    return `${initial.environmentId}:${initial.id}`;
  });
  const selected = props.members.find(
    (member) => `${member.environmentId}:${member.id}` === chosenKey,
  );
  const representative = selected ?? props.members[0]!;
  const displayName = deriveProjectGroupLabel({ representative, members: props.members });
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  return (
    <>
      <MaterialButton label="All projects" tone="text" onPress={props.onBackToProjects} />
      <View className="flex-row items-center gap-4 px-2">
        <ProjectFavicon
          environmentId={representative.environmentId}
          projectTitle={representative.title}
          workspaceRoot={representative.workspaceRoot}
          faviconPath={representative.faviconPath}
          projectIcon={representative.projectIcon}
          size={48}
        />
        <View className="min-w-0 flex-1">
          <Text className="text-xl font-t3-semibold text-foreground" numberOfLines={2}>
            {displayName}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {new Set(props.members.map((member) => member.environmentId)).size}{" "}
            {new Set(props.members.map((member) => member.environmentId)).size === 1
              ? "computer"
              : "computers"}
          </Text>
        </View>
      </View>
      {props.members.length > 1 ? (
        <SettingsSection title="Choose a working copy">
          {props.members.map((member, index) => {
            const environment = props.environments.find(
              (entry) => entry.environmentId === member.environmentId,
            );
            return (
              <ListChoiceRow
                key={`${member.environmentId}:${member.id}`}
                label={environment?.label ?? "Computer"}
                description={`${environment?.connection.phase === "connected" ? "Connected" : "Offline"}\n${member.workspaceRoot}`}
                selected={
                  selected?.id === member.id && selected.environmentId === member.environmentId
                }
                separated={index > 0}
                onPress={() => setChosenKey(`${member.environmentId}:${member.id}`)}
              />
            );
          })}
        </SettingsSection>
      ) : null}
      {selected ? (
        <SelectedProjectOverview
          key={`${selected.environmentId}:${selected.id}`}
          project={selected}
          environment={props.environments.find(
            (entry) => entry.environmentId === selected.environmentId,
          )}
          detailsExpanded={detailsExpanded}
          toggleDetails={() => setDetailsExpanded((expanded) => !expanded)}
        />
      ) : (
        <Text className="text-sm text-foreground-muted">
          Choose a working copy to manage this project.
        </Text>
      )}
    </>
  );
}

function SelectedProjectOverview(props: {
  readonly project: EnvironmentProject;
  readonly environment: EnvironmentPresentation | undefined;
  readonly detailsExpanded: boolean;
  readonly toggleDetails: () => void;
}) {
  const navigation = useNavigation();
  const { project, environment } = props;
  const label = environment?.label ?? "Computer";
  const connected =
    environment?.entry.enabled === true && environment.connection.phase === "connected";
  const [draftName, setDraftName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const canUpdate = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);
  const canRead = useEnvironmentScope(project.environmentId, AuthOrchestrationReadScope);
  const updateProject = useAtomCommand(projectEnvironment.update, {
    label: "project name update",
    reportFailure: true,
  });
  const nextName = (draftName ?? project.title).trim();
  const canSave =
    connected && canUpdate && !isSaving && nextName.length > 0 && nextName !== project.title;
  const canPrepare =
    connected &&
    canRead &&
    supportsLoomFeature(
      environment?.serverConfig?.environment.capabilities,
      "project-checkout-management",
    );
  const saveName = () => {
    if (!canSave) return;
    setIsSaving(true);
    void updateProject({
      environmentId: project.environmentId,
      input: { projectId: project.id, title: nextName },
    })
      .then((result) => {
        if (result._tag !== "Failure") setDraftName(null);
      })
      .finally(() => setIsSaving(false));
  };
  return (
    <>
      <View className="gap-3 px-2">
        <Text className="text-sm text-foreground-muted">
          Managing this project on {label}
          {connected ? "." : ", currently offline."}
        </Text>
        <MaterialButton
          label="Open project"
          onPress={() =>
            navigation.navigate("ProjectHome", {
              environmentId: project.environmentId,
              projectId: project.id,
            })
          }
        />
      </View>
      <SettingsSection title="Project name">
        <View className="gap-3 p-4">
          <View className="flex-row items-center gap-3">
            <AppTextInput
              accessibilityLabel="Project name"
              className="min-h-11 min-w-0 flex-1 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
              value={draftName ?? project.title}
              onChangeText={setDraftName}
              onSubmitEditing={saveName}
              returnKeyType="done"
              editable={connected && canUpdate && !isSaving}
            />
            {canSave ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save project name"
                onPress={saveName}
                className="rounded-full bg-subtle-strong px-4 py-2 active:opacity-70"
              >
                <Text className="text-sm font-t3-medium text-foreground">Save</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </SettingsSection>
      <ProjectWorkingCopySection
        environmentId={project.environmentId}
        projectId={project.id}
        workspaceRoot={project.workspaceRoot}
        computerLabel={label}
        canClone={canPrepare}
        onClone={() =>
          navigation.navigate("ProjectPreparation", {
            environmentId: project.environmentId,
            projectId: project.id,
          })
        }
      />
      <ProjectResourcesSection
        environmentId={project.environmentId}
        projectId={project.id}
        computerLabel={label}
      />
      <MaterialButton
        label={
          props.detailsExpanded ? "Hide advanced preferences" : "Advanced working file preferences"
        }
        tone="text"
        onPress={props.toggleDetails}
      />
      {props.detailsExpanded ? (
        <ProjectCheckoutSection
          environmentId={project.environmentId}
          projectId={project.id}
          workspaceRoot={project.workspaceRoot}
          computerLabel={label}
        />
      ) : null}
    </>
  );
}
