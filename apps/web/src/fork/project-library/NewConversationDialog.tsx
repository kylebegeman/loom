import type { ModelEsque } from "~/components/chat/providerIconUtils";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { mergeEnvironmentSettings, useClientSettings } from "~/hooks/useSettings";
import { ConversationPalette } from "./ConversationPalette";
import { LibraryPaletteDialog } from "./LibraryPalette";
import { useRef, useState } from "react";
import {
  libraryContinuationContext,
  libraryCopyReadiness,
  libraryLaunchChoice,
  libraryPortableRecoveryPlan,
  libraryLaunchDefaults,
  libraryLaunchWarning,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";

import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentProviders } from "~/state/environments";
import { useNavigate } from "@tanstack/react-router";
import {
  EnvironmentId,
  ModelSelection,
  RuntimeMode,
  ProviderInteractionMode,
  ThreadId,
  type ProjectId,
  type ProviderInstanceId,
  type ServerSettings,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  LIBRARY_FILE_LIFECYCLE_FEATURE,
  LibraryThreadBinding,
  LibraryProject,
  LibraryPrepareCopyRequest,
  LibraryReopenCopyRequest,
  LibraryWorkingCopy,
  LibraryError,
  type LibraryThreadSummary,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";

import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { threadEnvironment } from "~/state/threads";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
} from "~/providerInstances";
import { type LegacyProjectSettingsFields } from "@t3tools/shared/projectSettings";
import { useProjects, waitForProject } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentServerConfigsAtom, serverEnvironment } from "~/state/server";

import { newThreadId, randomUUID } from "~/lib/utils";
import { useLibraryAttempt } from "./attempts";
import { PortableLaunchAttempt, restoreLibraryLaunchCopy } from "./portableLaunch";
import { useComposerDraftStore } from "~/composerDraftStore";
import { projectLibrary, useLibraryAuthority, useLibraryPermission } from "./state";

import { ReleaseCopyDialog } from "./ReleaseCopyDialog";
import {
  libraryLaunchCopyMatchesScope,
  libraryLaunchPathOverlaps,
  libraryLaunchRetainedCopy,
  libraryLaunchRootPath,
} from "./LaunchGetCopy";
import { useLibraryLaunchRanking } from "./useLibraryLaunchRanking";
import { vcsEnvironment } from "~/state/vcs";
import type { EnvironmentQueryView } from "~/state/query";

const ConversationAttempt = Schema.NullOr(
  Schema.Struct({
    environmentId: EnvironmentId,
    threadId: ThreadId,
    binding: LibraryThreadBinding,
    project: LibraryProject,
    title: Schema.String,
    context: Schema.String,
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
    requestedRuntimeMode: Schema.optional(RuntimeMode),
    interactionMode: Schema.optional(ProviderInteractionMode),
    createdAt: Schema.String,
    created: Schema.Boolean,
    registerRequestId: Schema.String,
    defaultsResolved: Schema.optional(Schema.Boolean),
    requestedModelSelection: Schema.optional(ModelSelection),
    keepOnComputer: Schema.optional(Schema.Boolean),
    retentionCopy: Schema.optional(LibraryWorkingCopy),
  }),
);

const PreparationAttempt = Schema.NullOr(
  Schema.Struct({
    environmentId: EnvironmentId,
    input: LibraryPrepareCopyRequest,
    registerRequestId: Schema.String,
    copy: Schema.NullOr(LibraryWorkingCopy),
    keepOnComputer: Schema.optional(Schema.Boolean),
    savedAt: Schema.optional(Schema.String),
  }),
);
const ReopeningAttempt = Schema.NullOr(
  Schema.Struct({
    environmentId: EnvironmentId,
    input: LibraryReopenCopyRequest,
    project: LibraryProject,
    resourceIds: Schema.Array(Schema.String),
    rootPath: Schema.String,
    registerRequestId: Schema.String,
    copy: Schema.NullOr(LibraryWorkingCopy),
    keepOnComputer: Schema.optional(Schema.Boolean),
    savedAt: Schema.optional(Schema.String),
  }),
);
const UNTITLED_CONVERSATION = "New project conversation";
type ReopeningFiles = NonNullable<typeof ReopeningAttempt.Type>;

/** Keep the restored receipt across authority failures without restoring a second workspace. */
export async function reopenLibraryLaunchCopy(
  attempt: ReopeningFiles,
  commands: {
    readonly reopen: (input: {
      readonly environmentId: EnvironmentId;
      readonly input: LibraryReopenCopyRequest;
    }) => Promise<LibraryWorkingCopy>;
    readonly register: (input: {
      readonly requestId: string;
      readonly copy: LibraryWorkingCopy;
    }) => Promise<LibraryWorkingCopy>;
    readonly save: (attempt: ReopeningFiles) => void;
  },
) {
  const copy =
    attempt.copy ??
    (await commands.reopen({ environmentId: attempt.environmentId, input: attempt.input }));
  const matches = (restored: LibraryWorkingCopy) =>
    restored.id === attempt.input.workingCopyId &&
    restored.environmentId === attempt.environmentId &&
    restored.projectId === attempt.project.id &&
    restored.rootPath === attempt.rootPath &&
    restored.ownership === "managed" &&
    restored.state === "ready";
  if (!matches(copy))
    throw new Error("The restored files do not match this conversation's saved project files.");
  if (!attempt.copy) commands.save({ ...attempt, copy });
  const registered = await commands.register({ requestId: attempt.registerRequestId, copy });
  if (!matches(registered))
    throw new Error("The restored files were not registered for this conversation.");
  return registered;
}

const isLibraryError = Schema.is(LibraryError);

/** Local settings keep their precedence; the shared profile supplies defaults before computer settings. */
export function libraryConversationDefaults(input: {
  readonly settings: ServerSettings;
  readonly localProject: (LegacyProjectSettingsFields & { readonly id: ProjectId }) | null;
  readonly project: LibraryProject;
  readonly providers: readonly ServerProvider[];
  readonly selection?: ModelSelection | undefined;
  readonly runtimeMode?: RuntimeMode | undefined;
}) {
  const defaults = libraryLaunchDefaults({
    settings: input.settings,
    localProjectId: input.localProject?.id ?? null,
    localProject: input.localProject,
    projectDefaultSelection: input.project.profile?.defaultModelSelection,
    selection: input.selection,
    runtimeMode: input.runtimeMode,
  });
  const entries = applyProviderInstanceSettings(
    deriveProviderInstanceEntries(input.providers),
    input.settings,
    input.localProject?.id ?? null,
  );
  const providers = entries.map((entry) => ({ ...entry.snapshot, enabled: entry.enabled }));
  return {
    entries,
    providers,
    modelSelection: resolveDefaultProviderModelSelection(providers, defaults.modelSelection),
    runtimeMode: defaults.runtimeMode,
  };
}

/** Persist an empty upstream thread, bind verified files, and register history before its first send. */
export function useLibraryConversationSetup({
  open = true,
  embedded = false,
  project,
  copies,
  copiesQuery,
  initialHostId,
  initialCopyId,
  initialResourceId,
  initialResourceIds,
  initialModelSelection,
  initialRuntimeMode,
  initialInteractionMode,
  continuation,
  onChooseProject,
  onChanged,
  onClose,
}: {
  readonly open?: boolean;
  readonly embedded?: boolean;
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly copiesQuery: Pick<
    EnvironmentQueryView<readonly LibraryWorkingCopy[]>,
    "isPending" | "isSuccess" | "error" | "refresh"
  >;
  readonly initialHostId?: EnvironmentId | undefined;
  readonly initialCopyId?: string | undefined;
  readonly initialResourceId?: string | undefined;
  readonly initialResourceIds?: readonly string[] | undefined;
  readonly initialModelSelection?: ModelSelection | undefined;
  readonly initialRuntimeMode?: RuntimeMode | undefined;
  readonly initialInteractionMode?: ProviderInteractionMode | undefined;
  readonly continuation?: LibraryThreadSummary;
  readonly onChooseProject?: (() => void) | undefined;
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  const authority = useLibraryAuthority();
  const providersByEnvironment = useEnvironmentProviders();
  const clientSettings = useClientSettings();
  const navigate = useNavigate();
  const localProjects = useProjects();
  // A continuation holds its own attempt, so an unfinished one never turns every later start in
  // the project into its retry, replaying the archived conversation's title, context and link.
  // Ordinary starts keep the bare key their attempts are already saved under.
  const attemptScope = `${authority.authorityId}:${project.id}${continuation ? `:continue:${continuation.id}` : ""}`;
  const [attempt, saveAttempt] = useLibraryAttempt(
    `loom:library:conversation:${attemptScope}`,
    ConversationAttempt,
  );
  const [preparation, savePreparation] = useLibraryAttempt(
    `loom:library:launch-files:${attemptScope}`,
    PreparationAttempt,
  );
  const [reopening, saveReopening] = useLibraryAttempt(
    `loom:library:launch-reopen:${attemptScope}`,
    ReopeningAttempt,
  );
  const [restoring, saveRestoring] = useLibraryAttempt(
    `loom:library:launch-portable:${attemptScope}`,
    PortableLaunchAttempt,
  );
  const needsSourceReview =
    restoring?.sourceSnapshotRejected === true && !restoring.sourceSnapshot && !restoring.copy;
  const locked =
    attempt !== null || preparation !== null || reopening !== null || restoring !== null;
  const launchProject =
    attempt?.project ??
    restoring?.project ??
    reopening?.project ??
    preparation?.input.project ??
    project;
  // Null until the user picks a computer, so the ranked choice can follow data as it arrives.
  const [hostChoice, setHostId] = useState<EnvironmentId | null>(
    attempt?.environmentId ??
      restoring?.environmentId ??
      reopening?.environmentId ??
      preparation?.environmentId ??
      initialHostId ??
      null,
  );
  const [resourceId, setResourceId] = useState<string | null>(
    attempt?.binding.resourceIds.length === 1
      ? attempt.binding.resourceIds[0]!
      : reopening
        ? reopening.resourceIds.length === 1
          ? reopening.resourceIds[0]!
          : null
        : (preparation?.input.resourceIds?.[0] ??
          initialResourceId ??
          (continuation?.resourceIds.length === 1 ? continuation.resourceIds[0]! : null)),
  );
  const [scopeChanged, setScopeChanged] = useState(false);
  const launchResourceIds =
    attempt?.binding.resourceIds ??
    restoring?.resourceIds ??
    reopening?.resourceIds ??
    preparation?.input.resourceIds ??
    (!scopeChanged ? (initialResourceIds ?? continuation?.resourceIds) : undefined) ??
    (resourceId ? [resourceId] : []);
  const selectedScope = launchResourceIds.length ? launchResourceIds : null;
  const [title, setTitle] = useState(
    attempt?.title ??
      restoring?.launch?.title ??
      (continuation ? `Continue: ${continuation.title}` : ""),
  );
  const [contextInput, setContext] = useState<string | null>(
    attempt?.context ?? restoring?.launch?.context ?? null,
  );
  const source = useEnvironmentQuery(
    authority.authorityId && continuation
      ? projectLibrary.history({
          environmentId: authority.authorityId,
          input: { id: continuation.id, offset: 0, limit: 100 },
        })
      : null,
  );
  const context =
    attempt?.context ??
    contextInput ??
    (source.data ? libraryContinuationContext(source.data) : "");
  const [preparedCopy, setPreparedCopy] = useState<LibraryWorkingCopy | null>(null);
  const [copyId, setCopyId] = useState<string | null>(
    attempt?.binding.workingCopyId ?? initialCopyId ?? null,
  );
  const [sourceChoiceId, setSourceChoiceId] = useState<string | null>(null);
  const [keepChoice, setKeepChoice] = useState<boolean | null>(null);
  const [typedPath, setRootPath] = useState<string | null>(null);
  const [existingFolder, setExistingFolder] = useState<string | null>(null);
  const [localFolder, setLocalFolder] = useState<string | null>(null);
  // Seeded from a saved attempt so Start over keeps the permissions and mode it showed instead of
  // silently falling back to this computer's defaults.
  const [modelChoice, setModelChoice] = useState<ModelSelection | null>(
    attempt?.requestedModelSelection ??
      restoring?.launch?.requestedModelSelection ??
      initialModelSelection ??
      null,
  );
  const [runtimeChoice, setRuntimeChoice] = useState<RuntimeMode | null>(
    attempt?.requestedRuntimeMode ??
      restoring?.launch?.requestedRuntimeMode ??
      initialRuntimeMode ??
      null,
  );
  const [interactionChoice, setInteractionChoice] = useState<ProviderInteractionMode>(
    attempt?.interactionMode ??
      restoring?.launch?.interactionMode ??
      initialInteractionMode ??
      "default",
  );
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [reviewingFiles, setReviewingFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloneRepair, setCloneRepair] = useState<LibraryError["repair"]>(undefined);
  const copiesReadiness = libraryCopyReadiness(copiesQuery);
  const knownCopies = [
    ...copies.filter((entry) => entry.id !== preparedCopy?.id),
    ...(preparedCopy ? [preparedCopy] : []),
  ];
  const ranking = useLibraryLaunchRanking({
    project: launchProject,
    copies:
      copiesReadiness === "ready"
        ? knownCopies.filter(
            (entry) =>
              entry.ownership !== "managed" ||
              libraryLaunchCopyMatchesScope(launchProject, entry, resourceId, selectedScope),
          )
        : [],
    resourceId,
  });
  const otherComputer =
    continuation && ranking.preselected
      ? ranking.candidates.find(
          (candidate) =>
            candidate.kind !== "mini" &&
            candidate.online &&
            candidate.environmentId !== continuation.environmentId &&
            candidate.readiness !== "not-ready",
        )
      : null;
  // Continuing elsewhere starts with another computer, while an explicit choice stays put.
  const choice =
    copiesReadiness === "ready" && !(continuation && hostChoice === null && !otherComputer)
      ? libraryLaunchChoice({
          ranking,
          hostId: hostChoice ?? otherComputer?.environmentId ?? null,
          copyId,
        })
      : { hostId: hostChoice, candidate: null };
  const hostId =
    attempt?.environmentId ??
    restoring?.environmentId ??
    reopening?.environmentId ??
    preparation?.environmentId ??
    choice.hostId;
  const host = authority.environments.find((entry) => entry.environmentId === hostId);
  const candidates = ranking.candidates.flatMap((candidate) =>
    candidate.kind === "copy" && candidate.environmentId === hostId
      ? knownCopies.filter((entry) => entry.id === candidate.copyId)
      : [],
  );
  const chosen = choice.candidate;
  const offline = !authority.connected;
  const retainedEnvironmentId = offline ? hostId : authority.authorityId;
  const retained = useEnvironmentQuery(
    retainedEnvironmentId
      ? projectLibrary.copies({
          environmentId: retainedEnvironmentId,
          input: { projectId: project.id, includeReleased: true },
        })
      : null,
  );
  const latestCopies = new Map<string, LibraryWorkingCopy>();
  for (const entry of [...knownCopies, ...(retained.data ?? [])]) {
    const previous = latestCopies.get(entry.id);
    if (!previous || entry.updatedAt > previous.updatedAt) latestCopies.set(entry.id, entry);
  }
  if (preparedCopy) latestCopies.set(preparedCopy.id, preparedCopy);
  const allCopies = [...latestCopies.values()];
  const sourceWorkingCopyId = continuation?.workingCopyId ?? initialCopyId ?? null;
  const sourcePlan =
    localFolder && localFolder === typedPath
      ? { kind: "clone" as const }
      : continuation && !sourceWorkingCopyId
        ? {
            kind: "unavailable" as const,
            message:
              "This conversation has no saved project files. Review its original location before continuing.",
          }
        : hostId
          ? libraryPortableRecoveryPlan({
              project: launchProject,
              copies: allCopies,
              destinationEnvironmentId: hostId,
              resourceIds: selectedScope,
              sourceWorkingCopyId,
              sourceEnvironmentId: continuation?.environmentId ?? initialHostId ?? null,
              selectedSourceCopyId: null,
            })
          : { kind: "unavailable" as const, message: "Choose a computer before starting." };
  const filesPlan =
    sourceChoiceId && hostId && !localFolder
      ? libraryPortableRecoveryPlan({
          project: launchProject,
          copies: allCopies,
          destinationEnvironmentId: hostId,
          resourceIds: selectedScope,
          sourceWorkingCopyId,
          sourceEnvironmentId: continuation?.environmentId ?? initialHostId ?? null,
          selectedSourceCopyId: sourceChoiceId,
        })
      : sourcePlan;
  const copy =
    copiesReadiness !== "ready"
      ? null
      : attempt
        ? (allCopies.find((entry) => entry.id === attempt.binding.workingCopyId) ?? null)
        : (restoring?.copy ?? (filesPlan.kind === "local" ? filesPlan.copy : null));
  const checksHealth =
    copy?.state === "ready" &&
    supportsLoomFeature(host?.serverConfig?.environment.capabilities, LIBRARY_COPY_HEALTH_FEATURE);
  const copyHealth = useEnvironmentQuery(
    checksHealth
      ? projectLibrary.copyHealth({
          environmentId: copy.environmentId,
          input: { workingCopyId: copy.id },
        })
      : null,
  );
  // A failed check leaves these files' freshness unknown, which is worth reading before starting.
  const warning = attempt
    ? null
    : (libraryLaunchWarning(chosen, copy, resourceId) ??
      (checksHealth && copyHealth.error
        ? {
            message: `Could not check whether these files are up to date. ${copyHealth.error}`,
            pullPaths: null,
          }
        : null));
  const supportsReopen = supportsLoomFeature(
    host?.serverConfig?.environment.capabilities,
    LIBRARY_FILE_LIFECYCLE_FEATURE,
  );
  const plannedSource = filesPlan.kind === "recover" ? filesPlan.sourceCopy : null;
  const supportsPortable = supportsLoomFeature(
    host?.serverConfig?.environment.capabilities,
    "library-portable-recovery",
  );
  const suggestedPath = libraryLaunchRootPath({
    project: launchProject,
    resourceId,
    resourceIds: selectedScope,
    copyId: attempt?.binding.workingCopyId ?? copyId,
    allowReopen: supportsReopen,
    environmentId: hostId,
    newProjectsRoot: host?.serverConfig?.newProjectsRoot,
    copies: retained.data ?? knownCopies,
  });
  const rootPath =
    restoring?.rootPath ??
    preparation?.input.rootPath ??
    reopening?.rootPath ??
    (attempt ? copy?.rootPath : undefined) ??
    typedPath ??
    copy?.rootPath ??
    suggestedPath;
  const movingLocalCopy = copy !== null && rootPath.trim() !== copy.rootPath;
  const portableSource = plannedSource ?? (movingLocalCopy ? copy : null);
  const retainedCopy = libraryLaunchRetainedCopy({
    project: launchProject,
    environmentId: hostId,
    copies: (retained.data ?? knownCopies).filter((entry) => entry.rootPath === rootPath.trim()),
    resourceId,
    resourceIds: selectedScope,
    copyId: attempt?.binding.workingCopyId ?? copyId,
    allowReopen: supportsReopen,
  });
  const filesPolicy = movingLocalCopy ? null : (copy ?? retainedCopy);
  const keepOnComputer =
    attempt?.keepOnComputer ??
    restoring?.keepOnComputer ??
    reopening?.keepOnComputer ??
    preparation?.keepOnComputer ??
    keepChoice ??
    (movingLocalCopy ? false : filesPolicy ? filesPolicy.keepOnComputer !== false : false);
  const needsReopen =
    reopening !== null ||
    (!movingLocalCopy &&
      copy?.state !== "ready" &&
      retainedCopy?.state === "released" &&
      (copy?.id === retainedCopy.id ||
        portableSource?.id === retainedCopy.id ||
        (!supportsPortable &&
          filesPlan.kind !== "choose" &&
          !plannedSource &&
          (!sourceWorkingCopyId || sourceWorkingCopyId === retainedCopy.id))));
  const needsPortable = restoring !== null || (portableSource !== null && !needsReopen);
  const snapshotSource = restoring?.sourceCopy ?? portableSource;
  const sourceHost = authority.environments.find(
    (entry) => entry.environmentId === snapshotSource?.environmentId,
  );
  const sourceCanSnapshot =
    snapshotSource?.state !== "ready" ||
    restoring?.sourceSnapshot !== undefined ||
    (restoring?.copy !== null && restoring?.copy !== undefined) ||
    (sourceHost?.entry.enabled === true &&
      sourceHost.connection.phase === "connected" &&
      supportsLoomFeature(
        sourceHost.serverConfig?.environment.capabilities,
        "library-portable-recovery",
      ));
  const localProjectId = resourceId
    ? copy?.repositories.find((repository) => repository.resourceId === resourceId)?.localProjectId
    : copy?.rootLocalProjectId;
  const localProject =
    localProjects.find((entry) => entry.environmentId === hostId && entry.id === localProjectId) ??
    null;
  const defaults = host?.serverConfig
    ? libraryConversationDefaults({
        settings: host.serverConfig.settings,
        localProject,
        project,
        providers: providersByEnvironment.get(host.environmentId) ?? [],
        ...(modelChoice ? { selection: modelChoice } : {}),
        ...(runtimeChoice ? { runtimeMode: runtimeChoice } : {}),
      })
    : null;
  const modelSelection =
    attempt?.modelSelection ??
    restoring?.launch?.modelSelection ??
    defaults?.modelSelection ??
    null;
  const runtimeMode =
    attempt?.runtimeMode ??
    restoring?.launch?.runtimeMode ??
    runtimeChoice ??
    defaults?.runtimeMode ??
    "approval-required";
  const interactionMode = attempt?.interactionMode ?? interactionChoice;
  const providerEntry = defaults?.entries.find(
    (entry) => entry.instanceId === modelSelection?.instanceId,
  );
  const pull = useAtomCommand(vcsEnvironment.pull, { reportFailure: false });
  const canPull = useLibraryPermission(vcsEnvironment.pull, hostId);
  const resolve = useAtomQueryRunner(projectLibrary.resolveBinding, {
    refresh: true,
    reportFailure: false,
  });
  const snapshot = useAtomQueryRunner(projectLibrary.snapshotThread, {
    refresh: true,
    reportFailure: false,
  });
  const create = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });
  const bind = useAtomCommand(projectLibrary.bindThread, { reportFailure: false });
  const executeOperation = useAtomCommand(projectLibrary.executeOperation, {
    reportFailure: false,
  });
  const prepareCopy = useAtomCommand(projectLibrary.prepareCopy, { reportFailure: false });
  const reopenCopy = useAtomCommand(projectLibrary.reopenCopy, { reportFailure: false });
  const readCopyStatus = useAtomCommand(projectLibrary.readCopyStatus, { reportFailure: false });
  const snapshotCopy = useAtomCommand(projectLibrary.snapshotCopy, { reportFailure: false });
  const authorizeRecovery = useAtomCommand(projectLibrary.authorizeRecovery, {
    reportFailure: false,
  });
  const restoreCopy = useAtomCommand(projectLibrary.restoreCopy, { reportFailure: false });
  const setRetention = useAtomCommand(projectLibrary.setCopyRetention, { reportFailure: false });
  const registerCopy = useAtomCommand(projectLibrary.registerCopy, { reportFailure: false });
  const register = useAtomCommand(projectLibrary.registerThread, { reportFailure: false });
  const inspect = useAtomCommand(projectLibrary.inspectFolder, { reportFailure: false });
  const recoverPreparation = useAtomQueryRunner(projectLibrary.preparation, {
    refresh: true,
    reportFailure: false,
  });
  const canPrepare = useLibraryPermission(projectLibrary.prepareCopy, hostId);
  const canReopen = useLibraryPermission(projectLibrary.reopenCopy, hostId);
  const canReadSource = useLibraryPermission(
    projectLibrary.readCopyStatus,
    snapshotSource?.environmentId ?? null,
  );
  const canSnapshotSource = useLibraryPermission(
    projectLibrary.snapshotCopy,
    snapshotSource?.environmentId ?? null,
  );
  const canAuthorizeRecovery = useLibraryPermission(
    projectLibrary.authorizeRecovery,
    authority.authorityId,
  );
  const canRestoreCopy = useLibraryPermission(projectLibrary.restoreCopy, hostId);
  const canSetRetention = useLibraryPermission(projectLibrary.setCopyRetention, hostId);
  const canInspect = useLibraryPermission(projectLibrary.inspectFolder, hostId);
  const canRegisterCopy = useLibraryPermission(projectLibrary.registerCopy, authority.authorityId);
  const allowed = useLibraryPermission(projectLibrary.bindThread, hostId);
  const canExecuteOperation = useLibraryPermission(projectLibrary.executeOperation, hostId);
  const canRegister = useLibraryPermission(projectLibrary.registerThread, authority.authorityId);
  const supportsOperations = supportsLoomFeature(
    host?.serverConfig?.environment.capabilities,
    "project-workflows",
  );
  const offlineReady =
    offline &&
    supportsOperations &&
    copy?.state === "ready" &&
    copy.registered !== false &&
    !movingLocalCopy &&
    !needsPortable &&
    !needsReopen &&
    preparation === null &&
    restoring === null &&
    reopening === null &&
    continuation === undefined &&
    (copy.ownership === "borrowed" || (copy.keepOnComputer !== false) === keepOnComputer);

  // `busy` is a render-time copy, so two calls before the next render, such as an automatic start
  // and an Enter on the same row, would both pass it and each create a conversation.
  const submitting = useRef(false);
  const submit = async () => {
    const authorityId = authority.authorityId;
    if (
      !authorityId ||
      !hostId ||
      !modelSelection ||
      busy ||
      submitting.current ||
      copiesReadiness !== "ready" ||
      (offline && !offlineReady)
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    let submittedPreparation = preparation;
    const launch = async () => {
      let launchCopy = copy ?? (retainedCopy?.state === "ready" ? retainedCopy : null);
      let pendingPreparation = preparation;
      if (!locked && filesPlan.kind === "choose")
        throw new Error("Choose which project files to use before starting.");
      if (!locked && filesPlan.kind === "unavailable" && !needsReopen)
        throw new Error(filesPlan.message);
      if (needsPortable) {
        if (!supportsPortable || !canRestoreCopy || !canAuthorizeRecovery || !canRegisterCopy)
          throw new Error(
            "This computer cannot restore saved project files with your current access.",
          );
        if (
          !sourceCanSnapshot ||
          (snapshotSource?.state === "ready" &&
            !restoring?.copy &&
            !restoring?.sourceSnapshot &&
            (!canReadSource || !canSnapshotSource))
        )
          throw new Error(
            "Connect the source computer to save its latest files before starting here.",
          );
        const files =
          restoring ??
          (portableSource
            ? {
                environmentId: hostId,
                project: launchProject,
                rootPath: rootPath.trim(),
                resourceIds: launchResourceIds,
                sourceCopy: portableSource,
                requestId: randomUUID(),
                registerRequestId: randomUUID(),
                snapshotRequestId: randomUUID(),
                copy: null,
                keepOnComputer,
                launch: {
                  title: title.trim() || UNTITLED_CONVERSATION,
                  context,
                  modelSelection,
                  runtimeMode,
                  interactionMode,
                  ...(modelChoice ? { requestedModelSelection: modelChoice } : {}),
                  ...(runtimeChoice ? { requestedRuntimeMode: runtimeChoice } : {}),
                  ...(continuation
                    ? {
                        continuationOf: {
                          environmentId: continuation.environmentId,
                          threadId: continuation.threadId,
                          sequence: continuation.sequence,
                        },
                      }
                    : {}),
                },
              }
            : null);
        if (!files)
          throw new Error(
            "The selected saved files are unavailable. Reload the project and retry.",
          );
        if (!restoring) {
          const occupied = allCopies.some(
            (entry) =>
              entry.environmentId === hostId &&
              libraryLaunchPathOverlaps(entry.rootPath, files.rootPath),
          );
          if (occupied)
            throw new Error(
              "Choose a separate folder. Existing project files stay in their current location.",
            );
          const inspected = await inspect({
            environmentId: hostId,
            input: { rootPath: files.rootPath },
          });
          if (inspected._tag === "Failure") throw squashAtomCommandFailure(inspected);
          if (inspected.value.exists) {
            setExistingFolder(files.rootPath);
            return;
          }
        }
        saveRestoring(files);
        launchCopy = await restoreLibraryLaunchCopy(files, {
          readStatus: async (input) => {
            const result = await readCopyStatus(input);
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            return result.value;
          },
          snapshot: async (input) => {
            const result = await snapshotCopy(input);
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            return result.value;
          },
          authorize: async (input) => {
            const result = await authorizeRecovery({ environmentId: authorityId, input });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            return result.value;
          },
          restore: async (input) => {
            const result = await restoreCopy(input);
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            return result.value;
          },
          register: async (input) => {
            const result = await registerCopy({ environmentId: authorityId, input });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            return result.value;
          },
          save: saveRestoring,
        });
        setPreparedCopy(launchCopy);
        setCopyId(launchCopy.id);
        setHostId(files.environmentId);
        pendingPreparation = null;
        submittedPreparation = null;
        savePreparation(null);
        onChanged();
      }
      if (needsReopen) {
        if (!supportsReopen || !canReopen || !canRegisterCopy)
          throw new Error(
            "This computer cannot reopen saved project files with your current access.",
          );
        const files =
          reopening ??
          (retainedCopy
            ? {
                environmentId: hostId,
                input: { requestId: randomUUID(), workingCopyId: retainedCopy.id },
                project: launchProject,
                resourceIds: launchResourceIds,
                rootPath: retainedCopy.rootPath,
                registerRequestId: randomUUID(),
                copy: null,
                keepOnComputer,
                savedAt: new Date().toISOString(),
              }
            : null);
        if (!files)
          throw new Error(
            "The saved project files are unavailable. Reconnect this computer and retry.",
          );
        saveReopening(files);
        launchCopy = await reopenLibraryLaunchCopy(files, {
          reopen: async (input) => {
            const result = await reopenCopy(input);
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            return result.value;
          },
          register: async (input) => {
            const result = await registerCopy({ environmentId: authorityId, input });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            return result.value;
          },
          save: saveReopening,
        });
        setPreparedCopy(launchCopy);
        setCopyId(launchCopy.id);
        setHostId(files.environmentId);
        pendingPreparation = null;
        submittedPreparation = null;
        savePreparation(null);
        onChanged();
      }
      if (pendingPreparation || !launchCopy || launchCopy.state !== "ready") {
        let files = pendingPreparation;
        if (
          (retained.data ?? knownCopies).some(
            (entry) =>
              entry.environmentId === hostId &&
              entry.ownership === "managed" &&
              entry.id !== files?.copy?.id &&
              libraryLaunchPathOverlaps(entry.rootPath, files?.input.rootPath ?? rootPath.trim()),
          )
        )
          throw new LibraryError({
            reason: "invalid",
            cause:
              "Choose a separate folder for this project layout. Existing project files must be reopened from their saved version.",
          });
        if (!files) {
          if (attempt)
            throw new Error("Reopen this conversation's original project files before retrying.");
          const inspected = await inspect({
            environmentId: hostId,
            input: { rootPath: rootPath.trim() },
          });
          if (inspected._tag === "Failure") throw squashAtomCommandFailure(inspected);
          files = {
            environmentId: hostId,
            input: {
              requestId: randomUUID(),
              project: launchProject,
              rootPath: rootPath.trim(),
              strategy: inspected.value.exists ? ("reuse" as const) : ("clone" as const),
              ...(launchResourceIds.length ? { resourceIds: launchResourceIds } : {}),
            },
            registerRequestId: randomUUID(),
            copy: null,
            keepOnComputer,
            savedAt: new Date().toISOString(),
          };
          savePreparation(files);
        }
        submittedPreparation = files;
        if (!files.copy || files.copy.state !== "ready") {
          const prepared = await prepareCopy({
            environmentId: files.environmentId,
            input: files.input,
          });
          if (prepared._tag === "Failure") throw squashAtomCommandFailure(prepared);
          files = { ...files, copy: prepared.value };
          submittedPreparation = files;
          savePreparation(files);
        }
        if (files.copy?.state !== "ready")
          throw new Error("Project files are not ready. Retry preparation.");
        const savedCopy = await registerCopy({
          environmentId: authorityId,
          input: { requestId: files.registerRequestId, copy: files.copy },
        });
        if (savedCopy._tag === "Failure") throw squashAtomCommandFailure(savedCopy);
        launchCopy = savedCopy.value;
        if (attempt && launchCopy.id !== attempt.binding.workingCopyId)
          throw new Error(
            "These files do not match the pending conversation. Reopen its original files and retry.",
          );
        setPreparedCopy(launchCopy);
        setCopyId(launchCopy.id);
        setHostId(files.environmentId);
        onChanged();
      }
      if (!launchCopy)
        throw new Error("The project files are unavailable. Reopen the project and try again.");
      let next = attempt ?? {
        environmentId: hostId,
        project: launchProject,
        threadId: newThreadId(),
        binding: {
          projectId: launchProject.id,
          projectRevision: launchProject.revision,
          workingCopyId: launchCopy.id,
          environmentId: hostId,
          resourceIds: launchResourceIds,
          ...(continuation || restoring?.launch?.continuationOf
            ? {
                continuationOf: restoring?.launch?.continuationOf ?? {
                  environmentId: continuation!.environmentId,
                  threadId: continuation!.threadId,
                  sequence: continuation!.sequence,
                },
              }
            : {}),
        },
        title: title.trim() || UNTITLED_CONVERSATION,
        context,
        modelSelection,
        defaultsResolved: false,
        keepOnComputer:
          restoring?.keepOnComputer ??
          reopening?.keepOnComputer ??
          preparation?.keepOnComputer ??
          keepOnComputer,
        ...(modelChoice ? { requestedModelSelection: modelChoice } : {}),
        ...(runtimeChoice ? { requestedRuntimeMode: runtimeChoice } : {}),
        runtimeMode,
        interactionMode,
        createdAt: new Date().toISOString(),
        created: false,
        registerRequestId: randomUUID(),
      };
      saveAttempt(next);
      saveReopening(null);
      saveRestoring(null);
      savePreparation(null);
      submittedPreparation = null;
      if (launchCopy.ownership === "borrowed" && !next.created && !offline) {
        const prepared = await prepareCopy({
          environmentId: next.environmentId,
          input: {
            requestId: `${next.registerRequestId}:files`,
            project: next.project,
            rootPath: launchCopy.rootPath,
            strategy: "reuse",
            ...(next.binding.resourceIds.length ? { resourceIds: next.binding.resourceIds } : {}),
          },
        });
        if (prepared._tag === "Failure") throw squashAtomCommandFailure(prepared);
        if (prepared.value.id !== next.binding.workingCopyId)
          throw new Error("The prepared folder does not match this conversation's project files.");
        const savedCopy = await registerCopy({
          environmentId: authorityId,
          input: { requestId: `${next.registerRequestId}:copy`, copy: prepared.value },
        });
        if (savedCopy._tag === "Failure") throw squashAtomCommandFailure(savedCopy);
      }
      const resolved = await resolve({
        environmentId: next.environmentId,
        input: { binding: next.binding, project: next.project },
      });
      if (resolved._tag === "Failure") throw squashAtomCommandFailure(resolved);
      if (next.defaultsResolved === false && !next.created) {
        const resolvedProject = await waitForProject(
          scopeProjectRef(next.environmentId, resolved.value.localProjectId),
        );
        const config = appAtomRegistry.get(environmentServerConfigsAtom).get(next.environmentId);
        if (!config) throw new Error("Reconnect this computer to load project settings.");
        const resolvedDefaults = libraryConversationDefaults({
          settings: config.settings,
          localProject: resolvedProject,
          project: next.project,
          providers:
            appAtomRegistry.get(serverEnvironment.providersValueAtom(next.environmentId)) ?? [],
          ...(next.requestedModelSelection ? { selection: next.requestedModelSelection } : {}),
          ...(next.requestedRuntimeMode ? { runtimeMode: next.requestedRuntimeMode } : {}),
        });
        if (!resolvedDefaults.modelSelection)
          throw new Error("Enable a provider on this computer before starting a conversation.");
        if (
          next.requestedModelSelection &&
          resolvedDefaults.modelSelection.instanceId !== next.requestedModelSelection.instanceId
        )
          throw new Error(
            "The selected provider is no longer available for this project. Enable it and retry.",
          );
        next = {
          ...next,
          modelSelection: resolvedDefaults.modelSelection,
          runtimeMode: next.requestedRuntimeMode ?? resolvedDefaults.runtimeMode,
          defaultsResolved: true,
        };
        saveAttempt(next);
      }
      const durableLaunch = supportsLoomFeature(
        host?.serverConfig?.environment.capabilities,
        "project-workflows",
      );
      if (durableLaunch) {
        const launched = await executeOperation({
          environmentId: next.environmentId,
          input: {
            operationId: `${next.registerRequestId}:launch`,
            request: {
              kind: "launch",
              input: {
                project: next.project,
                binding: next.binding,
                threadId: next.threadId,
                title: next.title,
                modelSelection: next.modelSelection,
                runtimeMode: next.runtimeMode,
                interactionMode: next.interactionMode ?? "default",
                ...(!offline &&
                launchCopy.ownership === "managed" &&
                next.keepOnComputer !== undefined
                  ? { keepOnComputer: next.keepOnComputer }
                  : {}),
              },
            },
          },
        });
        if (launched._tag === "Failure") throw squashAtomCommandFailure(launched);
      } else {
        if (!next.created) {
          const created = await create({
            environmentId: next.environmentId,
            input: {
              threadId: next.threadId,
              projectId: resolved.value.localProjectId,
              title: next.title,
              modelSelection: next.modelSelection,
              runtimeMode: next.runtimeMode,
              interactionMode: next.interactionMode ?? "default",
              branch: null,
              worktreePath: resolved.value.cwd,
              createdAt: next.createdAt,
            },
          });
          // A lost create response may leave the same empty thread upstream. Binding that ID is recoverable.
          if (created._tag === "Failure") {
            const recovery = await bind({
              environmentId: next.environmentId,
              input: { threadId: next.threadId, binding: next.binding, project: next.project },
            });
            if (recovery._tag === "Failure") throw squashAtomCommandFailure(created);
          }
          next = { ...next, created: true };
          saveAttempt(next);
        }
        const bound = await bind({
          environmentId: next.environmentId,
          input: { threadId: next.threadId, binding: next.binding, project: next.project },
        });
        if (bound._tag === "Failure") throw squashAtomCommandFailure(bound);
        // Binding protects restored temporary files before cleanup becomes eligible again.
        if (
          launchCopy.ownership === "managed" &&
          next.keepOnComputer !== undefined &&
          (next.retentionCopy || (launchCopy.keepOnComputer !== false) !== next.keepOnComputer)
        ) {
          if (!next.retentionCopy) {
            const updated = await setRetention({
              environmentId: next.environmentId,
              input: {
                workingCopyId: next.binding.workingCopyId,
                keepOnComputer: next.keepOnComputer,
              },
            });
            if (updated._tag === "Failure") throw squashAtomCommandFailure(updated);
            next = { ...next, retentionCopy: updated.value };
            saveAttempt(next);
          }
          const published = await registerCopy({
            environmentId: authorityId,
            input: { requestId: `${next.registerRequestId}:retention`, copy: next.retentionCopy! },
          });
          if (published._tag === "Failure") throw squashAtomCommandFailure(published);
        }
        const archived = await snapshot({
          environmentId: next.environmentId,
          input: { threadId: next.threadId },
        });
        if (archived._tag === "Failure") throw squashAtomCommandFailure(archived);
        const saved = await register({
          environmentId: authorityId,
          input: { requestId: next.registerRequestId, thread: archived.value },
        });
        if (saved._tag === "Failure") throw squashAtomCommandFailure(saved);
      }
      if (next.context.trim())
        useComposerDraftStore
          .getState()
          .setPrompt(scopeThreadRef(next.environmentId, next.threadId), next.context);
      saveAttempt(null);
      onChanged();
      onClose();
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: next.environmentId, threadId: next.threadId },
      });
    };
    try {
      await launch();
    } catch (cause) {
      setCloneRepair(isLibraryError(cause) ? cause.repair : undefined);
      if (submittedPreparation) {
        const receipt = await recoverPreparation({
          environmentId: submittedPreparation.environmentId,
          input: { requestId: submittedPreparation.input.requestId },
        });
        if (receipt._tag === "Success") {
          if (receipt.value) savePreparation({ ...submittedPreparation, copy: receipt.value });
          else if (
            isLibraryError(cause) &&
            ["invalid", "not-found", "blocked", "request-conflict"].includes(cause.reason)
          )
            savePreparation(null);
        }
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the conversation. Retry the same request.",
      );
    }
    submitting.current = false;
    setBusy(false);
  };
  /** Fast-forward the stale repositories, then launch on the refreshed copy. */
  const pullThenSubmit = async (paths: readonly string[]) => {
    if (!hostId) return;
    setPulling(true);
    setError(null);
    for (const cwd of paths) {
      const result = await pull({ environmentId: hostId, input: { cwd } });
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not pull the latest changes.");
        setPulling(false);
        copyHealth.refresh();
        return;
      }
    }
    setPulling(false);
    copyHealth.refresh();
    await submit();
  };
  const reviewFiles = async () => {
    if (!authority.authorityId || !preparation?.copy) return;
    setBusy(true);
    const saved = await registerCopy({
      environmentId: authority.authorityId,
      input: {
        requestId: `${preparation.registerRequestId}:failed:${preparation.copy.updatedAt}`,
        copy: preparation.copy,
      },
    });
    if (saved._tag === "Failure") {
      const cause = squashAtomCommandFailure(saved);
      setError(cause instanceof Error ? cause.message : "Could not load these files for review.");
    } else setReviewingFiles(true);
    setBusy(false);
  };
  const connected = host?.connection.phase === "connected" && host.entry.enabled;
  const canContinue =
    !needsSourceReview &&
    !busy &&
    !pulling &&
    existingFolder === null &&
    (!movingLocalCopy || rootPath.trim().length > 0) &&
    copiesReadiness === "ready" &&
    (offline
      ? offlineReady
      : needsPortable
        ? supportsPortable &&
          canRestoreCopy &&
          canAuthorizeRecovery &&
          canRegisterCopy &&
          canInspect &&
          rootPath.trim().length > 0 &&
          sourceCanSnapshot &&
          (snapshotSource?.state !== "ready" ||
            restoring?.sourceSnapshot !== undefined ||
            restoring?.copy != null ||
            (canReadSource && canSnapshotSource))
        : needsReopen
          ? supportsReopen &&
            canReopen &&
            canRegisterCopy &&
            libraryCopyReadiness(retained) === "ready"
          : (copy?.state === "ready" &&
              (copy.ownership === "managed" || (canPrepare && canRegisterCopy))) ||
            (canPrepare &&
              canInspect &&
              canRegisterCopy &&
              rootPath.trim().length > 0 &&
              libraryCopyReadiness(retained) === "ready")) &&
    (locked || needsReopen || (filesPlan.kind !== "choose" && filesPlan.kind !== "unavailable")) &&
    supportsLoomFeature(host?.serverConfig?.environment.capabilities, "project-library") &&
    allowed &&
    (offline ? offlineReady : canRegister) &&
    (!(
      supportsReopen &&
      filesPolicy?.ownership !== "borrowed" &&
      (needsPortable ||
        needsReopen ||
        (filesPolicy && (filesPolicy.keepOnComputer !== false) !== keepOnComputer))
    ) ||
      (canSetRetention && canRegisterCopy)) &&
    (continuation === undefined || (source.isSuccess && !source.isPending)) &&
    connected;
  const operationProgress = useEnvironmentQuery(
    busy && hostId && supportsOperations
      ? projectLibrary.operations({ environmentId: hostId, input: { projectId: project.id } })
      : null,
  );
  const operationPhase = operationProgress.data?.find(
    (operation) => operation.id === `${attempt?.registerRequestId}:launch`,
  )?.phase;
  const canCreate =
    canContinue && modelSelection !== null && (!supportsOperations || canExecuteOperation);
  // Only live connections deliver these; a disconnected computer's query waits without failing.
  const checking =
    connected &&
    (copiesReadiness === "loading" ||
      libraryCopyReadiness(retained) === "loading" ||
      (checksHealth && libraryCopyReadiness(copyHealth) === "loading"));
  const rankOf = (environmentId: EnvironmentId) => {
    const index = ranking.candidates.findIndex(
      (candidate) => candidate.environmentId === environmentId,
    );
    return index === -1 ? ranking.candidates.length : index;
  };
  const executionHosts = authority.environments
    .filter(
      (entry) =>
        entry.serverConfig?.environment.capabilities.supportsExecution !== false &&
        supportsLoomFeature(entry.serverConfig?.environment.capabilities, "project-library"),
    )
    .toSorted((left, right) => rankOf(left.environmentId) - rankOf(right.environmentId));
  /** Why a computer ranks low and is never preselected, for example "Xcode missing". */
  const toolProblemsOf = (environmentId: EnvironmentId) =>
    ranking.candidates
      .find((candidate) => candidate.environmentId === environmentId && candidate.kind !== "mini")
      ?.toolProblems.join(", ") ?? "";
  // A connection already on its way back needs no action, so it is not asked for.
  const reconnecting = (phase: string | undefined) =>
    phase === "connecting" || phase === "reconnecting";
  const blocker =
    offline && !offlineReady
      ? reconnecting(authority.environment?.connection.phase)
        ? "Connecting to your Library..."
        : "Reconnect the Library to prepare files or change retention. Offline starts need a ready registered copy."
      : !hostId
        ? "Choose a computer to run this conversation."
        : host?.connection.phase !== "connected"
          ? reconnecting(host?.connection.phase)
            ? `Connecting to ${host?.label ?? "the selected computer"}...`
            : "Reconnect the selected computer before starting."
          : copiesReadiness === "loading"
            ? "Loading project files..."
            : copiesReadiness === "error"
              ? (copiesQuery.error ?? "Could not load project files.")
              : !modelSelection
                ? "Enable an authenticated provider on this computer."
                : filesPlan.kind === "choose"
                  ? filesPlan.reason
                  : filesPlan.kind === "unavailable" && !needsReopen
                    ? filesPlan.message
                    : needsPortable && !supportsPortable
                      ? "Update this computer to restore saved project files."
                      : needsPortable && !sourceCanSnapshot
                        ? "Connect the source computer to save its latest files."
                        : toolProblemsOf(hostId) ||
                          (!canCreate && !busy && !existingFolder
                            ? "Review the selected computer, files and connection permissions."
                            : null);
  // Names what Retry replays. An attempt held before the conversation step saved no title, so it
  // uses the one shown, which cannot change until Start over.
  const heldTitle = attempt?.title ?? (title.trim() || UNTITLED_CONVERSATION);
  return {
    project,
    offlineNotice: offlineReady
      ? "Library offline; starting from this computer's copy. This conversation syncs when it reconnects."
      : null,
    operationPhase,
    open,
    embedded,
    onClose,
    onChooseProject,
    title,
    setTitle,
    context,
    setContext,
    continuation,
    hostId,
    hostLabel: host?.label,
    executionHosts,
    computers: authority.computers,
    selectHost: (value: EnvironmentId) => {
      if (value === hostId) return;
      setHostId(value);
      setCopyId(null);
      setSourceChoiceId(null);
      setExistingFolder(null);
      setLocalFolder(null);
      setRootPath(null);
      setModelChoice(null);
      setRuntimeChoice(null);
      setInteractionChoice("default");
      setKeepChoice(null);
    },
    scope: launchResourceIds,
    selectScope: (value: string | null) => {
      if (
        value === null
          ? launchResourceIds.length === 0
          : launchResourceIds.length === 1 && launchResourceIds[0] === value
      )
        return;
      setScopeChanged(true);
      setResourceId(value);
      setCopyId(null);
      setSourceChoiceId(null);
      setExistingFolder(null);
      setLocalFolder(null);
      setRootPath(null);
      setKeepChoice(null);
    },
    modelSelection,
    entries: defaults?.entries ?? [],
    modelOptionsByInstance:
      host?.serverConfig && defaults
        ? getCustomModelOptionsByInstance(
            mergeEnvironmentSettings(host.serverConfig.settings, clientSettings),
            defaults.providers,
            modelSelection?.instanceId,
            modelSelection?.model,
          )
        : new Map<ProviderInstanceId, readonly ModelEsque[]>(),
    providerEntry,
    setModelChoice,
    runtimeMode,
    setRuntimeChoice,
    interactionMode,
    setInteractionChoice,
    rootPath,
    setRootPath,
    copy,
    filesPlan,
    candidates,
    sourcePlan,
    selectCopy: (value: string) => {
      setCopyId(value);
      setSourceChoiceId(value);
      setExistingFolder(null);
      setLocalFolder(null);
      setRootPath(null);
      setKeepChoice(null);
    },
    selectFolder: (path: string) => {
      setRootPath(path);
      setLocalFolder(path);
      setExistingFolder(null);
    },
    chooseAnotherFolder: () => {
      setExistingFolder(null);
      setRootPath("");
    },
    existingFolder,
    keepOnComputer,
    setKeepChoice,
    canKeep:
      supportsReopen && filesPolicy?.ownership !== "borrowed" && canSetRetention && canRegisterCopy,
    needsReopen,
    needsPortable,
    locked,
    held: locked
      ? {
          title: heldTitle === UNTITLED_CONVERSATION ? null : heldTitle,
          savedAt: attempt?.createdAt ?? preparation?.savedAt ?? reopening?.savedAt ?? null,
        }
      : null,
    busy: busy || pulling,
    checking,
    canCreate,
    warning,
    canPull,
    pullThenSubmit,
    submit,
    error,
    cloneRepair: error && cloneRepair?.environmentId === hostId ? cloneRepair : null,
    blocker,
    refreshFiles: () => {
      copiesQuery.refresh();
      retained.refresh();
    },
    reviewLatest:
      restoring && needsSourceReview
        ? () => {
            saveRestoring({
              ...restoring,
              sourceReviewToken: undefined,
              sourceSnapshotRejected: undefined,
              snapshotRequestId: randomUUID(),
            });
            setError(null);
          }
        : null,
    // A saved attempt keeps retries on one operation, so a retry that keeps failing would
    // otherwise hold these settings for good, including after the dialog closes and reopens with
    // no error showing. The computer may still finish the abandoned request, so its files location
    // stays: the next start then finds those files instead of preparing a second set elsewhere.
    startOver:
      locked && !busy && !pulling
        ? () => {
            setRootPath(
              restoring?.rootPath ??
                preparation?.input.rootPath ??
                reopening?.rootPath ??
                typedPath,
            );
            saveAttempt(null);
            savePreparation(null);
            saveReopening(null);
            saveRestoring(null);
            setError(null);
            retained.refresh();
            onChanged();
          }
        : null,
    reviewFiles: preparation?.copy?.state === "failed" ? reviewFiles : null,
    review:
      reviewingFiles && preparation?.copy ? (
        <ReleaseCopyDialog
          copy={preparation.copy}
          onClose={() => setReviewingFiles(false)}
          onReleased={() => {
            savePreparation(null);
            setReviewingFiles(false);
            setPreparedCopy(null);
            onChanged();
          }}
        />
      ) : null,
  };
}

export function NewConversationDialog(props: Parameters<typeof useLibraryConversationSetup>[0]) {
  const setup = useLibraryConversationSetup(props);
  if (!setup.open) return null;
  if (setup.review) return setup.review;
  const content = <ConversationPalette setup={setup} />;
  return setup.embedded ? (
    content
  ) : (
    <LibraryPaletteDialog title="New conversation" onClose={setup.onClose}>
      {content}
    </LibraryPaletteDialog>
  );
}
