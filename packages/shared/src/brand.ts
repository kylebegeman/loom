/**
 * Loom fork branding. Upstream never edits this file; its readers mark the seam `fork: brand`.
 * Identifiers that locate existing data keep their T3 names (see FORK.md).
 */
export const BRAND_NAME = "Loom";

/**
 * Stage labels that show the bare name: upstream's stable desktop and mobile
 * stage ("Beta", formerly "Alpha", which older desktop hosts still report) and
 * the hosted stable web channel ("Latest").
 */
const UNLABELED_STAGES: ReadonlySet<string> = new Set(["beta", "alpha", "latest"]);

/**
 * Display name for a release stage: "Loom" for stable builds, otherwise the
 * stage in parentheses, such as "Loom (Nightly)" or "Loom (Dev)".
 */
export function formatBrandDisplayName(stageLabel: string, baseName: string = BRAND_NAME): string {
  return UNLABELED_STAGES.has(stageLabel.trim().toLowerCase())
    ? baseName
    : `${baseName} (${stageLabel})`;
}

/** One filled layer of the Loom mark, with a linear gradient across its bounding box. */
export interface LoomMarkLayer {
  readonly d: string;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly stops: ReadonlyArray<readonly [offset: number, color: string]>;
}

/**
 * The app icon at glyph size in a 24-unit view box: the sky tile, the sun, then the hill
 * drawn over the sun. Web and mobile render these same layers.
 */
export const LOOM_MARK_LAYERS: ReadonlyArray<LoomMarkLayer> = [
  {
    d: "M6 1H18A5 5 0 0 1 23 6V18A5 5 0 0 1 18 23H6A5 5 0 0 1 1 18V6A5 5 0 0 1 6 1Z",
    from: [0, 0],
    to: [1, 1],
    stops: [
      [0, "#ffffff"],
      [0.55, "#fff0ea"],
      [1, "#ebe4ff"],
    ],
  },
  {
    d: "M6.65 12.1A5.35 5.35 0 0 1 17.35 12.1A5.35 5.35 0 0 1 6.65 12.1Z",
    from: [0, 0],
    to: [0, 1],
    stops: [
      [0, "#ffe27a"],
      [0.55, "#ff9a62"],
      [1, "#ff4f79"],
    ],
  },
  {
    d: "M1 15.1Q12 8 23 15.3V18A5 5 0 0 1 18 23H6A5 5 0 0 1 1 18Z",
    from: [1, 0],
    to: [0.1, 1],
    stops: [
      [0, "#ffb466"],
      [0.25, "#f4508a"],
      [0.45, "#c42fb8"],
      [0.62, "#6a26e0"],
      [0.8, "#2d1fb5"],
      [1, "#0e1645"],
    ],
  },
];
