import type { CheckpointId } from "@t3tools/contracts";
import type { PcbHistory, PcbHistoryVersion } from "@t3tools/contracts/fork";
export type HistoryChip =
  | { kind: "version"; version: PcbHistoryVersion; folded: number }
  | { kind: "now"; matches: CheckpointId | null };
/** Oldest first, folding unchanged adjacent versions into the older chip. */
export function historyChips(
  pages: ReadonlyArray<PcbHistory>,
  selected: CheckpointId | null = null,
): HistoryChip[] {
  const unique = new Map<CheckpointId, PcbHistoryVersion>();
  for (const page of pages)
    for (const version of page.versions)
      if (!unique.has(version.checkpointId)) unique.set(version.checkpointId, version);
  const versions = [...unique.values()].toSorted((a, b) => a.turn - b.turn);
  const chips: HistoryChip[] = [];
  for (const version of versions) {
    const previous = chips.at(-1);
    if (
      previous?.kind === "version" &&
      version.checkpointId !== selected &&
      previous.version.contentKey === version.contentKey &&
      previous.version.present === version.present
    ) {
      previous.folded++;
      previous.version = {
        ...previous.version,
        changed: [...new Set([...previous.version.changed, ...version.changed])].slice(0, 20),
      };
    } else chips.push({ kind: "version", version, folded: 0 });
  }
  const current = pages[0]?.current;
  const match = current
    ? versions.findLast((version) => version.contentKey === current.contentKey)
    : null;
  chips.push({ kind: "now", matches: match?.checkpointId ?? null });
  return chips;
}
export function stepChip(
  chips: ReadonlyArray<HistoryChip>,
  current: CheckpointId | "now",
  direction: -1 | 1,
): CheckpointId | "now" | null {
  const index = chips.findIndex((chip) =>
    chip.kind === "now" ? current === "now" : chip.version.checkpointId === current,
  );
  if (index < 0) return null;
  const next = chips[index + direction];
  return next ? (next.kind === "now" ? "now" : next.version.checkpointId) : null;
}
export const viewingLabel = (turn: number, latestTurn: number | null) =>
  turn === 0
    ? "Viewing the start of the thread"
    : `Viewing turn ${turn}${latestTurn === null ? "" : ` of ${latestTurn}`}`;
export const chipLabel = (version: PcbHistoryVersion) =>
  `${version.turn === 0 ? "Start" : `Turn ${version.turn}`}${version.present ? "" : " (not created yet)"}`;
