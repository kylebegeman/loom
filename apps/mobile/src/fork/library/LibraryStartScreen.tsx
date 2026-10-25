import { GitHubHostSetupSettings } from "../../features/settings/components/GitHubHostSetupSettings";
import { LibraryError } from "@t3tools/contracts/fork";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  StackActions,
  useFocusEffect,
  useNavigation,
  usePreventRemove,
  type StaticScreenProps,
} from "@react-navigation/native";
import {
  libraryContinuationContext,
  libraryLaunchChoice,
  libraryLaunchDefaults,
  libraryLaunchWarning,
  libraryPortableRecoveryPlan,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import type { LibraryLaunchCandidate } from "@t3tools/shared/fork/library-launch";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EnvironmentId,
  ThreadId,
  type RuntimeMode,
  type ProviderInteractionMode,
} from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  LIBRARY_FILE_LIFECYCLE_FEATURE,
  LIBRARY_PORTABLE_RECOVERY_FEATURE,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ListRow } from "../../components/ui/ListRow";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { buildModelOptions } from "../../lib/modelOptions";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { useProject, useServerConfigs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { environmentPresentations } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { setComposerDraftText, flushComposerDrafts } from "../../state/use-composer-drafts";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { threadEnvironment } from "../../state/threads";
import { vcsEnvironment } from "../../state/vcs";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { LibraryAuthorityScreen, LibraryNotice, LibraryPage } from "./LibraryScreens";
import { library, refreshLibraryWork, useLibraryAuthority } from "./libraryState";
import { libraryListState, libraryRepositories } from "./libraryLogic";
import {
  emptyLibraryLaunchReceipt,
  bindLibraryLaunchConversation,
  launchLibraryConversation,
  readLibraryLaunchAttempt,
  encodeLibraryLaunchAttempt,
  type LibraryLaunchAttempt,
  type LibraryLaunchReceipt,
} from "./libraryLaunch";
import { LibraryProfileReadiness } from "./LibraryProfileReadiness";
import { useLibraryLaunchRanking } from "./useLibraryLaunchRanking";
import { libraryConversationModels } from "./libraryModels";
import type { LibrarySourceSettings } from "./librarySourceLaunch";
import { LibraryFolderStorage } from "./LibraryFolderStorage";
import { preparePortableLibraryLaunchCopy } from "./libraryPortableLaunch";
import {
  libraryFreshRootPath,
  libraryLaunchCopyMatchesScope,
  libraryLaunchCopiesForScope,
  libraryLaunchPathOverlaps,
  restoreLibraryLaunchCopy,
} from "./libraryLaunchFiles";

const sentence = (parts: readonly string[]) => {
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function unwrap<A, E>(result: AtomCommandResult<A, E>): A {
  if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
  return result.value;
}
export function LibraryStartRouteScreen({
  route,
}: StaticScreenProps<{
  readonly projectId: string;
  readonly initialResourceId?: string;
  readonly initialCopyId?: string;
  readonly sourceThreadId?: ThreadId;
  readonly launchSettings?: LibrarySourceSettings;
  readonly sourceArchiveId?: string;
  readonly reuseEnvironmentId?: EnvironmentId;
  readonly reuseRootPath?: string;
  /** Start as soon as this screen agrees the handed-in computer and files are ready. */
  readonly startNow?: boolean;
}>) {
  const authority = useLibraryAuthority();
  const preferences = useAtomValue(mobilePreferencesAtom);
  // Start over remounts the screen without the attempt it drops, but with that attempt's choices.
  // Every attempt has its own request id, so each Start over remounts.
  const [restart, setRestart] = useState<typeof LibraryLaunchAttempt.Type | null>(null);
  const project = useEnvironmentQuery(
    authority.environmentId
      ? library.project({
          environmentId: authority.environmentId,
          input: { projectId: route.params.projectId },
        })
      : null,
  );
  useFocusEffect(
    useCallback(() => {
      if (!authority.environmentId || !authority.connected || !authority.canRead) return;
      appAtomRegistry.refresh(
        library.project({
          environmentId: authority.environmentId,
          input: { projectId: route.params.projectId },
        }),
      );
      refreshLibraryWork(authority.environmentId, route.params.projectId);
      if (route.params.sourceArchiveId)
        appAtomRegistry.refresh(
          library.history({
            environmentId: authority.environmentId,
            input: { id: route.params.sourceArchiveId, offset: 0, limit: 100 },
          }),
        );
    }, [
      authority.environmentId,
      authority.connected,
      authority.canRead,
      route.params.projectId,
      route.params.sourceArchiveId,
    ]),
  );
  return project.data && AsyncResult.isSuccess(preferences) ? (
    <LibraryStartContent
      key={`${restart?.requestId ?? "new"}:${route.params.projectId}:${route.params.sourceArchiveId ?? "new"}:${route.params.reuseEnvironmentId ?? ""}:${route.params.reuseRootPath ?? ""}:${route.params.initialResourceId ?? ""}:${route.params.initialCopyId ?? ""}:${route.params.sourceThreadId ?? ""}`}
      project={project.data}
      projectReady={project.isSuccess && !project.isPending && project.error === null}
      projectNotice={
        project.error ?? (project.isPending ? "Refreshing shared project context…" : null)
      }
      projectError={project.error}
      onRefreshProject={project.refresh}
      initialResourceId={route.params.initialResourceId}
      initialCopyId={route.params.initialCopyId}
      sourceThreadId={route.params.sourceThreadId}
      launchSettings={route.params.launchSettings}
      sourceArchiveId={route.params.sourceArchiveId}
      reuseEnvironmentId={route.params.reuseEnvironmentId}
      reuseRootPath={route.params.reuseRootPath}
      restart={restart}
      // Starting over is a deliberate step back to the settings, so it never starts by itself.
      startNow={restart === null && route.params.startNow === true}
      onStartOver={setRestart}
    />
  ) : (
    <LibraryPage title="New conversation" back>
      <LibraryNotice
        error={project.error}
        detail={project.error ? null : "Loading shared project context…"}
        onRetry={project.refresh}
      />
    </LibraryPage>
  );
}
function LibraryStartContent(props: {
  project: LibraryProject;
  projectReady: boolean;
  projectNotice: string | null;
  projectError: string | null;
  onRefreshProject: () => void;
  initialResourceId?: string | undefined;
  initialCopyId?: string | undefined;
  sourceThreadId?: ThreadId | undefined;
  launchSettings?: LibrarySourceSettings | undefined;
  sourceArchiveId?: string;
  reuseEnvironmentId?: EnvironmentId;
  reuseRootPath?: string;
  /** The attempt Start over dropped, whose choices this screen starts from. */
  restart: typeof LibraryLaunchAttempt.Type | null;
  startNow: boolean;
  onStartOver: (dropped: typeof LibraryLaunchAttempt.Type) => void;
}) {
  const authority = useLibraryAuthority(),
    navigation = useNavigation(),
    { environments } = useEnvironments(),
    configs = useServerConfigs();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const attemptKey = JSON.stringify([
    authority.environmentId,
    props.project.id,
    props.sourceArchiveId ??
      (props.sourceThreadId
        ? `settings:${props.reuseEnvironmentId ?? ""}:${props.sourceThreadId}`
        : "new"),
  ]);
  const [saved] = useState(() =>
    readLibraryLaunchAttempt(
      AsyncResult.isSuccess(preferences)
        ? preferences.value.loomLibraryLaunches?.[attemptKey]
        : undefined,
    ),
  );
  // Choices come from the saved attempt or, after Start over, from the one it dropped, as web keeps
  // them: the next start stays on its computer, files, model and permissions instead of falling
  // back to this computer's defaults.
  const seed = saved ?? props.restart;
  // Decided once, when the files are known. A saved attempt, any change here or any start, manual
  // or automatic, leaves it to Start.
  const autoStart = useRef(props.startNow && !saved);
  const operable = useEnvironmentsWithScope(environments, AuthOrchestrationOperateScope),
    writable = useEnvironmentsWithScope(environments, AuthSourceControlWriteScope);
  const seedIntent = seed?.receipt.intent ?? null;
  const [selectedScope, setScope] = useState<string | null>(
      seedIntent
        ? seedIntent.resourceIds.length === 1
          ? seedIntent.resourceIds[0]!
          : "all"
        : (props.initialResourceId ?? null),
    ),
    [selectedExecution, setExecution] = useState<EnvironmentId | null>(
      seedIntent?.executionEnvironmentId ?? props.reuseEnvironmentId ?? null,
    ),
    // Null until picked, so the working files follow the chosen computer.
    [modeChoice, setMode] = useState<"reuse" | "folder" | "clone" | null>(
      seed?.review.mode ?? (props.reuseRootPath ? "folder" : null),
    ),
    // Null until typed, so a clone suggests the chosen computer's folder, as on web. A reuse
    // attempt records an empty folder, which counts as untyped.
    [typedPath, setRootPath] = useState<string | null>(
      seed?.review.rootPath || (props.reuseRootPath ?? null),
    ),
    [copyId, setCopyId] = useState<string | null>(
      seed?.review.copy?.id ?? props.initialCopyId ?? null,
    ),
    [title, setTitle] = useState(
      seed?.review.title ?? (props.sourceArchiveId ? "Linked continuation" : "Project discussion"),
    ),
    [modelKey, setModelKey] = useState<string | null>(
      seed?.review.model.key ??
        (props.launchSettings
          ? `${props.launchSettings.modelSelection.instanceId}:${props.launchSettings.modelSelection.model}`
          : null),
    ),
    [showModels, setShowModels] = useState(false);
  const [recoverySourceId, setRecoverySourceId] = useState<string | null>(
    seed?.review.recoverySource?.id ?? null,
  );
  const [showFolderOptions, setShowFolderOptions] = useState(Boolean(props.reuseRootPath)),
    [showComputers, setShowComputers] = useState(false),
    [showOptions, setShowOptions] = useState(false),
    [showSetup, setShowSetup] = useState(false),
    [keepFiles, setKeepFiles] = useState<boolean | null>(seed?.review.keepOnComputer ?? null);
  const [folderPending, setFolderPending] = useState(false);
  const folderBusy = useRef(false);
  const onFolderPending = useCallback((value: boolean) => {
    folderBusy.current = value;
    setFolderPending(value);
  }, []);
  const [pending, setPending] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const [cloneRepair, setCloneRepair] = useState<LibraryError["repair"]>(undefined);
  const [showGitHubSetup, setShowGitHubSetup] = useState(false);
  const [launchedThread, setLaunchedThread] = useState<Awaited<
    ReturnType<typeof launchLibraryConversation>
  > | null>(null);
  usePreventRemove((pending !== null || folderPending) && launchedThread === null, () => undefined);
  useEffect(() => {
    if (launchedThread && pending === null)
      navigation.dispatch(StackActions.replace("Thread", launchedThread));
  }, [launchedThread, pending, navigation]);
  const [progress, setProgress] = useState(saved?.receipt ?? emptyLibraryLaunchReceipt());
  const receipt = useRef<LibraryLaunchReceipt>(saved?.receipt ?? emptyLibraryLaunchReceipt()),
    requestId = useRef(saved?.requestId ?? uuidv4()),
    threadId = useRef(saved?.threadId ?? ThreadId.make(uuidv4())),
    busy = useRef(false);
  const reviewed = useRef<{
    authorityEnvironmentId: EnvironmentId;
    model: Pick<ReturnType<typeof buildModelOptions>[number], "key" | "selection">;
    title: string;
    mode: "reuse" | "folder" | "clone";
    rootPath: string;
    copy: LibraryWorkingCopy | null;
    recoverySource?: LibraryWorkingCopy;
    carryContext: string;
    keepOnComputer?: boolean;
    runtimeMode?: RuntimeMode;
    interactionMode?: ProviderInteractionMode;
  } | null>(saved?.review ?? null);
  const [reviewState, setReviewState] = useState(saved?.review ?? null);
  const source = useEnvironmentQuery(
    authority.environmentId && props.sourceArchiveId
      ? library.history({
          environmentId: authority.environmentId,
          input: { id: props.sourceArchiveId, offset: 0, limit: 100 },
        })
      : null,
  );
  const sourceScope = source.data?.summary.resourceIds;
  const selectedResource =
    selectedScope === "all" ||
    libraryRepositories(progress.intent?.project ?? props.project).some(
      (resource) => resource.id === selectedScope,
    )
      ? selectedScope
      : null;
  const scope =
    selectedResource ??
    (sourceScope?.length === 1 &&
    libraryRepositories(props.project).some((resource) => resource.id === sourceScope[0])
      ? sourceScope[0]!
      : "all");
  const launchProject = progress.intent?.project ?? props.project;
  const repositories = libraryRepositories(launchProject),
    resourceIds =
      progress.intent?.resourceIds ??
      (scope === "all" ? repositories.map((resource) => resource.id) : [scope]);
  const copies = useEnvironmentQuery(
    authority.environmentId
      ? library.copies({
          environmentId: authority.environmentId,
          input: { projectId: props.project.id, includeReleased: true },
        })
      : null,
  );
  const [carryInput, setCarryContext] = useState<string | null>(seed?.review.carryContext ?? null);
  const carryContext = carryInput ?? (source.data ? libraryContinuationContext(source.data) : "");
  const copiesState = libraryListState(copies);
  const copiesReady = copiesState === "ready" || copiesState === "empty";
  // Latched on the first settled answer. A persisted catalog is not trusted before it, and a
  // background refresh keeps ranking against the last answer, so the choice and the working
  // files below stay put while the Library refreshes.
  const [copiesSettled, setCopiesSettled] = useState(copiesReady);
  if (copiesReady && !copiesSettled) setCopiesSettled(true);
  const knownCopies = copiesSettled && copies.error === null ? copies.data : null;
  const copiesKnown = knownCopies !== null;
  const ranking = useLibraryLaunchRanking({
    project: launchProject,
    copies: (knownCopies ?? []).filter((copy) =>
      libraryLaunchCopyMatchesScope(launchProject, copy, scope === "all" ? null : scope),
    ),
    resourceId: scope === "all" ? null : scope,
  });
  // Nothing is preselected until copies are known, so the choice never jumps away from a copy.
  // Once a launch is recorded its computer is the target, whatever the ranking says now.
  // Memoized so React Compiler can treat the choice as immutable and keep optimizing this screen.
  const intentHost = progress.intent?.executionEnvironmentId ?? null;
  const choice = useMemo(
    () =>
      intentHost !== null
        ? { hostId: intentHost, candidate: null }
        : copiesKnown
          ? libraryLaunchChoice({ ranking, hostId: selectedExecution, copyId })
          : { hostId: selectedExecution, candidate: null },
    [intentHost, copiesKnown, ranking, selectedExecution, copyId],
  );
  const execution = choice.hostId,
    chosen = choice.candidate;
  // Acting on anything that depends on the computer makes the suggestion an explicit choice, so a
  // later ranking update cannot move that input to another computer.
  const pin = () => {
    autoStart.current = false;
    if (selectedExecution === null && execution !== null) setExecution(execution);
  };
  const rankOf = (environmentId: EnvironmentId, id?: string) => {
    const index = ranking.candidates.findIndex(
      (candidate) =>
        candidate.environmentId === environmentId &&
        (id === undefined || (candidate.kind === "copy" && candidate.copyId === id)),
    );
    return index === -1 ? ranking.candidates.length : index;
  };
  const candidateFor = (environmentId: EnvironmentId, id?: string) =>
    ranking.candidates.find(
      (candidate) =>
        candidate.environmentId === environmentId &&
        candidate.kind !== "mini" &&
        (id === undefined || (candidate.kind === "copy" && candidate.copyId === id)),
    ) ?? null;
  const config = execution ? (configs.get(execution) ?? null) : null;
  const supportsFileLifecycle = supportsLoomFeature(
    config?.environment.capabilities,
    LIBRARY_FILE_LIFECYCLE_FEATURE,
  );
  const eligible = libraryLaunchCopiesForScope(
    launchProject,
    knownCopies ?? [],
    execution,
    scope === "all" ? null : scope,
    supportsFileLifecycle,
  ).sort(
    (left, right) => rankOf(left.environmentId, left.id) - rankOf(right.environmentId, right.id),
  );
  // Until copies are known every computer ranks as having none, so leave out the copy's reason.
  const computerReasons = (candidate: LibraryLaunchCandidate) =>
    sentence(copiesKnown ? candidate.reasons : candidate.reasons.filter((_, index) => index !== 1));
  // Skip "online": the computer row already says it.
  const copyReasons = (copy: LibraryWorkingCopy) => {
    const reasons = candidateFor(copy.environmentId, copy.id)?.reasons.slice(1) ?? [];
    return reasons.length > 0 ? sentence(reasons) : undefined;
  };
  const sourceWorkingCopyId =
    source.data?.summary.workingCopyId ?? (props.sourceThreadId ? props.initialCopyId : undefined);
  const sourceEnvironmentId =
    source.data?.summary.environmentId ??
    (props.sourceThreadId ? props.reuseEnvironmentId : undefined);
  const continuationMissingFiles = Boolean(
    props.sourceArchiveId && source.data && !source.data.summary.workingCopyId,
  );
  const recoveryPlan = continuationMissingFiles
    ? {
        kind: "unavailable" as const,
        message:
          "The source conversation has no saved file location. Reconnect its computer to recover its project files.",
      }
    : execution
      ? libraryPortableRecoveryPlan({
          project: launchProject,
          copies: knownCopies ?? [],
          destinationEnvironmentId: execution,
          resourceIds: scope === "all" ? null : resourceIds,
          sourceWorkingCopyId,
          sourceEnvironmentId,
          selectedSourceCopyId: recoverySourceId,
        })
      : { kind: "clone" as const };
  const selectedCopy =
    eligible.find((copy) => copy.id === copyId) ??
    (modeChoice === null && recoveryPlan.kind === "local"
      ? eligible.find((copy) => copy.id === recoveryPlan.copy.id)
      : undefined) ??
    (chosen?.kind === "copy" ? eligible.find((copy) => copy.id === chosen.copyId) : undefined) ??
    eligible[0] ??
    null;
  const localProjectId =
    modeChoice === "folder" || modeChoice === "clone"
      ? null
      : resourceIds.length === 1
        ? (selectedCopy?.repositories.find((entry) => entry.resourceId === resourceIds[0])
            ?.localProjectId ?? null)
        : (selectedCopy?.rootLocalProjectId ?? null);
  const localProject = useProject(
    execution && localProjectId ? { environmentId: execution, projectId: localProjectId } : null,
  );
  const projectDefaultSelection = launchProject.profile?.defaultModelSelection ?? null;
  const savedModelSelection =
    seed?.review.model.selection ?? props.launchSettings?.modelSelection ?? null;
  const runtimeMode = seed?.review.runtimeMode ?? props.launchSettings?.runtimeMode,
    interactionMode = seed?.review.interactionMode ?? props.launchSettings?.interactionMode;
  const { models, defaultModel } = libraryConversationModels({
    config,
    projectDefaultSelection,
    localProjectId,
    localProject,
    savedSelection: savedModelSelection,
  });
  const chosenModel =
    modelKey !== null ? (models.find((model) => model.key === modelKey) ?? null) : defaultModel;
  const canPrepare = useAtomValue(library.prepareCopy.permissionAtom(execution)),
    canBind = useAtomValue(library.bindThread.permissionAtom(execution)),
    canRegisterCopy = useAtomValue(library.registerCopy.permissionAtom(authority.environmentId)),
    canRegisterThread = useAtomValue(
      library.registerThread.permissionAtom(authority.environmentId),
    );
  const canReopen = useAtomValue(library.reopenCopy.permissionAtom(execution));
  const reopen = useAtomCommand(library.reopenCopy, { reportFailure: false });
  const canSetRetention = useAtomValue(library.setCopyRetention.permissionAtom(execution));
  const setRetention = useAtomCommand(library.setCopyRetention, { reportFailure: false });
  // New work prepares files automatically; using an existing folder is an explicit choice.
  const needsCopy =
    copiesKnown &&
    execution !== null &&
    (eligible.length === 0 ||
      recoveryPlan.kind === "recover" ||
      recoveryPlan.kind === "choose" ||
      recoveryPlan.kind === "unavailable");
  const mode =
    modeChoice === "reuse" && copiesKnown && selectedCopy === null
      ? "clone"
      : (modeChoice ?? (needsCopy ? "clone" : "reuse"));
  const recoverySource =
    reviewState?.recoverySource ??
    (mode === "clone"
      ? recoveryPlan.kind === "recover"
        ? recoveryPlan.sourceCopy
        : recoveryPlan.kind === "local"
          ? recoveryPlan.copy
          : null
      : null);
  const recoveryAmbiguous =
    !reviewState?.recoverySource && mode === "clone" && recoveryPlan.kind === "choose";
  const sourceHost = recoverySource
    ? environments.find((entry) => entry.environmentId === recoverySource.environmentId)
    : undefined;
  const canAuthorizeRecovery = useAtomValue(
    library.authorizeRecovery.permissionAtom(authority.environmentId),
  );
  const canRestoreCopy = useAtomValue(library.restoreCopy.permissionAtom(execution));
  const canReadSourceStatus = useAtomValue(
    library.readCopyStatus.permissionAtom(recoverySource?.environmentId ?? null),
  );
  const canSnapshotSource = useAtomValue(
    library.snapshotCopy.permissionAtom(recoverySource?.environmentId ?? null),
  );
  const authorizeRecovery = useAtomCommand(library.authorizeRecovery, { reportFailure: false });
  const restoreCopy = useAtomCommand(library.restoreCopy, { reportFailure: false });
  const readSourceStatus = useAtomCommand(library.readCopyStatus, { reportFailure: false });
  const snapshotCopy = useAtomCommand(library.snapshotCopy, { reportFailure: false });
  const portableSupported =
    supportsFileLifecycle &&
    supportsLoomFeature(config?.environment.capabilities, LIBRARY_PORTABLE_RECOVERY_FEATURE) &&
    supportsLoomFeature(
      configs.get(authority.environmentId!)?.environment.capabilities,
      LIBRARY_PORTABLE_RECOVERY_FEATURE,
    );
  const sourceNeedsSnapshot = recoverySource?.state === "ready" && !progress.recoverySnapshot;
  const sourceCanSnapshot =
    sourceHost?.entry.enabled === true &&
    sourceHost.connection.phase === "connected" &&
    supportsLoomFeature(
      sourceHost.serverConfig?.environment.capabilities,
      LIBRARY_PORTABLE_RECOVERY_FEATURE,
    ) &&
    canReadSourceStatus &&
    canSnapshotSource;
  const recoveryUnavailable =
    mode === "clone" && progress.copy === null
      ? recoveryPlan.kind === "unavailable" && !reviewState?.recoverySource
        ? recoveryPlan.message
        : recoverySource && !portableSupported
          ? "Update this computer and your Library to restore saved project files."
          : recoverySource && (!canAuthorizeRecovery || !canRestoreCopy)
            ? "Restoring saved files needs file access on this computer and your Library."
            : sourceNeedsSnapshot && !sourceCanSnapshot
              ? "Reconnect the source computer with file access to save its latest files before continuing here."
              : null
      : null;
  const keepOnComputer =
    mode === "folder" || (mode === "reuse" && selectedCopy?.ownership === "borrowed")
      ? true
      : (keepFiles ?? (mode === "reuse" ? selectedCopy?.keepOnComputer !== false : false));
  const rootPath =
    typedPath ??
    (mode === "clone"
      ? libraryFreshRootPath(launchProject, knownCopies ?? [], execution, config?.newProjectsRoot)
      : "");
  const overlappingRoot =
    mode !== "reuse" &&
    (knownCopies ?? []).some(
      (copy) =>
        copy.environmentId === execution &&
        copy.ownership === "managed" &&
        libraryLaunchPathOverlaps(copy.rootPath, rootPath.trim()),
    );
  const warning =
    progress.intent === null && mode === "reuse" && selectedCopy?.state !== "released"
      ? libraryLaunchWarning(
          selectedCopy ? candidateFor(selectedCopy.environmentId, selectedCopy.id) : null,
          selectedCopy,
          scope === "all" ? null : scope,
        )
      : null;
  const canPull = useAtomValue(vcsEnvironment.pull.permissionAtom(execution));
  const pull = useAtomCommand(vcsEnvironment.pull, { reportFailure: false });
  const executeOperation = useAtomCommand(library.executeOperation, { reportFailure: false });
  const prepare = useAtomCommand(library.prepareCopy, { reportFailure: false }),
    registerCopy = useAtomCommand(library.registerCopy, { reportFailure: false }),
    bind = useAtomCommand(library.bindThread, { reportFailure: false }),
    registerThread = useAtomCommand(library.registerThread, { reportFailure: false }),
    create = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const resolve = useAtomQueryRunner(library.resolveBinding, {
      refresh: true,
      reportFailure: false,
    }),
    snapshot = useAtomQueryRunner(library.snapshotThread, { refresh: true, reportFailure: false });
  const locked = pending !== null || progress.intent !== null || folderPending;
  const selectedHost = environments.find((env) => env.environmentId === execution);
  const hostReady =
    selectedHost?.entry.enabled === true &&
    selectedHost.connection.phase === "connected" &&
    supportsLoomFeature(selectedHost.serverConfig?.environment.capabilities, "project-library") &&
    execution !== null &&
    operable.has(execution);
  const canStart =
    authority.ready &&
    !folderPending &&
    hostReady &&
    canBind &&
    canRegisterCopy &&
    canRegisterThread &&
    (!supportsFileLifecycle || keepFiles === null || canSetRetention) &&
    (progress.intent !== null || copiesReady) &&
    (progress.intent !== null || props.projectReady) &&
    (resourceIds.length > 0 || repositories.length === 0) &&
    (progress.threadCreated || chosenModel !== null) &&
    (progress.copy !== null ||
      mode !== "reuse" ||
      selectedCopy?.state !== "released" ||
      canReopen) &&
    (progress.intent !== null || !overlappingRoot) &&
    !launchProject.archived &&
    !progress.recoverySnapshotRejected &&
    (progress.copy !== null || (!recoveryAmbiguous && recoveryUnavailable === null)) &&
    (progress.copy !== null || mode === "reuse"
      ? progress.copy !== null || selectedCopy !== null
      : rootPath.trim().length > 0 &&
        (recoverySource
          ? canRestoreCopy && canAuthorizeRecovery
          : canPrepare && (mode !== "clone" || (execution !== null && writable.has(execution))))) &&
    (!props.sourceArchiveId ||
      progress.intent !== null ||
      (source.data !== null && source.isSuccess && !source.isPending && source.error === null));
  async function persistAttempt() {
    const review = reviewed.current;
    if (!review) throw new Error("Review this preparation before saving it.");
    const serialized = encodeLibraryLaunchAttempt({
      version: 1,
      requestId: requestId.current,
      threadId: threadId.current,
      receipt: receipt.current,
      review,
    });
    if (serialized.length > 256 * 1024)
      throw new Error("This preparation is too large to save safely on this device.");
    await savePreferences({
      transform: (current) => ({
        loomLibraryLaunches: { ...current.loomLibraryLaunches, [attemptKey]: serialized },
      }),
    });
  }
  async function start() {
    // A Start pressed while the tapped row's start waits must not be followed by that one.
    autoStart.current = false;
    if (busy.current || folderBusy.current || !canStart || !execution || !authority.environmentId)
      return;
    const current = appAtomRegistry.get(environmentPresentations.presentationAtom(execution));
    if (
      current?.entry.enabled !== true ||
      current.connection.phase !== "connected" ||
      !readEnvironmentScope(execution, AuthOrchestrationOperateScope)
    )
      return;
    if (!reviewed.current) {
      if (!chosenModel) return;
      const catalog = appAtomRegistry.get(
        library.copies({
          environmentId: authority.environmentId,
          input: { projectId: props.project.id, includeReleased: true },
        }),
      );
      if (catalog._tag !== "Success" || catalog.waiting) return;
      if (
        mode !== "reuse" &&
        catalog.value.some(
          (copy) =>
            copy.environmentId === execution &&
            copy.ownership === "managed" &&
            libraryLaunchPathOverlaps(copy.rootPath, rootPath.trim()),
        )
      ) {
        setError("Choose a separate folder for this project layout, or restore its saved files.");
        return;
      }
      // Pin what was reviewed, so the screen keeps showing it if the ranking moves mid-launch.
      setExecution(execution);
      setMode(mode);
      setCopyId(selectedCopy?.id ?? null);
      reviewed.current = {
        authorityEnvironmentId: authority.environmentId,
        model: chosenModel,
        ...(runtimeMode ? { runtimeMode } : {}),
        ...(interactionMode ? { interactionMode } : {}),
        title: title.trim() || "Project discussion",
        mode,
        rootPath: rootPath.trim(),
        copy: selectedCopy,
        ...(recoverySource ? { recoverySource } : {}),
        carryContext,
        ...(supportsFileLifecycle ? { keepOnComputer } : {}),
      };
      setReviewState(reviewed.current);
      setModelKey(chosenModel.key);
    }
    const review = reviewed.current;
    const persist = persistAttempt;
    if (review.authorityEnvironmentId !== authority.environmentId) {
      setError("Reconnect the library used to start this preparation before resuming it.");
      return;
    }
    busy.current = true;
    setPending("Preparing conversation…");
    setError(null);
    try {
      const continuation =
        receipt.current.intent?.continuationOf ??
        (source.data
          ? {
              environmentId: source.data.summary.environmentId,
              threadId: source.data.summary.threadId,
              sequence: source.data.summary.sequence,
            }
          : undefined);
      const target = await launchLibraryConversation(
        {
          project: launchProject,
          executionEnvironmentId: execution,
          resourceIds,
          threadId: threadId.current,
          ...(continuation ? { continuationOf: continuation } : {}),
        },
        receipt.current,
        {
          persist,
          prepare: async (intent) => {
            if (review.recoverySource) {
              return preparePortableLibraryLaunchCopy(
                {
                  sourceCopy: review.recoverySource,
                  project: intent.project,
                  destinationEnvironmentId: execution,
                  authorityEnvironmentId: authority.environmentId!,
                  rootPath: review.rootPath,
                  resourceIds: intent.resourceIds,
                  requestId: requestId.current,
                },
                receipt.current,
                {
                  readStatus: async (input) => unwrap(await readSourceStatus(input)),
                  snapshot: async (input) => unwrap(await snapshotCopy(input)),
                  registerCopy: async (input) => {
                    unwrap(await registerCopy({ environmentId: authority.environmentId!, input }));
                  },
                  authorize: async (input) => unwrap(await authorizeRecovery(input)),
                  restore: async (input) => unwrap(await restoreCopy(input)),
                  persist,
                  progress: setPending,
                },
              );
            }
            const copy =
              review.mode === "reuse" && review.copy?.ownership === "managed"
                ? review.copy.state === "released"
                  ? await restoreLibraryLaunchCopy(
                      review.copy,
                      `${requestId.current}:reopen`,
                      async (input) => {
                        if (
                          !supportsFileLifecycle ||
                          !appAtomRegistry.get(library.reopenCopy.permissionAtom(execution))
                        )
                          throw new Error(
                            "This computer needs permission to restore saved project files.",
                          );
                        return unwrap(await reopen(input));
                      },
                    )
                  : review.copy
                : unwrap(
                    await prepare({
                      environmentId: execution,
                      input: {
                        requestId: `${requestId.current}:prepare`,
                        project: intent.project,
                        rootPath:
                          review.mode === "reuse" && review.copy
                            ? review.copy.rootPath
                            : review.rootPath,
                        strategy: review.mode === "clone" ? "clone" : "reuse",
                        resourceIds: intent.resourceIds,
                      },
                    }),
                  );
            if (review.mode === "reuse" && review.copy && copy.id !== review.copy.id)
              throw new Error("The prepared folder does not match the selected files.");
            return copy;
          },
          registerCopy: async (copy) => {
            unwrap(
              await registerCopy({
                environmentId: authority.environmentId!,
                input: { requestId: `${requestId.current}:copy`, copy },
              }),
            );
          },
          resolve: async (input) =>
            unwrap(
              await resolve({
                environmentId: execution,
                input,
              }),
            ),
          durableLaunch: supportsLoomFeature(config?.environment.capabilities, "project-workflows")
            ? async (input) => {
                const localProjectId = receipt.current.resolved?.localProjectId;
                if (!localProjectId) throw new Error("Review the selected files before starting.");
                const currentModels = buildModelOptions(
                  config,
                  review.model.selection,
                  undefined,
                  localProjectId,
                );
                if (
                  !currentModels.some(
                    (model) => model.key === review.model.key && !model.isUnavailable,
                  )
                )
                  throw new Error(
                    "This model is unavailable for the chosen workspace. Review provider settings.",
                  );
                unwrap(
                  await executeOperation({
                    environmentId: execution,
                    input: {
                      operationId: `${requestId.current}:launch`,
                      request: {
                        kind: "launch",
                        input: {
                          ...input,
                          title: review.title,
                          modelSelection: review.model.selection,
                          runtimeMode:
                            review.runtimeMode ??
                            libraryLaunchDefaults({ settings: config?.settings, localProjectId })
                              .runtimeMode,
                          interactionMode:
                            review.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
                          ...(receipt.current.copy?.ownership === "managed" &&
                          review.keepOnComputer !== undefined
                            ? { keepOnComputer: review.keepOnComputer }
                            : {}),
                        },
                      },
                    },
                  }),
                );
              }
            : undefined,
          create: async (localProjectId) => {
            const currentModels = buildModelOptions(
              config,
              review.model.selection,
              undefined,
              localProjectId,
            );
            if (
              !currentModels.some((model) => model.key === review.model.key && !model.isUnavailable)
            )
              throw new Error(
                "This model is unavailable for the chosen workspace. Review provider settings.",
              );
            unwrap(
              await create({
                environmentId: execution,
                input: {
                  commandId: CommandId.make(`${requestId.current}:thread`),
                  threadId: threadId.current,
                  projectId: localProjectId,
                  title: review.title,
                  modelSelection: review.model.selection,
                  runtimeMode:
                    review.runtimeMode ??
                    libraryLaunchDefaults({
                      settings: config?.settings,
                      localProjectId,
                    }).runtimeMode,
                  interactionMode: review.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
                  branch: null,
                  worktreePath: null,
                },
              }),
            );
          },
          bind: (input) =>
            bindLibraryLaunchConversation(
              input,
              receipt.current,
              review.keepOnComputer,
              requestId.current,
              {
                bind: async (input) => {
                  unwrap(await bind({ environmentId: execution, input }));
                },
                setRetention: async (input) => {
                  if (!supportsFileLifecycle)
                    throw new Error("Update this computer to save the Keep files setting.");
                  return unwrap(await setRetention({ environmentId: execution, input }));
                },
                registerCopy: async (input) => {
                  unwrap(await registerCopy({ environmentId: authority.environmentId!, input }));
                },
                persist,
              },
            ),
          snapshot: async () =>
            unwrap(
              await snapshot({ environmentId: execution, input: { threadId: threadId.current } }),
            ),
          registerHistory: async (archive) => {
            unwrap(
              await registerThread({
                environmentId: authority.environmentId!,
                input: { requestId: `${requestId.current}:history`, thread: archive },
              }),
            );
          },
          progress: (label) => {
            setProgress({ ...receipt.current });
            setPending(label);
          },
        },
      );
      if (props.sourceArchiveId && review.carryContext.trim()) {
        setComposerDraftText(scopedThreadKey(target), review.carryContext);
        await flushComposerDrafts();
      }
      refreshLibraryWork(authority.environmentId, launchProject.id);
      await savePreferences({
        transform: (current) => {
          const next = { ...current.loomLibraryLaunches };
          delete next[attemptKey];
          return { loomLibraryLaunches: next };
        },
      });
      setLaunchedThread(target);
    } catch (cause) {
      setCloneRepair(cause instanceof LibraryError ? cause.repair : undefined);
      setError(
        cause instanceof Error
          ? cause.message
          : "The conversation could not be prepared. Retry the saved steps.",
      );
    } finally {
      busy.current = false;
      setProgress({ ...receipt.current });
      setPending(null);
    }
  }
  /**
   * Forgets a saved attempt, so the screen reopens unlocked on the same choices. Work it finished
   * stays: a conversation it created remains in the list, and prepared files remain registered.
   */
  async function startOver() {
    const review = reviewed.current;
    if (busy.current || folderBusy.current || !review) return;
    // Held while the attempt is forgotten, so Resume cannot run it meanwhile.
    busy.current = true;
    try {
      await savePreferences({
        transform: (current) => {
          const next = { ...current.loomLibraryLaunches };
          delete next[attemptKey];
          return { loomLibraryLaunches: next };
        },
      });
    } finally {
      busy.current = false;
    }
    // A failed attempt can leave files registered that the catalog read before it does not list.
    if (authority.environmentId) refreshLibraryWork(authority.environmentId, props.project.id);
    // The computer may still finish the dropped request, so the next start uses the files it
    // prepared, or the same folder, rather than preparing a second set beside them. A folder the
    // user chose stays that folder, which is added again as it is.
    const prepared = receipt.current.copy;
    const reusePrepared = prepared !== null && prepared.ownership === "managed";
    props.onStartOver({
      version: 1,
      requestId: requestId.current,
      threadId: threadId.current,
      receipt: receipt.current,
      review: reusePrepared ? { ...review, mode: "reuse", copy: prepared } : review,
    });
  }
  async function reviewLatestSourceFiles() {
    if (
      busy.current ||
      folderBusy.current ||
      receipt.current.copy ||
      receipt.current.recoverySnapshot ||
      !receipt.current.recoverySnapshotRejected
    )
      return;
    busy.current = true;
    setPending("Reviewing source files…");
    setError(null);
    try {
      delete receipt.current.recoverySnapshotReview;
      delete receipt.current.recoverySnapshotRejected;
      receipt.current.recoverySnapshotAttempt = (receipt.current.recoverySnapshotAttempt ?? 0) + 1;
      await persistAttempt();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The source review could not be saved.");
    } finally {
      setProgress({ ...receipt.current });
      setPending(null);
      busy.current = false;
    }
  }
  /** Fast-forward the copy's behind repositories, then start on it. */
  async function pullThenStart(paths: readonly string[]) {
    if (busy.current || !execution || !selectedCopy) return;
    const copy = selectedCopy;
    pin();
    setCopyId(copy.id);
    busy.current = true;
    setPending("Pulling latest changes…");
    setError(null);
    let pulled = true;
    try {
      for (const cwd of paths) {
        const result = await pull({ environmentId: execution, input: { cwd } });
        if (AsyncResult.isFailure(result)) {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : "Could not pull the latest changes.");
          pulled = false;
          break;
        }
      }
    } finally {
      busy.current = false;
      setPending(null);
      appAtomRegistry.refresh(
        library.copyHealth({
          environmentId: copy.environmentId,
          input: { workingCopyId: copy.id },
        }),
      );
    }
    if (pulled) await start();
  }
  // What the tapped row or folder handed in, as this screen resolves it now. Files it fell back
  // to, or a copy that has to be restored first, are for the user to review.
  const promised =
    execution !== null &&
    execution === props.reuseEnvironmentId &&
    (props.reuseRootPath === undefined
      ? mode === "reuse" &&
        selectedCopy !== null &&
        selectedCopy.id === props.initialCopyId &&
        selectedCopy.state === "ready"
      : mode === "folder");
  // The copy's live health decides whether it is behind, which the user should see first.
  const healthCopy =
    props.startNow &&
    promised &&
    mode === "reuse" &&
    supportsLoomFeature(config?.environment.capabilities, LIBRARY_COPY_HEALTH_FEATURE)
      ? selectedCopy
      : null;
  const health = useEnvironmentQuery(
    healthCopy
      ? library.copyHealth({
          environmentId: healthCopy.environmentId,
          input: { workingCopyId: healthCopy.id },
        })
      : null,
  );
  const autoStartWaiting =
    !copiesKnown || copies.isPending || !props.projectReady || health.isPending;
  const autoStartReady = canStart && promised && warning === null;
  const decideAutoStart = useEffectEvent((ready: boolean) => {
    if (!autoStart.current) return;
    autoStart.current = false;
    if (ready) void start();
  });
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- The tapped row asked for this launch; it runs once what it waits on has settled.
    if (!autoStartWaiting) decideAutoStart(autoStartReady);
  }, [autoStartWaiting, autoStartReady]);
  if (!authority.environmentId) return <LibraryAuthorityScreen />;
  const computerLabel =
    selectedHost?.label ??
    authority.computers.find((computer) => computer.environmentId === execution)?.label ??
    "Choose a computer";
  const displayedCopy =
    progress.copy ?? (progress.intent ? saved?.review.copy : null) ?? selectedCopy;
  const filesStatus =
    !copiesKnown && progress.intent === null
      ? "Checking project files"
      : mode === "reuse"
        ? displayedCopy?.state === "released"
          ? "Restore saved files when starting"
          : "Use files already on this computer"
        : mode === "folder"
          ? "Use an existing folder"
          : recoverySource || recoveryAmbiguous
            ? "Restore source files when starting"
            : rootPath.trim()
              ? "Prepare project files when starting"
              : "Choose a folder before starting";
  const retentionStatus = keepOnComputer
    ? "Files stay kept."
    : "Temporary files, saved work stays.";
  return (
    <LibraryPage title={props.sourceArchiveId ? "Continue conversation" : "New conversation"} back>
      <Text className="text-xl font-t3-semibold text-foreground">{launchProject.title}</Text>
      {saved ? (
        <LibraryNotice detail="An unfinished preparation is saved on this device. Resume it with the original computer, files and context." />
      ) : null}
      {props.projectNotice && progress.intent === null ? (
        <LibraryNotice
          detail={props.projectError ? null : props.projectNotice}
          error={props.projectError}
          onRetry={props.onRefreshProject}
        />
      ) : null}
      {source.data ? (
        <SettingsSection title="Continuation source">
          <View className="gap-1 p-4">
            <Text className="text-sm text-foreground">{source.data.summary.title}</Text>
            <Text className="text-xs text-foreground-muted">
              The original stays saved. This conversation links back to it.
            </Text>
          </View>
        </SettingsSection>
      ) : props.sourceArchiveId ? (
        <LibraryNotice
          error={source.error}
          detail={source.error ? null : "Loading the saved source context…"}
          onRetry={source.refresh}
        />
      ) : null}
      {source.data && (source.error || source.isPending) && progress.intent === null ? (
        <LibraryNotice
          error={source.error}
          detail={source.error ? null : "Refreshing the saved source context…"}
          onRetry={source.error ? source.refresh : undefined}
        />
      ) : null}
      <SettingsSection>
        <ListRow
          label="Computer"
          description={
            execution && !hostReady ? `${computerLabel}. Unavailable for new work.` : computerLabel
          }
          detail={showComputers && hostReady ? "Done" : "Change"}
          disabled={locked}
          onPress={() => {
            pin();
            setShowComputers((value) => !value);
          }}
        />
        {execution ? (
          <>
            <View className="border-t border-border-subtle">
              <ListRow
                label="Agent model"
                description={
                  chosenModel
                    ? `${chosenModel.providerLabel}: ${chosenModel.label}`
                    : "No available agent model"
                }
                detail={showModels ? "Done" : "Change"}
                disabled={locked}
                onPress={() => {
                  pin();
                  setShowModels((value) => !value);
                }}
              />
            </View>
            <View className="border-t border-border-subtle">
              <ListRow
                label="Files"
                description={
                  !copiesKnown || !supportsFileLifecycle
                    ? filesStatus
                    : `${filesStatus}. ${retentionStatus}`
                }
                detail={showFolderOptions ? "Done" : "Options"}
                disabled={folderPending || (progress.intent === null && !copiesReady)}
                onPress={() => {
                  pin();
                  setShowFolderOptions((value) => !value);
                }}
              />
            </View>
          </>
        ) : null}
      </SettingsSection>
      {showComputers || !hostReady ? (
        <SettingsSection title="Choose a computer">
          {environments
            .filter((env) => env.serverConfig?.environment.capabilities.supportsExecution !== false)
            .sort((left, right) => rankOf(left.environmentId) - rankOf(right.environmentId))
            .map((env, index) => {
              const connected = env.entry.enabled && env.connection.phase === "connected",
                supported = supportsLoomFeature(
                  env.serverConfig?.environment.capabilities,
                  "project-library",
                ),
                candidate = candidateFor(env.environmentId);
              return (
                <ListChoiceRow
                  key={env.environmentId}
                  label={env.label}
                  selected={execution === env.environmentId}
                  separated={index > 0}
                  disabled={locked || !connected || !supported || !operable.has(env.environmentId)}
                  description={
                    !connected
                      ? "Offline"
                      : !supported
                        ? "Update Loom to run library conversations"
                        : !operable.has(env.environmentId)
                          ? "Conversation access required"
                          : candidate
                            ? computerReasons(candidate)
                            : "Connected"
                  }
                  onPress={() => {
                    autoStart.current = false;
                    // Choices made for this computer, including a folder handed in, outlive a tap on it.
                    if (env.environmentId !== execution) {
                      setCopyId(null);
                      setModelKey(null);
                      setMode(null);
                      setRootPath(null);
                      setKeepFiles(null);
                      setRecoverySourceId(null);
                      setShowFolderOptions(false);
                    }
                    setExecution(env.environmentId);
                    setShowComputers(false);
                  }}
                />
              );
            })}
          {authority.computers
            .filter(
              (computer) =>
                computer.supportsExecution &&
                !environments.some((entry) => entry.environmentId === computer.environmentId),
            )
            .map((computer) => (
              <ListChoiceRow
                key={computer.environmentId}
                label={computer.label}
                description="Connect this computer to run work here. Its saved history is available in Projects."
                selected={false}
                disabled={locked}
                onPress={() => navigation.navigate("Connections")}
                separated
              />
            ))}
          {!hostReady ||
          authority.computers.some(
            (computer) =>
              computer.supportsExecution &&
              !environments.some((entry) => entry.environmentId === computer.environmentId),
          ) ? (
            <Button
              label="Connect a computer"
              tone="text"
              onPress={() => navigation.navigate("Connections")}
            />
          ) : null}
        </SettingsSection>
      ) : null}
      {execution ? (
        <>
          {showModels ? (
            <SettingsSection title="Agent model">
              {models.map((model) => (
                <ListChoiceRow
                  key={model.key}
                  label={`${model.providerLabel}: ${model.label}`}
                  selected={chosenModel?.key === model.key}
                  disabled={locked}
                  onPress={() => {
                    pin();
                    setModelKey(model.key);
                    setShowModels(false);
                  }}
                />
              ))}
            </SettingsSection>
          ) : null}
          {showFolderOptions ? (
            <SettingsSection title="Working files">
              <View className="gap-2 p-4">
                <Text selectable className="text-sm text-foreground">
                  {mode === "reuse" ? displayedCopy?.rootPath : rootPath || "Choose a folder"}
                </Text>
                <Text className="text-sm text-foreground-muted">
                  {mode === "reuse"
                    ? selectedCopy?.state === "released"
                      ? "Loom restores the saved files here when you start work."
                      : "Start with the files already here."
                    : mode === "folder"
                      ? "Files stay here until you change their setting in the project."
                      : recoverySource
                        ? "Loom restores saved files here, including local changes and work that has not been pushed."
                        : "Loom prepares the files here when you start work."}
                </Text>
              </View>
              {eligible.map((copy) => (
                <ListChoiceRow
                  key={copy.id}
                  label={copy.rootPath}
                  description={
                    sourceWorkingCopyId && copy.id !== sourceWorkingCopyId
                      ? "Use these local files instead of the source conversation's files."
                      : copy.state === "released"
                        ? "Restore saved files when starting work."
                        : copyReasons(copy)
                  }
                  selected={mode === "reuse" && selectedCopy?.id === copy.id}
                  disabled={locked || !copiesReady}
                  onPress={() => {
                    pin();
                    setMode("reuse");
                    setCopyId(copy.id);
                    setKeepFiles(null);
                  }}
                />
              ))}
              <ListChoiceRow
                label="Use an existing folder"
                description="Files you already have on this computer stay kept."
                selected={mode === "folder"}
                disabled={locked || !copiesReady || !canPrepare}
                onPress={() => {
                  pin();
                  setMode("folder");
                  setRootPath(null);
                  setKeepFiles(null);
                }}
              />
              <ListChoiceRow
                label="Prepare files in a new folder"
                description="Loom brings the project files to this computer."
                selected={mode === "clone"}
                disabled={locked || !copiesReady || (!canPrepare && !canRestoreCopy)}
                onPress={() => {
                  pin();
                  setMode("clone");
                  setRootPath(null);
                  setKeepFiles(null);
                }}
              />
              {mode !== "reuse" ? (
                <View className="gap-2 p-4">
                  <TextInput
                    accessibilityLabel="Project folder on selected computer"
                    placeholder="Absolute project folder on this computer"
                    value={rootPath}
                    onChangeText={(text) => {
                      pin();
                      setRootPath(text);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!locked}
                    className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
                  />
                  {mode === "folder" && repositories.length > 0 ? (
                    <Text className="text-xs text-foreground-muted">
                      Choose the folder containing{" "}
                      {repositories.map((entry) => entry.relativePath).join(", ")}.
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {mode === "reuse" && selectedCopy?.ownership === "borrowed" ? (
                <LibraryFolderStorage
                  copy={selectedCopy}
                  canAct={authority.ready && pending === null && progress.intent === null}
                  onPending={onFolderPending}
                  onChanged={() => refreshLibraryWork(authority.environmentId!, launchProject.id)}
                />
              ) : supportsFileLifecycle && mode !== "folder" ? (
                <SettingsSwitchRow
                  label="Keep files on this computer"
                  subtitle="Keep for later work. Loom frees space once all work is finished and safely saved. Your conversations stay available."
                  value={keepOnComputer}
                  disabled={locked || !canSetRetention}
                  onValueChange={(value) => {
                    pin();
                    setKeepFiles(value);
                  }}
                />
              ) : null}
            </SettingsSection>
          ) : null}
          {overlappingRoot ? (
            <LibraryNotice detail="Choose a separate folder for this project layout, or select saved files to restore them." />
          ) : null}
          {mode === "reuse" && selectedCopy?.state === "released" && !canReopen ? (
            <LibraryNotice detail="Restoring saved files needs file access on this computer." />
          ) : null}
          {mode === "clone" && !recoverySource && !writable.has(execution) ? (
            <LibraryNotice detail="File preparation needs source control access on this computer. Choose an existing folder or another computer." />
          ) : null}
        </>
      ) : null}
      {recoveryAmbiguous && recoveryPlan.kind === "choose" ? (
        <SettingsSection title="Choose source files">
          <View className="p-4">
            <Text className="text-sm text-foreground-muted">{recoveryPlan.reason}</Text>
          </View>
          {recoveryPlan.candidates.map((copy) => (
            <ListChoiceRow
              key={`${copy.environmentId}:${copy.id}`}
              label={`${environments.find((entry) => entry.environmentId === copy.environmentId)?.label ?? authority.computers.find((entry) => entry.environmentId === copy.environmentId)?.label ?? "Saved computer"}: ${copy.rootPath}`}
              description={
                copy.environmentId === execution
                  ? copy.state === "released"
                    ? "Restore these saved files on this computer."
                    : "Use the files already on this computer."
                  : copy.state === "released"
                    ? "Restore these saved files."
                    : "Save and restore the latest files from this computer."
              }
              selected={recoverySourceId === copy.id}
              disabled={locked}
              onPress={() => {
                pin();
                setRecoverySourceId(copy.id);
                if (copy.environmentId === execution && modeChoice !== "clone") {
                  setCopyId(copy.id);
                  setMode("reuse");
                }
              }}
            />
          ))}
        </SettingsSection>
      ) : null}
      {recoveryUnavailable ? <LibraryNotice detail={recoveryUnavailable} /> : null}
      {repositories.length > 1 ? (
        <SettingsSection title="Conversation context">
          <ListChoiceRow
            label="Whole project"
            description="Discuss and work across every repository."
            selected={scope === "all"}
            disabled={locked}
            onPress={() => {
              autoStart.current = false;
              setScope("all");
              setCopyId(null);
              setRecoverySourceId(null);
            }}
          />
          {repositories.map((resource) => (
            <ListChoiceRow
              key={resource.id}
              label={resource.title}
              selected={scope === resource.id}
              disabled={locked}
              separated
              onPress={() => {
                autoStart.current = false;
                setScope(resource.id);
                setCopyId(null);
                setRecoverySourceId(null);
              }}
            />
          ))}
        </SettingsSection>
      ) : null}
      {warning ? (
        <View className="gap-2">
          <Text className="text-sm text-warning-foreground">{warning.message}</Text>
          {warning.pullPaths && canPull ? (
            <Button
              label="Pull first"
              disabled={pending !== null || !canStart}
              onPress={() => {
                void pullThenStart(warning.pullPaths ?? []);
              }}
            />
          ) : null}
        </View>
      ) : null}
      {!authority.ready ? (
        <LibraryNotice detail="Reconnect your library to save this conversation. Your chosen computer stays selected." />
      ) : null}
      {copies.error ? <LibraryNotice error={copies.error} onRetry={copies.refresh} /> : null}
      {copiesState === "loading" && progress.intent === null ? (
        <LibraryNotice
          detail={
            !authority.connected
              ? "Reconnect your library to check project files before starting work."
              : copies.data === null
                ? "Finding project files…"
                : "Checking project files…"
          }
        />
      ) : null}
      {modelKey !== null && !chosenModel && !progress.threadCreated ? (
        <LibraryNotice detail="The selected model is unavailable. Restore it in provider settings before resuming this preparation." />
      ) : null}
      {error ? <LibraryNotice error={error} /> : null}
      {error && cloneRepair && cloneRepair.environmentId === execution ? (
        <>
          <Button
            label={showGitHubSetup ? "Hide GitHub setup" : `Set up GitHub on ${cloneRepair.label}`}
            onPress={() => setShowGitHubSetup((value) => !value)}
          />
          {showGitHubSetup ? (
            <GitHubHostSetupSettings
              environmentId={cloneRepair.environmentId}
              label={cloneRepair.label}
            />
          ) : null}
        </>
      ) : null}
      {progress.recoverySnapshotRejected && !progress.copy && !progress.recoverySnapshot ? (
        <Button
          label="Review latest source files"
          tone="text"
          disabled={pending !== null}
          onPress={() => {
            void reviewLatestSourceFiles();
          }}
        />
      ) : null}
      <Button
        label={
          pending ??
          (progress.intent ? "Resume starting work" : warning ? "Continue anyway" : "Start work")
        }
        tone="primary"
        fullWidth
        disabled={pending !== null || !canStart}
        onPress={() => {
          void start();
        }}
      />
      {/* Offered with no error too: a saved attempt reopened later shows only its retry. */}
      {progress.intent && pending === null ? (
        <Button
          label="Start over"
          tone="text"
          onPress={() => {
            void startOver().catch((cause: unknown) =>
              setError(
                cause instanceof Error ? cause.message : "This attempt could not be cleared.",
              ),
            );
          }}
        />
      ) : null}
      <SettingsSection>
        <ListRow
          label="Conversation options"
          description={title || "Title, context and setup"}
          detail={showOptions ? "Done" : "Edit"}
          onPress={() => {
            // A title or context being edited is not what the tapped row promised to start with.
            autoStart.current = false;
            setShowOptions((value) => !value);
          }}
        />
      </SettingsSection>
      {showOptions ? (
        <View className="gap-3">
          <Text className="text-sm text-foreground-muted">Conversation title</Text>
          <TextInput
            accessibilityLabel="Conversation title"
            value={title}
            onChangeText={setTitle}
            editable={!locked}
            placeholder="Project discussion"
            maxLength={160}
            className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-base text-foreground"
          />
          {props.sourceArchiveId ? (
            <SettingsSection title="Context to carry forward">
              <TextInput
                accessibilityLabel="Context to carry forward"
                value={carryContext}
                onChangeText={(text) => {
                  setCarryContext(text);
                }}
                multiline
                textAlignVertical="top"
                editable={!locked}
                className="min-h-32 rounded-xl border border-input-border bg-input p-3 text-base text-foreground"
              />
            </SettingsSection>
          ) : null}
          {execution && mode !== "reuse" && progress.intent === null ? (
            <View className="gap-2">
              <Button
                label={showSetup ? "Hide optional setup" : "Optional setup"}
                tone="text"
                disabled={locked}
                onPress={() => setShowSetup((value) => !value)}
              />
              {showSetup ? (
                <>
                  <Text className="text-xs text-foreground-muted">
                    You can start work without completing these checks.
                  </Text>
                  <LibraryProfileReadiness environmentId={execution} project={launchProject} />
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </LibraryPage>
  );
}
