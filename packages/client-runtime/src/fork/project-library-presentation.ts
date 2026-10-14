import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ProjectNavigationEntry,
  ProjectNavigationGroup,
  ProjectNavigationThread,
} from "./project-navigation.ts";

/** The library offers a short preview; Project home keeps the complete history. */
export const PROJECT_LIBRARY_PREVIEW_LIMIT = 3;

type LibraryEntry = Pick<
  ProjectNavigationEntry<ProjectNavigationGroup, ProjectNavigationThread>,
  | "threadCount"
  | "attentionCount"
  | "failedCount"
  | "workingCount"
  | "readyCount"
  | "snoozedCount"
  | "settledCount"
  | "offlineCount"
  | "environmentIds"
>;

type StatusKind = "attention" | "failed" | "working" | "ready" | "snoozed" | "settled" | "offline";

/** Summarize work by priority without making cached activity look live. */
export function createProjectLibraryPresentation(
  entry: LibraryEntry,
  computerNames: ReadonlyMap<string, string>,
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>,
) {
  const environmentIds = [...new Set(entry.environmentIds)];
  const offlineComputerCount = environmentIds.filter(
    (id) => !connectedEnvironmentIds.has(id),
  ).length;
  const allOffline = environmentIds.length > 0 && offlineComputerCount === environmentIds.length;
  const computerSummary =
    environmentIds.length === 1
      ? (computerNames.get(environmentIds[0]!) ?? "Computer")
      : environmentIds.length > 1
        ? `${environmentIds.length} computers`
        : "";
  const threadSummary =
    entry.threadCount === 0
      ? "No threads yet"
      : `${entry.threadCount} ${entry.threadCount === 1 ? "thread" : "threads"}`;
  const metadata = `${threadSummary}${computerSummary ? ` on ${computerSummary}` : ""}`;
  const activity = [
    entry.attentionCount > 0
      ? `${entry.attentionCount} ${entry.attentionCount === 1 ? "needs" : "need"} attention`
      : null,
    entry.failedCount > 0 ? `${entry.failedCount} failed` : null,
    entry.workingCount > 0 ? `${entry.workingCount} working` : null,
    entry.readyCount > 0 ? `${entry.readyCount} ready to continue` : null,
    entry.snoozedCount > 0 ? `${entry.snoozedCount} snoozed` : null,
    entry.settledCount > 0 ? `${entry.settledCount} settled` : null,
    entry.offlineCount > 0 ? `${entry.offlineCount} last known on offline computers` : null,
  ].filter((label): label is string => label !== null);
  const computerDetails = environmentIds.map(
    (id) =>
      `${computerNames.get(id) ?? "Computer"}${connectedEnvironmentIds.has(id) ? "" : " (offline)"}`,
  );
  const accessibilitySummary = [
    threadSummary,
    computerDetails.length > 0 ? `Computers: ${computerDetails.join(", ")}` : null,
    ...(allOffline && activity.length > 0
      ? [`Last known activity: ${activity.join(", ")}`]
      : activity),
  ]
    .filter(Boolean)
    .join(". ");
  let status: { kind: StatusKind; label: string } | null = null;
  if (allOffline) status = { kind: "offline", label: "Offline" };
  else if (entry.attentionCount > 0)
    status = { kind: "attention", label: `${entry.attentionCount} attention` };
  else if (entry.failedCount > 0) status = { kind: "failed", label: `${entry.failedCount} failed` };
  else if (entry.workingCount > 0)
    status = { kind: "working", label: `${entry.workingCount} working` };
  else if (entry.readyCount > 0) status = { kind: "ready", label: `${entry.readyCount} ready` };
  else if (entry.snoozedCount > 0)
    status = { kind: "snoozed", label: `${entry.snoozedCount} snoozed` };
  else if (entry.settledCount > 0)
    status = {
      kind: "settled",
      label: entry.settledCount === entry.threadCount ? "Settled" : `${entry.settledCount} settled`,
    };
  else if (entry.offlineCount > 0) status = { kind: "offline", label: "Last known" };
  return { status, metadata, accessibilitySummary, computerSummary };
}
