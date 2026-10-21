import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { scheduleStep } from "./scheduleStep.ts";

const at = (iso: string) => DateTime.makeZonedUnsafe(iso, { timeZone: "UTC" });
const hourly = { type: "interval", everyMs: 3_600_000 } as const;
const nine = { type: "fixed_time", timeOfDay: "09:00" } as const;

describe("schedule steps", () => {
  it("schedules a new trigger without firing it", () => {
    expect(scheduleStep(hourly, null, at("2026-10-20T10:00:00Z"))).toEqual({
      fire: null,
      next: "2026-10-20T11:00:00.000Z",
    });
  });

  it("waits until due, then fires once however late", () => {
    const due = "2026-10-20T11:00:00.000Z";
    expect(scheduleStep(hourly, due, at("2026-10-20T10:30:00Z"))).toEqual({
      fire: null,
      next: due,
    });
    expect(scheduleStep(hourly, due, at("2026-10-20T15:20:00Z"))).toEqual({
      fire: due,
      next: "2026-10-20T16:20:00.000Z",
    });
  });

  it("skips a time of day missed by more than ten minutes", () => {
    const due = "2026-10-20T09:00:00.000Z";
    expect(scheduleStep(nine, due, at("2026-10-20T09:05:00Z")).fire).toBe(due);
    expect(scheduleStep(nine, due, at("2026-10-20T09:30:00Z"))).toEqual({
      fire: null,
      next: "2026-10-21T09:00:00.000Z",
    });
  });
});
