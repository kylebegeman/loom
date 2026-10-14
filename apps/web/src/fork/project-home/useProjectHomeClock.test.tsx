// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { makeThreadFixture } from "~/test-fixtures";
import { useProjectHomeClock } from "./useProjectHomeClock";
vi.mock("~/hooks/useNowMinute", () => ({ useNowMinute: () => "2026-10-13T15:10" }));
let renderer: ReactTestRenderer | null = null;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("wakes a snoozed conversation at its exact deadline within a minute", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T15:10:15.000Z"));
  const thread = makeThreadFixture({
    snoozedAt: "2026-10-13T15:10:00.000Z",
    snoozedUntil: "2026-10-13T15:10:20.000Z",
  });
  const threads = [thread];
  let now = "";
  function Clock() {
    const value = useProjectHomeClock(threads);
    useLayoutEffect(() => {
      now = value;
    });
    return null;
  }
  await act(async () => {
    renderer = create(<Clock />);
  });
  expect(effectiveSnoozed(thread, { now })).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4999);
  });
  expect(effectiveSnoozed(thread, { now })).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(effectiveSnoozed(thread, { now })).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
