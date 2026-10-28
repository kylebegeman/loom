import { useAtomValue } from "@effect/atom-react";
import { createProjectLibraryAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { EnvironmentId, type AuthEnvironmentScope } from "@t3tools/contracts";
import {
  LibraryId,
  PROJECT_LIBRARY_FEATURE,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import { connectionAtomRuntime } from "~/connection/runtime";
import { getLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import { useEffect } from "react";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  projectEnvironmentPresentation,
  usePrimaryEnvironmentId,
  useEnvironments,
} from "~/state/environments";
import { useEnvironmentPresentation } from "~/state/presentation";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentSessionState } from "~/state/session";
import { identityProfile } from "~/fork/identity/identityProfile";
import { isHostedStaticApp } from "~/hostedPairing";
import { isLocalEnvironmentDisabled } from "~/localEnvironment";
import { accessBlock } from "./accessBlock";

export const projectLibrary: ReturnType<typeof createProjectLibraryAtoms> =
  createProjectLibraryAtoms(connectionAtomRuntime);
/** Every surface reads this one page of the thread index, so the client fetches it once. */
export const LIBRARY_THREAD_INDEX_LIMIT = 200;
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- initializes the local storage library authority once the primary server reports it is one
  useEffect(() => {
    // A designated authority can initialize an empty choice, never replace a saved one.
    if (!authorityId && primaryId && primaryInfo.data?.isAuthority === true)
      setAuthorityId(primaryId);
  }, [authorityId, primaryId, primaryInfo.data?.isAuthority, setAuthorityId]);
  const info = useEnvironmentQuery(
    authorityId ? projectLibrary.info({ environmentId: authorityId, input: {} }) : null,
  );
  return {
    authorityId,
    setAuthorityId,
    environment,
    connected,
    supported,
    environments,
    isReady,
    info,
    computers: info.data?.computers ?? [],
    destination: primaryInfo.data?.destination,
  };
}

/** Only the chosen Library's id, for surfaces that do not need its connection or info. */
export function useLibraryAuthorityId() {
  return useLocalStorage(AUTHORITY_KEY, null, Authority)[0];
}

export function useSelectedLibraryProject() {
  return useLocalStorage(SELECTED_PROJECT_KEY, null, SelectedProject);
}

const localCatalogAtoms = Atom.family((key: string) => {
  const { authorityId, environmentIds } = JSON.parse(key) as {
    authorityId: EnvironmentId;
    environmentIds: EnvironmentId[];
  };
  return Atom.make((get) => {
    const results = environmentIds.map((environmentId) =>
      AsyncResult.flatMap(
        get(projectLibrary.info({ environmentId, input: {} })),
        (info, current) =>
          current.waiting
            ? AsyncResult.initial(true)
            : info.destination?.environmentId === authorityId
              ? AsyncResult.all({
                  projects: get(
                    projectLibrary.projects({ environmentId, input: { includeArchived: true } }),
                  ),
                  copies: get(
                    projectLibrary.copies({ environmentId, input: { includeReleased: true } }),
                  ),
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

/** Reads the computers' persisted receipts during an outage; the selected authority stays put. */
export function useLibraryLocalCatalog(enabled: boolean, authorityId: EnvironmentId | null) {
  const { environments } = useEnvironments();
  const ids = enabled
    ? environments
        .filter(
          (entry) =>
            entry.entry.enabled &&
            entry.connection.phase === "connected" &&
            entry.serverConfig?.environment.capabilities.supportsExecution !== false &&
            supportsLoomFeature(
              entry.serverConfig?.environment.capabilities,
              PROJECT_LIBRARY_FEATURE,
            ),
        )
        .map((entry) => entry.environmentId)
    : [];
  const query = useEnvironmentQuery(
    enabled ? localCatalogAtoms(JSON.stringify({ authorityId, environmentIds: ids })) : null,
  );
  return {
    ...query,
    refresh: () => {
      for (const environmentId of ids) {
        appAtomRegistry.refresh(projectLibrary.info({ environmentId, input: {} }));
        appAtomRegistry.refresh(
          projectLibrary.projects({ environmentId, input: { includeArchived: true } }),
        );
        appAtomRegistry.refresh(
          projectLibrary.copies({ environmentId, input: { includeReleased: true } }),
        );
      }
    },
  };
}

export function useLibraryProjects(includeArchived = false) {
  const authority = useLibraryAuthority();
  const offline = authority.authorityId !== null && !authority.connected;
  const local = useLibraryLocalCatalog(offline, authority.authorityId);
  const remote = useEnvironmentQuery(
    authority.authorityId
      ? projectLibrary.projects({
          environmentId: authority.authorityId,
          input: { includeArchived },
        })
      : null,
  );
  const offlineProjects = new Map((remote.data ?? []).map((project) => [project.id, project]));
  for (const project of local.data?.projects ?? []) offlineProjects.set(project.id, project);
  const query = offline
    ? {
        ...local,
        // Existing cached records remain readable; only host receipts supply launchable files.
        data:
          local.data || remote.data
            ? [...offlineProjects.values()].filter(
                (project) => includeArchived || !project.archived,
              )
            : null,
      }
    : remote;
  return { ...authority, offline, query };
}

export function useLibraryProject(projectId: string, includeReleased = false) {
  const authority = useLibraryAuthority();
  const offline = authority.authorityId !== null && !authority.connected;
  const local = useLibraryLocalCatalog(offline, authority.authorityId);
  const target =
    authority.authorityId && projectId
      ? { environmentId: authority.authorityId, input: { projectId } }
      : null;
  const remoteProject = useEnvironmentQuery(target ? projectLibrary.project(target) : null);
  const remoteCopies = useEnvironmentQuery(
    target && !offline
      ? projectLibrary.copies({
          ...target,
          input: { ...target.input, ...(includeReleased ? { includeReleased: true } : {}) },
        })
      : null,
  );
  const project = offline
    ? {
        ...local,
        data:
          local.data?.projects.find((project) => project.id === projectId) ?? remoteProject.data,
        error:
          local.error ??
          (local.isSuccess &&
          !local.isPending &&
          !local.data?.projects.some((project) => project.id === projectId) &&
          remoteProject.data === null
            ? "Connect a computer with registered files for this project, or reconnect the Library."
            : null),
      }
    : remoteProject;
  const copies = offline
    ? {
        ...local,
        data:
          local.data?.copies.filter(
            (copy) =>
              copy.projectId === projectId &&
              (includeReleased || (copy.registered !== false && copy.state !== "released")),
          ) ?? null,
      }
    : remoteCopies;
  const threads = useEnvironmentQuery(target ? projectLibrary.threads(target) : null);
  const refresh = () => {
    project.refresh();
    copies.refresh();
    threads.refresh();
  };
  return { ...authority, offline, project, copies, threads, refresh };
}

export function useLibraryPermission(
  command: { readonly permissionAtom: (environmentId: EnvironmentId) => Atom.Atom<boolean> },
  environmentId: EnvironmentId | null,
) {
  return useAtomValue(environmentId ? command.permissionAtom(environmentId) : DENIED);
}

type GuardedCommands = ReadonlyArray<{
  readonly requiredScopes: () => ReadonlyArray<AuthEnvironmentScope>;
}>;

/** Hosted web and desktop with its local server off never register a primary environment. */
const expectsPrimaryEnvironment = () => !isHostedStaticApp() && !isLocalEnvironmentDisabled();

/**
 * Why this device cannot run `commands` on a computer, or null when it can. A computer this device
 * no longer saves is only explained when `missingLabel` names it, like a saved Library.
 */
export function useAccessBlock(
  environmentId: EnvironmentId | null,
  commands: GuardedCommands,
  missingLabel?: string,
) {
  const { isReady, presentation } = useEnvironmentPresentation(environmentId);
  const session = useEnvironmentSessionState(environmentId);
  const primaryId = usePrimaryEnvironmentId();
  if (environmentId === null) return null;
  // The primary environment joins the catalog after it is ready and can be the Library itself, so
  // a missing computer counts as removed only once the primary has registered.
  const catalogComplete = isReady && (primaryId !== null || !expectsPrimaryEnvironment());
  const requiredScopes = commands.flatMap((command) => command.requiredScopes());
  const environment = presentation && projectEnvironmentPresentation(environmentId, presentation);
  const block = environment
    ? accessBlock({
        label: environment.label,
        phase: environment.entry.enabled ? environment.connection.phase : null,
        connectionError: environment.connection.error,
        identity: identityProfile(environment.entry) !== undefined,
        session: session.data,
        sessionFailed: session.hasError,
        requiredScopes,
      })
    : catalogComplete && missingLabel !== undefined
      ? accessBlock({
          label: missingLabel,
          phase: null,
          connectionError: null,
          identity: false,
          session: null,
          sessionFailed: false,
          requiredScopes,
        })
      : null;
  return block && { ...block, environmentId };
}

export type EnvironmentAccessBlock = NonNullable<ReturnType<typeof useAccessBlock>>;

/** Why this device cannot run `commands` on its Library, or null when it can or has none. */
export function useLibraryAccessBlock(
  authorityId: EnvironmentId | null,
  commands: GuardedCommands,
) {
  return useAccessBlock(authorityId, commands, "Your Library");
}
