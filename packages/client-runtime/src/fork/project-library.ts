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
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { persistQuery } from "../state/queryPersistence.ts";
import type { Atom } from "effect/reactivity";
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
  return {
    refreshes,
    replicationStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:replication-status",
      tag: L.replicationStatus,
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
  };
}
