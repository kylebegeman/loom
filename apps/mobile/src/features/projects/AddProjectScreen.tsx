import { AppActivityIndicator } from "../../components/AppActivityIndicator";
import { MaterialListRow } from "../../components/MaterialListRow";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { MaterialButton } from "../../components/MaterialButton";
import {
  addProjectRemoteSourceLabel,
  addProjectRemoteSourcePathHint,
  addProjectRemoteSourceProvider,
  buildAddProjectRemoteSourceReadiness,
  buildProjectCreateCommand,
  canCreateProjectInEnvironment,
  findExistingAddProject,
  getAddProjectInitialQuery,
  getCloneDestinationBrowsePath,
  getCloneDestinationPath,
  getCloneDirectoryName,
  getDefaultCloneUrl,
  getNewProjectPathPreview,
  getNewProjectPublishTarget,
  getNewProjectPublishTargets,
  getNewProjectRepository,
  normalizePastedCloneUrl,
  parseAddProjectRemoteSource,
  resolveAddProjectPath,
  sortAddProjectProviderSources,
  type AddProjectRemoteSource,
} from "@t3tools/client-runtime/operations/projects";
import {
  connectionStatusText,
  type EnvironmentConnectionPhase,
} from "@t3tools/client-runtime/connection";
import {
  canPreloadBrowsePath,
  createBrowseNavigationCoordinator,
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
  resolveFilesystemReadAccess,
} from "@t3tools/client-runtime/state/filesystem";
import {
  appendBrowsePathSegment,
  inferProjectTitleFromPath,
  isWindowsPlatform,
} from "@t3tools/client-runtime/state/projects";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  AuthFilesystemReadScope,
  CommandId,
  type EnvironmentId,
  type EnvironmentMachineKind,
  ProjectId,
  resolveEnvironmentMachineKind,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { CommonActions, StackActions, useNavigation } from "@react-navigation/native";
import { SymbolView } from "../../components/AppSymbol";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Alert, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Order from "effect/Order";
import { AsyncResult } from "effect/reactivity";
import { cn } from "../../lib/cn";
import { useProjects, useServerConfigs, waitForProject } from "../../state/entities";
import { filesystemEnvironment } from "../../state/filesystem";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSession, useEnvironmentScope, readEnvironmentScope } from "../../state/session";
import { useEnvironmentPresentation } from "../../state/presentation";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { ErrorBanner } from "../../components/ErrorBanner";
import { SourceControlIcon } from "../../components/SourceControlIcon";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { uuidv4 } from "../../lib/uuid";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import {
  useRemoteConnectionStatus,
  useRemoteEnvironmentRuntime,
  useSavedRemoteConnections,
} from "../../state/use-remote-environment-registry";
import { resolveAddProjectEnvironment } from "./AddProjectScreen.logic";
import {
  createNewTaskDraft,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";

interface EnvironmentOption {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly platform: string;
  readonly machine: EnvironmentMachineKind;
  readonly baseDirectory: string | null;
  /** Folder for projects started from just a name; null on servers without it. */
  readonly newProjectsRoot: string | null;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionError: string | null;
  readonly connectionErrorTraceId: string | null;
  /** Server runs clones in the background and streams progress; older servers block. */
  readonly supportsCloneTracking: boolean;
}

const environmentOptionOrder = Order.mapInput(
  Order.Struct({
    label: Order.String,
  }),
  (environment: EnvironmentOption) => ({ label: environment.label }),
);

function platformFromOs(os: string | null | undefined): string {
  if (os === "windows") return "Win32";
  if (os === "darwin") return "MacIntel";
  if (os === "linux") return "Linux";
  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "An error occurred.";
}

function stringParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function sourceFromParam(value: string | string[] | undefined): AddProjectRemoteSource {
  return parseAddProjectRemoteSource(stringParam(value));
}

function SectionTitle(props: { readonly children: string }) {
  return (
    <Text
      className={
        Platform.OS === "android"
          ? "px-4 text-sm font-t3-medium text-primary-text"
          : "px-1 text-2xs font-t3-bold tracking-[0.7px] uppercase text-foreground-muted"
      }
    >
      {props.children}
    </Text>
  );
}

function AddProjectShell(props: { readonly children: ReactNode; readonly title: string }) {
  const insets = useSafeAreaInsets();

  return (
    // collapsable={false} is load-bearing: if this wrapper is flattened, the
    // ScrollView lands directly under RNSSafeAreaView and RNS's formSheet
    // scroll-view frame correction mistakes this full-height wrapper for a
    // "header" sibling, coercing the ScrollView to zero height (blank sheet
    // as soon as the sheet re-lays-out, e.g. when the keyboard opens).
    <SettingsScreen title={props.title}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: Platform.OS === "android" ? 16 : 20,
          paddingTop: 16,
          paddingBottom: Math.max(insets.bottom, 18) + 18,
          gap: Platform.OS === "android" ? 16 : 10,
        }}
      >
        {props.children}
      </ScrollView>
    </SettingsScreen>
  );
}

function ListSection(props: { readonly children: ReactNode }) {
  return (
    <View
      className={
        Platform.OS === "android"
          ? "overflow-hidden rounded-[28px] bg-grouped-card"
          : "overflow-hidden rounded-[24px] bg-grouped-card"
      }
    >
      {props.children}
    </View>
  );
}

function ListRow(props: {
  readonly title: string;
  readonly subtitle?: string | null;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly isFirst?: boolean;
  readonly right?: ReactNode;
  readonly onPress?: () => void;
}) {
  if (Platform.OS === "android") {
    return (
      <MaterialListRow
        className="bg-grouped-card"
        title={props.title}
        subtitle={props.subtitle}
        leading={props.icon}
        trailing={props.right}
        disabled={props.disabled}
        onPress={props.onPress}
        accessibilityRole={
          props.selected !== undefined ? "radio" : props.onPress ? "button" : "text"
        }
        accessibilityState={{
          disabled: props.disabled,
          ...(props.selected !== undefined ? { checked: props.selected } : {}),
        }}
      />
    );
  }
  return (
    <Pressable
      accessibilityLabel={[props.title, props.subtitle].filter(Boolean).join(", ")}
      accessibilityRole={props.selected !== undefined ? "radio" : props.onPress ? "button" : "text"}
      accessibilityState={{
        disabled: props.disabled,
        ...(props.selected !== undefined ? { checked: props.selected } : {}),
      }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "bg-grouped-card px-3.5 py-2.5 active:opacity-70",
        !props.isFirst && "border-t border-border-subtle",
        props.disabled && "opacity-[0.45]",
      )}
    >
      <View className="flex-row items-center gap-3">
        <View
          className={
            props.selected
              ? "h-7 w-7 items-center justify-center rounded-full bg-primary"
              : "h-7 w-7 items-center justify-center"
          }
        >
          {props.icon}
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-base leading-snug font-t3-bold">{props.title}</Text>
          {props.subtitle ? (
            <Text className="text-sm leading-snug text-foreground-muted" numberOfLines={2}>
              {props.subtitle}
            </Text>
          ) : null}
        </View>
        {"right" in props ? (
          props.right
        ) : !props.disabled ? (
          <SymbolView
            name="chevron.right"
            size={13}
            tintColorClassName="accent-chevron"
            type="monochrome"
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function PrimaryActionButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly onPress: () => void;
}) {
  if (Platform.OS === "android") return <MaterialButton {...props} tone="primary" fullWidth />;
  return (
    <Pressable
      disabled={props.disabled}
      onPress={props.onPress}
      className="h-12 items-center justify-center rounded-full bg-primary active:opacity-70 disabled:opacity-45"
    >
      {props.loading ? (
        <AppActivityIndicator colorClassName={String("accent-primary-foreground")} />
      ) : (
        <Text className="text-base font-t3-bold text-primary-foreground">{props.label}</Text>
      )}
    </Pressable>
  );
}

function ProjectPathInput(props: {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly onSubmit: () => void;
}) {
  return (
    <TextInput
      className="h-12 min-h-12 rounded-[24px] px-4 py-0 text-base leading-snug"
      value={props.value}
      onChangeText={props.onChangeText}
      autoCapitalize="none"
      autoCorrect={false}
      placeholder="~/projects/my-app"
      returnKeyType="done"
      onSubmitEditing={props.onSubmit}
    />
  );
}

// `pinnedDirectoryName` is the repository folder the clone destination keeps
// appended to whatever folder the user browses to. The plain add-project flow
// passes nothing, so it keeps proposing the browsed folder itself.
function useBrowsePathInput(environment: EnvironmentOption | null, pinnedDirectoryName = "") {
  const environmentId = environment?.environmentId ?? null;
  const environmentBaseDirectory = environment?.baseDirectory ?? null;
  const clonePathCaseSensitive = !isWindowsPlatform(environment?.platform ?? "");
  const [pathInput, commitPathInput] = useState(() =>
    getCloneDestinationPath(
      getAddProjectInitialQuery(environmentBaseDirectory),
      pinnedDirectoryName,
    ),
  );
  const previousEnvironmentIdRef = useRef(environmentId);
  const environmentRuntime = useRemoteEnvironmentRuntime(environmentId);
  const loadBrowsePath = useAtomQueryRunner(filesystemEnvironment.browse, {
    reportFailure: false,
    reportDefect: false,
  });
  const [browseNavigation] = useState(createBrowseNavigationCoordinator);
  const [isBrowseNavigating, setIsBrowseNavigating] = useState(false);
  const setPathInput = useCallback(
    (path: string) => {
      browseNavigation.invalidate();
      setIsBrowseNavigating(false);
      commitPathInput(path);
    },
    [browseNavigation],
  );
  const navigateToBrowsePath = useCallback(
    async (input: {
      readonly browseDirectoryPath: string;
      readonly selectedDirectoryName?: string;
    }) => {
      const selectedDirectoryPath = input.selectedDirectoryName
        ? appendBrowsePathSegment(input.browseDirectoryPath, input.selectedDirectoryName)
        : input.browseDirectoryPath;
      const nextPathInput =
        pinnedDirectoryName && input.selectedDirectoryName
          ? getCloneDestinationBrowsePath({
              browseDirectoryPath: input.browseDirectoryPath,
              selectedDirectoryName: input.selectedDirectoryName,
              cloneDirectoryName: pinnedDirectoryName,
              caseSensitive: clonePathCaseSensitive,
            })
          : getCloneDestinationPath(selectedDirectoryPath, pinnedDirectoryName);
      setIsBrowseNavigating(true);
      const committed = await browseNavigation.run(
        async () => {
          if (
            environment &&
            readEnvironmentScope(environment.environmentId, AuthFilesystemReadScope) &&
            canPreloadBrowsePath(environmentRuntime?.connectionState)
          ) {
            await loadBrowsePath({
              environmentId: environment.environmentId,
              input: { partialPath: selectedDirectoryPath },
            });
          }
        },
        () => commitPathInput(nextPathInput),
      );
      if (committed) {
        setIsBrowseNavigating(false);
      }
      return committed;
    },
    [
      browseNavigation,
      clonePathCaseSensitive,
      environment,
      environmentRuntime?.connectionState,
      loadBrowsePath,
      pinnedDirectoryName,
    ],
  );

  useEffect(() => {
    if (environmentId !== null && environmentId !== previousEnvironmentIdRef.current) {
      previousEnvironmentIdRef.current = environmentId;
      setPathInput(
        getCloneDestinationPath(
          getAddProjectInitialQuery(environmentBaseDirectory),
          pinnedDirectoryName,
        ),
      );
    }
  }, [environmentBaseDirectory, environmentId, pinnedDirectoryName, setPathInput]);

  useEffect(
    () => () => {
      browseNavigation.invalidate();
    },
    [browseNavigation],
  );

  return { isBrowseNavigating, pathInput, setPathInput, navigateToBrowsePath };
}

function useEnvironmentOptions(): ReadonlyArray<EnvironmentOption> {
  const serverConfigByEnvironmentId = useServerConfigs();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const { connectedEnvironments } = useRemoteConnectionStatus();

  return useMemo<ReadonlyArray<EnvironmentOption>>(() => {
    const runtimeByEnvironmentId = new Map(
      connectedEnvironments.map((environment) => [environment.environmentId, environment] as const),
    );
    const options = Object.values(savedConnectionsById).map((connection) => {
      const config = serverConfigByEnvironmentId.get(connection.environmentId);
      const runtime = runtimeByEnvironmentId.get(connection.environmentId);
      return {
        environmentId: connection.environmentId,
        label: connection.environmentLabel,
        platform: platformFromOs(config?.environment.platform.os ?? null),
        machine: resolveEnvironmentMachineKind(config ?? null),
        baseDirectory: config?.settings.addProjectBaseDirectory ?? null,
        newProjectsRoot: config?.newProjectsRoot ?? null,
        connectionState: runtime?.connectionState ?? "available",
        connectionError: runtime?.connectionError ?? null,
        connectionErrorTraceId: runtime?.connectionErrorTraceId ?? null,
        supportsCloneTracking: config?.environment.capabilities.projectCloneTracking === true,
      };
    });
    return Arr.sort(options, environmentOptionOrder);
  }, [connectedEnvironments, savedConnectionsById, serverConfigByEnvironmentId]);
}

function useSelectedEnvironment(): {
  readonly environmentOptions: ReadonlyArray<EnvironmentOption>;
  readonly selectedEnvironment: EnvironmentOption | null;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly setSelectedEnvironmentId: (environmentId: EnvironmentId) => void;
} {
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(null);
  const environmentOptions = useEnvironmentOptions();
  const selectedEnvironment = resolveAddProjectEnvironment(
    environmentOptions,
    selectedEnvironmentId,
  );
  // Freeze the first visible choice so a reconnect cannot redirect creation
  // to a different computer after the user starts this flow.
  if (selectedEnvironmentId === null && selectedEnvironment !== null) {
    setSelectedEnvironmentId(selectedEnvironment.environmentId);
  }

  return {
    environmentOptions,
    selectedEnvironment,
    selectedEnvironmentId: selectedEnvironmentId ?? selectedEnvironment?.environmentId ?? null,
    setSelectedEnvironmentId,
  };
}

function EmptyEnvironmentState() {
  const navigation = useNavigation();
  const { isLoadingSavedConnection, savedConnectionsById } = useSavedRemoteConnections();
  const hasSavedComputers = Object.keys(savedConnectionsById).length > 0;

  return (
    <View className="items-center gap-3 rounded-2xl bg-grouped-card px-5 py-8">
      {isLoadingSavedConnection ? (
        <AppActivityIndicator colorClassName="accent-icon-muted" />
      ) : null}
      <Text className="text-center text-lg font-t3-bold">
        {isLoadingSavedConnection
          ? "Loading computers"
          : hasSavedComputers
            ? "Computer unavailable"
            : "Connect a computer"}
      </Text>
      <Text className="text-center text-sm leading-normal text-foreground-muted">
        {isLoadingSavedConnection
          ? "Checking saved computers on this device."
          : hasSavedComputers
            ? "Reconnect the selected computer or choose another before adding a project."
            : "Connect a computer to create a project, open a folder, or clone a repository there."}
      </Text>
      {!isLoadingSavedConnection ? (
        <MaterialButton
          label={hasSavedComputers ? "Manage computers" : "Add computer"}
          tone="primary"
          onPress={() => navigation.navigate(hasSavedComputers ? "Connections" : "ConnectionsNew")}
        />
      ) : null}
    </View>
  );
}

function ComputerSummary(props: { readonly environment: EnvironmentOption }) {
  return (
    <>
      <SectionTitle>Computer</SectionTitle>
      <ListSection>
        <ListRow
          title={props.environment.label}
          subtitle={connectionStatusText({
            phase: props.environment.connectionState,
            error: props.environment.connectionError,
            traceId: props.environment.connectionErrorTraceId,
          })}
          icon={
            <EnvironmentMachineSymbol
              kind={props.environment.machine}
              size={Platform.OS === "android" ? 24 : 17}
              tintColorClassName="accent-icon"
            />
          }
          isFirst
          right={null}
        />
      </ListSection>
    </>
  );
}

function SourceControlRow(props: {
  readonly source: AddProjectRemoteSource;
  readonly selectedEnvironmentId: EnvironmentId;
  readonly ready: boolean;
  readonly hint: string;
  readonly isFirst: boolean;
}) {
  const navigation = useNavigation();
  const title =
    props.source === "url" ? "Git URL" : `${addProjectRemoteSourceLabel(props.source)} repository`;
  const subtitle =
    props.source === "url"
      ? "Clone from a remote URL"
      : `Clone ${addProjectRemoteSourceLabel(props.source)} ${props.hint}`;
  const icon =
    props.source === "url" ? (
      <SymbolView
        name="link"
        size={Platform.OS === "android" ? 24 : 17}
        tintColorClassName="accent-icon"
        type="monochrome"
      />
    ) : (
      <SourceControlIcon
        kind={sourceControlClients.get(props.source).icon}
        size={Platform.OS === "android" ? 24 : 18}
        colorClassName="accent-icon"
      />
    );

  if (!props.ready) {
    return (
      <ListRow title={title} subtitle={props.hint} icon={icon} disabled isFirst={props.isFirst} />
    );
  }

  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      icon={icon}
      isFirst={props.isFirst}
      onPress={() =>
        navigation.dispatch(
          StackActions.push("AddProjectRepository", {
            environmentId: props.selectedEnvironmentId,
            source: props.source,
          }),
        )
      }
    />
  );
}

export function AddProjectSourceScreen() {
  const navigation = useNavigation();
  const {
    environmentOptions,
    selectedEnvironment,
    selectedEnvironmentId,
    setSelectedEnvironmentId,
  } = useSelectedEnvironment();
  const canWriteSourceControl = useEnvironmentScope(
    selectedEnvironment?.environmentId ?? null,
    AuthSourceControlWriteScope,
  );
  const canCreateProject = useEnvironmentScope(
    selectedEnvironment?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const canCloneProject = canWriteSourceControl && canCreateProject;
  const discoveryState = useEnvironmentQuery(
    selectedEnvironment === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId: selectedEnvironment.environmentId,
          input: {},
        }),
  );
  const readiness = useMemo(
    () => buildAddProjectRemoteSourceReadiness(discoveryState.data),
    [discoveryState.data],
  );

  return (
    <AddProjectShell title="Add project">
      {environmentOptions.length > 0 ? (
        <>
          <SectionTitle>Computer</SectionTitle>
          <ListSection>
            {environmentOptions.map((environment, index) => (
              <ListRow
                key={environment.environmentId}
                title={environment.label}
                subtitle={connectionStatusText({
                  phase: environment.connectionState,
                  error: environment.connectionError,
                  traceId: environment.connectionErrorTraceId,
                })}
                icon={
                  <EnvironmentMachineSymbol
                    kind={environment.machine}
                    size={Platform.OS === "android" ? 24 : 17}
                    tintColorClassName="accent-icon"
                  />
                }
                selected={environment.environmentId === selectedEnvironmentId}
                disabled={!canCreateProjectInEnvironment(environment.connectionState)}
                isFirst={index === 0}
                right={
                  environment.environmentId === selectedEnvironmentId ? (
                    <SymbolView
                      name="checkmark"
                      size={Platform.OS === "android" ? 20 : 14}
                      tintColorClassName="accent-icon"
                      type="monochrome"
                    />
                  ) : null
                }
                onPress={() => setSelectedEnvironmentId(environment.environmentId)}
              />
            ))}
          </ListSection>
        </>
      ) : null}

      {selectedEnvironment === null ? <EmptyEnvironmentState /> : null}
      {selectedEnvironment ? (
        <>
          <ListSection>
            {selectedEnvironment.newProjectsRoot !== null ? (
              <ListRow
                title="New project"
                subtitle={
                  canCreateProject
                    ? "Start a new Git repository from a name"
                    : "This connection cannot add projects."
                }
                disabled={!canCreateProject}
                icon={
                  <SymbolView
                    name="plus"
                    size={Platform.OS === "android" ? 24 : 17}
                    tintColorClassName="accent-icon"
                    type="monochrome"
                  />
                }
                isFirst
                onPress={() =>
                  navigation.dispatch(
                    StackActions.push("AddProjectNew", {
                      environmentId: selectedEnvironment.environmentId,
                    }),
                  )
                }
              />
            ) : null}
            <ListRow
              title="Existing folder"
              subtitle={
                canCreateProject
                  ? `Browse folders on ${selectedEnvironment.label}`
                  : "This connection cannot add projects."
              }
              icon={
                <SymbolView
                  name="folder.badge.plus"
                  size={Platform.OS === "android" ? 24 : 17}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                />
              }
              isFirst={selectedEnvironment.newProjectsRoot === null}
              disabled={!canCreateProject}
              onPress={() =>
                navigation.dispatch(
                  StackActions.push("AddProjectLocal", {
                    environmentId: selectedEnvironment.environmentId,
                  }),
                )
              }
            />
            {(["url", ...sortAddProjectProviderSources(readiness)] as AddProjectRemoteSource[]).map(
              (candidate) => (
                <SourceControlRow
                  key={candidate}
                  source={candidate}
                  selectedEnvironmentId={selectedEnvironment.environmentId}
                  ready={canCloneProject && readiness(candidate).ready}
                  hint={
                    !canCloneProject
                      ? "This connection cannot clone projects."
                      : readiness(candidate).ready
                        ? addProjectRemoteSourcePathHint(candidate)
                        : (readiness(candidate).hint ?? "")
                  }
                  isFirst={false}
                />
              ),
            )}
          </ListSection>
          {discoveryState.isPending ? (
            <AppActivityIndicator colorClassName="accent-icon-muted" />
          ) : null}
          <MaterialButton
            label="Manage computers"
            tone="text"
            onPress={() => navigation.navigate("Connections")}
          />
        </>
      ) : null}
    </AddProjectShell>
  );
}

function openNewTaskDraft(
  navigation: { dispatch: (action: ReturnType<typeof CommonActions.reset>) => void },
  params: {
    environmentId: EnvironmentId;
    projectId: ProjectId;
    title: string;
    cloning?: "1";
    draftId?: string;
  },
) {
  navigation.dispatch(
    CommonActions.reset({ index: 0, routes: [{ name: "NewTaskDraft", params }] }),
  );
}

/** A new task draft in the project, holding a prompt link's prompt. */
async function draftWithPrompt(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  prompt: string,
): Promise<string> {
  await waitForComposerDraftsLoaded();
  const draftId = createNewTaskDraft({ environmentId, projectId });
  setComposerDraftText(draftId, prompt);
  return draftId;
}

function useCreateProject(
  environment: EnvironmentOption | null,
  createWorkspaceRootIfMissing: boolean,
) {
  const navigation = useNavigation();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const projects = useProjects();

  return useCallback(
    async (workspaceRoot: string) => {
      if (
        !environment ||
        !canCreateProjectInEnvironment(environment.connectionState) ||
        !readEnvironmentScope(environment.environmentId, AuthOrchestrationOperateScope)
      ) {
        Alert.alert(
          "Project not added",
          `This connection cannot add projects right now. Any existing files remain at ${workspaceRoot}.`,
        );
        return;
      }

      const existing = findExistingAddProject({
        projects,
        environmentId: environment.environmentId,
        path: workspaceRoot,
      });
      if (existing) {
        Alert.alert("Project already exists", existing.title);
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [
              {
                name: "NewTaskDraft",
                params: {
                  environmentId: existing.environmentId,
                  projectId: existing.id,
                  title: existing.title,
                },
              },
            ],
          }),
        );
        return;
      }

      const projectId = ProjectId.make(uuidv4());
      const command = {
        ...buildProjectCreateCommand({
          commandId: CommandId.make(uuidv4()),
          projectId,
          workspaceRoot,
        }),
        createWorkspaceRootIfMissing,
      };
      const result = await createProject({
        environmentId: environment.environmentId,
        input: command,
      });
      if (AsyncResult.isFailure(result)) {
        return result;
      }
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: "NewTaskDraft",
              params: {
                environmentId: environment.environmentId,
                projectId,
                title: inferProjectTitleFromPath(workspaceRoot),
              },
            },
          ],
        }),
      );
      return result;
    },
    [createProject, createWorkspaceRootIfMissing, environment, projects, navigation],
  );
}

function useEnvironmentFromParam(
  environmentIdParam: string | string[] | undefined,
): EnvironmentOption | null {
  const environmentOptions = useEnvironmentOptions();
  const environmentId = stringParam(environmentIdParam) as EnvironmentId | null;
  return resolveAddProjectEnvironment(environmentOptions, environmentId);
}

export function AddProjectRepositoryScreen(props: {
  readonly environmentId?: string | string[];
  readonly source?: string | string[];
}) {
  const lookupRepositoryQuery = useAtomQueryRunner(sourceControlEnvironment.repository, {
    reportFailure: false,
  });
  const navigation = useNavigation();
  const environment = useEnvironmentFromParam(props.environmentId);
  const source = sourceFromParam(props.source);
  const [repositoryInput, setRepositoryInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupRepository = useCallback(async () => {
    if (!environment || repositoryInput.trim().length === 0 || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    const provider = addProjectRemoteSourceProvider(source);
    if (!provider) {
      const remoteUrl = normalizePastedCloneUrl(repositoryInput);
      navigation.dispatch(
        StackActions.push("AddProjectDestination", {
          environmentId: environment.environmentId,
          source,
          remoteUrl,
          repositoryTitle: remoteUrl,
          repositoryName: getCloneDirectoryName(remoteUrl),
        }),
      );
      setIsSubmitting(false);
      return;
    }

    const result = await lookupRepositoryQuery({
      environmentId: environment.environmentId,
      input: {
        provider,
        repository: repositoryInput.trim(),
      },
    });
    if (AsyncResult.isFailure(result)) {
      setError(errorMessage(Cause.squash(result.cause)));
    } else {
      const repository = result.value;
      navigation.dispatch(
        StackActions.push("AddProjectDestination", {
          environmentId: environment.environmentId,
          source,
          remoteUrl: getDefaultCloneUrl(repository),
          repositoryTitle: repository.nameWithOwner,
          repositoryName: getCloneDirectoryName(repository.nameWithOwner),
        }),
      );
    }
    setIsSubmitting(false);
  }, [environment, isSubmitting, lookupRepositoryQuery, repositoryInput, navigation, source]);

  return (
    <AddProjectShell title={source === "url" ? "Git URL" : addProjectRemoteSourceLabel(source)}>
      {error ? <ErrorBanner message={error} /> : null}
      {environment ? (
        <>
          <ComputerSummary environment={environment} />
          <TextInput
            className="h-12 min-h-12 rounded-[24px] px-4 py-0 text-base leading-snug"
            value={repositoryInput}
            onChangeText={setRepositoryInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={
              source === "url"
                ? "https://github.com/org/repo.git"
                : addProjectRemoteSourcePathHint(source)
            }
            returnKeyType="next"
            onSubmitEditing={() => void lookupRepository()}
          />
          <PrimaryActionButton
            label={source === "url" ? "Continue" : "Lookup repository"}
            disabled={isSubmitting || repositoryInput.trim().length === 0}
            onPress={() => void lookupRepository()}
            loading={isSubmitting}
          />
        </>
      ) : (
        <EmptyEnvironmentState />
      )}
    </AddProjectShell>
  );
}

function FolderBrowser(props: {
  readonly environment: EnvironmentOption;
  readonly pathInput: string;
  readonly setPathInput: (path: string) => void;
  readonly navigateToBrowsePath: (input: {
    readonly browseDirectoryPath: string;
    readonly selectedDirectoryName?: string;
  }) => Promise<boolean>;
  readonly pinnedDirectoryName?: string;
}) {
  const browsePath = useMemo(
    () => getFilesystemBrowsePath(props.pathInput, props.environment.platform),
    [props.environment.platform, props.pathInput],
  );
  const browseInput = useMemo(
    () => (browsePath.directoryPath.length > 0 ? { partialPath: browsePath.directoryPath } : null),
    [browsePath.directoryPath],
  );
  const fileAccessSession = useEnvironmentQuery(
    environmentSession.sessionStateAtom(props.environment.environmentId),
  );
  const fileEnvironment = useEnvironmentPresentation(props.environment.environmentId);
  const fileAccess = resolveFilesystemReadAccess({
    isCatalogReady: fileEnvironment.isReady,
    connection: fileEnvironment.presentation?.connection ?? null,
    session: fileAccessSession.data,
    sessionError: fileAccessSession.error,
  });
  const { canReadFiles } = fileAccess;
  const browseState = useEnvironmentQuery(
    !canReadFiles || browseInput === null
      ? null
      : filesystemEnvironment.browse({
          environmentId: props.environment.environmentId,
          input: browseInput,
        }),
  );
  // A pinned repository folder does not exist yet, so filtering the listing by
  // it would empty the folder picker. Anything the user typed still filters.
  const pinnedDirectoryName = props.pinnedDirectoryName ?? "";
  const pinnedDirectoryMatches = isWindowsPlatform(props.environment.platform)
    ? browsePath.filterQuery.toLowerCase() === pinnedDirectoryName.toLowerCase()
    : browsePath.filterQuery === pinnedDirectoryName;
  const browseFilterQuery = pinnedDirectoryMatches ? "" : browsePath.filterQuery;
  const { visibleEntries: visibleBrowseEntries } = useMemo(
    () => filterFilesystemBrowseEntries(browseState.data?.entries ?? [], browseFilterQuery),
    [browseFilterQuery, browseState.data?.entries],
  );

  return (
    <>
      <SectionTitle>Browse folders</SectionTitle>
      {!canReadFiles && !fileAccess.isPending ? (
        <ErrorBanner message={fileAccess.error ?? "This connection cannot browse host folders."} />
      ) : null}
      {browseState.error ? <ErrorBanner message={browseState.error} /> : null}
      <ListSection>
        {fileAccess.isPending || (browseState.isPending && browseState.data === null) ? (
          <View className="items-center py-5">
            <AppActivityIndicator colorClassName="accent-icon-muted" />
          </View>
        ) : null}
        {browsePath.canBrowseUp ? (
          <ListRow
            title=".."
            icon={
              <SymbolView
                name="arrow.turn.left.up"
                size={Platform.OS === "android" ? 24 : 17}
                tintColorClassName="accent-icon-muted"
                type="monochrome"
              />
            }
            isFirst
            right={null}
            onPress={() => {
              if (browsePath.parentPath) {
                void props.navigateToBrowsePath({
                  browseDirectoryPath: browsePath.parentPath,
                });
              }
            }}
          />
        ) : null}
        {visibleBrowseEntries.map((entry, index) => (
          <ListRow
            key={entry.fullPath}
            title={entry.name}
            icon={
              <SymbolView
                name="folder"
                size={Platform.OS === "android" ? 24 : 17}
                tintColorClassName="accent-icon-muted"
                type="monochrome"
              />
            }
            isFirst={index === 0 && !browsePath.canBrowseUp}
            right={null}
            onPress={() => {
              void props.navigateToBrowsePath({
                browseDirectoryPath: browsePath.directoryPath,
                selectedDirectoryName: entry.name,
              });
            }}
          />
        ))}
      </ListSection>
    </>
  );
}

/**
 * New project: a name, then the server makes the folder, README, icon, and
 * first commit. Optionally publishes it to GitHub as a private repository.
 */
export function AddProjectNewScreen(props: { readonly environmentId?: string | string[] }) {
  const navigation = useNavigation();
  // Starts on the machine picked in Add project; the rows below switch it.
  const environmentOptions = useEnvironmentOptions().filter(
    (option) => option.newProjectsRoot !== null,
  );
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(
    () => stringParam(props.environmentId) as EnvironmentId | null,
  );
  const environment = resolveAddProjectEnvironment(environmentOptions, selectedEnvironmentId);
  const canCreateProject = useEnvironmentScope(
    environment?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const canPublishRepository = useEnvironmentScope(
    environment?.environmentId ?? null,
    AuthSourceControlWriteScope,
  );
  const createNew = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const publishRepository = useAtomCommand(sourceControlEnvironment.publishRepository, {
    reportFailure: false,
  });
  const discoveryState = useEnvironmentQuery(
    environment === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId: environment.environmentId,
          input: {},
        }),
  );
  const publishTargets = getNewProjectPublishTargets(discoveryState.data);
  const [name, setName] = useState("");
  const [publishes, setPublishes] = useState(false);
  // Null takes the first ready host, GitHub when it is ready.
  const [publishKind, setPublishKind] = useState<SourceControlProviderKind | null>(null);
  const publishTarget = getNewProjectPublishTarget(publishTargets, publishKind);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();
  const pathPreview =
    environment?.newProjectsRoot != null
      ? getNewProjectPathPreview(environment.newProjectsRoot, trimmedName)
      : null;

  if (selectedEnvironmentId === null && environment !== null) {
    setSelectedEnvironmentId(environment.environmentId);
  }
  const showMachines = environmentOptions.length > 0;
  const machineRows = showMachines ? (
    <ListSection>
      {environmentOptions.map((option, index) => {
        const selected =
          option.environmentId === (selectedEnvironmentId ?? environment?.environmentId);
        return (
          <ListRow
            key={option.environmentId}
            title={option.label}
            subtitle={connectionStatusText({
              phase: option.connectionState,
              error: option.connectionError,
              traceId: option.connectionErrorTraceId,
            })}
            icon={
              <EnvironmentMachineSymbol
                kind={option.machine}
                size={Platform.OS === "android" ? 24 : 17}
                tintColorClassName="accent-icon"
              />
            }
            selected={selected}
            // The create in flight keeps the machine it started on.
            disabled={isSubmitting || !canCreateProjectInEnvironment(option.connectionState)}
            isFirst={index === 0}
            right={
              selected ? (
                <SymbolView
                  name="checkmark"
                  size={Platform.OS === "android" ? 20 : 14}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                />
              ) : null
            }
            onPress={() => setSelectedEnvironmentId(option.environmentId)}
          />
        );
      })}
    </ListSection>
  ) : null;

  // State lags a render behind, so a double tap could start a second create.
  const submittingRef = useRef(false);
  const submit = async () => {
    if (!environment || trimmedName.length === 0 || submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    if (!readEnvironmentScope(environment.environmentId, AuthOrchestrationOperateScope)) {
      submittingRef.current = false;
      setError("This connection cannot add projects.");
      return;
    }
    if (
      publishes &&
      (publishTarget === null ||
        !readEnvironmentScope(environment.environmentId, AuthSourceControlWriteScope))
    ) {
      submittingRef.current = false;
      setError(
        "Repository publishing is unavailable. Turn off publishing to create the project here.",
      );
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createNew({
        environmentId: environment.environmentId,
        input: { name: trimmedName },
      });
      if (AsyncResult.isFailure(result)) {
        setError(errorMessage(Cause.squash(result.cause)));
        return;
      }
      const { projectId, workspaceRoot, commitError } = result.value;
      if (commitError !== undefined) {
        Alert.alert("Created without a first commit", commitError);
      }
      if (publishes && publishTarget !== null) {
        if (!readEnvironmentScope(environment.environmentId, AuthSourceControlWriteScope)) {
          Alert.alert(
            "Project created here",
            "Publishing permission changed while the project was being created. The local project is ready; its private repository was not created.",
          );
        } else {
          void publishRepository({
            environmentId: environment.environmentId,
            input: {
              cwd: workspaceRoot,
              provider: publishTarget.definition.kind,
              repository: getNewProjectRepository(publishTarget, workspaceRoot),
              visibility: "private",
            },
          }).then((publishResult) => {
            if (AsyncResult.isFailure(publishResult)) {
              Alert.alert(
                `Could not create the ${publishTarget.definition.label} repository`,
                errorMessage(Cause.squash(publishResult.cause)),
              );
            }
          });
        }
      }
      // The draft screen resolves its project from the client store, so it
      // must not open before the create event has arrived.
      const project = await waitForProject(
        { environmentId: environment.environmentId, projectId },
        15_000,
      );
      if (project === null) {
        // The project exists, so clearing the name keeps Create from making a `-2` copy.
        setName("");
        setError(
          "The project was created but has not reached this device yet. It will appear in the project list once the connection catches up.",
        );
        return;
      }
      openNewTaskDraft(navigation, {
        environmentId: environment.environmentId,
        projectId,
        title: trimmedName,
      });
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <AddProjectShell title="New project">
      {error ? <ErrorBanner message={error} /> : null}
      {environment ? (
        <>
          {!canCreateProject ? (
            <ErrorBanner message="This connection cannot add projects." />
          ) : null}
          <SectionTitle>Computer</SectionTitle>
          {machineRows}
          <TextInput
            className="h-12 min-h-12 rounded-[24px] px-4 py-0 text-base leading-snug"
            value={name}
            onChangeText={setName}
            autoCorrect={false}
            autoFocus
            placeholder="Project name"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
          />
          {pathPreview !== null ? (
            <Text className="px-1 text-sm leading-snug text-foreground-muted" numberOfLines={2}>
              {trimmedName.length > 0
                ? `Creates ${pathPreview}`
                : `Goes in ${environment.newProjectsRoot}`}
              {showMachines ? ` on ${environment.label}` : null}
            </Text>
          ) : null}
          {publishTarget !== null ? (
            <ListSection>
              <ListRow
                title={`Create private repository on ${publishTarget.definition.label}`}
                subtitle={
                  !canPublishRepository
                    ? "This connection cannot publish repositories."
                    : trimmedName.length > 0 && pathPreview !== null
                      ? getNewProjectRepository(publishTarget, pathPreview)
                      : publishTarget.owner
                }
                disabled={isSubmitting || (!canPublishRepository && !publishes)}
                icon={
                  <SourceControlIcon
                    kind={publishTarget.definition.icon}
                    size={Platform.OS === "android" ? 24 : 18}
                    colorClassName="accent-icon"
                  />
                }
                isFirst
                right={
                  <ThemedSwitch
                    accessibilityLabel={`Create private repository on ${publishTarget.definition.label}`}
                    value={publishes}
                    disabled={isSubmitting || (!canPublishRepository && !publishes)}
                    onValueChange={setPublishes}
                  />
                }
                onPress={() => setPublishes((current) => !current)}
              />
              {publishes && publishTargets.length > 1
                ? publishTargets.map((target) => {
                    const selected = target.definition.kind === publishTarget.definition.kind;
                    return (
                      <ListRow
                        key={target.definition.kind}
                        title={target.definition.label}
                        icon={
                          <SourceControlIcon
                            kind={target.definition.icon}
                            size={Platform.OS === "android" ? 24 : 17}
                            colorClassName="accent-icon"
                          />
                        }
                        selected={selected}
                        disabled={isSubmitting}
                        right={
                          selected ? (
                            <SymbolView
                              name="checkmark"
                              size={Platform.OS === "android" ? 20 : 14}
                              tintColorClassName="accent-icon"
                              type="monochrome"
                            />
                          ) : null
                        }
                        onPress={() => setPublishKind(target.definition.kind)}
                      />
                    );
                  })
                : null}
            </ListSection>
          ) : publishes ? (
            <ListSection>
              <ListRow
                title="Create private repository"
                subtitle="Publishing is unavailable. Turn this off to create the project here."
                icon={<SymbolView name="arrow.up" size={17} tintColorClassName="accent-icon" />}
                isFirst
                right={
                  <ThemedSwitch
                    accessibilityLabel="Create private repository"
                    value={publishes}
                    onValueChange={setPublishes}
                  />
                }
                onPress={() => setPublishes(false)}
              />
            </ListSection>
          ) : null}
          <PrimaryActionButton
            label="Create project"
            disabled={
              isSubmitting ||
              trimmedName.length === 0 ||
              !canCreateProject ||
              (publishes && (!canPublishRepository || publishTarget === null))
            }
            onPress={() => void submit()}
            loading={isSubmitting}
          />
          <ListSection>
            <ListRow
              title="Add existing project"
              subtitle="Open a folder or clone a repository"
              icon={
                <SymbolView
                  name="folder.badge.plus"
                  size={Platform.OS === "android" ? 24 : 17}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                />
              }
              isFirst
              // New project opens from Add project, so going back shows the
              // other sources. A deep link has nothing behind it.
              onPress={() =>
                navigation.canGoBack()
                  ? navigation.goBack()
                  : navigation.dispatch(StackActions.replace("AddProject"))
              }
            />
          </ListSection>
        </>
      ) : (
        <>
          {environmentOptions.length > 0 ? <SectionTitle>Computer</SectionTitle> : null}
          {machineRows}
          <EmptyEnvironmentState />
        </>
      )}
    </AddProjectShell>
  );
}

export function AddProjectLocalFolderScreen(props: { readonly environmentId?: string | string[] }) {
  const environment = useEnvironmentFromParam(props.environmentId);
  const canCreateProject = useEnvironmentScope(
    environment?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const createProject = useCreateProject(environment, false);
  const { isBrowseNavigating, navigateToBrowsePath, pathInput, setPathInput } =
    useBrowsePathInput(environment);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPath = useCallback(async () => {
    if (!environment || isBrowseNavigating || isSubmitting) return;
    setError(null);
    const resolved = resolveAddProjectPath({
      rawPath: pathInput,
      currentProjectCwd: null,
      platform: environment.platform,
    });
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }

    setIsSubmitting(true);
    const result = await createProject(resolved.path);
    if (result && AsyncResult.isFailure(result)) {
      const detail = errorMessage(Cause.squash(result.cause));
      const meaningfulDetail =
        detail === "Failed to mutate project." || detail === "An error occurred."
          ? ""
          : ` ${detail}`;
      setError(
        `Could not open ${resolved.path} on ${environment.label}. Check that the folder exists and Loom can access it.${meaningfulDetail}`,
      );
    }
    setIsSubmitting(false);
  }, [createProject, environment, isBrowseNavigating, isSubmitting, pathInput]);

  return (
    <AddProjectShell title="Existing folder">
      {error ? <ErrorBanner message={error} /> : null}
      {environment ? (
        <>
          <ComputerSummary environment={environment} />
          {!canCreateProject ? (
            <ErrorBanner message="This connection cannot add projects." />
          ) : null}
          <ProjectPathInput value={pathInput} onChangeText={setPathInput} onSubmit={submitPath} />
          <PrimaryActionButton
            label="Open folder"
            disabled={!canCreateProject || isBrowseNavigating || isSubmitting}
            onPress={submitPath}
            loading={isSubmitting}
          />
          <FolderBrowser
            environment={environment}
            navigateToBrowsePath={navigateToBrowsePath}
            pathInput={pathInput}
            setPathInput={setPathInput}
          />
        </>
      ) : (
        <EmptyEnvironmentState />
      )}
    </AddProjectShell>
  );
}

export function AddProjectDestinationScreen(props: {
  readonly environmentId?: string | string[];
  readonly remoteUrl?: string | string[];
  readonly repositoryTitle?: string | string[];
  readonly repositoryName?: string | string[];
  readonly prompt?: string | string[];
}) {
  const cloneRepository = useAtomCommand(sourceControlEnvironment.cloneRepository, {
    reportFailure: false,
  });
  const startProjectClone = useAtomCommand(sourceControlEnvironment.startProjectClone, {
    reportFailure: false,
  });
  const navigation = useNavigation();
  const environment = useEnvironmentFromParam(props.environmentId);
  const canWriteSourceControl = useEnvironmentScope(
    environment?.environmentId ?? null,
    AuthSourceControlWriteScope,
  );
  const canCreateProject = useEnvironmentScope(
    environment?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const canCloneProject = canWriteSourceControl && canCreateProject;
  const createProject = useCreateProject(environment, true);
  const remoteUrl = stringParam(props.remoteUrl);
  const repositoryTitle = stringParam(props.repositoryTitle);
  const prompt = stringParam(props.prompt);
  // A lookup derives this from "owner/repo", a pasted clone URL from its own
  // last segment. Older links without the param keep the browsed folder.
  // Trim once here: the path input and the folder-list filter must compare the
  // same value, or a deep link with a padded param empties the folder picker.
  const repositoryName = stringParam(props.repositoryName)?.trim() ?? "";
  const { isBrowseNavigating, navigateToBrowsePath, pathInput, setPathInput } = useBrowsePathInput(
    environment,
    repositoryName,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPath = useCallback(async () => {
    if (
      !environment ||
      !readEnvironmentScope(environment.environmentId, AuthSourceControlWriteScope) ||
      !readEnvironmentScope(environment.environmentId, AuthOrchestrationOperateScope) ||
      !remoteUrl ||
      isBrowseNavigating ||
      isSubmitting
    ) {
      return;
    }
    setError(null);
    const resolved = resolveAddProjectPath({
      rawPath: pathInput,
      currentProjectCwd: null,
      platform: environment.platform,
    });
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }

    setIsSubmitting(true);
    if (environment.supportsCloneTracking) {
      // The server creates the project and clones in the background; the
      // draft screen shows progress and holds Start until the files land.
      const projectId = ProjectId.make(uuidv4());
      const title = inferProjectTitleFromPath(resolved.path);
      const startResult = await startProjectClone({
        environmentId: environment.environmentId,
        input: {
          projectId,
          title,
          createdAt: new Date().toISOString(),
          remoteUrl,
          destinationPath: resolved.path,
        },
      });
      if (AsyncResult.isFailure(startResult)) {
        setError(errorMessage(Cause.squash(startResult.cause)));
      } else {
        // The draft screen resolves its project from the client store, so it
        // must not open before the create event has arrived (it would fall
        // back to the project picker and lose the clone controls). Stay in
        // the submitting state until then; the clone keeps running either way.
        const project = await waitForProject(
          { environmentId: environment.environmentId, projectId },
          15_000,
        );
        if (project === null) {
          setError(
            "The project was created but has not reached this device yet. It will appear in the project list once the connection catches up.",
          );
        } else {
          openNewTaskDraft(navigation, {
            environmentId: environment.environmentId,
            projectId,
            title,
            cloning: "1",
            ...(prompt
              ? // Without its prompt the draft still opens on the cloned project.
                await draftWithPrompt(environment.environmentId, projectId, prompt).then(
                  (draftId) => ({ draftId }),
                  () => ({}),
                )
              : {}),
          });
        }
      }
      setIsSubmitting(false);
      return;
    }
    const cloneResult = await cloneRepository({
      environmentId: environment.environmentId,
      input: {
        remoteUrl,
        destinationPath: resolved.path,
      },
    });
    if (AsyncResult.isFailure(cloneResult)) {
      setError(errorMessage(Cause.squash(cloneResult.cause)));
    } else {
      const createResult = await createProject(cloneResult.value.cwd);
      if (createResult && AsyncResult.isFailure(createResult)) {
        setError(errorMessage(Cause.squash(createResult.cause)));
      }
    }
    setIsSubmitting(false);
  }, [
    cloneRepository,
    createProject,
    environment,
    isBrowseNavigating,
    isSubmitting,
    navigation,
    pathInput,
    prompt,
    remoteUrl,
    startProjectClone,
  ]);

  return (
    <AddProjectShell title="Clone destination">
      {error ? <ErrorBanner message={error} /> : null}
      {repositoryTitle ? (
        <View className="rounded-[24px] bg-grouped-card px-4 py-3">
          <Text className="text-base font-t3-bold">{repositoryTitle}</Text>
          <Text className="mt-0.5 text-xs text-foreground-muted" numberOfLines={2}>
            {remoteUrl}
          </Text>
        </View>
      ) : null}
      {environment ? (
        <>
          <ComputerSummary environment={environment} />
          <ProjectPathInput value={pathInput} onChangeText={setPathInput} onSubmit={submitPath} />
          <PrimaryActionButton
            label="Clone project"
            disabled={!canCloneProject || isBrowseNavigating || isSubmitting || !remoteUrl}
            onPress={submitPath}
            loading={isSubmitting}
          />
          {!canCloneProject ? (
            <Text className="text-sm text-foreground-muted">
              This connection cannot clone projects.
            </Text>
          ) : null}
          <FolderBrowser
            environment={environment}
            navigateToBrowsePath={navigateToBrowsePath}
            pathInput={pathInput}
            setPathInput={setPathInput}
            pinnedDirectoryName={repositoryName}
          />
        </>
      ) : (
        <EmptyEnvironmentState />
      )}
    </AddProjectShell>
  );
}
