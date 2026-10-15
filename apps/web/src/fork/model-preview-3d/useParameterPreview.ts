import { useCallback, useEffect, useState } from "react";
type ParameterState = { overrides: Readonly<Record<string, string>>; setName: string | null };
function sameState(left: ParameterState, right: ParameterState) {
  const keys = Object.keys(left.overrides);
  return (
    left.setName === right.setName &&
    keys.length === Object.keys(right.overrides).length &&
    keys.every((key) => left.overrides[key] === right.overrides[key])
  );
}
/** Quiet after a parameter change before the preview renders on its own. */
export const AUTO_RENDER_MS = 400;

/**
 * Renders the current values once they have been quiet for AUTO_RENDER_MS. A newer change
 * restarts the wait, and nothing renders while `held` (a scrub is under way). Pausing auto
 * preview retains the applied values until an explicit Apply. A new applied state replaces the
 * render in flight, which the server then stops.
 */
export function useParameterPreview(
  current: ParameterState,
  ready: boolean,
  automatic: boolean,
  source: string | null = null,
  held = false,
) {
  const [baseline, setBaseline] = useState(source);
  const [applied, setApplied] = useState<ParameterState | null>(null);
  if (baseline !== source) {
    setBaseline(source);
    setApplied(ready ? current : null);
  }
  if (ready && applied === null) setApplied(current);
  useEffect(() => {
    if (!ready || applied === null || !automatic || held || sameState(current, applied)) return;
    const timeout = setTimeout(() => setApplied(current), AUTO_RENDER_MS);
    return () => clearTimeout(timeout);
  }, [current, ready, automatic, held, applied]);
  const apply = useCallback(() => setApplied(current), [current]);
  return {
    applied: applied ?? current,
    apply,
    hasUnapplied: applied !== null && !sameState(current, applied),
  };
}
