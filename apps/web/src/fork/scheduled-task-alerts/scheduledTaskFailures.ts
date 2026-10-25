import type { ScheduledTask } from "@t3tools/contracts";

type ScheduledTaskRun = Pick<ScheduledTask, "id" | "lastRunAt" | "lastRunStatus">;

/** Each task's last run as this client last saw it, by task id. */
export type ScheduledTaskRunMarks = ReadonlyMap<string, string>;

export const scheduledTaskRunMark = (task: ScheduledTaskRun) =>
  `${task.lastRunAt ?? ""}:${task.lastRunStatus}`;

/**
 * The tasks whose last run failed since `seen` was taken. With nothing seen yet, the first list
 * only records what is there: a failure from before this client connected is not news. A task
 * added since then counts as new, so one that failed during a reconnect still alerts.
 */
export function newScheduledTaskFailures<Task extends ScheduledTaskRun>(
  seen: ScheduledTaskRunMarks | null,
  tasks: readonly Task[],
): { readonly marks: ScheduledTaskRunMarks; readonly failed: readonly Task[] } {
  const marks = new Map(tasks.map((task) => [task.id, scheduledTaskRunMark(task)] as const));
  if (seen === null) return { marks, failed: [] };
  return {
    marks,
    failed: tasks.filter(
      (task) => task.lastRunStatus === "failed" && seen.get(task.id) !== marks.get(task.id),
    ),
  };
}
