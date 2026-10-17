// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { SitesSnapshot } from "@t3tools/contracts/fork";
import { siteCheckState } from "@t3tools/client-runtime/fork";
import { useSiteCheckClock } from "./use-site-check-clock";

const start = Date.parse("2026-10-17T00:00:00Z");
const check = {
  id: "check",
  service_id: "api",
  name: "API",
  url: "https://api.example.test",
  active: 1 as const,
  state: "healthy" as const,
  last: {
    checked_at: new Date(start).toISOString(),
    ok: 1 as const,
    status: 200,
    duration_ms: 1,
    tls_expires_at: null,
    error: null,
  },
};
const snapshot: SitesSnapshot = {
  schemaVersion: 1,
  primarySiteId: "site",
  checks: [check],
  services: [],
  sites: [],
  observedAt: new Date(start).toISOString(),
  staleAfterSeconds: 900,
};
let root: Root;
let states: string[];
function Probe({ data = snapshot }: { data?: SitesSnapshot }) {
  const now = useSiteCheckClock(data);
  const state = siteCheckState(data.checks[0]!, data.staleAfterSeconds, now);
  useEffect(() => {
    states.push(state);
  });
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(start);
  states = [];
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("ages a mounted offline observation at expiry with no interaction or periodic renders", () => {
  act(() => root.render(<Probe />));
  const renders = states.length;
  act(() => vi.advanceTimersByTime(900_000));
  expect(states).toHaveLength(renders);
  expect(states.at(-1)).toBe("healthy");
  act(() => vi.advanceTimersByTime(1));
  expect(states.at(-1)).toBe("stale");
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["visibilitychange", "focus", "pageshow"])(
  "rechecks wall time on %s after background timer suspension",
  (event) => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => root.render(<Probe />));
    vi.setSystemTime(start + 1_000_000);
    act(() => (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event)));
    expect(states.at(-1)).toBe("stale");
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("replaces deadlines with fresh observations and releases timers and listeners on unmount", () => {
  const removeDocument = vi.spyOn(document, "removeEventListener");
  const removeWindow = vi.spyOn(window, "removeEventListener");
  act(() => root.render(<Probe />));
  act(() => vi.advanceTimersByTime(500_000));
  const fresh = {
    ...snapshot,
    checks: [
      { ...check, last: { ...check.last, checked_at: new Date(start + 500_000).toISOString() } },
    ],
  };
  act(() => root.render(<Probe data={fresh} />));
  act(() => vi.advanceTimersByTime(400_001));
  expect(states.at(-1)).toBe("healthy");
  expect(vi.getTimerCount()).toBe(1);
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
  expect(removeDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  expect(removeWindow).toHaveBeenCalledWith("focus", expect.any(Function));
  expect(removeWindow).toHaveBeenCalledWith("pageshow", expect.any(Function));
  const renders = states.length;
  act(() => vi.advanceTimersByTime(1_000_000));
  expect(states).toHaveLength(renders);
});
