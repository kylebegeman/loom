import { describe, expect, it } from "vite-plus/test";
import { rollingBotsUsageWindow } from "./botUsageWindow.ts";

describe("rollingBotsUsageWindow", () => {
  it("includes runs created in the current minute after a refresh", () => {
    const createdAt = Date.parse("2026-10-20T10:15:05.000Z");
    const window = rollingBotsUsageWindow(7, Date.parse("2026-10-20T10:15:42.000Z"));
    expect(createdAt >= Date.parse(window.since) && createdAt < Date.parse(window.until)).toBe(
      true,
    );
  });

  it("includes a run created exactly on the current minute boundary", () => {
    const createdAt = Date.parse("2026-10-20T10:15:00.000Z");
    expect(createdAt < Date.parse(rollingBotsUsageWindow(7, createdAt).until)).toBe(true);
  });

  it("keeps one key for the whole minute and advances it at the next minute", () => {
    const start = Date.parse("2026-10-20T10:15:00.000Z");
    expect(rollingBotsUsageWindow(7, start)).toEqual(rollingBotsUsageWindow(7, start + 59_999));
    expect(rollingBotsUsageWindow(7, start + 60_000)).not.toEqual(rollingBotsUsageWindow(7, start));
  });

  it.each([1, 7, 30])("keeps %i rolling days across daylight saving changes", (days) => {
    const window = rollingBotsUsageWindow(days, Date.parse("2026-11-01T06:01:45Z"));
    expect(window.until).toBe("2026-11-01T06:02:00.000Z");
    expect(Date.parse(window.until) - Date.parse(window.since)).toBe(days * 86_400_000);
  });
});
