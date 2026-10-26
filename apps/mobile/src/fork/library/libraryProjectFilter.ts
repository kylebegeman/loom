import {
  libraryHoldsLocalRefs,
  libraryOutsideArchivedProjects,
  libraryProjectFilterItems,
  libraryThreadMatchesScope,
  type parseLibraryProjectScope,
} from "@t3tools/client-runtime/fork";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";

import type { HomeListFilterMenuProject } from "../../features/home/home-list-filter-menu";
import type { HomeProjectScope } from "../../features/home/homeThreadList";
import { scopedProjectKey } from "../../lib/scopedEntities";

/**
 * Every mobile project filter: Library projects, then local folders no live Library project holds.
 * A folder held only by an archived project stays a plain folder so it never vanishes, and the
 * selected scope stays listed so it can be seen and cleared.
 */
export function libraryProjectFilterOptions(input: {
  readonly scopes: ReadonlyArray<Pick<HomeProjectScope, "key" | "title" | "projectRefs">>;
  readonly catalog: readonly LibraryProject[];
  readonly threads: readonly LibraryThreadSummary[];
  readonly copies: readonly LibraryWorkingCopy[];
  readonly selectedKey: string | null;
}): HomeListFilterMenuProject[] {
  const threads = libraryOutsideArchivedProjects(input.threads, input.catalog);
  const copies = libraryOutsideArchivedProjects(input.copies, input.catalog);
  return [
    ...libraryProjectFilterItems(input.catalog, input.selectedKey).map((item) => ({
      key: item.value,
      label: item.label,
    })),
    ...input.scopes
      .filter(
        (scope) =>
          scope.key === input.selectedKey ||
          !libraryHoldsLocalRefs(threads, scope.projectRefs, copies),
      )
      .map((scope) => ({ key: scope.key, label: scope.title })),
  ];
}

/** The local projects a Library scope lists, by the threads saved for it. */
export function libraryScopeProjectKeys(
  scope: NonNullable<ReturnType<typeof parseLibraryProjectScope>>,
  threads: readonly LibraryThreadSummary[],
): ReadonlySet<string> {
  return new Set(
    threads
      .filter((thread) => libraryThreadMatchesScope(thread, scope))
      .map((thread) => scopedProjectKey(thread.environmentId, thread.localProjectId)),
  );
}
