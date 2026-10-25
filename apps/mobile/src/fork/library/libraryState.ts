import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useFocusEffect } from "@react-navigation/native";
import { createProjectLibraryAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { AuthOrchestrationReadScope, EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_PROJECT_PROFILE_FEATURE,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { AsyncResult, Atom } from "effect/reactivity";
import { useCallback, useRef } from "react";
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

/**
 * Re-reads a copy query when its screen is shown again, because the project screen stays mounted
 * under the screens it opens. Mounting, or switching to another query, already reads.
 */
export function useRefreshOnRefocus(refresh: () => void) {
  const lastRefresh = useRef<(() => void) | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (lastRefresh.current === refresh) refresh();
      lastRefresh.current = refresh;
    }, [refresh]),
  );
}

/** Whether a computer advertises a Loom feature. Absent or unknown means no. */
export function useLoomFeature(environmentId: EnvironmentId | null, feature: string) {
  return supportsLoomFeature(
    useEnvironmentServerConfig(environmentId)?.environment.capabilities,
    feature,
  );
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
  const sourceId = environments.find(
    (entry) =>
      entry.entry.enabled &&
      entry.connection.phase === "connected" &&
      entry.serverConfig?.environment.capabilities.supportsExecution !== false,
  )?.environmentId;
  const sourceInfo = useEnvironmentQuery(
    !environmentId && sourceId ? library.info({ environmentId: sourceId, input: {} }) : null,
  );
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
    // An older Library would drop a saved profile, so editing waits until it says it keeps one.
    keepsProfile: supportsLoomFeature(
      config?.environment.capabilities,
      LIBRARY_PROJECT_PROFILE_FEATURE,
    ),
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
    destination: sourceInfo.data?.destination,
    select,
  } as const;
}

const localCatalogAtoms = Atom.family((key: string) => {
  const { authorityId, environmentIds } = JSON.parse(key) as {
    authorityId: EnvironmentId;
    environmentIds: EnvironmentId[];
  };
  return Atom.make((get) => {
    const results = environmentIds.map((environmentId) =>
      AsyncResult.flatMap(get(library.info({ environmentId, input: {} })), (info, current) =>
        current.waiting
          ? AsyncResult.initial(true)
          : info.destination?.environmentId === authorityId
            ? AsyncResult.all({
                projects: get(
                  library.projects({ environmentId, input: { includeArchived: true } }),
                ),
                copies: get(library.copies({ environmentId, input: { includeReleased: true } })),
              })
            : AsyncResult.success({ projects: [], copies: [] }),
      ),
    );
    const successes = results.filter(AsyncResult.isSuccess);
    if (!successes.length && results.length)
      return results.find(AsyncResult.isFailure) ?? AsyncResult.initial(true);
    const projects = new Map<string, LibraryProject>();
    const copies: LibraryWorkingCopy[] = [];
    for (const { value } of successes) {
      for (const project of value.projects) {
        const previous = projects.get(project.id);
        if (!previous || previous.revision < project.revision) projects.set(project.id, project);
      }
      copies.push(...value.copies);
    }
    return AsyncResult.success(
      { projects: [...projects.values()], copies },
      {
        waiting: results.some((result) => result.waiting || AsyncResult.isInitial(result)),
      },
    );
  });
});

/** Local receipts let the start form survive a Library outage without changing its authority. */
function useLocalStartCatalog() {
  const authority = useLibraryAuthority();
  const { environments } = useEnvironments();
  const offline = authority.environmentId !== null && !authority.connected;
  const ids = offline
    ? environments
        .filter(
          (entry) =>
            entry.entry.enabled &&
            entry.connection.phase === "connected" &&
            entry.serverConfig?.environment.capabilities.supportsExecution !== false &&
            supportsLoomFeature(entry.serverConfig?.environment.capabilities, "project-library"),
        )
        .map((entry) => entry.environmentId)
    : [];
  const query = useEnvironmentQuery(
    offline
      ? localCatalogAtoms(
          JSON.stringify({ authorityId: authority.environmentId, environmentIds: ids }),
        )
      : null,
  );
  return {
    authority,
    offline,
    ...query,
    refresh: () => {
      for (const environmentId of ids) {
        appAtomRegistry.refresh(library.info({ environmentId, input: {} }));
        appAtomRegistry.refresh(
          library.projects({ environmentId, input: { includeArchived: true } }),
        );
        appAtomRegistry.refresh(
          library.copies({ environmentId, input: { includeReleased: true } }),
        );
      }
    },
  };
}

export function useLibraryStartProjects(includeArchived = false) {
  const local = useLocalStartCatalog();
  const environmentId = local.authority.environmentId;
  const remote = useEnvironmentQuery(
    environmentId ? library.projects({ environmentId, input: { includeArchived } }) : null,
  );
  const projects = new Map((remote.data ?? []).map((project) => [project.id, project]));
  for (const project of local.data?.projects ?? []) projects.set(project.id, project);
  return local.offline
    ? {
        ...local,
        data:
          local.data || remote.data
            ? [...projects.values()].filter((project) => includeArchived || !project.archived)
            : null,
      }
    : remote;
}

export function useLibraryStartProject(projectId: string) {
  const local = useLocalStartCatalog();
  const environmentId = local.authority.environmentId;
  const remote = useEnvironmentQuery(
    environmentId ? library.project({ environmentId, input: { projectId } }) : null,
  );
  return local.offline
    ? {
        ...local,
        data: local.data?.projects.find((project) => project.id === projectId) ?? remote.data,
        error:
          local.error ??
          (local.isSuccess &&
          !local.isPending &&
          !local.data?.projects.some((project) => project.id === projectId) &&
          remote.data === null
            ? "Connect a computer with registered files for this project, or reconnect the Library."
            : null),
      }
    : remote;
}

export function useLibraryStartCopies(projectId?: string, includeReleased = false) {
  const local = useLocalStartCatalog();
  const environmentId = local.authority.environmentId;
  const remote = useEnvironmentQuery(
    environmentId && !local.offline
      ? library.copies({
          environmentId,
          input: { ...(projectId ? { projectId } : {}), includeReleased },
        })
      : null,
  );
  return local.offline
    ? {
        ...local,
        data:
          local.data?.copies.filter(
            (copy) =>
              (!projectId || copy.projectId === projectId) &&
              (includeReleased || (copy.registered !== false && copy.state !== "released")),
          ) ?? null,
      }
    : remote;
}
