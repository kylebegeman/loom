import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryProject,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { libraryCopiesForScope } from "./library-copy-choice.ts";
import {
  effectiveLibraryCopyHealth,
  libraryRepositoryHealthSummary,
} from "./library-copy-health.ts";

export const LIBRARY_PROJECT_HOME_HEALTH_MAX_AGE_MS = 5 * 60_000;
const CLOCK_SKEW_ALLOWANCE_MS = 60_000;

export function selectLibraryProjectHomeCopies(
  projectId: string,
  copies: readonly LibraryWorkingCopy[],
  connected: ReadonlySet<EnvironmentId>,
) {
  return copies
    .filter(
      (copy) =>
        copy.projectId === projectId && copy.state !== "released" && copy.registered !== false,
    )
    .sort(
      (a, b) =>
        Number(connected.has(b.environmentId)) - Number(connected.has(a.environmentId)) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id),
    );
}

/** Failed starts can have a request on a computer without ever registering files there. */
export function libraryProjectRequestHosts(
  authorityId: EnvironmentId,
  copies: readonly LibraryWorkingCopy[],
  connected: readonly EnvironmentId[],
) {
  return [...new Set([authorityId, ...connected, ...copies.map((copy) => copy.environmentId)])];
}

export function libraryProjectHomeLocation(input: {
  readonly project: LibraryProject;
  readonly copy: LibraryWorkingCopy;
  readonly connected: boolean;
  readonly liveHealth: LibraryCopyHealth | null;
  readonly readFailed: boolean;
  readonly readPending: boolean;
  readonly now: number;
}) {
  const { project, copy, connected, readFailed, now } = input;
  const repositories = project.resources.filter((resource) => resource.kind !== "link");
  const missingComponents = repositories
    .filter(
      (resource) =>
        libraryCopiesForScope(
          { ...project, archived: false },
          [{ ...copy, state: "ready" }],
          copy.environmentId,
          [resource.id],
        ).length === 0,
    )
    .map((resource) => resource.title);
  const effective = effectiveLibraryCopyHealth({
    copy,
    live: connected && !readFailed ? input.liveHealth : null,
  });
  const health = effective?.health;
  const age = effective ? now - Date.parse(effective.asOf) : Number.POSITIVE_INFINITY;
  const recent =
    !input.readPending &&
    effective?.source === "live" &&
    age >= -CLOCK_SKEW_ALLOWANCE_MS &&
    age < LIBRARY_PROJECT_HOME_HEALTH_MAX_AGE_MS;
  const complete =
    repositories.length > 0 &&
    missingComponents.length === 0 &&
    repositories.every((resource) =>
      health?.repositories.some(
        (entry) =>
          entry.resourceId === resource.id &&
          now - Date.parse(entry.checkedAt) < LIBRARY_PROJECT_HOME_HEALTH_MAX_AGE_MS &&
          now - Date.parse(entry.checkedAt) >= -CLOCK_SKEW_ALLOWANCE_MS,
      ),
    );
  const relevantHealth =
    health?.repositories.filter((entry) =>
      repositories.some((resource) => resource.id === entry.resourceId),
    ) ?? [];
  const broken = relevantHealth.some((entry) => entry.error !== undefined);
  const attention = relevantHealth.flatMap((entry) => {
    const title = repositories.find((resource) => resource.id === entry.resourceId)!.title;
    return entry.error !== undefined
      ? [`${title}: ${libraryRepositoryHealthSummary(entry)}`]
      : entry.fetchFailed
        ? [`${title}: remote check needed`]
        : (entry.behind ?? 0) > 0
          ? [`${title}: ${entry.behind} behind last fetched remote`]
          : [];
  });
  const status = !connected
    ? ("offline" as const)
    : copy.state === "preparing"
      ? ("preparing" as const)
      : copy.state !== "ready" || missingComponents.length > 0 || (recent && broken)
        ? ("attention" as const)
        : recent && complete && !broken
          ? ("available" as const)
          : ("needs-check" as const);
  const labels = {
    offline: "Offline",
    preparing: "Preparing files",
    attention: "Needs attention",
    available: "Files available",
    "needs-check": "Needs check",
  };
  const detail = !connected
    ? "Saved location. Reconnect this computer to check its files."
    : copy.state === "preparing"
      ? "Preparation was recorded. Check the request for its current outcome."
      : missingComponents.length > 0
        ? `Missing current components: ${missingComponents.join(", ")}.`
        : copy.state !== "ready"
          ? "The saved file location needs review before work can continue."
          : readFailed
            ? "The current check failed. Saved observations do not confirm readiness."
            : status === "available"
              ? "Repositories are readable. Tool setup is checked when starting work."
              : recent && broken
                ? "The current repository check found a problem. Review these files."
                : "Saved observations do not confirm current readiness. Check this computer before starting.";
  return {
    status,
    label: labels[status],
    detail,
    missingComponents,
    attention,
    checkedAt: effective?.asOf ?? null,
    observation: effective?.source === "live" ? "Checked" : "Last reported",
    tone:
      status === "available"
        ? ("success" as const)
        : status === "attention" || status === "needs-check"
          ? ("warning" as const)
          : ("neutral" as const),
  };
}
