import { useEffect, useRef } from "react";

/** Prevents a response for a departed form from changing the current screen. */
export function useBotActionLifetime() {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return active;
}
