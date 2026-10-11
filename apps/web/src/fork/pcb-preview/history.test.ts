import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import { CheckpointId } from "@t3tools/contracts";
import type { PcbHistory, PcbHistoryVersion } from "@t3tools/contracts/fork";
import { historyChips, stepChip, chipLabel, viewingLabel } from "./history";
const version = (turn: number, key: string | null, present = true): PcbHistoryVersion => ({
  checkpointId: CheckpointId.make(`checkpoint-${turn}`),
  runId: null,
  turn,
  capturedAt: DateTime.makeUnsafe(turn * 1000),
  present,
  contentKey: key,
  ref: `refs/test/${turn}`,
  views: { pcb: present, schematic: present },
  changed: [],
});
const page = (
  versions: ReadonlyArray<PcbHistoryVersion>,
  key: string | null = "live",
): PcbHistory => ({
  versions,
  nextCursor: null,
  latestTurn: 9,
  current: { contentKey: key },
  threadRunning: false,
  unavailable: null,
});
it("merges pages oldest first and folds unchanged turns into the older version", () => {
  const chips = historyChips([
    page([version(7, "new"), version(4, "old")]),
    page([version(4, "old"), version(2, "old"), version(0, "start")]),
  ]);
  expect(
    chips.map((chip) => (chip.kind === "version" ? [chip.version.turn, chip.folded] : "now")),
  ).toEqual([[0, 0], [2, 1], [7, 0], "now"]);
});
it("Now names the newest matching checkpoint even when that version folded", () =>
  expect(historyChips([page([version(3, "same"), version(2, "same")], "same")]).at(-1)).toEqual({
    kind: "now",
    matches: CheckpointId.make("checkpoint-3"),
  }));
it("steps between Now and chronological chips and stops at both ends", () => {
  const chips = historyChips([page([version(4, "four"), version(2, "two")])]);
  expect(stepChip(chips, "now", -1)).toBe(CheckpointId.make("checkpoint-4"));
  expect(stepChip(chips, CheckpointId.make("checkpoint-4"), 1)).toBe("now");
  expect(stepChip(chips, CheckpointId.make("checkpoint-2"), -1)).toBeNull();
  expect(stepChip(chips, "now", 1)).toBeNull();
});
it("keeps the deleted state and formats labels with the thread's full turn count", () => {
  expect(chipLabel(version(5, null, false))).toBe("Turn 5 (not created yet)");
  expect(viewingLabel(4, 9)).toBe("Viewing turn 4 of 9");
  expect(viewingLabel(0, 9)).toBe("Viewing the start of the thread");
});
it("keeps an explicitly selected unchanged checkpoint visible for restore and stepping", () => {
  const selected = CheckpointId.make("checkpoint-3");
  const chips = historyChips(
    [page([version(4, "same"), version(3, "same"), version(2, "same")])],
    selected,
  );
  expect(chips.map((chip) => (chip.kind === "version" ? chip.version.turn : "now"))).toEqual([
    2,
    3,
    "now",
  ]);
  expect(stepChip(chips, selected, 1)).toBe("now");
});
