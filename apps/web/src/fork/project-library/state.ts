import { useAtomValue } from "@effect/atom-react";
import { createProjectLibraryAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import { LibraryId, PROJECT_LIBRARY_FEATURE } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { connectionAtomRuntime } from "~/connection/runtime";
import { getLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import { useEffect } from "react";
import { usePrimaryEnvironmentId, useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";

export const projectLibrary = createProjectLibraryAtoms(connectionAtomRuntime);
const AUTHORITY_KEY = "loom:project-library:authority:v1";
const SELECTED_PROJECT_KEY = "loom:project-library:selected-project:v1";
const Authority = Schema.NullOr(EnvironmentId);
const SelectedProject = Schema.NullOr(LibraryId);
const DENIED = Atom.make(false);

export function readLibraryAuthorityId() {
  try {
    return getLocalStorageItem(AUTHORITY_KEY, Authority);
  } catch {
    return null;
  }
}

/** A disconnected Library keeps its saved identity. Another computer never replaces it. */
export function useLibraryAuthority() {
  const [authorityId, setAuthorityId] = useLocalStorage(AUTHORITY_KEY, null, Authority);
  const { environments, isReady } = useEnvironments();
  const environment = environments.find((entry) => entry.environmentId === authorityId) ?? null;
  const connected =
    environment?.entry.enabled === true && environment.connection.phase === "connected";
  const supported = supportsLoomFeature(
    environment?.serverConfig?.environment.capabilities,
    PROJECT_LIBRARY_FEATURE,
  );
  const primaryId = usePrimaryEnvironmentId();
  const primary = environments.find((entry) => entry.environmentId === primaryId);
  const primarySupportsLibrary = supportsLoomFeature(
    primary?.serverConfig?.environment.capabilities,
    PROJECT_LIBRARY_FEATURE,
  );
  const primaryInfo = useEnvironmentQuery(
    !authorityId && primaryId && primarySupportsLibrary
      ? projectLibrary.info({ environmentId: primaryId, input: {} })
      : null,
  );
  useEffect(() => {
    // A designated authority can initialize an empty choice, never replace a saved one.
    if (!authorityId && primaryId && primaryInfo.data?.isAuthority === true)
      setAuthorityId(primaryId);
  }, [authorityId, primaryId, primaryInfo.data?.isAuthority, setAuthorityId]);
  return { authorityId, setAuthorityId, environment, connected, supported, environments, isReady };
}

export function useSelectedLibraryProject() {
  return useLocalStorage(SELECTED_PROJECT_KEY, null, SelectedProject);
}

export function useLibraryProjects(includeArchived = false) {
  const authority = useLibraryAuthority();
  const query = useEnvironmentQuery(
    authority.authorityId
      ? projectLibrary.projects({
          environmentId: authority.authorityId,
          input: { includeArchived },
        })
      : null,
  );
  return { ...authority, query };
}

export function useLibraryProject(projectId: string, includeReleased = false) {
  const authority = useLibraryAuthority();
  const target =
    authority.authorityId && projectId
      ? { environmentId: authority.authorityId, input: { projectId } }
      : null;
  const project = useEnvironmentQuery(target ? projectLibrary.project(target) : null);
  const copies = useEnvironmentQuery(
    target
      ? projectLibrary.copies({
          ...target,
          input: { ...target.input, ...(includeReleased ? { includeReleased: true } : {}) },
        })
      : null,
  );
  const threads = useEnvironmentQuery(target ? projectLibrary.threads(target) : null);
  const refresh = () => {
    project.refresh();
    copies.refresh();
    threads.refresh();
  };
  return { ...authority, project, copies, threads, refresh };
}

export function useLibraryPermission(
  command: { readonly permissionAtom: (environmentId: EnvironmentId) => Atom.Atom<boolean> },
  environmentId: EnvironmentId | null,
) {
  return useAtomValue(environmentId ? command.permissionAtom(environmentId) : DENIED);
}
