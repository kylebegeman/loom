import { expect, it } from "vite-plus/test";
import { formatDuration, formatEstimate, formatCost } from "./slicing";
it("formats long print times and multiple filament slots without inventing unknown cost", () => {
  expect(formatDuration(93784)).toBe("1 d 2 h 3 m");
  expect(formatDuration(20)).toBe("Under a minute");
  expect(formatDuration(null)).toBe("Time unavailable");
  expect(formatCost(null, "USD")).toBeNull();
  expect(
    formatEstimate({
      printSeconds: 120,
      layerCount: 2,
      filaments: [
        { slot: 0, type: "PLA", colorHex: null, lengthMm: null, grams: 12 },
        { slot: 1, type: "PETG", colorHex: null, lengthMm: null, grams: 6 },
      ],
      totalGrams: 18,
      supportUsed: null,
      supportGrams: null,
      cost: null,
      currency: "USD",
    }),
  ).toBe("2 m, 12 g PLA + 6 g PETG");
});
