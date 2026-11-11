import type { ModelEsque } from "~/components/chat/providerIconUtils";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { mergeEnvironmentSettings, useClientSettings } from "~/hooks/useSettings";
import { ConversationPalette, useConversationAutoStart } from "./ConversationPalette";
import { LibraryPaletteDialog } from "./LibraryPalette";
import { useEffect, useRef, useState } from "react";
import {
  libraryAccessRepairFromFailure,
  checkLibraryCopyRequest,
  checkedLibraryCopyRegistration,
  libraryContinuationContext,
  libraryCopyFolderConversations,
  libraryCopyReadiness,
  libraryLaunchCanUseWorktree,
  libraryLaunchChoice,
  libraryPortableRecoveryPlan,
  libraryLaunchDefaults,
  libraryLaunchWarning,
  libraryLaunchWorkspace,
  markLibraryConversationStarted,
  isRepositoryResource,
  LIBRARY_FOLDER_OCCUPIED_MESSAGE,
  LIBRARY_RESTORE_FOLDER_LINE,
  libraryFolderChoice,
  libraryPlacementLine,
  libraryPlacementManaged,
  libraryPlacementReuses,
  libraryPlacementStrategy,
  serverChoosesFolders,
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
  LIBRARY_DEFAULT_CONVERSATION_TITLE,
  isDefaultThreadTitle,
  LibraryLaunchWorkspace,
  LibraryThreadBinding,
  LibraryProject,
  LibraryPrepareCopyRequest,
  LibraryReopenCopyRequest,
  LibraryWorkingCopy,
  type LibraryFolderInspection,
  LibraryError,
  type LibraryOperation,
  type LibraryThreadSummary,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";

import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { threadEnvironment } from "~/state/threads";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  resolveSelectableProviderInstance,
} from "~/providerInstances";
import { type LegacyProjectSettingsFields } from "@t3tools/shared/projectSettings";
import { useProjects, useThreadShells, waitForProject } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentServerConfigsAtom, serverEnvironment } from "~/state/server";

import { newThreadId, randomUUID } from "~/lib/utils";
import { useLibraryAttempt } from "./attempts";
import {
  PortableLaunchAttempt,
  restoreLibraryLaunchCopy,
  type PortableLaunchFiles,
} from "./portableLaunch";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentSessionState } from "~/state/session";
import { useStableCallback } from "~/hooks/useStableCallback";
import { projectLibrary, useLibraryAuthority, useLibraryPermission } from "./state";

import { ReleaseCopyDialog } from "./ReleaseCopyDialog";
import { LibraryRestoreRequestDialog } from "./LibraryRestoreRequestDialog";
import {
  libraryLaunchCopyMatchesScope,
  libraryLaunchPathOverlaps,
  libraryLaunchRetainedCopy,
  libraryLaunchRootPath,
} from "./LaunchGetCopy";
import { useLibraryLaunchRanking } from "./useLibraryLaunchRanking";
import { vcsEnvironment } from "~/state/vcs";
import type { EnvironmentQueryView } from "~/state/query";

const LaunchActor = Schema.Struct({
  authorityId: Schema.optionalKey(EnvironmentId),
  initiator: Schema.optionalKey(Schema.Struct({ issuer: Schema.String, subject: Schema.String })),
  authorityInitiator: Schema.optionalKey(
    Schema.Struct({ issuer: Schema.String, subject: Schema.String }),
  ),
});
const ConversationAttempt = Schema.NullOr(
  Schema.Struct({
    ...LaunchActor.fields,
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
    launchOperationId: Schema.optional(Schema.String),
    launchState: Schema.optionalKey(Schema.Literals(["unknown", "ready"])),
    defaultsResolved: Schema.optional(Schema.Boolean),
    requestedModelSelection: Schema.optional(ModelSelection),
    keepOnComputer: Schema.optional(Schema.Boolean),
    retentionCopy: Schema.optional(LibraryWorkingCopy),
    workspace: Schema.optional(LibraryLaunchWorkspace),
    /** Files the launch reserves and fills after the conversation opens; a retry replays them. */
    files: Schema.optional(LibraryPrepareCopyRequest),
  }),
);

const PreparationAttempt = Schema.NullOr(
  Schema.Struct({
    ...LaunchActor.fields,
    state: Schema.optionalKey(Schema.Literals(["unknown", "ready"])),
    registration: Schema.optionalKey(Schema.Literals(["unknown", "ready", "succeeded"])),
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
    ...LaunchActor.fields,
    state: Schema.optionalKey(Schema.Literals(["unknown", "ready"])),
    registration: Schema.optionalKey(Schema.Literals(["unknown", "ready", "succeeded"])),
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
type ReopeningFiles = NonNullable<typeof ReopeningAttempt.Type>;

/** Keep the restored receipt across authority failures without restoring a second workspace. */
export async function reopenLibraryLaunchCopy(
  attempt: ReopeningFiles,
  commands: {
    readonly lookup?:
      | ((target: {
          environmentId: EnvironmentId;
          input: { requestId: string; kind: "reopen" };
        }) => Promise<LibraryOperation | null>)
      | undefined;
    readonly copies?: (() => Promise<readonly LibraryWorkingCopy[]>) | undefined;
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
  if (attempt.state === "unknown" && !attempt.copy) {
    if (!commands.lookup)
      throw new Error("Update this computer to check the original reopen request before retrying.");
    const result = await checkLibraryCopyRequest(
      {
        environmentId: attempt.environmentId,
        requestId: attempt.input.requestId,
        kind: "reopen",
        projectId: attempt.project.id,
        workingCopyId: attempt.input.workingCopyId,
        rootPath: attempt.rootPath,
      },
      (target) => commands.lookup!({ ...target, input: { ...target.input, kind: "reopen" } }),
    );
    commands.save({
      ...attempt,
      state: "ready",
      ...(result.copy ? { copy: result.copy, registration: "ready" } : {}),
    });
    throw new LibraryError({
      reason: "blocked",
      detail: "The saved reopen request has been checked. Continue explicitly when you are ready.",
      ...(result.accessRepair ? { accessRepair: result.accessRepair } : {}),
    });
  }
  if (!attempt.copy) commands.save({ ...attempt, state: "unknown" });
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
  if (!attempt.copy) commands.save({ ...attempt, copy, registration: "ready" });
  if (attempt.registration === "succeeded") return copy;
  if (attempt.registration === "unknown") {
    if (!commands.copies)
      throw new Error(
        "Reconnect the Library to check the saved file registration before retrying.",
      );
    const registered = checkedLibraryCopyRegistration(copy, await commands.copies());
    commands.save({ ...attempt, copy, registration: registered ? "succeeded" : "ready" });
    throw new Error(
      "The saved file registration has been checked. Continue explicitly when you are ready.",
    );
  }
  commands.save({ ...attempt, copy, registration: "unknown" });
  const registered = await commands.register({ requestId: attempt.registerRequestId, copy });
  if (!matches(registered))
    throw new Error("The restored files were not registered for this conversation.");
  commands.save({ ...attempt, copy: registered, registration: "succeeded" });
  return registered;
}

const isLibraryError = Schema.is(LibraryError);

/** The model new upstream drafts start with: the one last picked in any composer. */
export const selectLastUsedModel = (
  state: Pick<
    ReturnType<typeof useComposerDraftStore.getState>,
    "stickyActiveProvider" | "stickyModelSelectionByProvider"
  >,
): ModelSelection | null =>
  state.stickyActiveProvider === null
    ? null
    : (state.stickyModelSelectionByProvider[state.stickyActiveProvider] ?? null);

/**
 * Local settings keep their precedence; the shared profile supplies defaults before computer
 * settings. The last-used model counts only when this computer can run it, so a model picked
 * elsewhere never replaces this computer's default with a provider fallback.
 */
export function libraryConversationDefaults(input: {
  readonly settings: ServerSettings;
  readonly localProject: (LegacyProjectSettingsFields & { readonly id: ProjectId }) | null;
  readonly project: LibraryProject;
  readonly providers: readonly ServerProvider[];
  readonly selection?: ModelSelection | undefined;
  readonly lastUsedSelection?: ModelSelection | null | undefined;
  readonly runtimeMode?: RuntimeMode | undefined;
}) {
  const entries = applyProviderInstanceSettings(
    deriveProviderInstanceEntries(input.providers),
    input.settings,
    input.localProject?.id ?? null,
  );
  const providers = entries.map((entry) => ({ ...entry.snapshot, enabled: entry.enabled }));
  const lastUsed = input.lastUsedSelection;
  const defaults = libraryLaunchDefaults({
    settings: input.settings,
    localProjectId: input.localProject?.id ?? null,
    localProject: input.localProject,
    projectDefaultSelection: input.project.profile?.defaultModelSelection,
    selection: input.selection,
    lastUsedSelection:
      lastUsed &&
      resolveSelectableProviderInstance(providers, lastUsed.instanceId) === lastUsed.instanceId
        ? lastUsed
        : null,
    runtimeMode: input.runtimeMode,
  });
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
  const [pinnedAuthorityId, pinAuthority] = useState(authority.authorityId);
  if (!pinnedAuthorityId && authority.authorityId) pinAuthority(authority.authorityId);
  const authorityMatches =
    pinnedAuthorityId !== null && authority.authorityId === pinnedAuthorityId;
  const providersByEnvironment = useEnvironmentProviders();
  const clientSettings = useClientSettings();
  const navigate = useNavigate();
  const localProjects = useProjects();
  const lastUsedSelection = useComposerDraftStore(selectLastUsedModel);
  // A continuation holds its own attempt, so an unfinished one never turns every later start in
  // the project into its retry, replaying the archived conversation's title, context and link.
  // Ordinary starts keep the bare key their attempts are already saved under.
  const attemptScope = `${pinnedAuthorityId}:${project.id}${continuation ? `:continue:${continuation.id}` : ""}`;
  const [attempt, saveAttempt, conversationUnreadable] = useLibraryAttempt(
    `loom:library:conversation:${attemptScope}`,
    ConversationAttempt,
  );
  const [preparation, savePreparation, preparationUnreadable] = useLibraryAttempt(
    `loom:library:launch-files:${attemptScope}`,
    PreparationAttempt,
  );
  const [reopening, saveReopening, reopeningUnreadable] = useLibraryAttempt(
    `loom:library:launch-reopen:${attemptScope}`,
    ReopeningAttempt,
  );
  const [restoring, saveRestoring, restoringUnreadable] = useLibraryAttempt(
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
  const [workspaceChoice, setWorkspaceChoice] = useState<LibraryLaunchWorkspace | null>(
    attempt?.workspace ?? null,
  );
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
  const [restoreReview, setRestoreReview] = useState<LibraryOperation | null>(null);
  const [accessRepair, setAccessRepair] = useState<LibraryError["accessRepair"]>(undefined);
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
  const identity = useEnvironmentSessionState(hostId).data?.identity;
  const authorityIdentity = useEnvironmentSessionState(pinnedAuthorityId).data?.identity;
  const savedActor = attempt ?? preparation ?? reopening ?? restoring;
  const matchesActor = (actor: typeof LaunchActor.Type) =>
    (!actor.authorityId || actor.authorityId === pinnedAuthorityId) &&
    (!actor.initiator ||
      (actor.initiator.issuer === identity?.issuer &&
        actor.initiator.subject === identity?.subject)) &&
    (!actor.authorityInitiator ||
      (actor.authorityInitiator.issuer === authorityIdentity?.issuer &&
        actor.authorityInitiator.subject === authorityIdentity?.subject));
  const accountMatches = !savedActor || matchesActor(savedActor);
  const unreadable =
    conversationUnreadable || preparationUnreadable || reopeningUnreadable || restoringUnreadable;
  const mounted = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- guards the launch chain after the conversation form closes
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ensureCurrent = useStableCallback(
    (environmentId: EnvironmentId, actor: typeof LaunchActor.Type) => {
      if (
        !mounted.current ||
        !open ||
        !authorityMatches ||
        hostId !== environmentId ||
        !matchesActor(actor)
      )
        throw new Error(
          "Return to the original Library, computer and account before continuing this conversation request.",
        );
    },
  );

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
  const plannedSource = filesPlan.kind === "recover" ? filesPlan.sourceCopy : null;
  const supportsPortable = supportsLoomFeature(
    host?.serverConfig?.environment.capabilities,
    "library-portable-recovery",
  );
  // A computer that chooses folders previews where new files go; Start then sends no folder, so it
  // resolves and claims one itself. A failed preview still starts and lets the computer choose.
  const serverPlaces =
    serverChoosesFolders(host?.serverConfig) && !locked && typedPath === null && copy === null;
  // A restore needs a folder of its own, so the computer picks one rather than the start's preview.
  const serverRestores = serverPlaces && plannedSource !== null;
  const placement = useEnvironmentQuery(
    hostId && host?.connection.phase === "connected" && serverPlaces && !serverRestores
      ? projectLibrary.placement.resultAtom({
          environmentId: hostId,
          input: {
            projectId: launchProject.id,
            ...(launchResourceIds.length ? { resourceIds: launchResourceIds } : {}),
          },
        })
      : null,
  );
  const legacyPath = libraryLaunchRootPath({
    project: launchProject,
    resourceId,
    resourceIds: selectedScope,
    copyId: attempt?.binding.workingCopyId ?? copyId,
    allowReopen: true,
    environmentId: hostId,
    newProjectsRoot: host?.serverConfig?.newProjectsRoot,
    copies: retained.data ?? knownCopies,
  });
  const retainedRoot = libraryLaunchRetainedCopy({
    project: launchProject,
    environmentId: hostId,
    copies: retained.data ?? knownCopies,
    resourceId,
    resourceIds: selectedScope,
    copyId: attempt?.binding.workingCopyId ?? copyId,
    allowReopen: true,
  })?.rootPath;
  const suggestedPath = serverRestores
    ? (retainedRoot ?? "")
    : serverPlaces && placement.data
      ? (retainedRoot ?? placement.data.rootPath)
      : legacyPath;
  // The one place a start picks its files folder; every launch path reads it from here.
  const rootPath =
    attempt?.files?.rootPath ??
    (restoring ? (restoring.rootPath ?? restoring.copy?.rootPath ?? "") : undefined) ??
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
    allowReopen: true,
  });
  const filesPolicy = movingLocalCopy ? null : (copy ?? retainedCopy);
  const keepOnComputer =
    attempt?.keepOnComputer ??
    restoring?.keepOnComputer ??
    reopening?.keepOnComputer ??
    preparation?.keepOnComputer ??
    keepChoice ??
    (movingLocalCopy ? false : filesPolicy ? filesPolicy.keepOnComputer !== false : false);
  const shells = useThreadShells();
  // Files moved to a new folder leave the conversations working in the old one behind.
  const folderConversations = movingLocalCopy ? 0 : libraryCopyFolderConversations(shells, copy);
  const workspace = attempt
    ? (attempt.workspace ?? null)
    : libraryLaunchWorkspace({
        available: libraryLaunchCanUseWorktree(
          launchProject,
          launchResourceIds.length === 1 ? launchResourceIds[0]! : null,
        ),
        chosen: workspaceChoice,
        conversations: folderConversations,
      });
  // A failed check leaves these files' freshness unknown, which is worth reading before starting.
  const warning = attempt
    ? null
    : (libraryLaunchWarning(chosen, copy, resourceId, {
        conversations: folderConversations,
        workspace,
      }) ??
      (checksHealth && copyHealth.error
        ? {
            message: `Could not check whether these files are up to date. ${copyHealth.error}`,
            pullPaths: null,
          }
        : null));
  const needsReopen =
    preparation === null &&
    (reopening !== null ||
      (!movingLocalCopy &&
        copy?.state !== "ready" &&
        retainedCopy?.state === "released" &&
        (copy?.id === retainedCopy.id ||
          portableSource?.id === retainedCopy.id ||
          (!supportsPortable &&
            filesPlan.kind !== "choose" &&
            !plannedSource &&
            (!sourceWorkingCopyId || sourceWorkingCopyId === retainedCopy.id)))));
  const needsPortable =
    preparation === null && (restoring !== null || (portableSource !== null && !needsReopen));
  const restoreChoosesFolder =
    needsPortable && rootPath.trim() === "" && (restoring !== null || serverRestores);
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
        lastUsedSelection,
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
  const lookupOutcome = useAtomCommand(projectLibrary.operationOutcome, { reportFailure: false });
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
  const readRegisteredCopies = useAtomQueryRunner(projectLibrary.copies, {
    refresh: true,
    reportFailure: false,
  });
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
  const canLookupOutcome = useLibraryPermission(projectLibrary.operationOutcome, hostId);
  const canExecuteOperation = useLibraryPermission(projectLibrary.executeOperation, hostId);
  const canRegister = useLibraryPermission(projectLibrary.registerThread, authority.authorityId);
  // Untagged saved attempts finish their original receipt chain; every new start has an operation.
  const usesLegacyLaunch = attempt !== null && attempt.launchOperationId === undefined;
  const offlineReady =
    offline &&
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

  const launchRepositories = launchProject.resources.filter(
    (resource) =>
      isRepositoryResource(resource) &&
      (launchResourceIds.length === 0 || launchResourceIds.includes(resource.id)),
  );
  /** A folder holding these repositories is used as it is; an empty or missing one gets new files. */
  const folderChoice = (inspection: LibraryFolderInspection) => {
    const choice = libraryFolderChoice(inspection, launchRepositories);
    if (choice === "occupied") throw new Error(LIBRARY_FOLDER_OCCUPIED_MESSAGE);
    return choice;
  };

  // `busy` is a render-time copy, so two calls before the next render, such as an automatic start
  // and an Enter on the same row, would both pass it and each create a conversation.
  const submitting = useRef(false);
  const submit = async () => {
    const authorityId = pinnedAuthorityId;
    if (
      unreadable ||
      !authorityMatches ||
      !accountMatches ||
      !authorityId ||
      !hostId ||
      !modelSelection ||
      busy ||
      submitting.current ||
      (!canCheckLaunch && (copiesReadiness !== "ready" || (offline && !offlineReady)))
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setAccessRepair(undefined);
    const actor = savedActor ?? {
      authorityId,
      ...(identity ? { initiator: identity } : {}),
      ...(authorityIdentity ? { authorityInitiator: authorityIdentity } : {}),
    };
    const assertCurrent = () => ensureCurrent(hostId, actor);
    let submittedPreparation = preparation;
    const openConversation = async (next: NonNullable<typeof attempt>) => {
      assertCurrent();
      if (next.context.trim())
        useComposerDraftStore
          .getState()
          .setPrompt(scopeThreadRef(next.environmentId, next.threadId), next.context);
      saveAttempt(null);
      markLibraryConversationStarted(
        scopedThreadKey(scopeThreadRef(next.environmentId, next.threadId)),
      );
      onChanged();
      onClose();
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: next.environmentId, threadId: next.threadId },
      });
    };
    const launch = async () => {
      assertCurrent();
      if (canCheckLaunch && attempt?.launchOperationId) {
        const answer = await lookupOutcome({
          environmentId: attempt.environmentId,
          input: { requestId: attempt.launchOperationId, kind: "launch" },
        });
        if (answer._tag === "Failure") throw squashAtomCommandFailure(answer);
        assertCurrent();
        const operation = answer.value;
        if (
          operation &&
          (operation.id !== attempt.launchOperationId ||
            operation.kind !== "launch" ||
            operation.environmentId !== attempt.environmentId ||
            operation.projectId !== attempt.project.id)
        )
          throw new Error("The launch receipt belongs to another request, project or computer.");
        if (operation?.state === "succeeded") {
          if (
            !operation.result ||
            !("threadId" in operation.result) ||
            operation.result.threadId !== attempt.threadId
          )
            throw new Error("The launch receipt does not contain the original conversation.");
          await openConversation(attempt);
          return;
        }
        if (
          operation?.state === "running" ||
          operation?.state === "queued" ||
          operation?.state === "cancelled"
        )
          throw new Error(
            operation.state === "cancelled"
              ? "This conversation request was cancelled. Review its completed steps before starting another."
              : "This conversation request is already running. Check its result again.",
          );
        saveAttempt({ ...attempt, launchState: "ready" });
        setAccessRepair(operation?.accessRepair);
        setError(
          operation?.error ??
            "The saved conversation request has been checked. Continue explicitly when you are ready.",
        );
        return;
      }
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
        const files: PortableLaunchFiles | null =
          restoring ??
          (portableSource
            ? {
                ...actor,
                environmentId: hostId,
                project: launchProject,
                ...(restoreChoosesFolder ? {} : { rootPath: rootPath.trim() }),
                resourceIds: launchResourceIds,
                sourceCopy: portableSource,
                requestId: randomUUID(),
                registerRequestId: randomUUID(),
                snapshotRequestId: randomUUID(),
                copy: null,
                keepOnComputer,
                launch: {
                  title: title.trim() || LIBRARY_DEFAULT_CONVERSATION_TITLE,
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
        if (!restoring && files.rootPath !== undefined) {
          const restoreRoot = files.rootPath;
          const occupied = allCopies.some(
            (entry) =>
              entry.environmentId === hostId &&
              libraryLaunchPathOverlaps(entry.rootPath, restoreRoot),
          );
          if (occupied)
            throw new Error(
              "Choose a separate folder. Existing project files stay in their current location.",
            );
          const inspected = await inspect({
            environmentId: hostId,
            input: { rootPath: restoreRoot },
          });
          if (inspected._tag === "Failure") throw squashAtomCommandFailure(inspected);
          if (folderChoice(inspected.value) === "reuse") {
            setExistingFolder(restoreRoot);
            return;
          }
        }
        saveRestoring(files);
        launchCopy = await restoreLibraryLaunchCopy(
          restoring
            ? {
                ...files,
                ...(!files.sourceSnapshot && files.sourceReviewToken
                  ? { snapshotState: files.snapshotState ?? "unknown" }
                  : {}),
                ...(files.snapshotState === undefined &&
                files.sourceRegistration === undefined &&
                files.restoreState === undefined
                  ? {
                      ...(files.sourceSnapshot ? { sourceRegistration: "unknown" as const } : {}),
                      ...(!files.copy &&
                      (files.sourceCopy.state !== "ready" || files.sourceSnapshot)
                        ? { restoreState: "unknown" as const }
                        : {}),
                      ...(files.copy && files.registration === undefined
                        ? { registration: "unknown" as const }
                        : {}),
                    }
                  : {}),
              }
            : files,
          {
            lookup: async (target) => {
              const result = await lookupOutcome(target);
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            copies: async () => {
              const result = await readRegisteredCopies({
                environmentId: authorityId,
                input: { projectId: files.project.id },
              });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            readStatus: async (input) => {
              const result = await readCopyStatus(input);
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            snapshot: async (input) => {
              assertCurrent();
              const result = await snapshotCopy(input);
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            authorize: async (input) => {
              assertCurrent();
              const result = await authorizeRecovery({ environmentId: authorityId, input });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            restore: async (input) => {
              assertCurrent();
              const result = await restoreCopy(input);
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            register: async (input) => {
              assertCurrent();
              const result = await registerCopy({ environmentId: authorityId, input });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            save: (next) => saveRestoring(next, (latest) => latest?.requestId === next.requestId),
          },
        );
        setPreparedCopy(launchCopy);
        setCopyId(launchCopy.id);
        setHostId(files.environmentId);
        pendingPreparation = null;
        submittedPreparation = null;
        savePreparation(null);
        onChanged();
      }
      if (needsReopen) {
        if (!canReopen || !canRegisterCopy)
          throw new Error(
            "This computer cannot reopen saved project files with your current access.",
          );
        const files =
          reopening ??
          (retainedCopy
            ? {
                ...actor,
                environmentId: hostId,
                input: { requestId: randomUUID(), workingCopyId: retainedCopy.id },
                project: launchProject,
                resourceIds: launchResourceIds,
                rootPath: retainedCopy.rootPath,
                registerRequestId: randomUUID(),
                copy: null,
                state: "ready" as const,
                registration: "ready" as const,
                keepOnComputer,
                savedAt: new Date().toISOString(),
              }
            : null);
        if (!files)
          throw new Error(
            "The saved project files are unavailable. Reconnect this computer and retry.",
          );
        saveReopening(files);
        launchCopy = await reopenLibraryLaunchCopy(
          reopening
            ? {
                ...files,
                state: files.state ?? "unknown",
                ...(files.copy && files.registration === undefined
                  ? { registration: "unknown" }
                  : {}),
              }
            : files,
          {
            lookup: async (target) => {
              const result = await lookupOutcome(target);
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            copies: async () => {
              const result = await readRegisteredCopies({
                environmentId: authorityId,
                input: { projectId: files.project.id },
              });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            reopen: async (input) => {
              assertCurrent();
              const result = await reopenCopy(input);
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            register: async (input) => {
              assertCurrent();
              const result = await registerCopy({ environmentId: authorityId, input });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            save: (next) =>
              saveReopening(next, (latest) => latest?.input.requestId === next.input.requestId),
          },
        );
        setPreparedCopy(launchCopy);
        setCopyId(launchCopy.id);
        setHostId(files.environmentId);
        pendingPreparation = null;
        submittedPreparation = null;
        savePreparation(null);
        onChanged();
      }
      // The computer opens the conversation first and fills its files after, so one request
      // replaces preparing, registering and resolving files here. A saved preparation from an
      // earlier start finishes on the chain that began it.
      if (pendingPreparation === null && !usesLegacyLaunch) {
        const readyCopy = launchCopy?.state === "ready" ? launchCopy : null;
        let files = attempt?.files;
        if (!attempt && !readyCopy && serverPlaces)
          files = {
            requestId: randomUUID(),
            project: launchProject,
            strategy: libraryPlacementStrategy(placement.data),
            ...(launchResourceIds.length ? { resourceIds: launchResourceIds } : {}),
          };
        else if (!attempt && !readyCopy) {
          const filesRootPath = rootPath.trim();
          if (
            (retained.data ?? knownCopies).some(
              (entry) =>
                entry.environmentId === hostId &&
                entry.ownership === "managed" &&
                libraryLaunchPathOverlaps(entry.rootPath, filesRootPath),
            )
          )
            throw new LibraryError({
              reason: "invalid",
              cause:
                "Choose a separate folder for this project layout. Existing project files must be reopened from their saved version.",
            });
          const inspected = await inspect({
            environmentId: hostId,
            input: { rootPath: filesRootPath },
          });
          if (inspected._tag === "Failure") throw squashAtomCommandFailure(inspected);
          files = {
            requestId: randomUUID(),
            project: launchProject,
            rootPath: filesRootPath,
            strategy: folderChoice(inspected.value),
            ...(launchResourceIds.length ? { resourceIds: launchResourceIds } : {}),
          };
        }
        const workingCopyId = files?.requestId ?? readyCopy?.id;
        if (!workingCopyId)
          throw new Error("Reopen this conversation's original project files before retrying.");
        const registerRequestId = attempt?.registerRequestId ?? randomUUID();
        const next = attempt ?? {
          ...actor,
          environmentId: hostId,
          project: launchProject,
          threadId: newThreadId(),
          binding: {
            projectId: launchProject.id,
            projectRevision: launchProject.revision,
            workingCopyId,
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
          title: title.trim() || LIBRARY_DEFAULT_CONVERSATION_TITLE,
          context,
          modelSelection,
          defaultsResolved: true,
          keepOnComputer: restoring?.keepOnComputer ?? reopening?.keepOnComputer ?? keepOnComputer,
          ...(modelChoice ? { requestedModelSelection: modelChoice } : {}),
          ...(runtimeChoice ? { requestedRuntimeMode: runtimeChoice } : {}),
          ...(workspace ? { workspace } : {}),
          ...(files ? { files } : {}),
          runtimeMode,
          interactionMode,
          createdAt: new Date().toISOString(),
          created: false,
          registerRequestId,
          launchOperationId: `${registerRequestId}:launch`,
        };
        saveAttempt(next);
        saveReopening(null);
        saveRestoring(null);
        // Cloned files are the conversation's own; a reused folder stays where it was found. Files
        // the computer places follow its preview, which knows when they are a found checkout.
        const managed = next.files
          ? libraryPlacementManaged(
              next.files.rootPath === undefined && !attempt ? placement.data : null,
              next.files.strategy,
            )
          : readyCopy?.ownership === "managed";
        saveAttempt({ ...next, launchState: "unknown" });
        assertCurrent();
        const launched = await executeOperation({
          environmentId: next.environmentId,
          input: {
            operationId: next.launchOperationId!,
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
                ...(!offline && managed && next.keepOnComputer !== undefined
                  ? { keepOnComputer: next.keepOnComputer }
                  : {}),
                ...(next.workspace ? { workspace: next.workspace } : {}),
                ...(next.files ? { files: next.files } : {}),
              },
            },
          },
        });
        if (launched._tag === "Failure") throw squashAtomCommandFailure(launched);
        await openConversation(next);
        return;
      }
      if (pendingPreparation) {
        let files = pendingPreparation;
        if (!files.copy && files.state !== "ready") {
          const result = await checkLibraryCopyRequest(
            {
              environmentId: files.environmentId,
              requestId: files.input.requestId,
              kind: "prepare",
              projectId: files.input.project.id,
              rootPath: files.input.rootPath,
            },
            async (target) => {
              const answer = await lookupOutcome(target);
              if (answer._tag === "Failure") throw squashAtomCommandFailure(answer);
              return answer.value;
            },
          );
          savePreparation({
            ...files,
            state: "ready",
            ...(result.copy ? { copy: result.copy, registration: "ready" } : {}),
          });
          setAccessRepair(result.accessRepair);
          setError(
            "The saved preparation has been checked. Continue explicitly when you are ready.",
          );
          return;
        }
        const filesRootPath = files.input.rootPath;
        if (
          filesRootPath !== undefined &&
          (retained.data ?? knownCopies).some(
            (entry) =>
              entry.environmentId === hostId &&
              entry.ownership === "managed" &&
              entry.id !== files.copy?.id &&
              libraryLaunchPathOverlaps(entry.rootPath, filesRootPath.trim()),
          )
        )
          throw new LibraryError({
            reason: "invalid",
            cause:
              "Choose a separate folder for this project layout. Existing project files must be reopened from their saved version.",
          });
        submittedPreparation = files;
        if (!files.copy || files.copy.state !== "ready") {
          files = { ...files, state: "unknown" };
          submittedPreparation = files;
          savePreparation(files);
          assertCurrent();
          const prepared = await prepareCopy({
            environmentId: files.environmentId,
            input: files.input,
          });
          if (prepared._tag === "Failure") throw squashAtomCommandFailure(prepared);
          files = { ...files, copy: prepared.value, registration: "ready" };
          submittedPreparation = files;
          savePreparation(files);
        }
        if (files.copy?.state !== "ready")
          throw new Error("Project files are not ready. Retry preparation.");
        const fileCopy = files.copy;
        if (files.registration === "unknown" || files.registration === undefined) {
          const result = await readRegisteredCopies({
            environmentId: authorityId,
            input: { projectId: files.input.project.id },
          });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          const registered = checkedLibraryCopyRegistration(fileCopy, result.value);
          savePreparation({ ...files, registration: registered ? "succeeded" : "ready" });
          setError(
            "The saved file registration has been checked. Continue explicitly when you are ready.",
          );
          return;
        }
        const registeredAlready = files.registration === "succeeded";
        if (!registeredAlready) {
          files = { ...files, registration: "unknown" };
          submittedPreparation = files;
          savePreparation(files);
        }
        assertCurrent();
        const savedCopy = registeredAlready
          ? { _tag: "Success" as const, value: fileCopy }
          : await registerCopy({
              environmentId: authorityId,
              input: { requestId: files.registerRequestId, copy: fileCopy },
            });
        if (savedCopy._tag === "Failure") throw squashAtomCommandFailure(savedCopy);
        files = { ...files, copy: savedCopy.value, registration: "succeeded" };
        savePreparation(files);
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
      const registerRequestId = attempt?.registerRequestId ?? randomUUID();
      let next = attempt ?? {
        ...actor,
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
        title: title.trim() || LIBRARY_DEFAULT_CONVERSATION_TITLE,
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
        ...(workspace ? { workspace } : {}),
        runtimeMode,
        interactionMode,
        createdAt: new Date().toISOString(),
        created: false,
        registerRequestId,
        launchOperationId: `${registerRequestId}:launch`,
      };
      saveAttempt(next);
      saveReopening(null);
      saveRestoring(null);
      savePreparation(null);
      submittedPreparation = null;
      if (launchCopy.ownership === "borrowed" && !next.created && !offline) {
        assertCurrent();
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
        assertCurrent();
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
          lastUsedSelection: selectLastUsedModel(useComposerDraftStore.getState()),
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
      if (next.launchOperationId !== undefined) {
        saveAttempt({ ...next, launchState: "unknown" });
        assertCurrent();
        const launched = await executeOperation({
          environmentId: next.environmentId,
          input: {
            operationId: next.launchOperationId,
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
                ...(next.workspace ? { workspace: next.workspace } : {}),
              },
            },
          },
        });
        if (launched._tag === "Failure") throw squashAtomCommandFailure(launched);
      } else {
        if (!next.created) {
          assertCurrent();
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
            assertCurrent();
            const recovery = await bind({
              environmentId: next.environmentId,
              input: { threadId: next.threadId, binding: next.binding, project: next.project },
            });
            if (recovery._tag === "Failure") throw squashAtomCommandFailure(created);
          }
          next = { ...next, created: true };
          saveAttempt(next);
        }
        assertCurrent();
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
            assertCurrent();
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
          assertCurrent();
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
        assertCurrent();
        const saved = await register({
          environmentId: authorityId,
          input: { requestId: next.registerRequestId, thread: archived.value },
        });
        if (saved._tag === "Failure") throw squashAtomCommandFailure(saved);
      }
      await openConversation(next);
    };
    try {
      await launch();
    } catch (cause) {
      setCloneRepair(isLibraryError(cause) ? cause.repair : undefined);
      setAccessRepair(libraryAccessRepairFromFailure(cause, hostId));
      if (submittedPreparation) {
        const receipt = await recoverPreparation({
          environmentId: submittedPreparation.environmentId,
          input: { requestId: submittedPreparation.input.requestId },
        });
        if (receipt._tag === "Success") {
          if (receipt.value) savePreparation({ ...submittedPreparation, copy: receipt.value });
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
          (restoreChoosesFolder || (canInspect && rootPath.trim().length > 0)) &&
          sourceCanSnapshot &&
          (snapshotSource?.state !== "ready" ||
            restoring?.sourceSnapshot !== undefined ||
            restoring?.copy != null ||
            (canReadSource && canSnapshotSource))
        : needsReopen
          ? canReopen && canRegisterCopy && libraryCopyReadiness(retained) === "ready"
          : (copy?.state === "ready" &&
              (copy.ownership === "managed" || (canPrepare && canRegisterCopy))) ||
            (canPrepare &&
              (serverPlaces || (canInspect && rootPath.trim().length > 0)) &&
              canRegisterCopy &&
              libraryCopyReadiness(retained) === "ready")) &&
    (locked || needsReopen || (filesPlan.kind !== "choose" && filesPlan.kind !== "unavailable")) &&
    supportsLoomFeature(host?.serverConfig?.environment.capabilities, "project-library") &&
    allowed &&
    (offline ? offlineReady : canRegister) &&
    (!(
      filesPolicy?.ownership !== "borrowed" &&
      (needsPortable ||
        needsReopen ||
        (filesPolicy && (filesPolicy.keepOnComputer !== false) !== keepOnComputer))
    ) ||
      (canSetRetention && canRegisterCopy)) &&
    (continuation === undefined || (source.isSuccess && !source.isPending)) &&
    connected;
  const operationProgress = useEnvironmentQuery(
    busy && hostId && !usesLegacyLaunch
      ? projectLibrary.operations({ environmentId: hostId, input: { projectId: project.id } })
      : null,
  );
  const operationPhase = operationProgress.data?.find(
    (operation) => operation.id === attempt?.launchOperationId,
  )?.phase;
  const canCheckLaunch =
    !!attempt?.launchOperationId &&
    attempt.launchState !== "ready" &&
    connected &&
    canLookupOutcome;
  const canCreate =
    !unreadable &&
    accountMatches &&
    authorityMatches &&
    (canCheckLaunch ||
      (canContinue && modelSelection !== null && (usesLegacyLaunch || canExecuteOperation)));
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
  const heldTitle = attempt?.title ?? (title.trim() || LIBRARY_DEFAULT_CONVERSATION_TITLE);
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
      setWorkspaceChoice(null);
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
      setWorkspaceChoice(null);
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
    serverPlaces,
    filesLine: restoreChoosesFolder
      ? LIBRARY_RESTORE_FOLDER_LINE
      : serverPlaces
        ? placement.data
          ? libraryPlacementLine(placement.data)
          : placement.error
            ? "Loom will choose a folder on this computer"
            : "Finding a folder on this computer..."
        : null,
    placementReuses:
      serverPlaces && !serverRestores && placement.data
        ? libraryPlacementReuses(placement.data)
        : false,
    browseStart:
      rootPath ||
      host?.serverConfig?.folders?.projects ||
      host?.serverConfig?.newProjectsRoot ||
      "~/",
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
    // Using a found folder instead of restoring leaves the source computer's changes behind.
    existingFolderSkipsRestore: needsPortable,
    keepOnComputer,
    setKeepChoice,
    workspace,
    setWorkspaceChoice,
    canKeep: filesPolicy?.ownership !== "borrowed" && canSetRetention && canRegisterCopy,
    needsReopen,
    needsPortable,
    locked,
    held: locked
      ? {
          title: isDefaultThreadTitle(heldTitle) ? null : heldTitle,
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
    error: unreadable
      ? "The saved conversation request could not be read. Keep it for recovery before starting another."
      : error,
    accessRepair: !accountMatches
      ? { kind: "ownership" as const, ...(hostId ? { environmentId: hostId } : {}) }
      : !authorityMatches
        ? {
            kind: "connection" as const,
            ...(pinnedAuthorityId ? { environmentId: pinnedAuthorityId } : {}),
          }
        : accessRepair,
    accessContext: {
      environmentId: hostId,
      authorityEnvironmentId: pinnedAuthorityId,
      originalAccount: savedActor?.initiator,
    },
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
              snapshotState: "ready",
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
      locked && !busy && !pulling && !unreadable && accountMatches && authorityMatches
        ? async () => {
            if (!hostId || submitting.current) return;
            submitting.current = true;
            setBusy(true);
            const check = async () => {
              const requests = [
                ...(attempt?.launchOperationId
                  ? [
                      {
                        environmentId: attempt.environmentId,
                        requestId: attempt.launchOperationId,
                        kind: "launch" as const,
                      },
                    ]
                  : []),
                ...(preparation
                  ? [
                      {
                        environmentId: preparation.environmentId,
                        requestId: preparation.input.requestId,
                        kind: "prepare" as const,
                      },
                    ]
                  : []),
                ...(reopening
                  ? [
                      {
                        environmentId: reopening.environmentId,
                        requestId: reopening.input.requestId,
                        kind: "reopen" as const,
                      },
                    ]
                  : []),
                ...(restoring
                  ? [
                      {
                        environmentId: restoring.environmentId,
                        requestId: restoring.requestId,
                        kind: "restore" as const,
                      },
                    ]
                  : []),
              ];
              for (const request of requests) {
                const result = await lookupOutcome({
                  environmentId: request.environmentId,
                  input: { requestId: request.requestId, kind: request.kind },
                });
                if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                if (result.value?.state === "running" || result.value?.state === "queued")
                  throw new Error(
                    "The saved request is still running. Check its result before starting another.",
                  );
              }
              ensureCurrent(hostId, savedActor ?? {});
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
            };
            await check().catch((cause: unknown) =>
              setError(
                cause instanceof Error ? cause.message : "Could not check the original request.",
              ),
            );
            submitting.current = false;
            setBusy(false);
          }
        : null,
    reviewRestore:
      restoring && !restoring.copy && canLookupOutcome && accountMatches && authorityMatches
        ? async () => {
            if (submitting.current || !hostId) return;
            submitting.current = true;
            setBusy(true);
            const review = async () => {
              const result = await lookupOutcome({
                environmentId: restoring.environmentId,
                input: { requestId: restoring.requestId, kind: "restore" },
              });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              ensureCurrent(hostId, savedActor ?? {});
              const operation = result.value;
              if (
                !operation?.restoreRequest ||
                operation.kind !== "restore" ||
                operation.environmentId !== restoring.environmentId ||
                operation.restoreRequest.requestId !== restoring.requestId ||
                operation.restoreRequest.project.id !== restoring.project.id ||
                operation.restoreRequest.libraryEnvironmentId !== pinnedAuthorityId
              )
                throw new Error(
                  "Refresh the destination computer's history to recover the original restore selection. Keep this saved request.",
                );
              setRestoreReview(operation);
            };
            await review().catch((cause: unknown) => {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not read the original restore request.",
              );
              setAccessRepair(libraryAccessRepairFromFailure(cause, restoring.environmentId));
            });
            submitting.current = false;
            setBusy(false);
          }
        : null,
    reviewFiles: preparation?.copy?.state === "failed" ? reviewFiles : null,
    review: restoreReview ? (
      <LibraryRestoreRequestDialog
        operation={restoreReview}
        onClose={() => setRestoreReview(null)}
        onChanged={() => {
          retained.refresh();
          onChanged();
        }}
      />
    ) : reviewingFiles && preparation?.copy ? (
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
  const launch = useConversationAutoStart(setup);
  if (!setup.open) return null;
  if (setup.review) return setup.review;
  if (launch.waiting && launch.renderPending)
    return launch.renderPending(
      setup.operationPhase ??
        `Starting ${setup.project.title} on ${setup.hostLabel ?? "the selected computer"}...`,
    );
  const content = <ConversationPalette setup={setup} launch={launch} />;
  return setup.embedded ? (
    content
  ) : (
    <LibraryPaletteDialog title="New conversation" onClose={setup.onClose}>
      {content}
    </LibraryPaletteDialog>
  );
}
