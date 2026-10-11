import type { ModelMeasurement, ModelPoint } from "@t3tools/contracts/fork";

/** Wall chords use ordinary distance measurements, so stale, visibility and delete behavior agree. */
export function createWallMeasurement(
  start: ModelPoint,
  end: ModelPoint,
  sourceRevision: string,
  id: string,
  wallCount: number,
): ModelMeasurement {
  return {
    id,
    kind: "distance",
    name: `Wall ${wallCount + 1}`,
    sourceRevision,
    start,
    end,
    visible: true,
  };
}
