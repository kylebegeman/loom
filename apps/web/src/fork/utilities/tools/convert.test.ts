import { describe, expect, it } from "vite-plus/test";

import type { UtilityOptionValues, UtilityResult } from "../types";
import { CONVERT_TOOLS } from "./convert";
import { FIXED_NOW, runInput } from "./testSupport";

type ToolId = keyof typeof CONVERT_TOOLS;

interface RunOverrides {
  readonly options?: UtilityOptionValues;
  readonly now?: number;
  readonly timeZone?: string;
}

function run(id: ToolId, text: string, overrides: RunOverrides = {}): UtilityResult {
  const tool = CONVERT_TOOLS[id];
  return tool.run(runInput(tool, { ...overrides, text }));
}

function fields(result: UtilityResult): Record<string, string> {
  if (result.kind !== "ok") throw new Error(`Expected a result, got the error: ${result.message}`);
  return Object.fromEntries(result.fields.map((field) => [field.label, field.value]));
}

function warnings(result: UtilityResult): ReadonlyArray<string> {
  return result.kind === "ok" ? (result.warnings ?? []) : [];
}

const errorOf = (result: UtilityResult) => (result.kind === "error" ? result.message : null);

describe("examples", () => {
  it.each(Object.keys(CONVERT_TOOLS) as ReadonlyArray<ToolId>)("%s runs its example", (id) => {
    const tool = CONVERT_TOOLS[id];
    const result = tool.run(runInput(tool, { text: tool.example.text }));
    expect(result.kind).toBe("ok");
  });
});

describe("number-base", () => {
  it("converts values beyond 2^64 without losing digits", () => {
    expect(fields(run("number-base", "18446744073709551617"))).toEqual({
      Decimal: "18446744073709551617",
      Hexadecimal: "10000000000000001",
      Octal: "2000000000000000000001",
      Binary: `1${"0".repeat(63)}1`,
      "Base 36": "3w5e11264sgsh",
    });
  });

  it("keeps integers just past 2^53 exact", () => {
    expect(fields(run("number-base", "9007199254740993")).Hexadecimal).toBe("20000000000001");
  });

  it.each([
    ["0xff", "255"],
    ["0XFF", "255"],
    ["0b1010", "10"],
    ["0o755", "493"],
    ["-0x10", "-16"],
    ["1_000 000", "1000000"],
    ["  42  ", "42"],
    ["-0", "0"],
  ])("reads %j in auto mode as %s", (text, decimal) => {
    expect(fields(run("number-base", text)).Decimal).toBe(decimal);
  });

  it("accepts the prefix of the chosen base and reads other prefixes as digits", () => {
    expect(fields(run("number-base", "0xff", { options: { from: "16" } })).Decimal).toBe("255");
    expect(fields(run("number-base", "0b1", { options: { from: "16" } })).Decimal).toBe("177");
    expect(errorOf(run("number-base", "0x1", { options: { from: "2" } }))).toBe(
      'Invalid digit "x" for base 2 at position 2.',
    );
  });

  it("reads and writes a custom base", () => {
    expect(
      fields(run("number-base", "ZZ", { options: { from: "custom", customBase: 36 } })),
    ).toMatchObject({ Decimal: "1295", "Base 36": "zz" });
    expect(fields(run("number-base", "255", { options: { customBase: 7 } }))["Base 7"]).toBe("513");
  });

  it("clamps a custom base outside 2 to 36", () => {
    expect(fields(run("number-base", "8", { options: { customBase: 99 } }))["Base 36"]).toBe("8");
    expect(fields(run("number-base", "8", { options: { customBase: 1 } }))["Base 2"]).toBe("1000");
  });

  it("names the invalid digit, the base and its position", () => {
    expect(errorOf(run("number-base", "ffg", { options: { from: "16" } }))).toBe(
      'Invalid digit "g" for base 16 at position 3.',
    );
    expect(errorOf(run("number-base", "19", { options: { from: "8" } }))).toBe(
      'Invalid digit "9" for base 8 at position 2.',
    );
    expect(errorOf(run("number-base", "  0xZ"))).toBe(
      'Invalid digit "Z" for base 16 at position 5.',
    );
    expect(errorOf(run("number-base", "12😀3"))).toBe(
      'Invalid digit "😀" for base 10 at position 3.',
    );
    expect(errorOf(run("number-base", "1.5"))).toBe('Invalid digit "." for base 10 at position 2.');
  });

  it("rejects input without digits", () => {
    expect(errorOf(run("number-base", "0x"))).toBe("No digits to convert.");
    expect(errorOf(run("number-base", "-"))).toBe("No digits to convert.");
    expect(errorOf(run("number-base", "   "))).toBe("No digits to convert.");
  });

  it("refuses numbers too long to convert quickly", () => {
    expect(fields(run("number-base", "1".repeat(20_000))).Decimal).toHaveLength(20_000);
    expect(errorOf(run("number-base", "1".repeat(20_001)))).toBe(
      "Numbers are limited to 20,000 digits.",
    );
  });
});

describe("timestamp", () => {
  it("detects seconds and prints every form", () => {
    expect(fields(run("timestamp", "1700000000"))).toEqual({
      Unit: "Seconds (auto-detected)",
      "UTC (ISO 8601)": "2023-11-14T22:13:20.000Z",
      "Local (UTC)": "2023-11-14 22:13:20 UTC",
      Relative: "now",
      Seconds: "1700000000",
      Milliseconds: "1700000000000",
    });
  });

  it("detects milliseconds from 1e11 up", () => {
    expect(fields(run("timestamp", "1700000000123"))).toMatchObject({
      Unit: "Milliseconds (auto-detected)",
      "UTC (ISO 8601)": "2023-11-14T22:13:20.123Z",
      Seconds: "1700000000",
      Milliseconds: "1700000000123",
    });
    expect(fields(run("timestamp", "99999999999")).Unit).toBe("Seconds (auto-detected)");
    expect(fields(run("timestamp", "100000000000")).Unit).toBe("Milliseconds (auto-detected)");
  });

  it("follows an explicit unit", () => {
    expect(
      fields(run("timestamp", "1700000000", { options: { unit: "milliseconds" } })),
    ).toMatchObject({ Unit: "Milliseconds", "UTC (ISO 8601)": "1970-01-20T16:13:20.000Z" });
    expect(
      fields(run("timestamp", "1700000000000", { options: { unit: "seconds" } })),
    ).toMatchObject({ Unit: "Seconds", Milliseconds: "1700000000000000" });
  });

  it("keeps fractional seconds as milliseconds", () => {
    expect(fields(run("timestamp", "1700000000.5")).Milliseconds).toBe("1700000000500");
  });

  it("prints local time in the given zone, not the host's", () => {
    const result = fields(run("timestamp", "1700000000", { timeZone: "America/New_York" }));
    expect(result["Local (America/New_York)"]).toBe("2023-11-14 17:13:20 EST");
  });

  it.each([
    ["1699996400", "1 hour ago"],
    ["1700000045", "in 45 seconds"],
    ["1700086400", "tomorrow"],
    ["1699827200", "2 days ago"],
    ["1701814400", "in 3 weeks"],
    ["2020-11-14T22:13:20Z", "3 years ago"],
  ])("describes %s relative to now as %j", (text, relative) => {
    expect(fields(run("timestamp", text)).Relative).toBe(relative);
  });

  it("reads an ISO date with an offset back to Unix time", () => {
    const expected = {
      Seconds: "1700000000",
      Milliseconds: "1700000000000",
      "UTC (ISO 8601)": "2023-11-14T22:13:20.000Z",
      "Local (UTC)": "2023-11-14 22:13:20 UTC",
      Relative: "now",
    };
    for (const text of [
      "2023-11-14T22:13:20Z",
      "2023-11-14t22:13:20z",
      "2023-11-14 17:13:20-05:00",
      "2023-11-15T03:43:20+0530",
      "2023-11-14T23:13:20 +01",
    ]) {
      const result = run("timestamp", text);
      expect(fields(result)).toEqual(expected);
      expect(warnings(result)).toEqual([]);
    }
    expect(fields(run("timestamp", "2023-11-14T22:13:20.123456Z")).Milliseconds).toBe(
      "1700000000123",
    );
  });

  it("reads an ISO date without an offset as local time in the given zone and says so", () => {
    const timeZone = "America/New_York";
    const winter = run("timestamp", "2023-11-14T17:13:20", { timeZone });
    expect(fields(winter).Seconds).toBe("1700000000");
    expect(warnings(winter)).toEqual([
      "No time zone given, so this is read as local time in America/New_York.",
    ]);
    expect(fields(run("timestamp", "2024-03-10", { timeZone }))["UTC (ISO 8601)"]).toBe(
      "2024-03-10T05:00:00.000Z",
    );
    expect(fields(run("timestamp", "2024-03-10T03:30", { timeZone }))["UTC (ISO 8601)"]).toBe(
      "2024-03-10T07:30:00.000Z",
    );
  });

  // The expectations are what Date gives with TZ set to each zone.
  it.each([
    ["America/New_York", "2024-03-10T02:30", "2024-03-10T07:30:00.000Z", "2024-03-10 03:30:00 EDT"],
    ["America/New_York", "2024-11-03T01:30", "2024-11-03T05:30:00.000Z", "2024-11-03 01:30:00 EDT"],
    ["Europe/Berlin", "2024-03-31T02:30", "2024-03-31T01:30:00.000Z", "2024-03-31 03:30:00 GMT+2"],
    ["Europe/Berlin", "2024-10-27T02:30", "2024-10-27T00:30:00.000Z", "2024-10-27 02:30:00 GMT+2"],
  ])("in %s reads %s, skipped or repeated by DST, as Date does", (timeZone, text, utc, local) => {
    expect(fields(run("timestamp", text, { timeZone }))).toMatchObject({
      "UTC (ISO 8601)": utc,
      [`Local (${timeZone})`]: local,
    });
  });

  it("reads now from the injected clock", () => {
    expect(fields(run("timestamp", " NOW ", { now: FIXED_NOW + 999 }))).toEqual({
      Seconds: "1700000000",
      Milliseconds: "1700000000999",
      "UTC (ISO 8601)": "2023-11-14T22:13:20.999Z",
      "Local (UTC)": "2023-11-14 22:13:20 UTC",
      Relative: "now",
    });
  });

  it("handles years 0 to 99 and before 1 CE", () => {
    expect(fields(run("timestamp", "0050-01-01T00:00:00Z"))).toMatchObject({
      Seconds: "-60589296000",
      "Local (UTC)": "0050-01-01 00:00:00 UTC",
    });
    expect(fields(run("timestamp", "+010000-01-01T00:00:00Z"))["Local (UTC)"]).toBe(
      "+010000-01-01 00:00:00 UTC",
    );
    expect(fields(run("timestamp", "0000-06-15T12:00:00Z"))).toMatchObject({
      "UTC (ISO 8601)": "0000-06-15T12:00:00.000Z",
      "Local (UTC)": "0000-06-15 12:00:00 UTC",
    });
    expect(fields(run("timestamp", "-000001-06-15T12:00:00Z"))["Local (UTC)"]).toBe(
      "-000001-06-15 12:00:00 UTC",
    );
    // New York ran on local mean time, 4:56:02 behind UTC, so this is still year 0 there.
    expect(
      fields(run("timestamp", "0001-01-01T03:00:00Z", { timeZone: "America/New_York" }))[
        "Local (America/New_York)"
      ],
    ).toBe("0000-12-31 22:03:58 GMT-4:56:02");
  });

  it("accepts the ends of the date range and refuses anything past them", () => {
    expect(fields(run("timestamp", "8640000000000000"))["UTC (ISO 8601)"]).toBe(
      "+275760-09-13T00:00:00.000Z",
    );
    const outOfRange = "Out of range: dates must be within 100,000,000 days of 1970-01-01.";
    expect(errorOf(run("timestamp", "8640000000000001"))).toBe(outOfRange);
    expect(errorOf(run("timestamp", "-8640000000001", { options: { unit: "seconds" } }))).toBe(
      outOfRange,
    );
    expect(errorOf(run("timestamp", "9".repeat(400)))).toBe(outOfRange);
    expect(errorOf(run("timestamp", "+275760-09-13T00:00:01Z"))).toBe(outOfRange);
  });

  it("accepts a wall-clock time past the range when its offset brings it back inside", () => {
    expect(fields(run("timestamp", "+275760-09-13T01:00:00+01:00"))["UTC (ISO 8601)"]).toBe(
      "+275760-09-13T00:00:00.000Z",
    );
    expect(fields(run("timestamp", "-271821-04-19T23:00:00-01:00"))["UTC (ISO 8601)"]).toBe(
      "-271821-04-20T00:00:00.000Z",
    );
    expect(
      fields(run("timestamp", "-271821-04-20T00:00", { timeZone: "America/New_York" }))[
        "UTC (ISO 8601)"
      ],
    ).toBe("-271821-04-20T04:56:02.000Z");
  });

  it("rejects a long run of digits in linear time", () => {
    expect(errorOf(run("timestamp", `${"1".repeat(1_000_000)}x`))).toBe(
      "Enter Unix seconds or milliseconds, an ISO 8601 date such as 2026-10-20T14:03:05Z, or now.",
    );
  });

  it.each([
    [
      "yesterday",
      "Enter Unix seconds or milliseconds, an ISO 8601 date such as 2026-10-20T14:03:05Z, or now.",
    ],
    ["2023-13-01", "Month 13 does not exist."],
    ["2023-02-29", "There is no day 29 in 2023-02."],
    ["2023-11-14T24:00", "Hours must be 00 to 23."],
    ["2023-11-14T12:60", "Minutes must be 00 to 59."],
    ["2023-11-14T12:00:60", "Seconds must be 00 to 59."],
    ["2023-11-14T12:00+24:00", "The UTC offset must be between -23:59 and +23:59."],
    ["2023-11-14Z", "Not a valid ISO 8601 date. Use a form such as 2026-10-20T14:03:05Z."],
  ])("explains why %j is not a time", (text, message) => {
    expect(errorOf(run("timestamp", text))).toBe(message);
  });

  it("accepts February 29 in a leap year", () => {
    expect(fields(run("timestamp", "2024-02-29T00:00:00Z")).Seconds).toBe("1709164800");
  });
});

describe("color", () => {
  it.each([
    [
      "tomato",
      {
        Hex: "#ff6347",
        RGB: "rgb(255, 99, 71)",
        HSL: "hsl(9.13, 100%, 63.92%)",
        OKLCH: "oklch(0.6962 0.1955 32.32)",
      },
    ],
    [
      "#FF000080",
      {
        Hex: "#ff000080",
        RGB: "rgba(255, 0, 0, 0.502)",
        HSL: "hsla(0, 100%, 50%, 0.502)",
        OKLCH: "oklch(0.628 0.2577 29.23 / 0.502)",
      },
    ],
    [
      "rgb(0 128 255)",
      {
        Hex: "#0080ff",
        RGB: "rgb(0, 128, 255)",
        HSL: "hsl(209.88, 100%, 50%)",
        OKLCH: "oklch(0.6152 0.2108 256.1)",
      },
    ],
    [
      "HSL(120deg 100% 50% / 25%)",
      {
        Hex: "#00ff0040",
        RGB: "rgba(0, 255, 0, 0.25)",
        HSL: "hsla(120, 100%, 50%, 0.25)",
        OKLCH: "oklch(0.8664 0.2948 142.5 / 0.25)",
      },
    ],
    [
      "oklch(0.7 0.1 200)",
      {
        Hex: "#40b1b7",
        RGB: "rgb(64, 177, 183)",
        HSL: "hsl(182.94, 48.02%, 48.44%)",
        OKLCH: "oklch(0.7 0.1 200)",
      },
    ],
    [
      "white",
      {
        Hex: "#ffffff",
        RGB: "rgb(255, 255, 255)",
        HSL: "hsl(0, 0%, 100%)",
        OKLCH: "oklch(1 0 none)",
      },
    ],
    [
      "transparent",
      {
        Hex: "#00000000",
        RGB: "rgba(0, 0, 0, 0)",
        HSL: "hsla(0, 0%, 0%, 0)",
        OKLCH: "oklch(0 0 none / 0)",
      },
    ],
  ])("converts %s", (text, expected) => {
    const result = run("color", text);
    expect(fields(result)).toEqual(expected);
    expect(warnings(result)).toEqual([]);
  });

  it("keeps alpha near 0 and 1 apart from fully transparent and opaque", () => {
    expect(fields(run("color", "#ff000001"))).toMatchObject({
      RGB: "rgba(255, 0, 0, 0.004)",
      HSL: "hsla(0, 100%, 50%, 0.004)",
    });
    expect(fields(run("color", "#ff0000fe"))).toMatchObject({
      Hex: "#ff0000fe",
      RGB: "rgba(255, 0, 0, 0.996)",
    });
  });

  it("gives every field a swatch color equal to its value", () => {
    const result = run("color", "rgb(255 99 71 / 0.5)");
    if (result.kind !== "ok") throw new Error(result.message);
    for (const field of result.fields) expect(field.color).toBe(field.value);
  });

  it("maps colors outside sRGB into it and warns", () => {
    const result = run("color", "oklch(0.7 0.4 30)");
    expect(fields(result)).toMatchObject({
      Hex: "#ff5843",
      RGB: "rgb(255, 88, 67)",
      OKLCH: "oklch(0.7 0.4 30)",
    });
    expect(warnings(result)).toEqual([
      "Outside the sRGB gamut, so hex, RGB and HSL show the nearest color sRGB can display.",
    ]);
    expect(warnings(run("color", "color(display-p3 1 0 0)"))).toHaveLength(1);
  });

  it.each(["nope", "#12345", "rgb(1, 2)", "red;", ""])("rejects %j", (text) => {
    expect(errorOf(run("color", text))).toBe("Not a CSS color.");
  });
});

describe("case", () => {
  it("converts to every style at once, splitting acronyms and digits", () => {
    expect(fields(run("case", "XMLHttpRequest id2Value"))).toEqual({
      camelCase: "xmlHttpRequestId2Value",
      PascalCase: "XmlHttpRequestId2Value",
      snake_case: "xml_http_request_id2_value",
      CONSTANT_CASE: "XML_HTTP_REQUEST_ID2_VALUE",
      "kebab-case": "xml-http-request-id2-value",
      "Title Case": "Xml Http Request Id2 Value",
      "Sentence case": "Xml http request id2 value",
      "lower case": "xml http request id2 value",
      "UPPER CASE": "XML HTTP REQUEST ID2 VALUE",
    });
  });

  it.each([
    ["user_id--first.name", "user_id_first_name"],
    ["CONSTANT_CASE_NAME", "constant_case_name"],
    ["kebab-case-name", "kebab_case_name"],
    ["Hello, world! It's done.", "hello_world_its_done"],
    ["HTML5Parser v1.2", "html5_parser_v1_2"],
    ["getURLForID", "get_url_for_id"],
  ])("splits %j into words", (text, snake) => {
    expect(fields(run("case", text)).snake_case).toBe(snake);
  });

  it("handles letters outside ASCII", () => {
    expect(fields(run("case", "ÉcoleNormale supérieure"))).toMatchObject({
      PascalCase: "ÉcoleNormaleSupérieure",
      "kebab-case": "école-normale-supérieure",
    });
    expect(fields(run("case", "straßeName")).CONSTANT_CASE).toBe("STRASSE_NAME");
    expect(fields(run("case", "ΑλφαΒήτα")).snake_case).toBe("αλφα_βήτα");
    expect(fields(run("case", "écoleName")).PascalCase).toBe("ÉcoleName");
    expect(fields(run("case", "日本語 text")).camelCase).toBe("日本語Text");
  });

  it("splits a word with a long run of combining marks in linear time", () => {
    const marks = "́".repeat(200_000);
    expect(fields(run("case", `a${marks}B`)).snake_case).toBe(`a${marks}_b`);
    expect(fields(run("case", `A${marks}Bc`)).snake_case).toBe(`a${marks}_bc`);
  });

  it("converts each line on its own", () => {
    expect(fields(run("case", "fooBar\r\n\nbaz qux")).snake_case).toBe("foo_bar\n\nbaz_qux");
  });

  it("rejects text without letters or digits", () => {
    expect(errorOf(run("case", "--- !!"))).toBe("No letters or digits to convert.");
  });
});
