import { BUILD_PLATE_PRESETS, type BuildPlateSetting } from "@t3tools/contracts/fork";
export const resolveBuildVolume = (
  setting: BuildPlateSetting,
): readonly [number, number, number] =>
  setting.preset === "custom" ? setting.customMm : BUILD_PLATE_PRESETS[setting.preset].volumeMm;
export const buildPlateLabel = (setting: BuildPlateSetting) =>
  setting.preset === "custom" ? "custom" : BUILD_PLATE_PRESETS[setting.preset].label;
export const fitsBuildVolume = (size: readonly number[], volume: readonly number[]) =>
  size.length === 3 && size.every((v, i) => Number.isFinite(v) && v <= volume[i]! + 1e-6);
