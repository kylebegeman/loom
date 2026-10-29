import { libraryProjectForLocalRefs } from "@t3tools/client-runtime/fork";
import { AgentToolFamiliesSection } from "../../fork/project-profiles/AgentToolFamiliesSection"; // fork: ext-settings
import { library, useLibraryAuthority } from "../../fork/library/libraryState";
import { useEnvironmentQuery } from "../../state/query";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts"; // fork: project-navigation
import { ProjectFolderLocation } from "../../fork/project-navigation/ProjectFolderLocation";
import { projectFolderSettingsSuccessor } from "../../fork/project-navigation/projectFolderSettingsSelection";
import { resolveProjectSettingsScope } from "../../fork/project-navigation/projectNavigation.logic"; // fork: project-navigation
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import * as Dialog from "../../components/ui/Dialog";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { planProjectRemoval } from "@t3tools/client-runtime/state/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { deriveProjectGroupLabel } from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
// fork: project-navigation
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react"; // fork: project-navigation
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// fork: project-checkout-management - Review storage ownership per checkout on its host.
import { ProjectCheckoutSection } from "../../fork/project-checkout/ProjectCheckoutSection";
import { projectEnvironment } from "../../state/projects";
import { useThreadShells } from "../../state/entities";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  clearComposerDraft,
  composerDraftsAtom,
  findNewTaskDraftKeys,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import {
  readEnvironmentScope,
  useEnvironmentScope,
  useEnvironmentsWithScope,
} from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { leaveSettingsPage } from "./settings-navigation";
import { workspaceHasColumns } from "../workspace/workspace-selection-store";
import { DEFAULT_SETTINGS_PAGE } from "../workspace/workspace-tab-navigation";
import { readUnloadedThreadCount } from "../../state/olderSettledShelf";

// fork: project-navigation - A project library shortcut opens this existing settings flow in scope.
export function SettingsProjectOverviewRouteScreen({
  route,
}: StaticScreenProps<
  | { readonly initialEnvironmentId?: EnvironmentId; readonly initialProjectId?: ProjectId }
  | undefined
>) {
  const insets = useSafeAreaInsets();
  const [isRemoving, setIsRemoving] = useState(false);
  const removalPending = useRef(false);
  const startRemoval = () => {
    if (removalPending.current) return false;
    removalPending.current = true;
    return true;
  };
  const finishRemoval = () => {
    removalPending.current = false;
    setIsRemoving(false);
  };
  const navigation = useNavigation();
  const {
    selectedTargets,
    projectGroups,
    selectedProjectKey,
    selectProject,
    getSelectedProjectKey,
    selectAll, // fork: project-navigation
  } = useSettingsEnvironmentFilter();
  // The filter can move to another project while a removal is still running.
  const finishProjectRemoval = (projectKey: string | null) => {
    if (getSelectedProjectKey() !== projectKey) return;
    if (navigation.isFocused())
      leaveSettingsPage(navigation, workspaceHasColumns(), DEFAULT_SETTINGS_PAGE);
    // Otherwise the filter keeps pointing at the removed project as an unavailable one.
    selectProject(null);
  };
  // fork: project-navigation
  const initialEnvironmentId = route.params?.initialEnvironmentId;
  const initialProjectId = route.params?.initialProjectId;
  const appliedProjectRef = useRef<string | undefined>(undefined);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies the route's initial project to the shared Settings filter after its environment groups load
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
  // fork: project-navigation
  // Folder paths can change grouping keys, while the selected project IDs stay the same.
  const previousSelection = useRef<(typeof projectGroups)[number] | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the successor is written to the Settings filter provider, which another component owns
  useEffect(() => {
    if (group) {
      previousSelection.current = group;
      return;
    }
    const successor = projectFolderSettingsSuccessor(
      projectGroups,
      selectedProjectKey,
      previousSelection.current,
    );
    if (successor) selectProject(successor);
  }, [group, projectGroups, selectedProjectKey, selectProject]);
  const selectedEnvironmentIds = new Set(selectedTargets.map((entry) => entry.environmentId));
  const members =
    group?.members
      .map((entry) => entry.project)
      .filter((project) => selectedEnvironmentIds.has(project.environmentId)) ?? [];

  return (
    <>
      <SettingsEnvironmentFilterHeader />
      {/* fork: project-checkout-management - Library projects are Projects; this page manages folders. */}
      <SettingsScreen title="Computer folders" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedProjectKey === null ? (
            <Text className="px-2 text-base text-foreground-muted">
              Choose a project with the filter above to manage its name, checkouts and removal.
            </Text>
          ) : members.length === 0 ? (
            <Text className="px-2 text-base text-foreground-muted">
              {/* fork: everyday-workflows */}
              This project has no folder on the selected connected computers. Change the filter
              above.
            </Text>
          ) : (
            <ProjectOverviewContent
              // fork: project-checkout-management
              key={`${selectedProjectKey}:${members.map((member) => `${member.environmentId}:${member.id}:${member.workspaceRoot}`).join(",")}`}
              members={members}
              environments={selectedTargets}
              hasOtherMembers={members.length < (group?.members.length ?? 0)}
              isRemoving={isRemoving}
              setIsRemoving={setIsRemoving}
              startRemoval={startRemoval}
              finishRemoval={finishRemoval}
              projectKey={selectedProjectKey}
              onProjectRemoved={finishProjectRemoval}
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
  readonly hasOtherMembers: boolean;
  readonly isRemoving: boolean;
  readonly setIsRemoving: (isRemoving: boolean) => void;
  readonly startRemoval: () => boolean;
  readonly finishRemoval: () => void;
  readonly projectKey: string | null;
  readonly onProjectRemoved: (projectKey: string | null) => void;
}) {
  const { isRemoving, setIsRemoving, startRemoval, finishRemoval } = props;
  // fork: library
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
  const threads = useThreadShells();
  const removableEnvironments = useEnvironmentsWithScope(
    props.members,
    AuthOrchestrationOperateScope,
  );
  const canRemoveGroup = props.members.every((member) =>
    removableEnvironments.has(member.environmentId),
  );
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const updateProject = useAtomCommand(projectEnvironment.update, {
    label: "project name update",
    reportFailure: true,
  });
  const nextName = (draftName ?? displayName).trim();
  const canSave = !isSaving && nextName.length > 0 && nextName !== displayName;

  const checkRemovalAccess = (members: readonly EnvironmentProject[]) => {
    const denied = members.find(
      (member) => !readEnvironmentScope(member.environmentId, AuthOrchestrationOperateScope),
    );
    if (!denied) return true;
    const environment = props.environments.find(
      (entry) => entry.environmentId === denied.environmentId,
    );
    Dialog.alert(
      "Failed to remove project",
      `This connection cannot change projects in ${environment?.label ?? "this environment"}.`,
    );
    return false;
  };

  const removeMembers = (members: readonly EnvironmentProject[]) => {
    if (!checkRemovalAccess(members) || !startRemoval()) return;
    const projectKey = props.projectKey;
    const plan = planProjectRemoval({
      members: members.map((member) => ({
        ...member,
        environmentLabel: props.environments.find(
          (entry) => entry.environmentId === member.environmentId,
        )?.label,
      })),
      groupMemberCount: props.members.length,
      hasOtherMembers: props.hasOtherMembers,
      displayName,
      threads,
      unloadedThreadCount: readUnloadedThreadCount(members, threads),
    });
    Dialog.confirm({
      title: plan.targetKind === "checkout" ? "Remove checkout" : "Remove project",
      message: plan.confirmationMessage,
      confirmText: plan.targetKind === "checkout" ? "Remove checkout" : "Remove project",
      destructive: true,
      onCancel: finishRemoval,
      onConfirm: () => {
        void (async () => {
          setIsRemoving(true);
          if (!checkRemovalAccess(members)) return;
          for (const member of members) {
            if (!checkRemovalAccess([member])) return;
            const result = await deleteProject({
              environmentId: member.environmentId,
              input: { projectId: member.id, force: true },
            });
            if (result._tag === "Failure") {
              if (!isAtomCommandInterrupted(result)) {
                const error = squashAtomCommandFailure(result);
                Dialog.alert(
                  `Failed to remove "${member.title}"`,
                  error instanceof Error ? error.message : "An error occurred.",
                );
              }
              return;
            }
            await waitForComposerDraftsLoaded()
              .then(() => {
                for (const draftKey of findNewTaskDraftKeys(
                  appAtomRegistry.get(composerDraftsAtom),
                  {
                    environmentId: member.environmentId,
                    projectId: member.id,
                  },
                )) {
                  clearComposerDraft(draftKey);
                }
              })
              .catch((error) => {
                console.warn("[project-removal] could not clear composer drafts", error);
              });
          }
          // Nothing is left to show once the whole project is gone.
          if (plan.targetKind === "project") props.onProjectRemoved(projectKey);
        })().finally(finishRemoval);
      },
    });
  };

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
      {/* fork: library */}
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

      {/* fork: library */}
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
                {/* fork: everyday-workflows */}
                {environment?.label ?? "Computer"}
              </Text>
              {environment?.displayUrl ? (
                <Text className="text-sm leading-normal text-foreground-muted">
                  {environment.displayUrl}
                </Text>
              ) : null}
              <Text className="text-sm leading-normal text-foreground-muted" selectable>
                {member.workspaceRoot}
              </Text>
              {/* fork: project-navigation */}
              <ProjectFolderLocation
                project={member}
                computerLabel={environment?.label ?? "Computer"}
              />
              {props.members.length > 1 || props.hasOtherMembers ? (
                <RemoveCheckoutAction
                  member={member}
                  disabled={isRemoving}
                  onPress={() => removeMembers([member])}
                />
              ) : null}
            </View>
          );
        })}
      </SettingsSection>
      {/* fork: ext-settings */}
      {props.members.map((member) => (
        <AgentToolFamiliesSection
          key={`${member.environmentId}:${member.id}`}
          environmentId={member.environmentId}
          projectId={member.id}
          computerLabel={
            props.environments.find((entry) => entry.environmentId === member.environmentId)
              ?.label ?? "Computer"
          }
        />
      ))}
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
      <SettingsSection title="Danger">
        <SettingsActionRow
          icon="trash"
          label={
            props.hasOtherMembers
              ? "Remove checkout"
              : props.members.length > 1
                ? "Remove this project everywhere"
                : "Remove project"
          }
          description={
            props.hasOtherMembers
              ? "Deletes the selected machine's checkout entries and their threads. Other machines and files on disk are not touched."
              : props.members.length > 1
                ? `Deletes all ${props.members.length} checkout entries and their threads on every machine. Files on disk are not touched.`
                : "Deletes the project entry and its threads. Files on disk are not touched."
          }
          tone="danger"
          disabled={!canRemoveGroup || isRemoving}
          loading={isRemoving}
          onPress={() => removeMembers(props.members)}
        />
      </SettingsSection>
    </>
  );
}

function RemoveCheckoutAction(props: {
  readonly member: EnvironmentProject;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const canRemove = useEnvironmentScope(props.member.environmentId, AuthOrchestrationOperateScope);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remove checkout ${props.member.workspaceRoot}`}
      disabled={props.disabled || !canRemove}
      onPress={props.onPress}
      className="self-start rounded-full border border-border bg-card px-3 py-1.5 disabled:opacity-40"
    >
      <Text className="font-t3-medium text-xs text-danger-foreground">Remove checkout</Text>
    </Pressable>
  );
}
