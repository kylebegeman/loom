// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { SitesSnapshot } from "@t3tools/contracts/fork";
import { siteCheckState } from "@t3tools/client-runtime/fork";

const listeners = vi.hoisted(() => new Set<(state: string) => void>());
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  },
}));
import { useSiteCheckClock } from "./use-site-check-clock";

const start = Date.parse("2026-10-17T00:00:00Z");
const snapshot: SitesSnapshot = {
  schemaVersion: 1,
  primarySiteId: "site",
  sites: [],
  services: [],
  observedAt: new Date(start).toISOString(),
  staleAfterSeconds: 900,
  checks: [
    {
      id: "check",
      service_id: "api",
      name: "API",
      url: "https://api.example.test",
      active: 1,
      state: "healthy",
      last: {
        checked_at: new Date(start).toISOString(),
        ok: 1,
        status: 200,
        duration_ms: 1,
        tls_expires_at: null,
        error: null,
      },
    },
  ],
};
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.useRealTimers();
});

it("expires while mounted, revalidates native resume after suspended timers, and cleans up", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(start);
  const states: string[] = [];
  function Probe() {
    const now = useSiteCheckClock(snapshot);
    useEffect(() => {
      states.push(siteCheckState(snapshot.checks[0]!, 900, now));
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(<Probe />));
  expect(states.at(-1)).toBe("healthy");
  act(() => vi.advanceTimersByTime(900_001));
  expect(states.at(-1)).toBe("stale");
  act(() => root!.render(null));
  expect(listeners.size).toBe(0);

  vi.setSystemTime(start);
  act(() => root!.render(<Probe />));
  expect(vi.getTimerCount()).toBe(1);
  act(() => {
    for (const listener of listeners) listener("background");
  });
  vi.setSystemTime(start + 1_000_000);
  act(() => {
    for (const listener of listeners) listener("active");
  });
  expect(states.at(-1)).toBe("stale");
  expect(vi.getTimerCount()).toBe(0);

  act(() => root!.render(null));
  vi.setSystemTime(start);
  act(() => root!.render(<Probe />));
  expect(vi.getTimerCount()).toBe(1);
  act(() => root!.render(null));
  expect(listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
