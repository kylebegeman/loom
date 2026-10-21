import type { BotTriggerSchedule } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";

import { isMissedFixedTimeRun, nextScheduledRunAt } from "../../../scheduledTasks/Schedule.ts";

const isoOrNull = (at: DateTime.DateTime | null) => (at === null ? null : DateTime.formatIso(at));

/** When a schedule trigger first fires, counted from `now` (local time for times of day). */
export const firstFireAt = (schedule: BotTriggerSchedule, now: DateTime.Zoned) =>
  isoOrNull(nextScheduledRunAt(schedule, now));

/**
 * One look at a schedule trigger, with the scheduled task rules: a due time fires once, however
 * long ago; a time of day missed by more than 10 minutes is skipped. `fire` is the due time to fire
 * for, `next` the time to look again.
 */
export const scheduleStep = (
  schedule: BotTriggerSchedule,
  nextFireAt: string | null,
  now: DateTime.Zoned,
): { readonly fire: string | null; readonly next: string | null } => {
  if (nextFireAt === null) return { fire: null, next: firstFireAt(schedule, now) };
  const dueMs = Date.parse(nextFireAt);
  if (!Number.isFinite(dueMs)) return { fire: null, next: firstFireAt(schedule, now) };
  if (dueMs > DateTime.toEpochMillis(now)) return { fire: null, next: nextFireAt };
  const missed = isMissedFixedTimeRun(schedule, DateTime.makeUnsafe(dueMs), now);
  return { fire: missed ? null : nextFireAt, next: firstFireAt(schedule, now) };
};
