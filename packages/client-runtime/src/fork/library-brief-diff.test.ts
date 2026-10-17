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

  it("shows a rewrite too large to match as removed then added", () => {
    const before = Array.from({ length: 1200 }, (_, index) => `old ${index}`).join("\n");
    const after = Array.from({ length: 1200 }, (_, index) => `new ${index}`).join("\n");
    const diff = libraryBriefDiff(before, after);
    expect(diff).toHaveLength(2400);
    expect(diff[0]).toEqual({ kind: "removed", text: "old 0" });
    expect(diff[1200]).toEqual({ kind: "added", text: "new 0" });
  });
});
