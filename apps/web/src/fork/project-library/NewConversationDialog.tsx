import { useState } from "react";
import {
  libraryContinuationContext,
  libraryCopyReadiness,
  libraryLaunchChoice,
  libraryPortableRecoveryPlan,
  libraryLaunchDefaults,
  libraryLaunchWarning,
  isRepositoryResource,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { libraryLaunchCandidateSummary } from "@t3tools/shared/fork/library-launch";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentProviders } from "~/state/environments";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  EnvironmentId,
  ModelSelection,
  RuntimeMode,
  ProviderInteractionMode,
  ThreadId,
  type ProjectId,
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
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
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
import { TraitsPicker } from "~/components/chat/TraitsPicker";
import { runtimeModeConfig, runtimeModeOptions } from "~/components/chat/runtimeModeConfig";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { mergeEnvironmentSettings, useClientSettings } from "~/hooks/useSettings";
import { newThreadId, randomUUID } from "~/lib/utils";
import { useLibraryAttempt } from "./attempts";
import { PortableLaunchAttempt, restoreLibraryLaunchCopy } from "./portableLaunch";
import { useComposerDraftStore } from "~/composerDraftStore";
import { projectLibrary, useLibraryAuthority, useLibraryPermission } from "./state";
import { LibraryDialog, LibraryField, LibraryErrorNotice } from "./LibraryControls";
import { ReleaseCopyDialog } from "./ReleaseCopyDialog";
import {
  LaunchGetCopy,
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
  }),
);
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
export function NewConversationDialog({
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
  const [attempt, saveAttempt] = useLibraryAttempt(
    `loom:library:conversation:${authority.authorityId}:${project.id}`,
    ConversationAttempt,
  );
  const [preparation, savePreparation] = useLibraryAttempt(
    `loom:library:launch-files:${authority.authorityId}:${project.id}`,
    PreparationAttempt,
  );
  const [reopening, saveReopening] = useLibraryAttempt(
    `loom:library:launch-reopen:${authority.authorityId}:${project.id}`,
    ReopeningAttempt,
  );
  const [restoring, saveRestoring] = useLibraryAttempt(
    `loom:library:launch-portable:${authority.authorityId}:${project.id}`,
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
  const [modelChoice, setModelChoice] = useState<ModelSelection | null>(
    restoring?.launch?.requestedModelSelection ?? initialModelSelection ?? null,
  );
  const [runtimeChoice, setRuntimeChoice] = useState<RuntimeMode | null>(
    restoring?.launch?.requestedRuntimeMode ?? initialRuntimeMode ?? null,
  );
  const [interactionChoice, setInteractionChoice] = useState<ProviderInteractionMode>(
    restoring?.launch?.interactionMode ?? initialInteractionMode ?? "default",
  );
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [reviewingFiles, setReviewingFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const retained = useEnvironmentQuery(
    authority.authorityId
      ? projectLibrary.copies({
          environmentId: authority.authorityId,
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
  const warning = attempt ? null : libraryLaunchWarning(chosen, copy, resourceId);
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
  const copyHealth = useEnvironmentQuery(
    copy &&
      supportsLoomFeature(host?.serverConfig?.environment.capabilities, LIBRARY_COPY_HEALTH_FEATURE)
      ? projectLibrary.copyHealth({
          environmentId: copy.environmentId,
          input: { workingCopyId: copy.id },
        })
      : null,
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
  const canRegister = useLibraryPermission(projectLibrary.registerThread, authority.authorityId);
  const submit = async () => {
    const authorityId = authority.authorityId;
    if (!authorityId || !hostId || !modelSelection || busy || copiesReadiness !== "ready") return;
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
                  title: title.trim() || "New project conversation",
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
        title: title.trim() || "New project conversation",
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
      if (launchCopy.ownership === "borrowed" && !next.created) {
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
  const canCreate =
    !needsSourceReview &&
    !busy &&
    !pulling &&
    existingFolder === null &&
    (!movingLocalCopy || rootPath.trim().length > 0) &&
    copiesReadiness === "ready" &&
    (needsPortable
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
    canRegister &&
    (!(
      supportsReopen &&
      filesPolicy?.ownership !== "borrowed" &&
      (needsPortable ||
        needsReopen ||
        (filesPolicy && (filesPolicy.keepOnComputer !== false) !== keepOnComputer))
    ) ||
      (canSetRetention && canRegisterCopy)) &&
    modelSelection !== null &&
    (continuation === undefined || (source.isSuccess && !source.isPending)) &&
    authority.connected &&
    host?.connection.phase === "connected" &&
    host.entry.enabled;
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
  const connectedExecutionHosts = executionHosts.filter(
    (entry) => entry.entry.enabled && entry.connection.phase === "connected",
  );
  const canChooseComputer =
    connectedExecutionHosts.length > 1 ||
    !connectedExecutionHosts.some((entry) => entry.environmentId === hostId);
  /** Why a computer ranks low and is never preselected, for example "Xcode missing". */
  const toolProblemsOf = (environmentId: EnvironmentId) =>
    ranking.candidates
      .find((candidate) => candidate.environmentId === environmentId && candidate.kind !== "mini")
      ?.toolProblems.join(", ") ?? "";
  // Mini runs long jobs for conversations on the computer it is registered on.
  const miniCandidates = ranking.candidates.filter(
    (candidate) => candidate.kind === "mini" && candidate.environmentId === hostId,
  );
  if (reviewingFiles && preparation?.copy)
    return (
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
    );
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={continuation ? "Continue elsewhere" : "New conversation"}
      description={
        continuation
          ? "Start a conversation with the context you choose. The original conversation keeps its computer and history."
          : "Start work in this project. Any files you need are prepared before the conversation opens."
      }
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {restoring && needsSourceReview ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                saveRestoring({
                  ...restoring,
                  sourceReviewToken: undefined,
                  sourceSnapshotRejected: undefined,
                  snapshotRequestId: randomUUID(),
                });
                setError(null);
              }}
            >
              Review latest source files
            </Button>
          ) : null}
          {restoring && !restoring.copy && !attempt && error ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setRootPath(restoring.rootPath);
                saveRestoring(null);
                setError(null);
                retained.refresh();
                onChanged();
              }}
            >
              Choose files again
            </Button>
          ) : null}
          {preparation?.copy?.state === "failed" ? (
            <Button
              variant="outline"
              disabled={busy || !canRegisterCopy || !authority.connected}
              onClick={() => void reviewFiles()}
            >
              Review files
            </Button>
          ) : null}
          <Button disabled={!canCreate} onClick={() => void submit()}>
            {busy ? "Starting..." : locked ? "Retry conversation" : "Start conversation"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <LibraryField label="Project">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium">{project.title}</span>
            {onChooseProject ? (
              <Button variant="ghost" size="xs" disabled={busy || locked} onClick={onChooseProject}>
                Change project
              </Button>
            ) : null}
          </div>
        </LibraryField>
        <LibraryField label="Conversation title">
          <Input
            value={title}
            disabled={busy || locked}
            onChange={(event) => setTitle(event.target.value)}
          />
        </LibraryField>
        <LibraryField label="Scope">
          <Select
            value={launchResourceIds.length > 1 ? "source-scope" : (resourceId ?? "whole")}
            disabled={busy || locked}
            onValueChange={(value) => {
              if (value === "source-scope") return;
              setScopeChanged(true);
              setResourceId(value === "whole" ? null : value);
              setCopyId(null);
              setSourceChoiceId(null);
              setExistingFolder(null);
              setLocalFolder(null);
              setRootPath(null);
              setKeepChoice(null);
            }}
            items={[
              { value: "whole", label: "Whole project" },
              ...(launchResourceIds.length > 1
                ? [{ value: "source-scope", label: "Original repositories" }]
                : []),
              ...project.resources
                .filter(isRepositoryResource)
                .map((resource) => ({ value: resource.id, label: resource.title })),
            ]}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="whole">Whole project</SelectItem>
              {launchResourceIds.length > 1 ? (
                <SelectItem value="source-scope">Original repositories</SelectItem>
              ) : null}
              {project.resources.filter(isRepositoryResource).map((resource) => (
                <SelectItem key={resource.id} value={resource.id}>
                  {resource.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LibraryField>
        <details className="text-sm" open={!chosen?.online || undefined}>
          <summary className="cursor-pointer text-muted-foreground">
            {host ? `On ${host.label}` : "Choose a computer"}
          </summary>
          <div className="mt-2 space-y-2">
            {canChooseComputer ? (
              <LibraryField label="Computer">
                <Select
                  value={hostId}
                  disabled={busy || locked}
                  onValueChange={(value) => {
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
                  }}
                  items={executionHosts.map((entry) => ({
                    value: entry.environmentId,
                    label: entry.label,
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a computer" />
                  </SelectTrigger>
                  <SelectPopup>
                    {executionHosts.map((entry) => (
                      <SelectItem key={entry.environmentId} value={entry.environmentId}>
                        {entry.label}
                        {entry.connection.phase !== "connected"
                          ? " (offline)"
                          : toolProblemsOf(entry.environmentId)
                            ? ` (${toolProblemsOf(entry.environmentId)})`
                            : ""}
                      </SelectItem>
                    ))}
                    {authority.computers
                      .filter(
                        (computer) =>
                          computer.supportsExecution &&
                          !authority.environments.some(
                            (entry) => entry.environmentId === computer.environmentId,
                          ),
                      )
                      .map((computer) => (
                        <SelectItem
                          key={computer.environmentId}
                          value={computer.environmentId}
                          disabled
                        >
                          {computer.label} (connect first)
                        </SelectItem>
                      ))}
                  </SelectPopup>
                </Select>
                {chosen && !attempt ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {libraryLaunchCandidateSummary(chosen).replace(
                      "no copy yet",
                      "files prepared when starting",
                    )}
                  </p>
                ) : null}
                {!attempt
                  ? miniCandidates.map((candidate) => (
                      <p
                        key={candidate.kind === "mini" ? candidate.workerId : candidate.label}
                        className="mt-1 text-xs text-muted-foreground"
                      >
                        {libraryLaunchCandidateSummary(candidate)}
                      </p>
                    ))
                  : null}
              </LibraryField>
            ) : chosen ? (
              <p className="text-xs text-muted-foreground">
                {libraryLaunchCandidateSummary(chosen).replace(
                  "no copy yet",
                  "files prepared when starting",
                )}
              </p>
            ) : null}
          </div>
        </details>
        {hostId && host?.serverConfig && modelSelection && defaults ? (
          <LibraryField label="Model">
            <div className="flex flex-wrap items-center gap-2">
              <ProviderModelPicker
                environmentId={hostId}
                activeInstanceId={modelSelection.instanceId}
                model={modelSelection.model}
                lockedProvider={null}
                instanceEntries={defaults.entries}
                modelOptionsByInstance={getCustomModelOptionsByInstance(
                  mergeEnvironmentSettings(host.serverConfig.settings, clientSettings),
                  defaults.providers,
                  modelSelection.instanceId,
                  modelSelection.model,
                )}
                disabled={busy || locked}
                onInstanceModelChange={(instanceId, model) => setModelChoice({ instanceId, model })}
              />
              {providerEntry ? (
                <TraitsPicker
                  provider={providerEntry.driverKind}
                  instanceId={modelSelection.instanceId}
                  models={providerEntry.models}
                  model={modelSelection.model}
                  modelOptions={modelSelection.options}
                  prompt=""
                  onPromptChange={() => {}}
                  allowPromptInjectedEffort={false}
                  planModeEnabled={interactionMode === "plan"}
                  isComposerOwned={false}
                  disabled={busy || locked}
                  onModelOptionsChange={(options) =>
                    setModelChoice({ ...modelSelection, options: options ?? [] })
                  }
                />
              ) : null}
            </div>
          </LibraryField>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <LibraryField label="Permissions">
            <Select
              value={runtimeMode}
              disabled={busy || locked}
              onValueChange={(value) => {
                if (value) setRuntimeChoice(value);
              }}
              items={runtimeModeOptions.map((mode) => ({
                value: mode,
                label: runtimeModeConfig[mode].label,
              }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {runtimeModeOptions.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {runtimeModeConfig[mode].label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </LibraryField>
          <LibraryField label="Mode">
            <Select
              value={interactionMode}
              disabled={busy || locked}
              onValueChange={(value) => {
                if (value) setInteractionChoice(value);
              }}
              items={[
                { value: "default", label: "Do the work" },
                { value: "plan", label: "Plan only" },
              ]}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="default">Do the work</SelectItem>
                <SelectItem value="plan">Plan only</SelectItem>
              </SelectPopup>
            </Select>
          </LibraryField>
        </div>
        {authority.computers.some(
          (computer) =>
            computer.supportsExecution &&
            !authority.environments.some((entry) => entry.environmentId === computer.environmentId),
        ) ? (
          <p className="text-sm text-muted-foreground">
            Your Library remembers other computers.{" "}
            <Link to="/settings/connections" className="underline underline-offset-4">
              Connect a computer
            </Link>{" "}
            to run work there. Saved conversations are available here.
          </p>
        ) : null}
        {!locked && sourcePlan.kind === "choose" ? (
          <LibraryField label="Files">
            <p className="mb-2 text-xs text-muted-foreground">{sourcePlan.reason}</p>
            <Select
              value={sourceChoiceId}
              disabled={busy}
              items={sourcePlan.candidates.map((entry) => ({
                value: entry.id,
                label: entry.rootPath,
              }))}
              onValueChange={(value) => {
                setSourceChoiceId(value);
                setExistingFolder(null);
                setLocalFolder(null);
                setCopyId(value);
                setRootPath(null);
                setKeepChoice(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose project files" />
              </SelectTrigger>
              <SelectPopup>
                {sourcePlan.candidates.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.rootPath} on{" "}
                    {authority.environments.find(
                      (host) => host.environmentId === entry.environmentId,
                    )?.label ??
                      authority.computers.find((host) => host.environmentId === entry.environmentId)
                        ?.label ??
                      entry.environmentId}
                    {entry.environmentId === hostId && entry.state === "ready"
                      ? " (on this computer)"
                      : " (saved files)"}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </LibraryField>
        ) : candidates.length > 1 && !sourceWorkingCopyId && !portableSource ? (
          <LibraryField label="Files location">
            <Select
              value={copy?.id ?? null}
              onValueChange={(value) => {
                setCopyId(value);
                setSourceChoiceId(value);
                setKeepChoice(null);
              }}
              disabled={busy || locked}
              items={candidates.map((entry) => ({ value: entry.id, label: entry.rootPath }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a folder" />
              </SelectTrigger>
              <SelectPopup>
                {candidates.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.rootPath}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </LibraryField>
        ) : null}
        {existingFolder ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-muted-foreground">
              {existingFolder} already has files. Choose which files to use.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRootPath(existingFolder);
                  setLocalFolder(existingFolder);
                  setExistingFolder(null);
                }}
              >
                Use files in this folder
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setExistingFolder(null);
                  setRootPath("");
                }}
              >
                Choose another folder
              </Button>
            </div>
          </div>
        ) : null}
        {hostId && !locked && filesPlan.kind === "unavailable" && !needsReopen ? (
          <p role="alert" className="text-sm text-muted-foreground">
            {filesPlan.message}
          </p>
        ) : null}
        {needsPortable && !supportsPortable ? (
          <p role="alert" className="text-sm text-muted-foreground">
            Update Loom on this computer to use these saved files here.
          </p>
        ) : null}
        {needsPortable && !sourceCanSnapshot ? (
          <p role="alert" className="text-sm text-muted-foreground">
            Connect the source computer to save its latest files before starting here.
          </p>
        ) : null}
        {copiesReadiness === "loading" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading project files...
          </p>
        ) : copiesReadiness === "error" ? (
          <LibraryErrorNotice
            error={copiesQuery.error ?? "Could not load project files."}
            onRetry={copiesQuery.refresh}
          />
        ) : copy?.state === "ready" && !needsPortable ? (
          <div className="space-y-2">
            <p className="break-words text-sm text-muted-foreground">
              Files on {host?.label}: {copy.rootPath}
            </p>
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer">Files location</summary>
              <div className="mt-2">
                <LibraryField label="Folder">
                  <Input
                    font="mono"
                    value={rootPath}
                    disabled={busy || locked}
                    onChange={(event) => setRootPath(event.target.value)}
                  />
                </LibraryField>
              </div>
            </details>
            {warning ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-warning-foreground">
                  {warning.message
                    .replace("This copy is", "These files are")
                    .replace("This copy has", "These files have")
                    .replace(" and has ", " and have ")
                    .replace("in this copy", "in this project")}
                </p>
                {warning.pullPaths && canPull ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canCreate}
                    onClick={() => void pullThenSubmit(warning.pullPaths ?? [])}
                  >
                    {pulling ? "Pulling..." : "Pull first"}
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!canCreate}
                  onClick={() => void submit()}
                >
                  Continue anyway
                </Button>
              </div>
            ) : null}
          </div>
        ) : hostId ? (
          <LaunchGetCopy
            environmentId={hostId}
            project={project}
            hostLabel={host?.label ?? "this computer"}
            temporary={supportsLoomFeature(
              host?.serverConfig?.environment.capabilities,
              LIBRARY_FILE_LIFECYCLE_FEATURE,
            )}
            rootPath={rootPath}
            disabled={busy || pulling || locked || host?.connection.phase !== "connected"}
            needsExistingFolder={
              !needsPortable &&
              project.resources.some(
                (resource) =>
                  isRepositoryResource(resource) &&
                  (!resourceId || resource.id === resourceId) &&
                  !resource.remoteUrl,
              )
            }
            onRootPathChange={(path) => {
              setRootPath(path);
              setExistingFolder(null);
            }}
          />
        ) : null}
        {supportsReopen && filesPolicy?.ownership !== "borrowed" ? (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Keep files on this computer
              <span className="mt-1 block text-xs text-muted-foreground">
                With Keep off, finished work can be cleaned up to free space.
              </span>
            </span>
            <Switch
              checked={keepOnComputer}
              onCheckedChange={setKeepChoice}
              disabled={busy || locked || !canSetRetention || !canRegisterCopy}
            />
          </label>
        ) : null}
        {copy?.state !== "ready" && retained.error ? (
          <LibraryErrorNotice error={retained.error} onRetry={retained.refresh} />
        ) : null}
        {copy?.state !== "ready" && retained.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">
            Checking saved files...
          </p>
        ) : null}
        {project.brief ? (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Shared project brief</summary>
            <p className="mt-2 whitespace-pre-wrap">{project.brief}</p>
          </details>
        ) : null}
        {continuation && !source.data ? (
          <LibraryErrorNotice
            error={source.error ?? "Loading recent saved context..."}
            onRetry={source.refresh}
          />
        ) : null}
        {continuation ? (
          <LibraryField label="Context to carry forward">
            <Textarea
              disabled={busy || locked}
              value={context}
              onChange={(event) => {
                setContext(event.target.value);
              }}
              placeholder="Summarize the decisions and next step to carry into the new conversation."
            />
          </LibraryField>
        ) : null}
        {hostId && !modelSelection ? (
          <p className="text-xs text-muted-foreground">
            Connect this computer and enable a provider before creating a conversation.
          </p>
        ) : null}
        {locked ? (
          <p className="text-xs text-muted-foreground">
            {needsSourceReview
              ? "Review the latest source files to continue this conversation."
              : "This conversation is waiting for confirmation. Retry to recover it without starting another one."}
          </p>
        ) : null}
        <LibraryErrorNotice error={error} />
      </div>
    </LibraryDialog>
  );
}
