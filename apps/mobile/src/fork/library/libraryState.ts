import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createProjectLibraryAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { AuthOrchestrationReadScope, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useCallback } from "react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";

export const library = createProjectLibraryAtoms(connectionAtomRuntime);

export function refreshLibraryProject(environmentId: EnvironmentId, projectId: string) {
  appAtomRegistry.refresh(library.projects({ environmentId, input: { includeArchived: false } }));
  appAtomRegistry.refresh(library.projects({ environmentId, input: { includeArchived: true } }));
  appAtomRegistry.refresh(library.project({ environmentId, input: { projectId } }));
}
export function refreshLibraryWork(environmentId: EnvironmentId, projectId: string) {
  appAtomRegistry.refresh(library.copies({ environmentId, input: { projectId } }));
  appAtomRegistry.refresh(
    library.copies({ environmentId, input: { projectId, includeReleased: true } }),
  );
  appAtomRegistry.refresh(library.threads({ environmentId, input: { projectId } }));
}

/** One library authority is retained independently of execution host selection. */
export function useLibraryAuthority() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const { environments } = useEnvironments();
  const save = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const saved = AsyncResult.isSuccess(preferences)
    ? preferences.value["loom.library.authorityEnvironmentId"]
    : null;
  const environmentId = saved ? EnvironmentId.make(saved) : null;
  const { presentation } = useEnvironmentPresentation(environmentId);
  const config = useEnvironmentServerConfig(environmentId);
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const connected =
    presentation?.entry.enabled === true && presentation.connection.phase === "connected";
  const supported = supportsLoomFeature(config?.environment.capabilities, "project-library");
  const info = useEnvironmentQuery(
    environmentId ? library.info({ environmentId, input: {} }) : null,
  );
  const select = useCallback(
    async (next: EnvironmentId) => {
      await save({ "loom.library.authorityEnvironmentId": next });
    },
    [save],
  );
  return {
    environmentId,
    loaded: AsyncResult.isSuccess(preferences),
    connected,
    canRead,
    supported,
    ready:
      connected &&
      canRead &&
      supported &&
      info.data?.environmentId === environmentId &&
      info.data?.isAuthority === true,
    label:
      environments.find((environment) => environment.environmentId === environmentId)?.label ??
      "Library server",
    info,
    computers: info.data?.computers ?? [],
    select,
  } as const;
}
