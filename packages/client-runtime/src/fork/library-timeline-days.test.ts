// @effect-diagnostics globalDate:off - Groups by the viewer's local calendar day for display, outside an Effect runtime.
import { describe, expect, it } from "vite-plus/test";
import {
  groupTimelineByDay,
  timelineDayDetail,
  timelineDayLabel,
} from "./library-timeline-days.ts";

const local = (month: number, day: number, hour: number, year = 2026) =>
  new Date(year, month - 1, day, hour);
const now = local(10, 17, 9);

describe("timeline days", () => {
  it("names recent days plainly and older ones by date", () => {
    expect(timelineDayLabel(local(10, 17, 1), now, "en-US")).toBe("Today");
    expect(timelineDayLabel(local(10, 16, 23), now, "en-US")).toBe("Yesterday");
    expect(timelineDayLabel(local(10, 13, 12), now, "en-US")).toBe("Tuesday");
    expect(timelineDayLabel(local(10, 2, 12), now, "en-US")).toBe("Fri, Oct 2");
    expect(timelineDayLabel(local(12, 30, 12, 2025), now, "en-US")).toBe("Tue, Dec 30, 2025");
    // A computer whose clock runs ahead still reads as today.
    expect(timelineDayLabel(local(10, 18, 2), now, "en-US")).toBe("Today");
  });

  it("dates the days a relative name leaves undated", () => {
    expect(timelineDayDetail(local(10, 17, 1), now, "en-US")).toBe("October 17");
    expect(timelineDayDetail(local(10, 13, 12), now, "en-US")).toBe("October 13");
    expect(timelineDayDetail(local(10, 2, 12), now, "en-US")).toBeNull();
  });

  it("groups by local calendar day and folds an out of order entry into its day", () => {
    const at = (date: Date, id: string) => ({ id, at: date.toISOString() });
    const days = groupTimelineByDay(
      [
        at(local(10, 17, 8), "a"),
        at(local(10, 17, 0), "b"),
        at(local(10, 16, 23), "c"),
        at(local(10, 17, 3), "estimated"),
      ],
      now,
      "en-US",
    );
    expect(days.map((day) => [day.label, day.entries.map((entry) => entry.id)])).toEqual([
      ["Today", ["a", "b", "estimated"]],
      ["Yesterday", ["c"]],
    ]);
  });
});
