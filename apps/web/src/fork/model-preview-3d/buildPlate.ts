import {
  activeBed,
  listBeds,
  fitOnBed,
  type BedFit as SharedBedFit,
  type BedVolume,
  type BuildPlatePattern,
  type BuildPlateSetting,
} from "@t3tools/contracts/fork";
/** X, Y and Z in mm. Z is null for a surface, which has no height limit. */
export type BuildVolume = BedVolume;
export const resolveBuildVolume = (setting: BuildPlateSetting): BuildVolume =>
  activeBed(setting).volumeMm;
/** What a viewer draws and fit checks use: the bed's volume and the pattern on its surface. */
export type Plate = { readonly volume: BuildVolume; readonly pattern: BuildPlatePattern };
export const resolvePlate = (setting: BuildPlateSetting): Plate => ({
  volume: resolveBuildVolume(setting),
  pattern: setting.pattern,
});
export const buildPlateLabel = (setting: BuildPlateSetting) =>
  setting.preset === "custom" ? "Custom bed" : activeBed(setting).label;
/** Extra limits worth knowing, such as per-nozzle reach on a dual-nozzle printer. */
export const buildPlateNote = (setting: BuildPlateSetting): string | null =>
  activeBed(setting).note;
/** Bed choices grouped for menus: printers, surfaces, then the custom size. */
export const bedGroups = (setting: BuildPlateSetting) => {
  const beds = listBeds(setting);
  return [
    { label: "Printers", options: beds.filter((bed) => bed.kind === "printer") },
    { label: "Surfaces", options: beds.filter((bed) => bed.kind === "surface") },
    { label: "Custom", options: beds.filter((bed) => bed.kind === "custom") },
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
export const fitsBuildVolume = (size: readonly [number, number, number], volume: BuildVolume) =>
  fitOnBed(size, volume).status === "fits";
/** Legacy labels used by the viewport and variant chips, backed by the shared fit rule. */
export type BedFit = "fits" | "rotated" | "too-large";
export const bedFit = (size: readonly [number, number, number], volume: BuildVolume): BedFit => {
  const fit = fitOnBed(size, volume);
  return fit.status === "fits" ? "fits" : fit.status === "fits-rotated" ? "rotated" : "too-large";
};

const OVER = ["wide", "deep", "tall"] as const;
/** Fits, Fits rotated, or per-axis overage, with lengths formatted for the current units. */
export const describeFit = (fit: SharedBedFit, format: (mm: number) => string): string =>
  fit.status === "fits"
    ? "Fits"
    : fit.status === "fits-rotated"
      ? "Fits rotated"
      : fit.overMm
          .flatMap((value, axis) => (value > 1e-6 ? [`${format(value)} too ${OVER[axis]}`] : []))
          .join(", ");
