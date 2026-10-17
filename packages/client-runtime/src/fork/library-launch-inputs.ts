import type { EnvironmentId, ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  LIBRARY_PROFILE_READINESS_FEATURE,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import type { LibraryLaunchComputer } from "@t3tools/shared/fork/library-launch";
import { threadRuntimeIsActive, type EnvironmentThreadShell } from "../state/models.ts";
import { supportsLoomFeature } from "./capabilities.ts";

/** Computers advertise this when they can check a Mini worker's readiness. */
export const MINI_WORKER_READINESS_FEATURE = "mini-worker-readiness";

/** A computer this client has a connection entry for, as a possible launch host. */
export interface LibraryLaunchHost {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  /** Enabled and connected now. */
  readonly online: boolean;
  /** False for computers that cannot run this client's conversations; they are never ranked. */
  readonly supportsExecution: boolean;
  readonly capabilities: ExecutionEnvironmentCapabilities | null | undefined;
}

/** A computer the Library remembers, whether or not this client connects to it. */
export interface LibraryLaunchRememberedComputer {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly supportsExecution: boolean;
}

export interface LibraryLaunchHealthTarget {
  readonly environmentId: EnvironmentId;
  readonly workingCopyId: string;
}

/**
 * Threads running on each computer now. A thread waiting on an approval or an answer is not
 * counted, matching the sidebar's "working" status.
 */
export function libraryWorkingThreadCounts(
  shells: readonly Pick<
    EnvironmentThreadShell,
    | "environmentId"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "pendingSubagentRequest"
    | "runtime"
  >[],
): ReadonlyMap<EnvironmentId, number> {
  const counts = new Map<EnvironmentId, number>();
  for (const shell of shells) {
    if (shell.hasPendingApprovals || shell.hasPendingUserInput) continue;
    if (
      shell.pendingSubagentRequest === "approval" ||
      shell.pendingSubagentRequest === "user_input"
    )
      continue;
    if (!threadRuntimeIsActive(shell.runtime)) continue;
    counts.set(shell.environmentId, (counts.get(shell.environmentId) ?? 0) + 1);
  }
  return counts;
}

/**
 * What a client needs to rank a project's launch computers: the computers themselves, the copies
 * whose health to read live, and where to check required tools and Mini workers. Computers the
 * Library remembers but this client has no entry for are listed offline. Older computers that do
 * not advertise a check are left out of it, so they rank as before.
 */
export function libraryLaunchInputs(input: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly hosts: readonly LibraryLaunchHost[];
  readonly remembered: readonly LibraryLaunchRememberedComputer[];
  readonly workingThreads: ReadonlyMap<EnvironmentId, number>;
}): {
  readonly computers: readonly LibraryLaunchComputer[];
  readonly healthTargets: readonly LibraryLaunchHealthTarget[];
  /** Empty unless the profile lists required tools. */
  readonly readinessEnvironmentIds: readonly EnvironmentId[];
  /** Empty unless the profile allows Mini. */
  readonly miniEnvironmentIds: readonly EnvironmentId[];
} {
  const computers: LibraryLaunchComputer[] = [
    ...input.hosts.map((host) => ({
      environmentId: host.environmentId,
      label: host.label,
      online: host.online,
      supportsExecution: host.supportsExecution,
      workingThreads: input.workingThreads.get(host.environmentId) ?? 0,
    })),
    ...input.remembered
      .filter(
        (computer) => !input.hosts.some((host) => host.environmentId === computer.environmentId),
      )
      .map((computer) => ({
        environmentId: computer.environmentId,
        label: computer.label,
        online: false,
        supportsExecution: computer.supportsExecution,
        workingThreads: 0,
      })),
  ];
  const onlineWith = (feature: string) =>
    input.hosts
      .filter((host) => host.online && supportsLoomFeature(host.capabilities, feature))
      .map((host) => host.environmentId);
  const healthHosts = new Set(onlineWith(LIBRARY_COPY_HEALTH_FEATURE));
  return {
    computers,
    healthTargets: input.copies
      .filter(
        (copy) =>
          copy.projectId === input.project.id &&
          copy.state === "ready" &&
          healthHosts.has(copy.environmentId),
      )
      .map((copy) => ({ environmentId: copy.environmentId, workingCopyId: copy.id })),
    readinessEnvironmentIds:
      (input.project.profile?.requiredTools?.length ?? 0) > 0
        ? onlineWith(LIBRARY_PROFILE_READINESS_FEATURE)
        : [],
    miniEnvironmentIds:
      input.project.profile?.allowMini === true ? onlineWith(MINI_WORKER_READINESS_FEATURE) : [],
  };
}
