import { useEffect, useMemo, useReducer } from "react";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useNowMinute } from "~/hooks/useNowMinute";

/** Snooze deadlines are second-precise; the shared minute clock only updates relative labels. */
export function useProjectHomeClock(threads: readonly EnvironmentThreadShell[]) {
  const minute = useNowMinute();
  const [wakeTick, bumpWakeTick] = useReducer((tick: number) => tick + 1, 0);
  const now = useMemo(() => {
    void minute;
    void wakeTick;
    void threads;
    return new Date().toISOString();
    // oxlint-disable-next-line react/memo-dependencies -- Shell changes and timer ticks invalidate this real-clock snapshot before snooze classification.
  }, [minute, wakeTick, threads]);
  const nextWake = useMemo(() => {
    let deadline = Number.POSITIVE_INFINITY;
    for (const thread of threads) {
      if (!thread.snoozedUntil || !effectiveSnoozed(thread, { now })) continue;
      const parsed = Date.parse(thread.snoozedUntil);
      if (Number.isFinite(parsed)) deadline = Math.min(deadline, parsed);
    }
    return deadline;
  }, [threads, now]);
  useEffect(() => {
    void now;
    if (!Number.isFinite(nextWake)) return;
    const timeout = window.setTimeout(
      () => bumpWakeTick(),
      Math.min(Math.max(0, nextWake - Date.now()), 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A clamped long snooze must rearm after its timer refreshes the clock even when its deadline stays the same.
  }, [nextWake, now]);
  return now;
}
