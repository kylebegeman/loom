import { describe, expect, it } from "vite-plus/test";

import type { UtilityResult } from "../types";
import { CRON_TOOLS } from "./cron";
import { runInput } from "./testSupport";

const tool = CRON_TOOLS.cron;
const STANDARD_ONLY = "Only standard 5-field cron is supported";

const run = (text: string, overrides: { readonly now?: number; readonly timeZone?: string } = {}) =>
  tool.run(runInput(tool, { text, ...overrides }));

function okFields(result: UtilityResult) {
  if (result.kind === "error") throw new Error(`Expected a result, got: ${result.message}`);
  return result.fields;
}

const fieldValue = (result: UtilityResult, label: string) =>
  okFields(result).find((field) => field.label === label)?.value;

const description = (text: string) => fieldValue(run(text), "Description");

function nextRuns(text: string, now: number, timeZone = "UTC") {
  return fieldValue(run(text, { now, timeZone }), `Next runs (${timeZone})`)?.split("\n");
}

describe("cron description", () => {
  it.each([
    ["* * * * *", "Every minute"],
    ["*/15 * * * *", "Every 15 minutes"],
    ["30 9 * * 1-5", "At 09:30, Monday through Friday"],
    ["0 0 1 * *", "At 00:00, on day 1 of the month"],
    ["0 */2 * * *", "At minute 0 past every 2nd hour"],
    ["0 0 * * *", "At 00:00, every day"],
    ["0 * * * *", "At minute 0 past every hour"],
    ["*/15 9-17 * * *", "Every 15 minutes during hours 9 through 17"],
    ["0,30 9,17 * * *", "At 09:00, 09:30, 17:00 and 17:30, every day"],
    ["*/7 * * * *", "Every 7 minutes from minute 0 through 56 past every hour"],
    ["0 9-21/2 * * *", "At minute 0 past every 2nd hour from 9 through 21"],
    ["0 9-17/2 * * *", "At 09:00, 11:00, 13:00, 15:00 and 17:00, every day"],
    ["0 0 */2 * *", "At 00:00, on every 2nd day of the month"],
    ["0 0 1 */3 *", "At 00:00, on day 1 of the month, in January, April, July and October"],
  ])("describes %s", (text, expected) => {
    expect(description(text)).toBe(expected);
  });

  it("keeps complex lists readable", () => {
    expect(description("0,15,30,45 8-10,14 1,15 */3 1-5")).toBe(
      "At minutes 0, 15, 30 and 45 past hours 8 through 10 and 14, on days 1 and 15 of the month or on Monday through Friday, in January, April, July and October",
    );
  });

  it("reads macros as their five-field form", () => {
    const weekly = run("@weekly");
    expect(fieldValue(weekly, "Description")).toBe("At 00:00, only on Sunday");
    expect(fieldValue(weekly, "Expands to")).toBe("0 0 * * 0");
    expect(description("@yearly")).toBe("At 00:00, on day 1 of the month, in January");
    expect(description("@annually")).toBe(description("@yearly"));
    expect(description("@monthly")).toBe("At 00:00, on day 1 of the month");
    expect(description("@daily")).toBe("At 00:00, every day");
    expect(description("@midnight")).toBe(description("@daily"));
    expect(description("@HOURLY")).toBe("At minute 0 past every hour");
  });

  it("accepts month and weekday names in any case", () => {
    expect(description("0 12 * jan,JUL Mon-fri")).toBe(
      "At 12:00, Monday through Friday, in January and July",
    );
    expect(description("0 0 * * SAT,sun")).toBe("At 00:00, only on Sunday and Saturday");
    const now = Date.UTC(2024, 0, 1);
    expect(nextRuns("0 12 * jan,JUL Mon-fri", now)).toEqual(nextRuns("0 12 * 1,7 1-5", now));
  });

  it("treats weekday 7 as Sunday", () => {
    expect(description("0 0 * * 7")).toBe("At 00:00, only on Sunday");
    expect(nextRuns("0 0 * * 7", Date.UTC(2024, 0, 1))).toEqual(
      nextRuns("0 0 * * 0", Date.UTC(2024, 0, 1)),
    );
  });

  it("reads a/n as a through the field's maximum, every n", () => {
    expect(description("5/15 * * * *")).toBe(
      "Every 15 minutes from minute 5 through 50 past every hour",
    );
    // Day of week runs to 7, which is Sunday, so 1/2 is 1-7/2.
    expect(description("0 0 * * 1/2")).toBe(
      "At 00:00, only on Sunday, Monday, Wednesday and Friday",
    );
    const now = Date.UTC(2024, 0, 1);
    expect(nextRuns("0 0 * * 1/2", now)).toEqual(nextRuns("0 0 * * 1-7/2", now));
  });

  it("reads a weekday range ending on Sunday as ending on 7, like cronie", () => {
    expect(description("0 0 * * MON-SUN")).toBe("At 00:00, every day");
    expect(description("0 0 * * FRI-SUN")).toBe("At 00:00, only on Sunday, Friday and Saturday");
    const now = Date.UTC(2024, 0, 1);
    expect(nextRuns("0 0 * * fri-0", now)).toEqual(nextRuns("0 0 * * 5-7", now));
  });
});

describe("cron next runs", () => {
  it("lists the next five minutes after now, labeled with the zone", () => {
    const result = run("* * * * *");
    expect(fieldValue(result, "Next runs (UTC)")?.split("\n")).toEqual([
      "2023-11-14 22:14:00 UTC",
      "2023-11-14 22:15:00 UTC",
      "2023-11-14 22:16:00 UTC",
      "2023-11-14 22:17:00 UTC",
      "2023-11-14 22:18:00 UTC",
    ]);
  });

  it("uses the given time zone, not the host's", () => {
    const result = run("30 9 * * 1-5", { timeZone: "America/New_York" });
    expect(fieldValue(result, "Next runs (America/New_York)")?.split("\n")).toEqual([
      "2023-11-15 09:30:00 EST",
      "2023-11-16 09:30:00 EST",
      "2023-11-17 09:30:00 EST",
      "2023-11-20 09:30:00 EST",
      "2023-11-21 09:30:00 EST",
    ]);
  });

  it("crosses a month end and skips the weekend", () => {
    expect(nextRuns("30 9 * * 1-5", Date.UTC(2024, 0, 30, 12))).toEqual([
      "2024-01-31 09:30:00 UTC",
      "2024-02-01 09:30:00 UTC",
      "2024-02-02 09:30:00 UTC",
      "2024-02-05 09:30:00 UTC",
      "2024-02-06 09:30:00 UTC",
    ]);
  });

  it("includes February 29 in a leap year", () => {
    expect(nextRuns("15 6 * * *", Date.UTC(2024, 1, 27, 12))).toEqual([
      "2024-02-28 06:15:00 UTC",
      "2024-02-29 06:15:00 UTC",
      "2024-03-01 06:15:00 UTC",
      "2024-03-02 06:15:00 UTC",
      "2024-03-03 06:15:00 UTC",
    ]);
  });

  it("finds five leap days for a February 29 schedule", () => {
    const result = run("0 0 29 2 *");
    expect(fieldValue(result, "Next runs (UTC)")?.split("\n")).toEqual([
      "2024-02-29 00:00:00 UTC",
      "2028-02-29 00:00:00 UTC",
      "2032-02-29 00:00:00 UTC",
      "2036-02-29 00:00:00 UTC",
      "2040-02-29 00:00:00 UTC",
    ]);
    expect(result).not.toHaveProperty("warnings");
  });

  it("reports a schedule that never runs instead of searching forever", () => {
    const result = run("0 0 30 2 *");
    expect(result.kind).toBe("ok");
    expect(fieldValue(result, "Next runs (UTC)")).toBe("None within the next 4 years.");
  });

  it("says when fewer than five runs fall within the search window", () => {
    // Day of week starts with "*", so both day fields must match: February 29 on a Sunday,
    // which happens in 2032 and then not again until 2060.
    const result = run("0 0 29 2 */7", { now: Date.UTC(2031, 0, 1) });
    expect(fieldValue(result, "Next runs (UTC)")).toBe("2032-02-29 00:00:00 UTC");
    expect(result).toMatchObject({
      warnings: ["Only 1 run found; the schedule does not run again within 4 years of it."],
    });
  });

  it("runs when either day field matches if both are restricted", () => {
    const result = run("0 0 13 * 5");
    expect(fieldValue(result, "Description")).toBe("At 00:00, on day 13 of the month or on Friday");
    expect(fieldValue(result, "Next runs (UTC)")?.split("\n")).toEqual([
      "2023-11-17 00:00:00 UTC",
      "2023-11-24 00:00:00 UTC",
      "2023-12-01 00:00:00 UTC",
      "2023-12-08 00:00:00 UTC",
      "2023-12-13 00:00:00 UTC",
    ]);
    expect(result).toMatchObject({
      warnings: [
        "Both day fields are set, so this runs when either the day of month or the day of week matches.",
      ],
    });
  });

  it("requires both day fields when one starts with *", () => {
    expect(description("0 0 */2 * 5")).toBe(
      "At 00:00, on every 2nd day of the month if it falls on Friday",
    );
    expect(nextRuns("0 0 */2 * 5", Date.UTC(2023, 10, 14, 22))).toEqual([
      "2023-11-17 00:00:00 UTC",
      "2023-12-01 00:00:00 UTC",
      "2023-12-15 00:00:00 UTC",
      "2023-12-29 00:00:00 UTC",
      "2024-01-05 00:00:00 UTC",
    ]);
  });
});

describe("cron across daylight saving changes", () => {
  const zone = "America/New_York";

  it("skips a local time that does not exist on the spring-forward day", () => {
    expect(nextRuns("30 2 * * *", Date.UTC(2024, 2, 8, 12), zone)).toEqual([
      "2024-03-09 02:30:00 EST",
      "2024-03-11 02:30:00 EDT",
      "2024-03-12 02:30:00 EDT",
      "2024-03-13 02:30:00 EDT",
      "2024-03-14 02:30:00 EDT",
    ]);
  });

  it("runs a repeated local time once, at its first occurrence", () => {
    expect(nextRuns("0,30 1 * * *", Date.UTC(2024, 10, 2, 12), zone)).toEqual([
      "2024-11-03 01:00:00 EDT",
      "2024-11-03 01:30:00 EDT",
      "2024-11-04 01:00:00 EST",
      "2024-11-04 01:30:00 EST",
      "2024-11-05 01:00:00 EST",
    ]);
  });

  it("does not run again in the repeated hour once the first occurrence has passed", () => {
    // 06:10 UTC is 01:10 EST, after 01:30 EDT already happened at 05:30 UTC.
    expect(nextRuns("30 1 * * *", Date.UTC(2024, 10, 3, 6, 10), zone)).toEqual([
      "2024-11-04 01:30:00 EST",
      "2024-11-05 01:30:00 EST",
      "2024-11-06 01:30:00 EST",
      "2024-11-07 01:30:00 EST",
      "2024-11-08 01:30:00 EST",
    ]);
  });
});

describe("cron errors", () => {
  it.each([
    ["61 * * * *", "Minute: 61 is out of range 0 to 59."],
    ["* 24 * * *", "Hour: 24 is out of range 0 to 23."],
    ["* * 0 * *", "Day of month: 0 is out of range 1 to 31."],
    ["* * * 13 *", "Month: 13 is out of range 1 to 12."],
    ["* * * * 8", "Day of week: 8 is out of range 0 to 7."],
    ["* * * *", "Expected 5 fields (minute, hour, day of month, month, day of week); got 4."],
    ["* * * FOO *", "Month: FOO is not a number or month name."],
    ["* * * * Funday", "Day of week: Funday is not a number or weekday name."],
    ["x * * * *", "Minute: x is not a number."],
    ["*/0 * * * *", "Minute: the step in */0 must be at least 1."],
    ["1,,2 * * * *", "Minute: 1,,2 has an empty list item."],
    ["1- * * * *", "Minute: 1- is not a valid range."],
    [
      "* 22-2 * * *",
      "Hour: 22-2 runs backwards. Ranges cannot wrap around; use 22-23,0-2 instead.",
    ],
    ["@reboot", "Not a time-based schedule."],
    ["@daily echo hi", "@daily stands for all 5 fields; remove the text after it."],
    ["", "Enter a cron expression, such as 30 9 * * 1-5."],
  ])("rejects %j", (text, message) => {
    expect(run(text)).toEqual({ kind: "error", message });
  });

  it.each([
    ["0 0 12 * * ?", "Only standard 5-field cron is supported; got 6 fields."],
    ["0 0 12 * * MON 2026", "Only standard 5-field cron is supported; got 7 fields."],
    ["0 0 ? * MON", "Day of month: ? is not standard cron syntax."],
    ["0 0 L * *", "Day of month: L is not standard cron syntax."],
    ["0 0 15W * *", "Day of month: 15W is not standard cron syntax."],
    ["0 0 * * 5#3", "Day of week: 5#3 is not standard cron syntax."],
    ["0 0 * * 5L", "Day of week: 5L is not standard cron syntax."],
    ["H * * * *", "Minute: H is not standard cron syntax."],
    ["H/15 * * * *", "Minute: H/15 is not standard cron syntax."],
    ["@every 5m", "@every is not standard cron syntax."],
  ])("rejects the dialect syntax in %j", (text, start) => {
    const result = run(text);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message.startsWith(start)).toBe(true);
    expect(result.message).toContain(STANDARD_ONLY);
  });

  it.each([
    ["* 022-02 * * *", "Hour", "22-23,0-2"],
    ["* * * * 7-3", "Day of week", "0-3"],
    ["* * * * SAT-MON", "Day of week", "SAT-6,0-MON"],
  ])("suggests a working fix for the backwards range in %j", (text, label, suggestion) => {
    const result = run(text);
    expect(result).toMatchObject({ kind: "error" });
    if (result.kind !== "error") return;
    expect(result.message).toMatch(new RegExp(`^${label}: .* runs backwards\\.`));
    expect(result.message).toContain(`use ${suggestion} instead.`);
    const fields = text.split(" ");
    fields[label === "Hour" ? 1 : 4] = suggestion;
    expect(run(fields.join(" ")).kind).toBe("ok");
  });

  it("keeps a huge token out of the error message", () => {
    expect(run(`${"9".repeat(1_000_000)} * * * *`)).toEqual({
      kind: "error",
      message: `Minute: ${"9".repeat(40)}... is out of range 0 to 59.`,
    });
    // Cutting at 40 code units would split the 20th emoji, so the clip stops before it.
    expect(run(`x${"\u{1F642}".repeat(30)} * * * *`)).toEqual({
      kind: "error",
      message: `Minute: x${"\u{1F642}".repeat(19)}... is not a number.`,
    });
  });

  it("names months and weekdays without mistaking them for dialect letters", () => {
    expect(run("0 0 * JUL,WED *")).toEqual({
      kind: "error",
      message: "Month: WED is not a number or month name.",
    });
    expect(run("0 0 * JUL WED,THU").kind).toBe("ok");
  });

  it("never throws on odd input", () => {
    for (const text of [
      "   ",
      "*/",
      "@",
      "\u0000",
      "9".repeat(400),
      "- - - - -",
      ", * * * *",
      "*/ * * * *",
      "a-b/c * * * *",
      "1-2-3 * * * *",
      "1/2/3 * * * *",
      "99999999999999999999 * * * *",
      "*/99999999999999999999 * * * *",
      "H(0-29)/10 * * * *",
      "0 0 L-3 * *",
    ]) {
      expect(["ok", "error"]).toContain(run(text).kind);
    }
  });
});

describe("cron tool", () => {
  it("produces a result from its example", () => {
    expect(tool.example.text).toBeTruthy();
    expect(run(tool.example.text).kind).toBe("ok");
  });

  it("reads a megabyte of one repeated list item as that item", () => {
    expect(run(`${"*/15,".repeat(200_000)}*/15 * * * *`)).toEqual(run("*/15 * * * *"));
  });

  it("falls back to UTC for an unknown time zone", () => {
    const result = run("0 0 * * *", { timeZone: "Mars/Olympus" });
    expect(fieldValue(result, "Next runs (UTC)")?.split("\n")[0]).toBe("2023-11-15 00:00:00 UTC");
    expect(result).toMatchObject({ warnings: ["Unknown time zone Mars/Olympus; showing UTC."] });
  });
});
