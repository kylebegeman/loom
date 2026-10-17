import { afterEach, expect, it, vi } from "vite-plus/test";
import { createSiteCheckClock } from "./sites-check-clock.ts";
import { siteCheckState } from "./sites-presentation.ts";

const checkedAt = Date.parse("2026-10-17T00:00:00Z");
const check = {
  id: "check",
  service_id: "api",
  name: "API",
  url: "https://api.example.test",
  active: 1 as const,
  state: "healthy" as const,
  last: {
    checked_at: "2026-10-17T00:00:00Z",
    ok: 1 as const,
    status: 200,
    duration_ms: 1,
    tls_expires_at: null,
    error: null,
  },
};

afterEach(() => vi.useRealTimers());

it("expires cached checks without interaction and stops waking after the last expiry", () => {
  vi.useFakeTimers();
  vi.setSystemTime(checkedAt);
  const clock = createSiteCheckClock({ checks: [check], staleAfterSeconds: 900 }, () => () => {});
  const states: string[] = [];
  const unmount = clock.subscribe(() =>
    states.push(siteCheckState(check, 900, clock.getSnapshot())),
  );
  expect(states.at(-1)).toBe("healthy");
  vi.advanceTimersByTime(900_000);
  expect(states).toEqual(["healthy"]);
  vi.advanceTimersByTime(1);
  expect(states).toEqual(["healthy", "stale"]);
  expect(vi.getTimerCount()).toBe(0);
  unmount();
});

it("revalidates wall time on resume and releases the timer and resume listener on unmount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(checkedAt);
  let resume: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const clock = createSiteCheckClock({ checks: [check], staleAfterSeconds: 900 }, (listener) => {
    resume = listener;
    return unsubscribe;
  });
  const changed = vi.fn();
  const unmount = clock.subscribe(changed);
  expect(vi.getTimerCount()).toBe(1);
  vi.setSystemTime(checkedAt + 901_000);
  resume!();
  expect(siteCheckState(check, 900, clock.getSnapshot())).toBe("stale");
  expect(vi.getTimerCount()).toBe(0);
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();

  vi.setSystemTime(checkedAt);
  const unmountAgain = clock.subscribe(changed);
  expect(vi.getTimerCount()).toBe(1);
  unmountAgain();
  expect(vi.getTimerCount()).toBe(0);
  const calls = changed.mock.calls.length;
  vi.advanceTimersByTime(1_000_000);
  expect(changed).toHaveBeenCalledTimes(calls);
});

it("uses one timer for successive deadlines and ignores checks without a future state change", () => {
  vi.useFakeTimers();
  vi.setSystemTime(checkedAt);
  const later = {
    ...check,
    id: "later",
    last: { ...check.last, checked_at: "2026-10-17T00:00:30Z" },
  };
  const clock = createSiteCheckClock(
    {
      checks: [
        check,
        later,
        { ...check, state: "disabled" },
        { ...check, last: null },
        { ...check, last: { ...check.last, checked_at: "invalid" } },
      ],
      staleAfterSeconds: 900,
    },
    () => () => {},
  );
  const changed = vi.fn();
  const unmount = clock.subscribe(changed);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(900_001);
  expect(siteCheckState(later, 900, clock.getSnapshot())).toBe("healthy");
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(30_000);
  expect(siteCheckState(later, 900, clock.getSnapshot())).toBe("stale");
  expect(vi.getTimerCount()).toBe(0);
  expect(changed).toHaveBeenCalledTimes(3);
  unmount();
});
