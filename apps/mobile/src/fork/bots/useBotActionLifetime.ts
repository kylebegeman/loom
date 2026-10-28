import { useEffect, useRef } from "react";

/** Prevents a response for a departed form from changing the current screen. */
export function useBotActionLifetime() {
  const active = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks mount state so async bot actions finishing after unmount are ignored
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return active;
}
