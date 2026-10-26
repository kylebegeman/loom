import { useNavigation } from "@react-navigation/native";
import { parseLibraryProjectScope } from "@t3tools/client-runtime/fork";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import type { HomeProjectScope } from "../../features/home/homeThreadList";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { libraryProjectFilterOptions, libraryScopeProjectKeys } from "./libraryProjectFilter";
import { library, useLibraryAuthority } from "./libraryState";

/** Library project scope keys stay selected even when no local project backs them. */
export function isLibraryProjectScopeKey(key: string | null): boolean {
  return parseLibraryProjectScope(key) !== null;
}

/**
 * The project filter shared by Home and the tablet sidebar, and the local projects a selected
 * Library scope lists. The catalog includes archived projects so their conversations and copies
 * can be told apart.
 */
export function useLibraryProjectFilter(
  scopes: ReadonlyArray<HomeProjectScope>,
  selectedKey: string | null,
) {
  const { environmentId } = useLibraryAuthority();
  const catalog = useEnvironmentQuery(
    environmentId ? library.projects({ environmentId, input: { includeArchived: true } }) : null,
  );
  const index = useEnvironmentQuery(
    environmentId ? library.threadIndex({ environmentId, input: { limit: 200 } }) : null,
  );
  const copies = useEnvironmentQuery(
    environmentId ? library.copies({ environmentId, input: {} }) : null,
  );
  const scope = parseLibraryProjectScope(selectedKey);
  const scopeThreads = useEnvironmentQuery(
    environmentId && scope
      ? library.threads({ environmentId, input: { projectId: scope.projectId } })
      : null,
  );
  return {
    options: libraryProjectFilterOptions({
      scopes,
      catalog: catalog.data ?? [],
      threads: index.data?.threads ?? [],
      copies: copies.data ?? [],
      selectedKey,
    }),
    libraryProjectKeys: scope ? libraryScopeProjectKeys(scope, scopeThreads.data ?? []) : null,
  };
}

/**
 * Library additions to the Home thread list: a selected Library project leads New task, and a
 * thread on a computer that is not connected opens its saved Library history when one exists.
 */
export function useHomeLibraryProjects(selectLiveThread: (thread: EnvironmentThreadShell) => void) {
  const navigation = useNavigation();
  const libraryAuthority = useLibraryAuthority();
  const { environments: executionConnections } = useEnvironments();
  const lookupSavedThread = useAtomQueryRunner(library.lookupThread, { reportFailure: false });

  const selectThread = async (thread: EnvironmentThreadShell) => {
    if (
      libraryAuthority.environmentId &&
      executionConnections.find((entry) => entry.environmentId === thread.environmentId)?.connection
        .phase !== "connected"
    ) {
      const saved = await lookupSavedThread({
        environmentId: libraryAuthority.environmentId,
        input: { sourceEnvironmentId: thread.environmentId, threadId: thread.id },
      });
      if (saved._tag === "Success" && saved.value) {
        navigation.navigate("LibraryHistory", {
          projectId: saved.value.projectId,
          archiveId: saved.value.id,
        });
        return;
      }
    }
    selectLiveThread(thread);
  };

  /**
   * Opens New task, led by the project a Library scope key selects. The filter only suggests it, as
   * on web, so the other projects and No project stay offered beside it. Without a Library scope,
   * the workspace's own New task flow runs.
   */
  const startConversation = (projectKey: string | null, startNewTask: () => void) => {
    const scope = parseLibraryProjectScope(projectKey);
    if (scope) navigation.navigate("NewTaskProject", { libraryProjectId: scope.projectId });
    else startNewTask();
  };

  return { selectThread, startConversation };
}
