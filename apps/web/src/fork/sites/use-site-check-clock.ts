import { useMemo, useSyncExternalStore } from "react";
import { createSiteCheckClock } from "@t3tools/client-runtime/fork";
import type { SitesSnapshot } from "@t3tools/contracts/fork";

function subscribeToResume(refresh: () => void) {
  const visible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("focus", visible);
  window.addEventListener("pageshow", visible);
  return () => {
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("focus", visible);
    window.removeEventListener("pageshow", visible);
  };
}

export function useSiteCheckClock(snapshot: SitesSnapshot | null | undefined) {
  const clock = useMemo(() => createSiteCheckClock(snapshot, subscribeToResume), [snapshot]);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}
