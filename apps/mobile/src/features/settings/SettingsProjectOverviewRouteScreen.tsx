import { libraryProjectForLocalRefs } from "@t3tools/client-runtime/fork";
import { library, useLibraryAuthority } from "../../fork/library/libraryState";
import { useEnvironmentQuery } from "../../state/query";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts"; // fork: project-navigation
import { resolveProjectSettingsScope } from "../../fork/project-navigation/projectNavigation.logic"; // fork: project-navigation
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { deriveProjectGroupLabel } from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useEffect, useRef, useState } from "react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// fork: project-checkout-management - Review storage ownership per checkout on its host.
import { ProjectCheckoutSection } from "../../fork/project-checkout/ProjectCheckoutSection";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";

// fork: project-navigation - A project library shortcut opens this existing settings flow in scope.
export function SettingsProjectOverviewRouteScreen({
  route,
}: StaticScreenProps<
  | { readonly initialEnvironmentId?: EnvironmentId; readonly initialProjectId?: ProjectId }
  | undefined
>) {
  const insets = useSafeAreaInsets();
  const { selectedTargets, projectGroups, selectedProjectKey, selectProject, selectAll } =
    useSettingsEnvironmentFilter();
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
  const selectedEnvironmentIds = new Set(selectedTargets.map((entry) => entry.environmentId));
  const members =
    group?.members
      .map((entry) => entry.project)
      .filter((project) => selectedEnvironmentIds.has(project.environmentId)) ?? [];

  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Computer folders" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {members.length === 0 ? (
            <Text className="px-2 text-base text-foreground-muted">
              This project has no checkout on the selected connected environments. Change the filter
              above.
            </Text>
          ) : (
            <ProjectOverviewContent
              key={`${selectedProjectKey}:${members.map((member) => `${member.environmentId}:${member.id}:${member.workspaceRoot}`).join(",")}`}
              members={members}
              environments={selectedTargets}
            />
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function ProjectOverviewContent(props: {
  readonly members: readonly EnvironmentProject[];
  readonly environments: readonly SettingsTarget[];
}) {
  const navigation = useNavigation();
  const authority = useLibraryAuthority();
  const copies = useEnvironmentQuery(
    authority.environmentId
      ? library.copies({ environmentId: authority.environmentId, input: { includeReleased: true } })
      : null,
  );
  const sharedProjectId = libraryProjectForLocalRefs(
    [],
    props.members.map((member) => ({
      environmentId: member.environmentId,
      projectId: member.id,
    })),
    copies.data ?? [],
    { includeInactiveCopies: true },
  );
  const representative = props.members[0]!;
  const displayName = deriveProjectGroupLabel({ representative, members: props.members });
  const [draftName, setDraftName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const updateProject = useAtomCommand(projectEnvironment.update, {
    label: "project name update",
    reportFailure: true,
  });
  const nextName = (draftName ?? displayName).trim();
  const canSave = !isSaving && nextName.length > 0 && nextName !== displayName;

  const saveName = () => {
    if (!canSave) return;
    setIsSaving(true);
    void (async () => {
      const results = await Promise.all(
        props.members.map((member) =>
          updateProject({
            environmentId: member.environmentId,
            input: { projectId: member.id, title: nextName },
          }),
        ),
      );
      setIsSaving(false);
      if (results.every((result) => result._tag !== "Failure")) setDraftName(null);
    })();
  };

  return (
    <>
      {sharedProjectId ? (
        <View className="gap-3 rounded-2xl bg-grouped-card p-4">
          <Text className="text-sm text-foreground-muted">
            These are computer folder settings. Shared preferences and files belong to the same
            project in Projects.
          </Text>
          <Button
            label="Open project"
            onPress={() => navigation.navigate("LibraryProject", { projectId: sharedProjectId })}
          />
        </View>
      ) : null}
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
            {props.members.length === 1 ? "1 checkout" : `${props.members.length} checkouts`}
          </Text>
        </View>
      </View>

      <SettingsSection title="Project">
        <View className="gap-3 p-4">
          <Text className="text-sm font-t3-medium text-foreground-muted">Name</Text>
          <View className="flex-row items-center gap-3">
            <AppTextInput
              accessibilityLabel="Project name"
              className="min-h-11 min-w-0 flex-1 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
              value={draftName ?? displayName}
              onChangeText={setDraftName}
              onSubmitEditing={saveName}
              returnKeyType="done"
              editable={!isSaving}
            />
            {canSave ? (
              <Button
                label="Save"
                accessibilityHint="Save project name"
                tone="secondary"
                onPress={saveName}
              />
            ) : null}
          </View>
        </View>
      </SettingsSection>

      <SettingsSection title="Computer folders">
        {props.members.map((member, index) => {
          const environment = props.environments.find(
            (entry) => entry.environmentId === member.environmentId,
          );
          return (
            <View
              key={`${member.environmentId}:${member.id}`}
              className={index === 0 ? "gap-1 p-4" : "gap-1 border-t border-border-subtle p-4"}
            >
              <Text
                className={
                  Platform.OS === "android"
                    ? "text-base text-foreground"
                    : "text-lg text-foreground"
                }
              >
                {environment?.label ?? "Environment"}
              </Text>
              {environment?.displayUrl ? (
                <Text className="text-sm leading-normal text-foreground-muted">
                  {environment.displayUrl}
                </Text>
              ) : null}
              <Text className="text-sm leading-normal text-foreground-muted" selectable>
                {member.workspaceRoot}
              </Text>
            </View>
          );
        })}
      </SettingsSection>
      {/* fork: project-checkout-management - Each review stays bound to one computer's folder. */}
      {!sharedProjectId
        ? props.members.map((member) => (
            <ProjectCheckoutSection
              key={`${member.environmentId}:${member.id}`}
              environmentId={member.environmentId}
              projectId={member.id}
              workspaceRoot={member.workspaceRoot}
              computerLabel={
                props.environments.find((entry) => entry.environmentId === member.environmentId)
                  ?.label ?? "Computer"
              }
            />
          ))
        : null}
    </>
  );
}
