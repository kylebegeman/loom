import { describe, expect, it } from "vite-plus/test";
import { formatCount, sparklinePoint, trafficDayAt } from "./SiteTraffic";

describe("trafficDayAt", () => {
  it("picks the day nearest the pointer", () => {
    expect(trafficDayAt(0, 300, 30)).toBe(0);
    expect(trafficDayAt(300, 300, 30)).toBe(29);
    expect(trafficDayAt(150, 300, 31)).toBe(15);
  });

  it("clamps a pointer past either edge to the first or last day", () => {
    expect(trafficDayAt(-40, 300, 30)).toBe(0);
    expect(trafficDayAt(900, 300, 30)).toBe(29);
  });

  it("stays on the only day for a chart that cannot be read across", () => {
    expect(trafficDayAt(120, 300, 1)).toBe(0);
    expect(trafficDayAt(120, 0, 30)).toBe(0);
  });
});

describe("sparklinePoint", () => {
  it("places points where the sparkline draws them", () => {
    const values = [0, 5, 10];
    expect(sparklinePoint(values, 0)).toEqual({ x: 0, y: (22 / 24) * 100 });
    expect(sparklinePoint(values, 2)).toEqual({ x: 100, y: (2 / 24) * 100 });
    expect(sparklinePoint(values, 1).x).toBe(50);
  });

  it("keeps a quiet window on the baseline instead of dividing by zero", () => {
    expect(sparklinePoint([0, 0], 1)).toEqual({ x: 100, y: (22 / 24) * 100 });
  });

  it("centers a single day", () => {
    expect(sparklinePoint([4], 0).x).toBe(50);
  });
});

describe("formatCount", () => {
  it("stays exact below six digits and compacts above", () => {
    expect(formatCount(99_999)).toBe(new Intl.NumberFormat().format(99_999));
    expect(formatCount(1_250_000)).not.toContain("250");
  });
});
