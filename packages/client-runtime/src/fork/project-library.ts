import { PROJECT_WORKFLOW_WS_METHODS as W } from "@t3tools/contracts/fork";
import {
  LibraryInfo,
  LibraryProject,
  LibraryWorkingCopy,
  LibraryThreadSummary,
  LibraryThreadIndex,
  LibraryThreadArchive,
  LIBRARY_WS_METHODS as L,
  LIBRARY_HEALTH_WS_METHODS as LH,
  LIBRARY_READINESS_WS_METHODS as LR,
  LIBRARY_TIMELINE_WS_METHODS as LT,
  LIBRARY_BRIEF_WS_METHODS as BRIEF,
  LIBRARY_BRIEF_SUGGESTION_WS_METHODS as SUGGEST,
  LIBRARY_SEARCH_WS_METHODS as LS,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { persistQuery } from "../state/queryPersistence.ts";
import { libraryThreadSaveStatusIsFinal } from "./library-save-state.ts";
import { Atom } from "effect/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

/** Catalog queries target the chosen authority; workspace commands target their actual host. */
export function createProjectLibraryAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const refreshes = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "loom:library:refreshes",
    tag: L.subscribeRefreshes,
  });
  const workflowChanges = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "loom:workflows:changes",
    tag: W.changes,
  });
  const catalogWorkflowChanges = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => [
      get(refreshes({ environmentId, input: {} })),
      get(workflowChanges({ environmentId, input: {} })),
    ]),
  );
  return {
    refreshes,
    workstreams: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:workstreams",
      tag: W.workstreams,
      refreshTrigger: ({ environmentId }) => workflowChanges({ environmentId, input: {} }),
    }),
    saveWorkstream: createEnvironmentRpcCommand(runtime, {
      label: "loom:workstreams:save",
      tag: W.saveWorkstream,
    }),
    blueprint: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:blueprint",
      tag: W.blueprint,
      refreshTrigger: ({ environmentId }) => catalogWorkflowChanges(environmentId),
    }),
    applyBlueprint: createEnvironmentRpcCommand(runtime, {
      label: "loom:blueprint:apply",
      tag: W.applyBlueprint,
    }),
    preservation: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:preservation",
      tag: W.preservation,
      refreshTrigger: ({ environmentId }) => catalogWorkflowChanges(environmentId),
    }),
    operations: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:operations",
      tag: W.operations,
      refreshTrigger: ({ environmentId }) => workflowChanges({ environmentId, input: {} }),
    }),
    runOperation: createEnvironmentRpcCommand(runtime, {
      label: "loom:operations:run",
      tag: W.run,
    }),
    executeOperation: createEnvironmentRpcCommand(runtime, {
      label: "loom:operations:execute",
      tag: W.execute,
    }),
    resumeOperation: createEnvironmentRpcCommand(runtime, {
      label: "loom:operations:resume",
      tag: W.resume,
    }),
    cancelOperation: createEnvironmentRpcCommand(runtime, {
      label: "loom:operations:cancel",
      tag: W.cancel,
    }),
    replicationStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:replication-status",
      tag: L.replicationStatus,
    }),
    /** One conversation's entry, polled while it is shown: uploads have no change stream. */
    threadSaveStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:thread-save-status",
      tag: L.replicationStatus,
      refreshIntervalMs: 30_000,
      isFinal: libraryThreadSaveStatusIsFinal,
    }),
    flushHistory: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:flush-history",
      tag: L.flushHistory,
    }),
    preparation: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:preparation",
      tag: L.preparation,
    }),
    snapshotThread: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:snapshot-thread",
      tag: L.snapshotThread,
    }),
    registerThread: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:register-thread",
      tag: L.registerThread,
    }),
    inspectFolder: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:inspect-folder",
      tag: L.inspectFolder,
    }),
    info: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:info",
      tag: L.info,
      refreshTrigger: ({ environmentId }) => refreshes({ environmentId, input: {} }),
      persistence: persistQuery(LibraryInfo),
    }),
    projects: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:projects",
      tag: L.projects,
      refreshTrigger: ({ environmentId }) => refreshes({ environmentId, input: {} }),
      persistence: persistQuery(Schema.Array(LibraryProject)),
    }),
    project: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:project",
      tag: L.project,
      refreshTrigger: ({ environmentId }) => refreshes({ environmentId, input: {} }),
      persistence: persistQuery(LibraryProject),
    }),
    copies: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:copies",
      tag: L.copies,
      refreshTrigger: ({ environmentId }) => refreshes({ environmentId, input: {} }),
      persistence: persistQuery(Schema.Array(LibraryWorkingCopy)),
    }),
    threads: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:threads",
      tag: L.threads,
      refreshTrigger: ({ environmentId }) => refreshes({ environmentId, input: {} }),
      persistence: persistQuery(Schema.Array(LibraryThreadSummary)),
    }),
    lookupThread: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:lookup-thread",
      tag: L.lookupThread,
      persistence: persistQuery(Schema.NullOr(LibraryThreadSummary)),
    }),
    threadIndex: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:thread-index",
      tag: L.threadIndex,
      refreshTrigger: ({ environmentId }) => refreshes({ environmentId, input: {} }),
      persistence: persistQuery(LibraryThreadIndex),
    }),
    threadBinding: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:thread-binding",
      tag: L.threadBinding,
    }),
    history: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:history",
      tag: L.history,
      persistence: persistQuery(LibraryThreadArchive),
    }),
    /**
     * Query the authority, which must advertise `library-timeline`. Only the newest page follows
     * Library changes; older pages are fixed by their cursor because the log is append-only.
     */
    timeline: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:timeline",
      tag: LT.timeline,
      refreshTrigger: ({ environmentId, input }) =>
        input.before === undefined ? refreshes({ environmentId, input: {} }) : undefined,
    }),
    /**
     * Query the authority, which must advertise `library-search`. Results do not follow Library
     * changes, so pages already read stay put while more are read.
     */
    search: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:search",
      tag: LS.search,
    }),
    copyStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:copy-status",
      tag: L.copyStatus,
    }),
    /** Query the copy's own computer, which must advertise `library-copy-health`. */
    copyHealth: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:copy-health",
      tag: LH.copyHealth,
    }),
    /** Fetches the copy's remotes before reading health; the app's own status refresh. */
    refreshCopyHealth: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:refresh-copy-health",
      tag: LH.copyHealth,
    }),
    /** One-off reads for flows that check many copies, or re-check a copy right before acting. */
    readCopyHealth: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:read-copy-health",
      tag: LH.copyHealth,
    }),
    /** Query the copy's computer, which must advertise `library-profile-readiness`. */
    profileReadiness: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:profile-readiness",
      tag: LR.readiness,
    }),
    /** Where a copy's local settings differ from its project's setup, on the copy's computer. */
    profileSettings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:profile-settings",
      tag: LR.profileSettings,
    }),
    applyProfile: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:apply-profile",
      tag: LR.applyProfile,
    }),
    readCopyStatus: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:read-copy-status",
      tag: L.copyStatus,
    }),
    resolveBinding: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:resolve-binding",
      tag: L.resolveBinding,
    }),
    verifyImport: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:verify-import",
      tag: L.verifyImport,
    }),
    createProject: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:create-project",
      tag: L.createProject,
    }),
    updateProject: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:update-project",
      tag: L.updateProject,
    }),
    archiveProject: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:archive-project",
      tag: L.archiveProject,
    }),
    registerCopy: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:register-copy",
      tag: L.registerCopy,
    }),
    prepareCopy: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:prepare-copy",
      tag: L.prepareCopy,
    }),
    unregisterCopy: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:unregister-copy",
      tag: L.unregisterCopy,
    }),
    setCopyRetention: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:set-copy-retention",
      tag: L.setCopyRetention,
    }),
    reopenCopy: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:reopen-copy",
      tag: L.reopenCopy,
    }),
    snapshotCopy: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:snapshot-copy",
      tag: L.snapshotCopy,
    }),
    authorizeRecovery: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:authorize-recovery",
      tag: L.authorizeRecovery,
    }),
    restoreCopy: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:restore-copy",
      tag: L.restoreCopy,
    }),
    releaseCopy: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:release-copy",
      tag: L.releaseCopy,
    }),
    bindThread: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:bind-thread",
      tag: L.bindThread,
    }),
    ingestHistory: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:ingest-history",
      tag: L.ingestHistory,
    }),
    importShadow: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:import-shadow",
      tag: L.importShadow,
    }),
    /** Ask the Library computer, which must advertise `library-brief-proposals`. */
    briefProposals: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:brief-proposals",
      tag: BRIEF.proposals,
      refreshTrigger: ({ environmentId }) => refreshes({ environmentId, input: {} }),
    }),
    acceptBriefProposal: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:accept-brief-proposal",
      tag: BRIEF.accept,
    }),
    dismissBriefProposal: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:dismiss-brief-proposal",
      tag: BRIEF.dismiss,
    }),
    /** Ask the conversation's computer, which must advertise `library-brief-suggestions`. */
    briefSuggestion: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:brief-suggestion",
      tag: SUGGEST.suggestion,
    }),
    startBriefSuggestion: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:start-brief-suggestion",
      tag: SUGGEST.start,
    }),
    declineBriefSuggestion: createEnvironmentRpcCommand(runtime, {
      label: "loom:library:decline-brief-suggestion",
      tag: SUGGEST.decline,
    }),
  };
}
