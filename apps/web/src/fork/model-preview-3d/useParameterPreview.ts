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
/** Pausing auto preview retains the applied values until an explicit Apply. */
export function useParameterPreview(
  current: ParameterState,
  ready: boolean,
  automatic: boolean,
  source: string | null = null,
) {
  const [baseline, setBaseline] = useState(source);
  const [applied, setApplied] = useState<ParameterState | null>(null);
  if (baseline !== source) {
    setBaseline(source);
    setApplied(ready ? current : null);
  }
  if (ready && applied === null) setApplied(current);
  useEffect(() => {
    if (!ready || applied === null || !automatic || sameState(current, applied)) return;
    const timeout = setTimeout(() => setApplied(current), 300);
    return () => clearTimeout(timeout);
  }, [current, ready, automatic, applied]);
  const apply = useCallback(() => setApplied(current), [current]);
  return {
    applied: applied ?? current,
    apply,
    hasUnapplied: applied !== null && !sameState(current, applied),
  };
}
