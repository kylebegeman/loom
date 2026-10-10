import {
  BUILD_PLATE_PRESETS,
  type BuildPlatePattern,
  type BuildPlatePresetId,
  type BuildPlateSetting,
} from "@t3tools/contracts/fork";
/** X, Y and Z in mm. Z is null for a surface, which has no height limit. */
export type BuildVolume = readonly [number, number, number | null];
export const resolveBuildVolume = (setting: BuildPlateSetting): BuildVolume =>
  setting.preset === "custom" ? setting.customMm : BUILD_PLATE_PRESETS[setting.preset].volumeMm;
/** What a viewer draws and fit checks use: the bed's volume and the pattern on its surface. */
export type Plate = { readonly volume: BuildVolume; readonly pattern: BuildPlatePattern };
export const resolvePlate = (setting: BuildPlateSetting): Plate => ({
  volume: resolveBuildVolume(setting),
  pattern: setting.pattern,
});
export const buildPlateLabel = (setting: BuildPlateSetting) =>
  setting.preset === "custom" ? "Custom bed" : BUILD_PLATE_PRESETS[setting.preset].label;
/** Extra limits worth knowing, such as per-nozzle reach on a dual-nozzle printer. */
export const buildPlateNote = (setting: BuildPlateSetting): string | null =>
  setting.preset === "custom" ? null : BUILD_PLATE_PRESETS[setting.preset].note;
export const formatVolume = (volume: BuildVolume) =>
  volume.filter((value) => value !== null).join(" × ");
/** Bed choices grouped for menus: printers, surfaces, then the custom size. */
export const bedGroups = (customMm: readonly [number, number, number]) => {
  const options = Object.entries(BUILD_PLATE_PRESETS).map(([id, preset]) => ({
    id: id as BuildPlatePresetId,
    label: preset.label as string,
    kind: preset.kind as "printer" | "surface",
    volumeMm: preset.volumeMm as BuildVolume,
  }));
  return [
    { label: "Printers", options: options.filter((option) => option.kind === "printer") },
    { label: "Surfaces", options: options.filter((option) => option.kind === "surface") },
    {
      label: "Custom",
      options: [
        { id: "custom" as BuildPlatePresetId, label: "Custom", volumeMm: customMm as BuildVolume },
      ],
    },
  ];
};
/** Short labels suit the viewport's segmented control; names suit lists. */
export const BUILD_PLATE_PATTERNS: readonly {
  value: BuildPlatePattern;
  label: string;
  name: string;
}[] = [
  { value: "grid-mm", label: "10 mm", name: "10 mm grid" },
  { value: "grid-inch", label: "1 in", name: "1 in grid" },
  { value: "plain", label: "Plain", name: "Plain" },
];
export const fitsBuildVolume = (size: readonly number[], volume: BuildVolume) =>
  size.length === 3 &&
  size.every((v, i) => Number.isFinite(v) && (volume[i] === null || v <= volume[i]! + 1e-6));
/** Whether a part fits as placed, fits once turned 90° on the bed, or does not fit at all. */
export type BedFit = "fits" | "rotated" | "too-large";
export const bedFit = (size: readonly number[], volume: BuildVolume): BedFit =>
  fitsBuildVolume(size, volume)
    ? "fits"
    : size.length === 3 && fitsBuildVolume([size[1]!, size[0]!, size[2]!], volume)
      ? "rotated"
      : "too-large";
