import { describe, expect, it } from "vite-plus/test";
import {
  formatArea,
  formatLength,
  formatLengths,
  fromMm,
  parseLength,
  reportUnit,
  toMm,
  unitName,
} from "./length";

describe("PCB display units", () => {
  it.each(["mm", "mil", "in"] as const)("round trips millimetres through %s", (unit) => {
    for (const mm of [0, 0.254, 12.7, -25.4])
      expect(toMm(fromMm(mm, unit), unit)).toBeCloseTo(mm, 12);
  });
  it("uses PCB precision, optional suffixes and trimmed dimensions", () => {
    expect(formatLength(12.7, "mm")).toBe("12.70 mm");
    expect(formatLength(12.7, "mil")).toBe("500.0 mil");
    expect(formatLength(12.7, "in")).toBe("0.500 in");
    expect(formatLength(12.7, "mm", { digits: 0 })).toBe("13 mm");
    expect(formatLength(12.7, "mil", { digits: 0 })).toBe("500 mil");
    expect(formatLength(12.7, "in", { digits: 0 })).toBe("0.5 in");
    expect(formatLength(12.7, "mm", { digits: 1 })).toBe("12.7 mm");
    expect(formatLength(12.7, "mil", { digits: 1 })).toBe("500 mil");
    expect(formatLength(12.7, "in", { digits: 1 })).toBe("0.50 in");
    expect(formatLength(12.7, "mil", { unit: false })).toBe("500.0");
    expect(formatLength(12.7, "in", { trim: true })).toBe("0.5 in");
    expect(formatLengths([50, null, 30], "mm", { trim: true })).toBe("50 × 30 mm");
    expect(formatLengths([12.7, 25.4], "in", { unit: false })).toBe("0.500 × 1.000");
    expect(formatLengths([null], "mm")).toBe("");
    expect(formatArea(645.16, "mm")).toBe("645.16 mm²");
    expect(formatArea(645.16, "mil")).toBe("1.00 in²");
    expect(formatArea(645.16, "in")).toBe("1.00 in²");
    expect(unitName("mil")).toBe("mils");
  });
  it("does not print a negative zero after rounding", () => {
    for (const unit of ["mm", "mil", "in"] as const) {
      expect(formatLength(-0, unit, { trim: true })).toBe(`0 ${unit}`);
      expect(formatLength(-0.0000001, unit, { trim: true })).toBe(`0 ${unit}`);
    }
  });
  it("parses bare values in the current unit and explicit suffixes in any mode", () => {
    expect(parseLength("12.7", "mm")).toBe(12.7);
    expect(parseLength("500", "mil")).toBeCloseTo(12.7);
    expect(parseLength("0.5", "in")).toBe(12.7);
    for (const text of ["12.7mm", "12.7 mm", "500 mil", "500mils", "0.5in", '0.5"', "  .5 IN  "])
      expect(parseLength(text, "mm")).toBeCloseTo(12.7);
    expect(parseLength("2 in", "mil")).toBe(50.8);
    expect(parseLength("0", "in")).toBe(0);
  });
  it("rejects malformed, negative, infinite or ambiguous hardware lengths", () => {
    for (const text of [
      "",
      " ",
      "1 2",
      "1,2",
      "-1",
      "NaN",
      "Infinity",
      "1e309",
      "12 cm",
      "1.2.3",
      "mm",
      "2inches",
    ])
      expect(parseLength(text, "mm")).toBeNull();
    expect(parseLength("9".repeat(400), "in")).toBeNull();
  });
  it("recognizes report aliases and leaves unknown units unsupported", () => {
    expect(reportUnit(undefined)).toBe("mm");
    expect(reportUnit("mm")).toBe("mm");
    expect(reportUnit("mil")).toBe("mil");
    expect(reportUnit("mils")).toBe("mil");
    expect(reportUnit("in")).toBe("in");
    expect(reportUnit("cm")).toBeNull();
  });
});
