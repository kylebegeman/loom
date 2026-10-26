import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  buildProjectPreparationPlan,
  createProjectCheckoutAtoms,
  getProjectPreparationDestination,
  LIBRARY_FOLDER_CHOICE_TITLES,
  LIBRARY_FOLDER_OCCUPIED_MESSAGE,
  libraryFolderChoice,
  projectPreparationSource,
  matchingProjectPreparationCopies,
  serverChoosesFolders,
  supportsLoomFeature,
  type ProjectPreparationSource,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  buildProjectCreateCommand,
  getCloneDirectoryName,
} from "@t3tools/client-runtime/operations/projects";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSourceControlWriteScope,
  CommandId,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { Button } from "../../components/ui/Button";
import { AppBar } from "../../components/ui/AppBar";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { connectionAtomRuntime } from "../../connection/runtime";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { LibraryFolderPicker } from "../library/LibraryFolderPicker";
import { library } from "../library/libraryState";
import { preparationReceiptKey } from "./projectPreparationReceipt";
import { useProjectPreparationReceipt } from "./useProjectPreparationReceipt";
import { uuidv4 } from "../../lib/uuid";
import { useProject, useProjects, useServerConfigs, waitForProject } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { projectEnvironment } from "../../state/projects";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";

const checkout = createProjectCheckoutAtoms(connectionAtomRuntime);
export type ProjectPreparationRouteParams = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly destinationEnvironmentId?: string;
};

export function ProjectPreparationRouteScreen({
  route,
}: StaticScreenProps<ProjectPreparationRouteParams>) {
  return (
    <ProjectPreparationContent
      key={`${route.params.environmentId}:${route.params.projectId}:${route.params.destinationEnvironmentId ?? "choose"}`}
      sourceEnvironmentId={EnvironmentId.make(route.params.environmentId)}
      sourceProjectId={ProjectId.make(route.params.projectId)}
      initialDestinationEnvironmentId={
        route.params.destinationEnvironmentId
          ? EnvironmentId.make(route.params.destinationEnvironmentId)
          : null
      }
    />
  );
}

function ProjectPreparationContent(props: {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly sourceProjectId: ProjectId;
  readonly initialDestinationEnvironmentId: EnvironmentId | null;
}) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const sourceProject = useProject({
    environmentId: props.sourceEnvironmentId,
    projectId: props.sourceProjectId,
  });
  const projects = useProjects();
  const configs = useServerConfigs();
  const { environments } = useEnvironments();
  const readable = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  const operable = useEnvironmentsWithScope(environments, AuthOrchestrationOperateScope);
  const writable = useEnvironmentsWithScope(environments, AuthSourceControlWriteScope);
  const review = useAtomQueryRunner(checkout.preview, { reportFailure: false, refresh: true });
  const startProjectClone = useAtomCommand(sourceControlEnvironment.startProjectClone, {
    reportFailure: false,
  });
  const inspectFolder = useAtomCommand(library.inspectFolder, { reportFailure: false });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const [reviewedSource, setSource] = useState<ProjectPreparationSource>(() =>
    projectPreparationSource({}),
  );
  const [destinationId, setDestinationId] = useState<EnvironmentId | null>(
    props.initialDestinationEnvironmentId,
  );
  // Null leaves the folder to the computer. A picked folder is cloned into, or registered as the
  // project when it already holds this repository.
  const [picked, setPicked] = useState<{ readonly path: string; readonly reuse: boolean } | null>(
    null,
  );
  const pickToken = useRef(0);
  const [pickingFolder, setPickingFolder] = useState(false);
  const receiptState = useProjectPreparationReceipt(
    destinationId
      ? preparationReceiptKey(props.sourceEnvironmentId, props.sourceProjectId, destinationId)
      : null,
  );
  const receipt = receiptState.receipt;
  const source: ProjectPreparationSource = receipt
    ? {
        ready: true,
        source: "checkout",
        remoteUrl: receipt.remoteUrl,
        repositoryKey: receipt.repositoryKey,
      }
    : reviewedSource;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [request] = useState(() => ({
    projectId: ProjectId.make(uuidv4()),
    createdAt: new Date().toISOString(),
  }));
  const sourceComputer = environments.find(
    (environment) => environment.environmentId === props.sourceEnvironmentId,
  );
  const sourceConnected =
    sourceComputer?.entry.enabled === true && sourceComputer.connection.phase === "connected";
  const sourceSupported = supportsLoomFeature(
    configs.get(props.sourceEnvironmentId)?.environment.capabilities,
    "project-checkout-management",
  );
  const destination = environments.find(
    (environment) => environment.environmentId === destinationId,
  );
  const destinationConnected =
    destination?.entry.enabled === true && destination.connection.phase === "connected";
  const canClone =
    destinationId !== null && operable.has(destinationId) && writable.has(destinationId);
  const newProjectsRoot = destinationId ? configs.get(destinationId)?.newProjectsRoot : null;
  // The computer picks the folder, or reuses a checkout it has, so nothing is typed or proposed.
  const serverChosen = destinationId ? serverChoosesFolders(configs.get(destinationId)) : false;
  const proposal =
    source.ready && !serverChosen
      ? getProjectPreparationDestination({ newProjectsRoot, remoteUrl: source.remoteUrl })
      : null;
  const plan =
    destinationId && sourceProject
      ? buildProjectPreparationPlan({
          source,
          host: {
            environmentId: destinationId,
            connected: destinationConnected,
            canClone,
            newProjectsRoot,
            serverChosenFolders: serverChosen,
          },
          projectId: receipt?.projectId ?? request.projectId,
          title: receipt?.title ?? sourceProject.title,
          createdAt: receipt?.createdAt ?? request.createdAt,
          ...(receipt && (receipt.destinationPath !== "" || !serverChosen)
            ? { destinationPath: receipt.destinationPath }
            : (picked?.path ?? proposal)
              ? { destinationPath: picked?.path ?? proposal }
              : {}),
          projects: projects.map((project) => ({
            ...project,
            repositoryIdentity: project.repositoryIdentity ?? null,
          })),
        })
      : null;
  const destinationTracksClones = destinationId
    ? configs.get(destinationId)?.environment.capabilities.projectCloneTracking === true
    : false;
  const matchingCopies = destinationId
    ? matchingProjectPreparationCopies({ source, environmentId: destinationId, projects })
    : [];
  const canContinue =
    source.ready &&
    (receipt !== null || (sourceConnected && readable.has(props.sourceEnvironmentId))) &&
    receiptState.loaded &&
    !receiptState.invalid &&
    destinationConnected &&
    canClone &&
    (receipt !== null || destinationTracksClones || plan?.kind === "existing");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Disconnect invalidates the reviewed origin, including after reconnect.
    if (!sourceConnected) setSource(projectPreparationSource({}));
  }, [sourceConnected]);
  const verifySource = async () => {
    const current = appAtomRegistry.get(
      environmentPresentations.presentationAtom(props.sourceEnvironmentId),
    );
    if (
      busyRef.current ||
      !sourceProject ||
      !sourceSupported ||
      current?.entry.enabled !== true ||
      current.connection.phase !== "connected" ||
      !readEnvironmentScope(props.sourceEnvironmentId, AuthOrchestrationReadScope)
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await review({
        environmentId: props.sourceEnvironmentId,
        input: { projectId: props.sourceProjectId },
      });
      if (!mounted.current) return;
      const latest = appAtomRegistry.get(
        environmentPresentations.presentationAtom(props.sourceEnvironmentId),
      );
      if (
        latest?.entry.enabled !== true ||
        latest.connection.phase !== "connected" ||
        !readEnvironmentScope(props.sourceEnvironmentId, AuthOrchestrationReadScope)
      )
        return;
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      if (result.value.projectId !== props.sourceProjectId)
        throw new Error("The source project changed. Review its origin again.");
      setSource(projectPreparationSource({ checkout: result.value }));
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : "The source origin could not be reviewed.",
        );
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const computersReady = (destination: EnvironmentId) => {
    const sourceCurrent = appAtomRegistry.get(
      environmentPresentations.presentationAtom(props.sourceEnvironmentId),
    );
    const current = appAtomRegistry.get(environmentPresentations.presentationAtom(destination));
    return (
      (receipt !== null ||
        (sourceCurrent?.entry.enabled === true &&
          sourceCurrent.connection.phase === "connected" &&
          readEnvironmentScope(props.sourceEnvironmentId, AuthOrchestrationReadScope))) &&
      current?.entry.enabled === true &&
      current.connection.phase === "connected" &&
      readEnvironmentScope(destination, AuthOrchestrationOperateScope) &&
      readEnvironmentScope(destination, AuthSourceControlWriteScope)
    );
  };
  // Same rule as the Library start screen: the computer refuses a folder holding other files.
  const chooseFolder = async (path: string) => {
    if (!destinationId || !source.ready) return;
    const token = ++pickToken.current;
    setPickingFolder(false);
    setError(null);
    const result = await inspectFolder({ environmentId: destinationId, input: { rootPath: path } });
    if (!mounted.current || token !== pickToken.current) return;
    const found = AsyncResult.isSuccess(result) ? result.value : null;
    const choice = found
      ? libraryFolderChoice(found, [{ remoteUrl: source.remoteUrl, relativePath: "." }])
      : "clone";
    if (choice === "occupied") {
      setPicked(null);
      setError(LIBRARY_FOLDER_OCCUPIED_MESSAGE);
      return;
    }
    const checkout =
      choice === "reuse"
        ? found?.repositories.find(
            (repository) =>
              repository.remoteUrl !== null &&
              normalizeGitRemoteUrl(repository.remoteUrl) ===
                normalizeGitRemoteUrl(source.remoteUrl),
          )
        : undefined;
    setPicked(
      checkout
        ? { path: checkout.path, reuse: true }
        : { path: found?.rootPath ?? path, reuse: false },
    );
  };
  // The computer answers with the folder it used and, for a reused checkout, that project.
  const startOnComputer = async () => {
    if (
      busyRef.current ||
      !source.ready ||
      !destinationId ||
      plan?.kind !== "create" ||
      !computersReady(destinationId)
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const requested = {
      sourceEnvironmentId: props.sourceEnvironmentId,
      sourceProjectId: props.sourceProjectId,
      destinationEnvironmentId: destinationId,
      projectId: plan.input.projectId,
      title: plan.input.title,
      createdAt: plan.input.createdAt,
      remoteUrl: source.remoteUrl,
      repositoryKey: source.repositoryKey,
    };
    const failure = (fallback: string) => (cause: unknown) =>
      cause instanceof Error ? cause.message : fallback;
    const reusePath = !receipt && picked?.reuse ? picked.path : null;
    const problem = await (
      receipt || reusePath !== null
        ? Promise.resolve(null)
        : receiptState
            .save({ ...requested, destinationPath: picked?.path ?? "" })
            .then(
              () => null,
              failure("The preparation receipt could not be saved. No clone was started."),
            )
    ).then(async (saveProblem) => {
      if (saveProblem !== null) return saveProblem;
      let started: { readonly projectId: ProjectId };
      if (reusePath !== null) {
        const result = await createProject({
          environmentId: destinationId,
          input: {
            ...buildProjectCreateCommand({
              commandId: CommandId.make(uuidv4()),
              projectId: plan.input.projectId,
              workspaceRoot: reusePath,
            }),
            title: plan.input.title,
            createWorkspaceRootIfMissing: false,
          },
        });
        if (AsyncResult.isFailure(result))
          return failure("The project could not be added.")(squashAtomCommandFailure(result));
        started = { projectId: plan.input.projectId };
      } else {
        const result = await startProjectClone({ environmentId: destinationId, input: plan.input });
        if (AsyncResult.isFailure(result))
          return failure("The clone could not be started.")(squashAtomCommandFailure(result));
        started = result.value;
        await receiptState
          .settle({
            ...requested,
            projectId: result.value.projectId,
            destinationPath: result.value.destinationPath ?? result.value.cwd,
          })
          .catch(() => undefined);
      }
      const project = await waitForProject(
        { environmentId: destinationId, projectId: started.projectId },
        15_000,
      );
      if (project === null)
        return "The project was created but has not reached this device yet. It will appear in the project list once the connection catches up.";
      if (mounted.current)
        navigation.navigate("ProjectHome", {
          environmentId: destinationId,
          projectId: started.projectId,
        });
      return null;
    });
    busyRef.current = false;
    if (!mounted.current) return;
    setBusy(false);
    setError(problem);
  };
  const continuePreparation = () => {
    if (!source.ready || !destinationId || !sourceProject || !computersReady(destinationId)) return;
    if (!receipt && plan?.kind === "existing") {
      navigation.navigate("ProjectHome", {
        environmentId: plan.project.environmentId,
        projectId: plan.project.id,
      });
      return;
    }
    const preparationDestinationPath = receipt?.destinationPath ?? proposal;
    navigation.navigate("AddProjectDestination", {
      environmentId: destinationId,
      remoteUrl: source.remoteUrl,
      repositoryTitle: sourceProject.title,
      repositoryName: getCloneDirectoryName(source.remoteUrl),
      preparationSourceEnvironmentId: props.sourceEnvironmentId,
      preparationSourceProjectId: props.sourceProjectId,
      preparationProjectId: receipt?.projectId ?? request.projectId,
      preparationCreatedAt: receipt?.createdAt ?? request.createdAt,
      preparationRepositoryKey: source.repositoryKey,
      ...(preparationDestinationPath ? { preparationDestinationPath } : {}),
    });
  };
  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title="Prepare another computer"
        onBack={() => navigation.goBack()}
        backInSplitView={{ accessibilityLabel: "Back to project", icon: "arrow.left" }}
      />
      <ScreenScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          gap: 24,
          padding: 16,
          paddingBottom: Math.max(insets.bottom, 24) + 24,
        }}
      >
        {!sourceProject ? (
          <EmptyState
            variant="plain"
            title="Source project unavailable"
            detail="Reconnect its computer and open this project again."
          />
        ) : (
          <>
            <Text className="text-sm leading-normal text-foreground-muted">
              Create a separate checkout using the selected computer's Git credentials. Existing
              conversations stay on their current computer. Move work is a separate reviewed step.
            </Text>
            <SettingsSection title={`Source · ${sourceComputer?.label ?? "Computer"}`}>
              <View className="gap-3 p-4">
                <Text className="text-base font-t3-medium text-foreground">
                  {sourceProject.title}
                </Text>
                <Text className="text-sm text-foreground-muted">
                  Review the actual origin before preparing another copy. This review leaves
                  released working files released.
                </Text>
                <Button
                  label={
                    busy
                      ? "Reviewing origin…"
                      : source.ready
                        ? "Review origin again"
                        : "Review source origin"
                  }
                  disabled={
                    !sourceConnected ||
                    !sourceSupported ||
                    !readable.has(props.sourceEnvironmentId) ||
                    busy
                  }
                  onPress={() => void verifySource()}
                />
                {!sourceConnected ? (
                  <Text className="text-sm text-foreground-muted">
                    Reconnect the source computer to review its origin.
                  </Text>
                ) : !sourceSupported ? (
                  <Text className="text-sm text-foreground-muted">
                    Update Loom on the source computer to review its origin.
                  </Text>
                ) : null}
                {source.ready ? (
                  <Text selectable className="text-sm text-foreground-muted">
                    {source.remoteUrl}
                  </Text>
                ) : (
                  <Text className="text-sm text-foreground-muted">{source.reason}</Text>
                )}
                {error ? (
                  <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
                    {error}
                  </Text>
                ) : null}
              </View>
            </SettingsSection>
            <SettingsSection title="Choose a computer">
              {environments
                .filter(
                  (environment) =>
                    environment.environmentId !== props.sourceEnvironmentId &&
                    configs.get(environment.environmentId)?.environment.capabilities
                      .supportsExecution !== false,
                )
                .map((environment, index) => {
                  const connected =
                    environment.entry.enabled && environment.connection.phase === "connected";
                  const allowed =
                    operable.has(environment.environmentId) &&
                    writable.has(environment.environmentId);
                  return (
                    <ListChoiceRow
                      key={environment.environmentId}
                      label={environment.label}
                      separated={index > 0}
                      selected={destinationId === environment.environmentId}
                      disabled={!connected || !allowed}
                      description={
                        !connected
                          ? "Offline, reconnect to prepare a checkout"
                          : !allowed
                            ? "Read-only, cloning and project creation access required"
                            : "Connected with cloning and project access"
                      }
                      onPress={() => {
                        setDestinationId(environment.environmentId);
                        pickToken.current += 1;
                        setPicked(null);
                        setPickingFolder(false);
                      }}
                    />
                  );
                })}
              {environments.length < 2 ? (
                <View className="p-4">
                  <Text className="text-sm text-foreground-muted">
                    Connect another computer first.
                  </Text>
                </View>
              ) : null}
            </SettingsSection>
            {destinationId ? (
              <View className="gap-3">
                <Text className="text-base font-t3-medium text-foreground">
                  Destination · {destination?.label ?? "Saved computer"}
                </Text>
                {receiptState.invalid ? (
                  <Text className="text-sm text-danger-foreground">
                    The saved preparation receipt could not be read. Review this computer's known
                    project before retrying.
                  </Text>
                ) : null}
                {receipt ? (
                  <Text className="text-sm text-foreground-muted">
                    A preparation is already saved for this computer. Its source and destination
                    stay fixed.
                  </Text>
                ) : null}
                {matchingCopies.map((project) => (
                  <View
                    key={`${project.environmentId}:${project.id}`}
                    className="gap-2 rounded-xl bg-card p-3"
                  >
                    <Text className="text-sm font-t3-medium">{project.title}</Text>
                    <Text selectable className="text-xs text-foreground-muted">
                      {project.workspaceRoot}
                    </Text>
                    <Button
                      label={`Open ${project.title} on ${destination?.label ?? "computer"}`}
                      disabled={!destinationConnected}
                      onPress={() =>
                        navigation.navigate("ProjectHome", {
                          environmentId: project.environmentId,
                          projectId: project.id,
                        })
                      }
                    />
                  </View>
                ))}
                {serverChosen ? (
                  <Text selectable className="text-sm text-foreground-muted">
                    {receipt?.destinationPath
                      ? `Files are in ${receipt.destinationPath}`
                      : picked
                        ? `${LIBRARY_FOLDER_CHOICE_TITLES[picked.reuse ? "reuse" : "clone"]}: ${picked.path}`
                        : "Loom puts the files in this computer's Projects folder, or uses a checkout it already has."}
                  </Text>
                ) : proposal ? (
                  <Text selectable className="text-sm text-foreground-muted">
                    {receipt ? "Submitted folder" : "Suggested folder"}:{" "}
                    {receipt?.destinationPath ?? proposal}
                  </Text>
                ) : null}
                {serverChosen && !receipt && plan?.kind === "create" ? (
                  <View className="gap-2">
                    <Button
                      label="Choose another folder"
                      tone="text"
                      disabled={busy}
                      onPress={() => setPickingFolder((open) => !open)}
                    />
                    {picked ? (
                      <Button
                        label="Let Loom choose the folder"
                        tone="text"
                        disabled={busy}
                        onPress={() => {
                          pickToken.current += 1;
                          setPicked(null);
                        }}
                      />
                    ) : null}
                    {pickingFolder ? (
                      <LibraryFolderPicker
                        environmentId={destinationId}
                        projectTitle={sourceProject.title}
                        disabled={busy}
                        onChoose={(path) => void chooseFolder(path)}
                      />
                    ) : null}
                  </View>
                ) : null}
                {plan?.kind === "existing" ? (
                  <Text className="text-sm text-foreground-muted">
                    This computer already has a matching project. Open its existing checkout.
                  </Text>
                ) : (
                  <Text className="text-sm text-foreground-muted">
                    {plan?.kind === "blocked"
                      ? plan.reason
                      : serverChosen
                        ? picked?.reuse
                          ? "Loom adds this checkout as the project and opens it."
                          : "Loom clones the repository on this computer and opens the project."
                        : "Review and edit the destination folder in the next step before starting the clone."}
                  </Text>
                )}
                <Button
                  tone="primary"
                  label={
                    serverChosen && plan?.kind === "create"
                      ? busy
                        ? "Preparing…"
                        : receipt
                          ? "Retry preparation"
                          : "Prepare this computer"
                      : receipt
                        ? "Review saved preparation"
                        : plan?.kind === "existing"
                          ? "Open existing checkout"
                          : "Review clone destination"
                  }
                  disabled={
                    !canContinue ||
                    busy ||
                    (!receipt && plan?.kind === "blocked" && matchingCopies.length > 1)
                  }
                  onPress={
                    serverChosen && plan?.kind === "create"
                      ? () => void startOnComputer()
                      : continuePreparation
                  }
                />
              </View>
            ) : null}
            <Button
              label="Manage computers"
              tone="text"
              onPress={() => navigation.navigate("Connections")}
            />
          </>
        )}
      </ScreenScrollView>
    </View>
  );
}
