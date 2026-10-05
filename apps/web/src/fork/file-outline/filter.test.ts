import { describe, expect, it } from "vite-plus/test";
import { filterOutline, matchesSymbol, moveOutlineSelection, nearestOutlineSymbol } from "./filter";
import { outlineSymbol } from "./outline";

describe("outline navigation", () => {
  const symbols = [
    outlineSymbol("Store", "class", 1, 0),
    outlineSymbol("loadData", "method", 3, 1),
    outlineSymbol("save", "method", 5, 1),
    outlineSymbol("Other", "function", 10, 0),
  ];
  it("supports case-insensitive subsequences and retains only matching ancestors", () => {
    expect(matchesSymbol("loadData", "LDd")).toBe(true);
    expect(matchesSymbol("loadData", "Dload")).toBe(false);
    expect(
      filterOutline(symbols, "ldd").map(({ symbol, matched }) => [symbol.name, matched]),
    ).toEqual([
      ["Store", false],
      ["loadData", true],
    ]);
    expect(filterOutline(symbols, "missing")).toEqual([]);
    expect(filterOutline(symbols, "")).toHaveLength(4);
  });
  it("finds the nearest declaration even with grouped Go methods", () => {
    expect(nearestOutlineSymbol([symbols[0]!, symbols[3]!, symbols[1]!], 4)?.name).toBe("loadData");
    expect(nearestOutlineSymbol(symbols, 0)).toBeNull();
  });
  it("bounds keyboard navigation and handles empty results", () => {
    expect(moveOutlineSelection(0, 4, "ArrowUp")).toBe(0);
    expect(moveOutlineSelection(0, 4, "End")).toBe(3);
    expect(moveOutlineSelection(3, 4, "ArrowDown")).toBe(3);
    expect(moveOutlineSelection(3, 4, "Home")).toBe(0);
    expect(moveOutlineSelection(0, 0, "ArrowDown")).toBe(-1);
  });
});
