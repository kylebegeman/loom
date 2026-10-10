import {
  BUILD_PLATE_PRESETS,
  type BuildPlatePresetId,
  type BuildPlateSetting,
} from "@t3tools/contracts/fork";
export const resolveBuildVolume = (
  setting: BuildPlateSetting,
): readonly [number, number, number] =>
  setting.preset === "custom" ? setting.customMm : BUILD_PLATE_PRESETS[setting.preset].volumeMm;
export const buildPlateLabel = (setting: BuildPlateSetting) =>
  setting.preset === "custom" ? "Custom build plate" : BUILD_PLATE_PRESETS[setting.preset].label;
/** Printer presets in menu order, followed by the custom volume. */
export const buildPlateOptions = (customMm: readonly [number, number, number]) => [
  ...Object.entries(BUILD_PLATE_PRESETS).map(([id, preset]) => ({
    id: id as BuildPlatePresetId,
    label: preset.label,
    volumeMm: preset.volumeMm,
  })),
  { id: "custom" as BuildPlatePresetId, label: "Custom", volumeMm: customMm },
];
export const fitsBuildVolume = (size: readonly number[], volume: readonly number[]) =>
  size.length === 3 && size.every((v, i) => Number.isFinite(v) && v <= volume[i]! + 1e-6);
