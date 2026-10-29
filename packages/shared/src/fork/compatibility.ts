/** Capabilities present on every supported Loom computer, including a Library-only host. */
export const LOOM_COMPAT_FLOOR = [
  "project-workflows",
  "library-launch-files",
  "library-worktree-starts",
  "library-file-lifecycle",
] as const;

export function loomCompatibility(features: readonly string[]) {
  const advertised = new Set(features);
  const missingCompatibilityFeatures = LOOM_COMPAT_FLOOR.filter(
    (feature) => !advertised.has(feature),
  );
  return {
    belowCompatibilityFloor: missingCompatibilityFeatures.length > 0,
    missingCompatibilityFeatures,
  };
}
