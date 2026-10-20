import type {
  BotReplay,
  BotReplayComparison,
  BotReplayItem,
  BotRun,
} from "@t3tools/contracts/fork";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Structural equality for decoded JSON, ignoring key order and keys set to undefined. */
export const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (!sameValue(a[key], b[key])) return false;
  return true;
};

/** Top-level fields that differ, in a stable order, such as `["instructions", "timeoutMinutes"]`. */
export const changedFields = (
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Array<string> =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !sameValue(before[key], after[key]))
    .toSorted();

const passed = (run: BotRun) => run.status === "completed" && run.verdict?.verdict === "pass";

/**
 * How a finished replay run compares with the run it repeated. Verdict bots compare verdicts;
 * text bots compare status and reply text.
 */
export const compareRuns = (original: BotRun, replay: BotRun): BotReplayComparison => {
  if (replay.status !== "completed") return "failed";
  const before = original.verdict?.verdict;
  const after = replay.verdict?.verdict;
  if (before !== undefined || after !== undefined) {
    if (before === after) return "same";
    if (passed(replay)) return "fixed";
    if (passed(original)) return "broke";
    return "changed";
  }
  return original.status === replay.status && original.result === replay.result
    ? "same"
    : "changed";
};

export const summarizeItems = (items: ReadonlyArray<BotReplayItem>): BotReplay["summary"] => {
  const count = (comparison: BotReplayComparison) =>
    items.filter((item) => item.comparison === comparison).length;
  return {
    fixed: count("fixed"),
    broke: count("broke"),
    same: count("same"),
    changed: count("changed"),
    failed: count("failed"),
  };
};
