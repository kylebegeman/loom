import { describe, expect, it } from "vite-plus/test";
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  commit,
  rebase,
  redo,
  same,
  startHistory,
  undo,
  type History,
} from "./undoHistory";

type State = { a: number; b: string };
const name = (_: Partial<State>, after: Partial<State>) => ({
  label: `set ${Object.keys(after).join("+")}`,
  key: Object.keys(after).join("+"),
});
const edit = (history: History<State>, next: Partial<State>, at: number) =>
  commit(history, { ...history.present, ...next }, name, at);

describe("undo history", () => {
  it("undoes and redoes only the fields a step changed", () => {
    let history = startHistory<State>({ a: 0, b: "x" });
    history = edit(history, { a: 1 }, 0);
    history = edit(history, { b: "y" }, 5000);
    const back = undo(history)!;
    expect(back.apply).toEqual({ b: "x" });
    expect(back.from).toEqual({ b: "y" });
    expect(back.label).toBe("set b");
    expect(back.history.present).toEqual({ a: 1, b: "x" });
    const again = redo(back.history)!;
    expect(again.apply).toEqual({ b: "y" });
    expect(again.from).toEqual({ b: "x" });
    expect(again.history.present).toEqual({ a: 1, b: "y" });
    expect(redo(again.history)).toBeUndefined();
    expect(undo(startHistory<State>({ a: 0, b: "" }))).toBeUndefined();
  });

  it("records nothing when the state is unchanged", () => {
    expect(edit(startHistory<State>({ a: 0, b: "x" }), { a: 0 }, 0).past).toEqual([]);
  });

  it("keeps at most the newest steps", () => {
    let history = startHistory<State>({ a: 0, b: "" });
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++)
      history = edit(history, { a: i }, i * (COALESCE_MS + 1));
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]!.before).toEqual({ a: 20 });
  });

  it("merges rapid edits to the same target into one step", () => {
    let history = startHistory<State>({ a: 0, b: "" });
    history = edit(history, { a: 1 }, 0);
    history = edit(history, { a: 2 }, COALESCE_MS);
    history = edit(history, { a: 3 }, COALESCE_MS * 2);
    expect(history.past).toHaveLength(1);
    expect(history.past[0]).toMatchObject({ before: { a: 0 }, after: { a: 3 } });
    // A pause or another target starts a new step.
    history = edit(history, { a: 4 }, COALESCE_MS * 3 + 1);
    history = edit(history, { b: "z" }, COALESCE_MS * 3 + 2);
    expect(history.past).toHaveLength(3);
  });

  it("names a merged run by its whole change", () => {
    const count = (before: Partial<State>, after: Partial<State>) => ({
      label: `a ${before.a} to ${after.a}`,
      key: "a",
    });
    let history = startHistory<State>({ a: 0, b: "" });
    history = commit(history, { ...history.present, a: 1 }, count, 0);
    history = commit(history, { ...history.present, a: 2 }, count, 100);
    expect(history.past.map((step) => step.label)).toEqual(["a 0 to 2"]);
  });

  it("drops a merged run that ends where it started", () => {
    let history = startHistory<State>({ a: 0, b: "" });
    history = edit(history, { a: 1 }, 0);
    history = edit(history, { a: 0 }, 100);
    expect(history.past).toEqual([]);
  });

  it("clears redo when a new edit follows an undo", () => {
    let history = startHistory<State>({ a: 0, b: "" });
    history = edit(history, { a: 1 }, 0);
    history = undo(history)!.history;
    expect(history.future).toHaveLength(1);
    history = edit(history, { b: "new" }, 5000);
    expect(history.future).toEqual([]);
    expect(redo(history)).toBeUndefined();
  });

  it("drops steps on fields changed outside the history", () => {
    let history = startHistory<State>({ a: 0, b: "" });
    history = edit(history, { a: 1 }, 0);
    history = edit(history, { b: "y" }, 5000);
    history = undo(history)!.history;
    history = rebase(history, { a: 9, b: "" });
    expect(history.past).toEqual([]);
    expect(history.future.map((step) => step.label)).toEqual(["set b"]);
    expect(history.present).toEqual({ a: 9, b: "" });
  });

  it("compares saved items regardless of key order or absent keys", () => {
    expect(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(same({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 2 })).toBe(false);
    expect(same([1, 2], [1, 2, 3])).toBe(false);
    expect(same([], {})).toBe(false);
    expect(same(null, {})).toBe(false);
  });
});
