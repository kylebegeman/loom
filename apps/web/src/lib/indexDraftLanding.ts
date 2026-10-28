import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";

import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import type { ThreadSortInput } from "@t3tools/client-runtime/state/thread-sort";

type LandingProject = Pick<
  EnvironmentProject,
  "environmentId" | "id" | "title" | "createdAt" | "updatedAt"
>;
type LandingThread = ThreadSortInput &
  Pick<EnvironmentThreadShell, "environmentId" | "projectId" | "archivedAt">;

/** Automatic fresh drafts use connected computers; cached history stays available separately. */
export function resolveIndexDraftProject<TProject extends LandingProject>(
  projects: readonly TProject[],
  threads: readonly LandingThread[],
  connectedEnvironmentIds: readonly EnvironmentId[],
): TProject | null {
  const connected = new Set(connectedEnvironmentIds);
  const availableProjects = projects.filter((project) => connected.has(project.environmentId));
  return sortScopedProjectsForSidebar(availableProjects, threads, "updated_at")[0] ?? null;
}
