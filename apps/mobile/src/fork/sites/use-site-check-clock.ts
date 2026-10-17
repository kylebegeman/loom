import { useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { createSiteCheckClock } from "@t3tools/client-runtime/fork";
import type { SitesSnapshot } from "@t3tools/contracts/fork";

function subscribeToResume(refresh: () => void) {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") refresh();
  });
  return () => subscription.remove();
}

export function useSiteCheckClock(snapshot: SitesSnapshot | null | undefined) {
  const clock = useMemo(() => createSiteCheckClock(snapshot, subscribeToResume), [snapshot]);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}
