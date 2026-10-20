import { useEffect, useState } from "react";

export function useVaultTime(deadlines: readonly (number | null)[], observedAt = 0) {
  const [clock, setNow] = useState(Date.now);
  const now = Math.max(clock, observedAt);
  const next = Math.min(
    ...deadlines.filter((value): value is number => value !== null && value > now),
  );
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const remaining = next - Date.now();
      timer =
        remaining > 2_147_483_647
          ? setTimeout(schedule, 2_147_483_647)
          : setTimeout(
              () => {
                const current = Date.now();
                if (current < next) schedule();
                else setNow(current);
              },
              Math.max(0, remaining) + 1,
            );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [next]);
  return now;
}
