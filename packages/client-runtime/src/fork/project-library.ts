import {
  LibraryInfo,
  LibraryProject,
  LibraryWorkingCopy,
  LibraryThreadSummary,
  LibraryThreadArchive,
  LIBRARY_WS_METHODS as L,
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
    history: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:history",
      tag: L.history,
      persistence: persistQuery(LibraryThreadArchive),
    }),
    copyStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:library:copy-status",
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
