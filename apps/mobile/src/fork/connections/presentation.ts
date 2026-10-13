import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { getThreadSortTimestamp } from "@t3tools/client-runtime/state/thread-sort";

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

/** Cached conversations stay available when the computer is offline. */
export function recentConversationForComputer(
  threads: readonly EnvironmentThreadShell[],
  projects: readonly EnvironmentProject[],
  environmentId: EnvironmentId,
): EnvironmentThreadShell | null {
  const projectIds = new Set(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => project.id),
  );
  let recent: EnvironmentThreadShell | null = null;
  for (const thread of threads) {
    if (
      thread.environmentId !== environmentId ||
      !projectIds.has(thread.projectId) ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      thread.lineage.relationshipToParent === "subagent" ||
      (thread.visibleItemCount === 0 &&
        thread.latestRun === null &&
        !threadRuntimeIsActive(thread.runtime))
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
