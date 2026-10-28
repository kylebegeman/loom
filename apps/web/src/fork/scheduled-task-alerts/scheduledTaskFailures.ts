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

const SEEN_KEY = "loom:scheduled-task-alerts:seen:v1";
type MarkStorage = Pick<Storage, "getItem" | "setItem">;

export function readScheduledTaskRunMarks(
  environmentId: string,
  storage: () => MarkStorage = () => localStorage,
): ScheduledTaskRunMarks | null {
  try {
    const raw = storage().getItem(`${SEEN_KEY}:${environmentId}`);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string"))
      return null;
    return new Map(entries);
  } catch {
    return null;
  }
}

export function writeScheduledTaskRunMarks(
  environmentId: string,
  marks: ScheduledTaskRunMarks,
  storage: () => MarkStorage = () => localStorage,
): void {
  try {
    storage().setItem(`${SEEN_KEY}:${environmentId}`, JSON.stringify(Object.fromEntries(marks)));
  } catch {
    /* In-memory marks still prevent repeats when browser storage is unavailable. */
  }
}
