import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";

import type { HomeProjectScope } from "../../features/home/homeThreadList";
import { resolveThreadListV2Status } from "../../features/threads/threadListV2";

/** Preserve the native thread list's capability and snooze/settlement precedence. */
export function projectThreadActivity(
  thread: EnvironmentThreadShell,
  options: {
    readonly now: string;
    readonly settlementEnvironmentIds: ReadonlySet<EnvironmentId>;
    readonly snoozeEnvironmentIds: ReadonlySet<EnvironmentId>;
    readonly queuedThreadKeys: ReadonlySet<string>;
  },
): "attention" | "working" | "failed" | "ready" | "settled" | "snoozed" {
  if (
    options.snoozeEnvironmentIds.has(thread.environmentId) &&
    effectiveSnoozed(thread, { now: options.now })
  )
    return "snoozed";
  if (
    options.settlementEnvironmentIds.has(thread.environmentId) &&
    thread.settledOverride === "settled" &&
    !options.queuedThreadKeys.has(`${thread.environmentId}:${thread.id}`)
  )
    return "settled";
  const status = resolveThreadListV2Status(thread);
  if (status === "approval" || status === "input") return "attention";
  if (status === "working" || status === "waiting") return "working";
  if (status === "failed" || status === "limited") return "failed";
  return "ready";
}

/** Never silently route new work to an offline or read-only member of a logical project. */
export function projectTaskDestination(
  scope: HomeProjectScope,
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>,
  operableEnvironmentIds: ReadonlySet<EnvironmentId>,
): EnvironmentProject | null {
  const eligible = (project: EnvironmentProject) =>
    connectedEnvironmentIds.has(project.environmentId) &&
    operableEnvironmentIds.has(project.environmentId);
  return eligible(scope.representative)
    ? scope.representative
    : (scope.projects.find(eligible) ?? null);
}

/** Filter grouping can combine Scratch, while settings must retain each owner's scope. */
export function resolveProjectSettingsScope(
  groups: ReadonlyArray<{
    readonly key: string;
    readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
  }>,
  target: ScopedProjectRef,
): string | null {
  return (
    groups.find((group) =>
      group.memberProjectRefs.some(
        (ref) => ref.environmentId === target.environmentId && ref.projectId === target.projectId,
      ),
    )?.key ?? null
  );
}
