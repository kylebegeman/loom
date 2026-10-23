import * as DateTime from "effect/DateTime";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface BotsUsageWindow {
  readonly since: string;
  readonly until: string;
}

/** The server's upper bound is exclusive; the next minute includes runs created just now while keeping refresh keys stable within a minute. */
export const rollingBotsUsageWindow = (days: number, nowMs: number): BotsUsageWindow => {
  const until = (Math.floor(nowMs / MINUTE_MS) + 1) * MINUTE_MS;
  return {
    since: DateTime.formatIso(DateTime.makeUnsafe(until - days * DAY_MS)),
    until: DateTime.formatIso(DateTime.makeUnsafe(until)),
  };
};
