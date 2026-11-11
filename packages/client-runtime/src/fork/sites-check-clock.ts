// @effect-diagnostics globalDate:off globalTimers:off - Mounted presentation clock outside the Effect runtime.
import type { SitesSnapshot } from "@t3tools/contracts/fork";

const MAX_TIMEOUT_MS = 2_147_483_647;

/** Only mounted consumers own a timer or a platform resume listener. */
export function createSiteCheckClock(
  snapshot: Pick<SitesSnapshot, "checks" | "staleAfterSeconds" | "observedAt"> | null | undefined,
  subscribeToResume: (refresh: () => void) => () => void,
) {
  const expiry = (timestamp: string) => {
    const at = Date.parse(timestamp);
    if (!Number.isFinite(at)) return [];
    // The exact age boundary is still fresh; future observations remain unverified until then.
    return [at, at + (snapshot?.staleAfterSeconds ?? 0) * 1000 + 1].filter(Number.isFinite);
  };
  const deadlines = [
    ...(snapshot?.observedAt ? expiry(snapshot.observedAt) : []),
    ...(snapshot?.checks.flatMap((check) =>
      !check.last || check.state === "disabled" || check.state === "stale"
        ? []
        : expiry(check.last.checked_at),
    ) ?? []),
  ];
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
