import { describe, expect, it } from "vite-plus/test";
import { libraryBriefDiff } from "./library-brief-diff.ts";

const lines = (...entries: string[]) => entries.join("\n");

describe("libraryBriefDiff", () => {
  it("marks a replaced line as removed then added, keeping the lines around it", () => {
    expect(libraryBriefDiff(lines("A", "B", "C"), lines("A", "B2", "C"))).toEqual([
      { kind: "same", text: "A" },
      { kind: "removed", text: "B" },
      { kind: "added", text: "B2" },
      { kind: "same", text: "C" },
    ]);
  });

  it("treats an empty brief as no lines, so a first brief is all added", () => {
    expect(libraryBriefDiff("", lines("Goal", "Stack"))).toEqual([
      { kind: "added", text: "Goal" },
      { kind: "added", text: "Stack" },
    ]);
    expect(libraryBriefDiff("Goal", "")).toEqual([{ kind: "removed", text: "Goal" }]);
  });

  it("matches lines that moved past an insertion instead of replacing everything", () => {
    expect(libraryBriefDiff(lines("A", "B", "C", "D"), lines("A", "X", "B", "D", "E"))).toEqual([
      { kind: "same", text: "A" },
      { kind: "added", text: "X" },
      { kind: "same", text: "B" },
      { kind: "removed", text: "C" },
      { kind: "same", text: "D" },
      { kind: "added", text: "E" },
    ]);
  });

  it("folds long unchanged runs and keeps two lines of context on each side", () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index}`);
    const after = before.map((line, index) => (index === 10 ? "changed" : line));
    expect(libraryBriefDiff(before.join("\n"), after.join("\n"))).toEqual([
      { kind: "folded", count: 8 },
      { kind: "same", text: "line 8" },
      { kind: "same", text: "line 9" },
      { kind: "removed", text: "line 10" },
      { kind: "added", text: "changed" },
      { kind: "same", text: "line 11" },
      { kind: "same", text: "line 12" },
      { kind: "folded", count: 7 },
    ]);
  });

  it("ignores Windows line endings", () => {
    expect(libraryBriefDiff("A\r\nB", "A\nB")).toEqual([{ kind: "folded", count: 2 }]);
  });

  it("shows a single unchanged line between changes instead of folding it", () => {
    const before = Array.from({ length: 9 }, (_, index) => `l${index}`);
    const after = before.map((line, index) => (index === 0 || index === 6 ? `x${index}` : line));
    expect(libraryBriefDiff(before.join("\n"), after.join("\n"))).toEqual([
      { kind: "removed", text: "l0" },
      { kind: "added", text: "x0" },
      { kind: "same", text: "l1" },
      { kind: "same", text: "l2" },
      { kind: "same", text: "l3" },
      { kind: "same", text: "l4" },
      { kind: "same", text: "l5" },
      { kind: "removed", text: "l6" },
      { kind: "added", text: "x6" },
      { kind: "same", text: "l7" },
      { kind: "same", text: "l8" },
    ]);
    expect(
      libraryBriefDiff(lines("l0", "l1", "l2", "l3", "l4"), lines("l0", "l1", "l2", "x3", "l4"))[0],
    ).toEqual({
      kind: "same",
      text: "l0",
    });
  });

  it("finds two small edits far apart in a long brief", () => {
    const before = Array.from({ length: 1100 }, (_, index) => `line ${index}`);
    const after = before.map((line, index) => (index === 0 || index === 1099 ? "edited" : line));
    expect(libraryBriefDiff(before.join("\n"), after.join("\n"))).toEqual([
      { kind: "removed", text: "line 0" },
      { kind: "added", text: "edited" },
      { kind: "same", text: "line 1" },
      { kind: "same", text: "line 2" },
      { kind: "folded", count: 1094 },
      { kind: "same", text: "line 1097" },
      { kind: "same", text: "line 1098" },
      { kind: "removed", text: "line 1099" },
      { kind: "added", text: "edited" },
    ]);
  });

  // Every other line changes, and so do both ends, so trimming leaves the whole brief to match.
  const alternating = (length: number) => {
    const before = Array.from({ length }, (_, index) => `line ${index}`);
    const after = before.map((line, index) =>
      index % 2 === 0 || index === length - 1 ? `edited ${index}` : line,
    );
    return libraryBriefDiff(before.join("\n"), after.join("\n"));
  };

  it("matches unchanged lines between many edits", () => {
    const diff = alternating(900);
    expect(diff.filter((line) => line.kind === "same")).toHaveLength(449);
    expect(diff.filter((line) => line.kind === "removed")).toHaveLength(451);
  });

  it("shows a rewrite with too many changes to match as removed then added", () => {
    const diff = alternating(1100);
    expect(diff.some((line) => line.kind === "same")).toBe(false);
    expect(diff).toHaveLength(2200);
    expect(diff[0]).toEqual({ kind: "removed", text: "line 0" });
    expect(diff[1100]).toEqual({ kind: "added", text: "edited 0" });
  });
});
