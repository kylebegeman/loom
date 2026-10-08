import { expect, it } from "vite-plus/test";
import { decadeTicks, formatEng, niceTicks, parseEng } from "./units";
import { diffHunks, lineDiff } from "./diff";
import { layerGroup } from "./layers";

it("reads SPICE engineering notation and rejects anything else", () => {
  expect(parseEng("10u")).toBeCloseTo(1e-5);
  expect(parseEng("10µs")).toBeCloseTo(1e-5);
  expect(parseEng("4.7k")).toBe(4700);
  expect(parseEng("1meg")).toBe(1e6);
  expect(parseEng("2M")).toBe(2e6);
  expect(parseEng("10ms")).toBeCloseTo(0.01);
  expect(parseEng("100 Hz")).toBe(100);
  expect(parseEng("1F")).toBe(1);
  expect(parseEng("1e-3")).toBe(0.001);
  expect(parseEng("")).toBeNull();
  expect(parseEng("ten")).toBeNull();
  expect(parseEng("1..2")).toBeNull();
});

it("formats values with SI prefixes and rolls over at a thousand", () => {
  expect(formatEng(0.00001, "s")).toBe("10 µs");
  expect(formatEng(4700, "Ω")).toBe("4.7 kΩ");
  expect(formatEng(3.3, "V")).toBe("3.3 V");
  expect(formatEng(0, "A")).toBe("0 A");
  expect(formatEng(999.95, "Hz")).toBe("1 kHz");
  expect(formatEng(-0.0025, "A")).toBe("-2.5 mA");
  expect(formatEng(1234)).toBe("1.23 k");
});

it("picks round axis ticks", () => {
  expect(niceTicks(0, 10, 5)).toEqual([0, 2.5, 5, 7.5, 10]);
  expect(niceTicks(-1, 1, 5)).toEqual([-1, -0.5, 0, 0.5, 1]);
  expect(decadeTicks(10, 100000)).toEqual([10, 100, 1000, 10000, 100000]);
});

it("diffs edited literals line by line and inserted lines by LCS", () => {
  expect(lineDiff("a\nb = 1\nc", "a\nb = 2\nc").map((l) => l.kind)).toEqual([
    "same",
    "removed",
    "added",
    "same",
  ]);
  expect(lineDiff("a\nc", "a\nb\nc").map((l) => `${l.kind}:${l.text}`)).toEqual([
    "same:a",
    "added:b",
    "same:c",
  ]);
  const lines = lineDiff(
    ["1", "2", "3", "4", "5", "6", "7", "8"].join("\n"),
    ["1", "2", "3", "4", "5", "6", "7", "x"].join("\n"),
  );
  expect(diffHunks(lines, 1).map((l) => l?.text ?? null)).toEqual(["7", "8", "x"]);
});

it("groups KiCad layers the way the layer panel lists them", () => {
  expect(["F.Cu", "In2.Cu", "B.Mask", "Edge.Cuts", "F.Fab", "Cmts.User"].map(layerGroup)).toEqual([
    "Copper",
    "Copper",
    "Technical",
    "Board",
    "Board",
    "User",
  ]);
});
