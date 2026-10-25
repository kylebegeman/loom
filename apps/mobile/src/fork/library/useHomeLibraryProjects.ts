import { useNavigation } from "@react-navigation/native";
import { libraryProjectFilterItems, parseLibraryProjectScope } from "@t3tools/client-runtime/fork";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useMemo } from "react";

import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { library, useLibraryAuthority } from "./libraryState";

/** Library project scope keys stay selected even when no local project backs them. */
export function isLibraryProjectScopeKey(key: string | null): boolean {
  return parseLibraryProjectScope(key) !== null;
}

/**
 * Library additions to the Home thread list: saved Library projects join the project filter,
 * a selected Library project leads New task, and a thread on a computer that is not connected
 * opens its saved Library history when one exists.
 */
export function useHomeLibraryProjects(selectLiveThread: (thread: EnvironmentThreadShell) => void) {
  const navigation = useNavigation();
  const libraryAuthority = useLibraryAuthority();
  const libraryCatalog = useEnvironmentQuery(
    libraryAuthority.environmentId
      ? library.projects({
          environmentId: libraryAuthority.environmentId,
          input: { includeArchived: true },
        })
      : null,
  );
  const { environments: executionConnections } = useEnvironments();
  const lookupSavedThread = useAtomQueryRunner(library.lookupThread, { reportFailure: false });

  const filterOptions = useMemo(
    () =>
      libraryProjectFilterItems(libraryCatalog.data ?? []).map((item) => ({
        key: item.value,
        label: item.label,
      })),
    [libraryCatalog.data],
  );

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
   * on web, so the other projects and No project stay offered beside it.
   */
  const startConversation = (projectKey: string | null) => {
    const scope = parseLibraryProjectScope(projectKey);
    navigation.navigate(
      "NewTaskSheet",
      scope
        ? { screen: "NewTask", params: { libraryProjectId: scope.projectId } }
        : { screen: "NewTask" },
    );
  };

  return { filterOptions, selectThread, startConversation };
}
