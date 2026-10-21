import { describe, expect, it } from "vite-plus/test";
import { UsageDay } from "@t3tools/contracts";
import { rollingWindow, usagePageWindow } from "./usageWindow";

describe("usagePageWindow", () => {
  it("spans whole local days in the page's time zone", () => {
    expect(
      usagePageWindow({
        sinceDay: UsageDay.make("2026-10-14"),
        untilDay: UsageDay.make("2026-10-20"),
        timeZone: "America/Los_Angeles",
      }),
    ).toEqual({ since: "2026-10-14T07:00:00.000Z", until: "2026-10-21T07:00:00.000Z" });
  });

  it("keeps each end on local midnight across a DST change", () => {
    expect(
      usagePageWindow({
        sinceDay: UsageDay.make("2026-10-31"),
        untilDay: UsageDay.make("2026-11-01"),
        timeZone: "America/New_York",
      }),
    ).toEqual({ since: "2026-10-31T04:00:00.000Z", until: "2026-11-02T05:00:00.000Z" });
  });

  it("uses an hourly window's instants as they are", () => {
    expect(
      usagePageWindow({
        sinceDay: UsageDay.make("2026-10-19"),
        untilDay: UsageDay.make("2026-10-20"),
        timeZone: "Asia/Kolkata",
        resolution: "hour",
        sinceTime: "2026-10-19T09:13:00.000Z",
        untilTime: "2026-10-20T09:13:00.000Z",
      }),
    ).toEqual({ since: "2026-10-19T09:13:00.000Z", until: "2026-10-20T09:13:00.000Z" });
  });
});

describe("rollingWindow", () => {
  it("ends on the current minute", () => {
    expect(rollingWindow(7, Date.parse("2026-10-20T10:15:42.000Z"))).toEqual({
      since: "2026-10-13T10:15:00.000Z",
      until: "2026-10-20T10:15:00.000Z",
    });
  });
});
