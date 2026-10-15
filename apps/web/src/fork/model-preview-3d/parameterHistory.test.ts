import { expect, it } from "vite-plus/test";
import { createHistory, moveHistory, nearestEntry, recordHistory } from "./parameterHistory";
it("groups continuous edits, supports undo/redo and drops the redo branch on a new edit", () => {
  const base = { overrides: { width: "10" }, setName: null };
  let history = createHistory(base);
  history = recordHistory(history, { ...base, overrides: { width: "11" } }, "11", "width", 1000);
  history = recordHistory(history, { ...base, overrides: { width: "12" } }, "12", "width", 1100);
  expect(history.entries).toHaveLength(2);
  history = moveHistory(history, 0);
  expect(history.entries[history.cursor]!.value).toEqual(base);
  history = moveHistory(history, 1);
  expect(history.entries[history.cursor]!.value.overrides.width).toBe("12");
  history = moveHistory(history, 0);
  history = recordHistory(history, { ...base, overrides: { width: "20" } }, "20", "width", 1200);
  expect(history.entries.map((e) => e.value.overrides.width)).toEqual(["10", "20"]);
});
it("bounds memory while retaining independent fields and named-set changes", () => {
  let history = createHistory({ overrides: {}, setName: null });
  for (let i = 0; i < 100; i++)
    history = recordHistory(
      history,
      { overrides: { width: String(i) }, setName: null },
      String(i),
      "width",
      i * 1000,
    );
  expect(history.entries).toHaveLength(80);
  expect(history.cursor).toBe(79);
  history = recordHistory(history, { overrides: {}, setName: "Wide" }, "Wide", null, 100001);
  expect(history.entries[history.cursor]!.value.setName).toBe("Wide");
});
it("finds the entry nearest the cursor that holds a value", () => {
  const value = (width: string) => ({ overrides: { width }, setName: null });
  let history = createHistory(value("10"));
  history = recordHistory(history, value("11"), "11", null, 1000);
  history = recordHistory(history, value("10"), "10", null, 2000);
  history = recordHistory(history, value("12"), "12", null, 3000);
  expect(nearestEntry(history, value("10"))).toBe(2);
  expect(nearestEntry(moveHistory(history, 0), value("10"))).toBe(0);
  expect(nearestEntry(history, value("99"))).toBe(-1);
});
