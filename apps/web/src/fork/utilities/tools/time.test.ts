import { describe, expect, it } from "vite-plus/test";

import { formatLocal, isValidTimeZone, zonedParts } from "./time";

describe("zonedParts", () => {
  it("reads wall-clock fields in the given zone, not the host's", () => {
    // 2024-03-10T07:30:00Z is 03:30 EDT, just after the spring-forward gap.
    expect(zonedParts(Date.UTC(2024, 2, 10, 7, 30), "America/New_York")).toMatchObject({
      year: 2024,
      month: 3,
      day: 10,
      hour: 3,
      minute: 30,
      weekday: 0,
      zoneName: "EDT",
    });
  });

  it("reports midnight as hour 0", () => {
    expect(zonedParts(Date.UTC(2024, 0, 1), "UTC").hour).toBe(0);
  });
});

describe("formatLocal", () => {
  it("prints one fixed shape", () => {
    expect(formatLocal(Date.UTC(2023, 10, 14, 22, 13, 20), "UTC")).toBe("2023-11-14 22:13:20 UTC");
    expect(formatLocal(Date.UTC(2023, 10, 14, 22, 13, 20), "Asia/Tokyo")).toBe(
      "2023-11-15 07:13:20 GMT+9",
    );
  });

  it("writes years as toISOString does, including before 1000 and before 1 CE", () => {
    for (const iso of [
      "0050-01-01T00:00:00.000Z",
      "0000-06-01T00:00:00.000Z",
      "-000044-03-15T12:00:00.000Z",
      "+010000-01-01T00:00:00.000Z",
    ]) {
      const ms = Date.parse(iso);
      expect(formatLocal(ms, "UTC")).toBe(`${iso.slice(0, -14)} ${iso.slice(-13, -5)} UTC`);
    }
  });

  it("keeps the year across New Year in a zone ahead of UTC before 1 CE", () => {
    // Year -1, December 31 23:00 UTC is already January 1 of year 0 at UTC+9. A fixed-offset
    // zone, because named zones use local mean time that far back.
    expect(formatLocal(Date.parse("-000001-12-31T23:00:00Z"), "Etc/GMT-9")).toBe(
      "0000-01-01 08:00:00 GMT+9",
    );
  });
});

it("validates zones", () => {
  expect(isValidTimeZone("Europe/Berlin")).toBe(true);
  expect(isValidTimeZone("Mars/Olympus")).toBe(false);
});
