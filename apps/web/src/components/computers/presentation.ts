import type { EnvironmentId } from "@t3tools/contracts";
import type {
  EnvironmentThreadShell,
  EnvironmentProject,
} from "@t3tools/client-runtime/state/shell";
import { getThreadSortTimestamp } from "~/lib/threadSort";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";
import type { ServerProvider } from "@t3tools/contracts";

/** Only installed, usable instances with selectable models can start work. */
export function readyAgentCount(
  providers: ReadonlyArray<
    Pick<ServerProvider, "enabled" | "installed" | "status" | "availability" | "models">
  >,
): number {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.status === "ready" &&
      provider.availability !== "unavailable" &&
      provider.models.length > 0,
  ).length;
}

/** Recent user conversations remain browsable even when their computer is offline. */
export function recentConversationForComputer(
  threads: readonly EnvironmentThreadShell[],
  projects: readonly Pick<EnvironmentProject, "environmentId" | "id">[],
  environmentId: EnvironmentId,
): EnvironmentThreadShell | null {
  const projectKeys = new Set(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => `${project.environmentId}:${project.id}`),
  );
  let recent: EnvironmentThreadShell | null = null;
  for (const thread of filterSidebarV2VisibleThreads(threads, projectKeys)) {
    if (thread.deletedAt !== null) continue;
    if (
      thread.visibleItemCount === 0 &&
      thread.latestRun === null &&
      !threadRuntimeIsActive(thread.runtime)
    )
      continue;
    if (
      recent === null ||
      getThreadSortTimestamp(thread, "updated_at") > getThreadSortTimestamp(recent, "updated_at")
    )
      recent = thread;
  }
  return recent;
}
