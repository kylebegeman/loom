import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";

const NO_FEATURES: ReadonlyArray<string> = [];

/**
 * Loom features (packet slugs and `core`) an environment supports. Empty on upstream
 * T3 servers.
 */
export const loomFeaturesOf = (
  capabilities: ExecutionEnvironmentCapabilities | null | undefined,
): ReadonlyArray<string> => capabilities?.loomFeatures ?? NO_FEATURES;

export const supportsLoomFeature = (
  capabilities: ExecutionEnvironmentCapabilities | null | undefined,
  feature: string,
): boolean => loomFeaturesOf(capabilities).includes(feature);
