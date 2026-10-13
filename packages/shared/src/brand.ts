/**
 * Loom fork branding. This file is fork-owned: upstream T3 Code never edits it,
 * and every upstream file that reads it marks the seam with `fork: brand`.
 *
 * Desktop identifiers that locate existing data keep their T3 names: the app
 * id, userData folder, `~/.t3`, URL schemes, storage keys, and the package name
 * Electron derives its macOS Keychain "Safe Storage" item from. Native iOS
 * uses a separate Loom identity and TestFlight channel. See FORK.md.
 */
export const BRAND_NAME = "Loom";

/**
 * Stage labels that show the bare name: upstream's stable desktop stage
 * ("Alpha") and the hosted stable web channel ("Latest").
 */
const UNLABELED_STAGES: ReadonlySet<string> = new Set(["alpha", "latest"]);

/**
 * Display name for a release stage: "Loom" for stable builds, otherwise the
 * stage in parentheses, such as "Loom (Nightly)" or "Loom (Dev)".
 */
export function formatBrandDisplayName(stageLabel: string, baseName: string = BRAND_NAME): string {
  return UNLABELED_STAGES.has(stageLabel.trim().toLowerCase())
    ? baseName
    : `${baseName} (${stageLabel})`;
}
