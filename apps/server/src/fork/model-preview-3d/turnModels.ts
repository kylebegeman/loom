import { modelFormatOf, type TurnModel } from "@t3tools/contracts/fork";
import { PREVIEWABLE_FORMATS } from "./formats.ts";

export const TURN_MODEL_LIMIT = 50;
export const SCAD_DEPENDENT_LIMIT = 200;

/** Collect transitive reverse include edges in checkpoint order, terminating cycles. */
export const dependentModels = (
  changed: ReadonlyArray<string>,
  reverse: ReadonlyMap<string, ReadonlySet<string>>,
  limit = SCAD_DEPENDENT_LIMIT,
) => {
  const models = new Map<string, string>();
  let truncated = false;
  for (const via of changed) {
    const seen = new Set([via]);
    const pending = [via];
    for (let index = 0; index < pending.length; index++) {
      for (const parent of reverse.get(pending[index]!) ?? []) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        if (!models.has(parent)) {
          if (models.size >= limit) {
            truncated = true;
            continue;
          }
          models.set(parent, via);
        }
        pending.push(parent);
      }
    }
  }
  return { models, truncated };
};

/** Written files retain checkpoint order; dependencies sort by path and never duplicate writes. */
export const modelCandidates = (
  changed: ReadonlyArray<string>,
  dependents: ReadonlyMap<string, string>,
): TurnModel[] => {
  const written = new Map<string, TurnModel>();
  for (const path of changed) {
    const format = modelFormatOf(path);
    if (format && PREVIEWABLE_FORMATS.has(format) && !written.has(path))
      written.set(path, { path, format, reason: "written", via: null });
  }
  const dependencies = [...dependents.entries()]
    .filter(([path]) => !written.has(path))
    .toSorted(([a], [b]) => a.localeCompare(b))
    .flatMap(([path, via]): TurnModel[] => {
      const format = modelFormatOf(path);
      return format && PREVIEWABLE_FORMATS.has(format)
        ? [{ path, format, reason: "dependency", via }]
        : [];
    });
  return [...written.values(), ...dependencies];
};

/** Apply the wire bound after filesystem validation, so deleted candidates do not hide valid ones. */
export const capTurnModels = (models: ReadonlyArray<TurnModel>) => ({
  models: models.slice(0, TURN_MODEL_LIMIT),
  truncated: models.length > TURN_MODEL_LIMIT,
});
