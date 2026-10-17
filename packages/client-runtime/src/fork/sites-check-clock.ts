// @effect-diagnostics globalDate:off globalTimers:off - Mounted presentation clock outside the Effect runtime.
import type { SitesSnapshot } from "@t3tools/contracts/fork";

const MAX_TIMEOUT_MS = 2_147_483_647;

/** Only mounted consumers own a timer or a platform resume listener. */
export function createSiteCheckClock(
  snapshot: Pick<SitesSnapshot, "checks" | "staleAfterSeconds"> | null | undefined,
  subscribeToResume: (refresh: () => void) => () => void,
) {
  const deadlines =
    snapshot?.checks.flatMap((check) => {
      if (!check.last || check.state === "disabled" || check.state === "stale") return [];
      // siteCheckState treats the exact age boundary as fresh.
      const deadline = Date.parse(check.last.checked_at) + snapshot.staleAfterSeconds * 1000 + 1;
      return Number.isFinite(deadline) ? [deadline] : [];
    }) ?? [];
  let now = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeResume: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const refresh = () => {
    clearTimeout(timer);
    timer = undefined;
    if (listeners.size === 0) return;
    now = Date.now();
    let next = Infinity;
    for (const deadline of deadlines) {
      if (deadline > now && deadline < next) next = deadline;
    }
    if (Number.isFinite(next)) timer = setTimeout(refresh, Math.min(next - now, MAX_TIMEOUT_MS));
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => now,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        unsubscribeResume = subscribeToResume(refresh);
        refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearTimeout(timer);
          timer = undefined;
          unsubscribeResume?.();
          unsubscribeResume = undefined;
        }
      };
    },
  };
}
