// fork: library
import {
  NewTaskLibraryProjectChoices,
  useNewTaskLibraryProjects,
} from "../../fork/library/NewTaskLibraryProjects";
import * as Dialog from "../../components/ui/Dialog";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { NavigationRow } from "../../components/ui/NavigationRow";
import { AppBar } from "../../components/ui/AppBar";
import {
  StackActions,
  useIsFocused,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useNoProjectTarget } from "../../fork/no-project/useNoProjectTarget"; // fork: no-project-first
import { connectionStatusTitle } from "@t3tools/client-runtime/connection"; // fork: fleet-connections
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "../../lib/cn";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { AppText as Text } from "../../components/ui/AppText";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { useProjects, useServerConfigs } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  useRemoteConnectionStatus,
  useSavedRemoteConnections, // fork: fleet-connections
} from "../../state/use-remote-environment-registry";
import type { WorkspaceState } from "../../state/workspaceModel";
import { useWorkspaceState } from "../../state/workspace";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { usePromptLinkResolver } from "../prompt-links/usePromptLinkResolver";
import { useIncomingShare } from "../sharing/IncomingShareProvider";
import { useNewTaskFlow } from "./new-task-flow-provider";
import { filterProjectScopes, getProjectScopeSelectionTarget } from "./new-task-project-selection";

type NewTaskRouteParams = {
  readonly incomingShareId?: string | string[];
  readonly prompt?: string | string[];
  readonly repo?: string | string[];
  readonly pr?: string | string[];
  readonly provider?: string | string[];
  readonly model?: string | string[];
  // fork: library - A Library project in view, which leads the choices.
  readonly libraryProjectId?: string; // fork: library
};

// fork: fleet-connections - Empty states speak of computers and surface unsupported clients.
function deriveProjectEmptyState(catalogState: WorkspaceState): {
  readonly title: string;
  readonly detail: string;
  readonly loading: boolean;
} {
  if (catalogState.isLoadingConnections) {
    return {
      title: "Loading computers",
      detail: "Checking saved computers on this device.",
      loading: true,
    };
  }

  if (!catalogState.hasConnections) {
    return {
      title: "Connect a computer",
      detail: "Connect a computer before starting a task.",
      loading: false,
    };
  }

  if (
    (catalogState.connectionState === "available" ||
      catalogState.connectionState === "offline" ||
      catalogState.connectionState === "error" ||
      catalogState.connectionState === "unsupported") &&
    !catalogState.hasReadyEnvironment
  ) {
    return {
      title:
        catalogState.connectionState === "unsupported"
          ? "Client not supported"
          : "Computer unavailable",
      detail:
        catalogState.connectionError ??
        "The saved computer is offline. Reconnect it or choose another computer to start working.",
      loading: false,
    };
  }

  if (
    catalogState.hasConnectingEnvironment &&
    !catalogState.hasReadyEnvironment &&
    catalogState.connectionError === null
  ) {
    return {
      title: "Connecting to computer",
      detail: "Loading projects from the saved computer.",
      loading: true,
    };
  }

  return {
    title: "Start your first task",
    detail: "Add a project or start without one on the connected computer.",
    loading: false,
  };
}

function NewTaskHeader(props: {
  readonly title: string;
  readonly subtitle: string | null;
  readonly canAddProject: boolean;
  readonly searchText: string;
  readonly onSearchTextChange: (text: string) => void;
}) {
  const navigation = useNavigation();
  const { layout } = useAdaptiveWorkspaceLayout();
  return (
    <AppBar
      title={props.title}
      subtitle={props.subtitle ?? undefined}
      sidebar={false}
      backInSplitView={{
        accessibilityLabel: "Go back",
        icon: "chevron.left",
      }}
      options={{ headerBackVisible: !layout.usesSplitView }}
      hideBottomBorder
      onBack={() => navigation.goBack()}
      actions={
        props.canAddProject
          ? [
              {
                accessibilityLabel: "Add project",
                icon: "plus",
                onPress: () => navigation.navigate("LibraryCreate"), // fork: library
              },
            ]
          : []
      }
      search={{
        value: props.searchText,
        onChangeText: props.onSearchTextChange,
        placeholder: "Search projects",
      }}
    />
  );
}

export function NewTaskRouteScreen({ route }: StaticScreenProps<NewTaskRouteParams | undefined>) {
  const projects = useProjects();
  const [searchText, setSearchText] = useState("");
  const { projectScopes, selectedEnvironmentId, setProject } = useNewTaskFlow();
  const { state: catalogState } = useWorkspaceState();
  const navigation = useNavigation();
  const suggestedProjectId = route.params?.libraryProjectId; // fork: library
  const libraryProjects = useNewTaskLibraryProjects({ searchText, suggestedProjectId }); // fork: library
  const sharedChoices = [...libraryProjects.suggested, ...libraryProjects.choices]; // fork: library
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { getShare, releaseShareReservation } = useIncomingShare();
  usePromptLinkResolver(route.params);
  const routeShareId = Array.isArray(route.params?.incomingShareId)
    ? route.params.incomingShareId[0]
    : route.params?.incomingShareId;
  const incomingShare = routeShareId ? getShare(routeShareId) : null;
  const incomingShareSubtitle = incomingShare
    ? incomingShare.attachments.length === 0
      ? "Choose a project for what you shared"
      : incomingShare.attachments.length === 1
        ? `Choose a project for the ${incomingShare.attachments[0]?.type === "image" ? "image" : "file"} you shared`
        : `Choose a project for the ${incomingShare.attachments.length} ${incomingShare.attachments.every((attachment) => attachment.type === "image") ? "images" : "files"} you shared`
    : null;
  const screenTitle = incomingShare ? "Start a task" : "Choose project";
  const projectEmptyState = deriveProjectEmptyState(catalogState);
  const serverConfigs = useServerConfigs();
  const listScopes = projectScopes.filter(
    (scope) =>
      !scope.projects.every((project) =>
        isScratchProject(project, serverConfigs.get(project.environmentId)?.scratchWorkspaceRoot),
      ),
  );
  const legacyScopes = listScopes.filter(
    (scope) => !libraryProjects.holdsLocalRefs(scope.projectRefs),
  ); // fork: library
  const visibleScopes = filterProjectScopes(legacyScopes, searchText);
  const resumedDestinationKeyRef = useRef<string | null>(null);
  const reservedDestinationProject = incomingShare?.destination
    ? (projects.find(
        (project) =>
          project.environmentId === incomingShare.destination?.environmentId &&
          project.id === incomingShare.destination?.projectId,
      ) ?? null)
    : null;
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const { savedConnectionsById } = useSavedRemoteConnections(); // fork: fleet-connections
  const openScratch = useAtomCommand(projectEnvironment.openScratch, {
    reportFailure: false,
  });
  const scratchEnvironment = useNoProjectTarget(selectedEnvironmentId); // fork: no-project-first
  const canStartScratch = scratchEnvironment !== null && reservedDestinationProject === null;
  // fork: no-project-first - Name the computer, as project rows do. The empty state below has its own button.
  const scratchSubtitle = scratchEnvironment
    ? `Starts on ${savedConnectionsById[scratchEnvironment.environmentId]?.environmentLabel ?? scratchEnvironment.environmentLabel}`
    : "Start a task without a project";
  const emptyStateOffersScratch =
    legacyScopes.length === 0 && sharedChoices.length === 0 && !projectEmptyState.loading;
  const scratchStartInFlightRef = useRef(false);

  async function selectProject(project: EnvironmentProject): Promise<void> {
    if (incomingShare?.destination && !reservedDestinationProject) {
      try {
        await releaseShareReservation(incomingShare.id, incomingShare.destination);
      } catch (error) {
        Dialog.alert(
          "Could not change project",
          error instanceof Error
            ? error.message
            : "The shared content reservation could not be updated.",
        );
        return;
      }
    }
    const state = navigation.getState();
    const previousRoute = state?.routes[state.index - 1];
    if (previousRoute?.name === "NewTaskDraft") {
      setProject(project);
      navigation.goBack();
      return;
    }

    navigation.dispatch(
      StackActions.push("NewTaskDraft", {
        environmentId: project.environmentId,
        projectId: project.id,
        title: project.title,
        incomingShareId: incomingShare?.id,
      }),
    );
  }

  async function startScratch(): Promise<void> {
    if (!scratchEnvironment || scratchStartInFlightRef.current) return;
    const environmentId = scratchEnvironment.environmentId;
    scratchStartInFlightRef.current = true;
    const result = await openScratch({ environmentId, input: {} });
    if (result._tag === "Failure") {
      scratchStartInFlightRef.current = false;
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        Dialog.alert(
          "Could not start without a project",
          error instanceof Error
            ? error.message
            : "The folder for threads without a project could not be created.",
        );
      }
      return;
    }
    // selectProject handles its own failures, so this never throws.
    await selectProject(result.value);
    scratchStartInFlightRef.current = false;
  }

  useEffect(() => {
    const destination = incomingShare?.destination;
    if (!destination) {
      resumedDestinationKeyRef.current = null;
      return;
    }
    if (!isFocused) {
      // Returning from the reserved draft is a fresh resume attempt. Keeping
      // this latch set would leave every project row disabled with no route.
      resumedDestinationKeyRef.current = null;
      return;
    }
    const destinationKey = `${incomingShare.id}:${destination.environmentId}:${destination.projectId}`;
    if (resumedDestinationKeyRef.current === destinationKey) {
      return;
    }
    if (!reservedDestinationProject) {
      return;
    }
    resumedDestinationKeyRef.current = destinationKey;
    navigation.dispatch(
      StackActions.push("NewTaskDraft", {
        environmentId: reservedDestinationProject.environmentId,
        projectId: reservedDestinationProject.id,
        title: reservedDestinationProject.title,
        incomingShareId: incomingShare.id,
      }),
    );
  }, [incomingShare, isFocused, navigation, reservedDestinationProject]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NewTaskHeader
        title={screenTitle}
        subtitle={incomingShareSubtitle}
        canAddProject={catalogState.hasReadyEnvironment}
        searchText={searchText}
        onSearchTextChange={setSearchText}
      />

      <ScreenContent>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          className="flex-1"
          contentContainerStyle={{
            gap: Platform.OS === "android" ? 8 : 12,
            paddingBottom: Math.max(insets.bottom, 18) + 18,
            paddingHorizontal: Platform.OS === "android" ? 16 : 20,
            paddingTop: Platform.OS === "android" ? 16 : 8,
            ...(Platform.OS === "android" && visibleScopes.length === 0
              ? { flexGrow: 1, justifyContent: "center" as const }
              : {}),
          }}
        >
          {/* fork: library - The Library project in view leads, ahead of No project, as on web. */}
          <NewTaskLibraryProjectChoices
            choices={libraryProjects.suggested} // fork: library
            error={null} // fork: library
            incomingShareId={incomingShare?.id} // fork: library
            disabled={reservedDestinationProject !== null} // fork: library
          />
          {/* fork: no-project-first - No project leads the choices whenever a computer can run it. */}
          {canStartScratch && !emptyStateOffersScratch ? (
            Platform.OS === "android" ? (
              <View collapsable={false} className="overflow-hidden rounded-[28px] bg-grouped-card">
                <NavigationRow
                  className="bg-grouped-card"
                  title="No project"
                  subtitle={scratchSubtitle} // fork: no-project-first
                  subtitleNumberOfLines={1} // fork: no-project-first
                  onPress={() => void startScratch()}
                  leading={
                    <SymbolView
                      name="text.bubble"
                      size={22}
                      tintColorClassName="accent-icon-muted"
                      type="monochrome"
                    />
                  }
                />
              </View>
            ) : (
              <View collapsable={false} className="overflow-hidden rounded-[24px] bg-grouped-card">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`No project, ${scratchSubtitle}`} // fork: no-project-first
                  onPress={() => void startScratch()}
                  className="flex-row items-center gap-3 bg-grouped-card px-4 py-3.5"
                >
                  <View className="h-7 w-7 items-center justify-center">
                    <SymbolView
                      name="text.bubble"
                      size={18}
                      tintColorClassName="accent-icon-muted"
                      type="monochrome"
                    />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-base font-t3-bold leading-snug">No project</Text>
                    <Text className="text-xs leading-snug text-foreground-muted" numberOfLines={1}>
                      {scratchSubtitle /* fork: no-project-first */}
                    </Text>
                  </View>
                  <SymbolView
                    name="chevron.right"
                    size={14}
                    tintColorClassName="accent-chevron"
                    type="monochrome"
                  />
                </Pressable>
              </View>
            )
          ) : null}
          {/* fork: library */}
          <NewTaskLibraryProjectChoices
            choices={libraryProjects.choices} // fork: library
            error={libraryProjects.error} // fork: library
            incomingShareId={incomingShare?.id} // fork: library
            disabled={reservedDestinationProject !== null} // fork: library
          />
          {legacyScopes.length === 0 && sharedChoices.length === 0 /* fork: library */ ? (
            <View
              collapsable={false}
              className={cn(
                "items-center gap-3 px-6 py-8",
                Platform.OS !== "android" && "rounded-[24px] bg-grouped-card",
              )}
            >
              {projectEmptyState.loading ? (
                <AppActivityIndicator colorClassName="accent-icon-muted" />
              ) : null}
              <Text className="text-center text-lg font-t3-bold text-foreground">
                {projectEmptyState.title}
              </Text>
              <Text className="text-center text-sm leading-normal text-foreground-muted">
                {projectEmptyState.detail}
              </Text>
              {!projectEmptyState.loading /* fork: fleet-connections */ ? (
                <>
                  {/* fork: fleet-connections */}
                  <Button
                    label={
                      catalogState.hasReadyEnvironment
                        ? "Add project"
                        : catalogState.hasConnections
                          ? "Manage computers"
                          : "Add computer"
                    }
                    tone="primary"
                    onPress={() =>
                      catalogState.hasReadyEnvironment
                        ? navigation.navigate("LibraryCreate") // fork: library - Same choice as the header's Add project.
                        : navigation.navigate(
                            catalogState.hasConnections ? "Connections" : "ConnectionsNew", // fork: fleet-connections
                          )
                    }
                  />
                  {canStartScratch ? (
                    <Button
                      label="Start without a project"
                      tone="secondary"
                      onPress={() => void startScratch()}
                    />
                  ) : null}
                </>
              ) : null}
            </View>
          ) : visibleScopes.length === 0 && sharedChoices.length === 0 /* fork: library */ ? (
            <View className="items-center gap-2 px-6 py-8">
              <Text className="text-center text-lg font-t3-bold text-foreground">
                No matching projects
              </Text>
              <Text className="text-center text-sm leading-normal text-foreground-muted">
                Try a different project name or workspace path.
              </Text>
            </View>
          ) : (
            <View
              collapsable={false}
              className={
                Platform.OS === "android"
                  ? "overflow-hidden rounded-[28px] bg-grouped-card"
                  : "overflow-hidden rounded-[24px] bg-grouped-card"
              }
            >
              {visibleScopes.map((scope, scopeIndex) => {
                const hasMultipleProjects = scope.projects.length > 1;
                const selectionTarget = getProjectScopeSelectionTarget(
                  scope,
                  selectedEnvironmentId,
                );
                // fork: fleet-connections - Name the computer and its connection state on each row.
                const computerLabel =
                  savedConnectionsById[selectionTarget.environmentId]?.environmentLabel ??
                  "Computer";
                const connectionPhase =
                  connectedEnvironments.find(
                    (environment) => environment.environmentId === selectionTarget.environmentId,
                  )?.connectionState ?? "available";
                const projectSubtitle = [
                  computerLabel,
                  connectionPhase === "connected"
                    ? null
                    : connectionStatusTitle({ phase: connectionPhase, error: null, traceId: null }),
                  hasMultipleProjects
                    ? `${scope.projects.length} workspaces`
                    : selectionTarget.workspaceRoot,
                ]
                  .filter(Boolean)
                  .join(" · ");
                if (Platform.OS === "android") {
                  return (
                    <NavigationRow
                      className="bg-grouped-card"
                      key={scope.key}
                      title={scope.title}
                      subtitle={projectSubtitle} // fork: fleet-connections
                      subtitleNumberOfLines={1}
                      subtitleEllipsizeMode="middle"
                      disabled={reservedDestinationProject !== null}
                      onPress={() => void selectProject(selectionTarget)}
                      leading={
                        <ProjectFavicon
                          environmentId={scope.representative.environmentId}
                          faviconPath={scope.representative.faviconPath}
                          projectIcon={scope.representative.projectIcon}
                          size={24}
                          projectTitle={scope.title}
                          workspaceRoot={scope.representative.workspaceRoot}
                        />
                      }
                    />
                  );
                }
                return (
                  <View
                    key={scope.key}
                    className={cn(scopeIndex > 0 && "border-t border-border-subtle")}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${scope.title}, ${projectSubtitle}`} // fork: fleet-connections
                      disabled={reservedDestinationProject !== null}
                      onPress={() => void selectProject(selectionTarget)}
                      className="flex-row items-center gap-3 bg-grouped-card px-4 py-3.5"
                    >
                      <View className="h-7 w-7 items-center justify-center">
                        <ProjectFavicon
                          environmentId={scope.representative.environmentId}
                          faviconPath={scope.representative.faviconPath}
                          projectIcon={scope.representative.projectIcon}
                          size={20}
                          projectTitle={scope.title}
                          workspaceRoot={scope.representative.workspaceRoot}
                        />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className={cn("text-base leading-snug", "font-t3-bold")}>
                          {scope.title}
                        </Text>
                        <Text
                          className="text-xs leading-snug text-foreground-muted"
                          ellipsizeMode="middle"
                          numberOfLines={1}
                        >
                          {projectSubtitle /* fork: fleet-connections */}
                        </Text>
                      </View>
                      <SymbolView
                        name="chevron.right"
                        size={14}
                        tintColorClassName="accent-chevron"
                        type="monochrome"
                      />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </ScreenContent>
    </View>
  );
}
