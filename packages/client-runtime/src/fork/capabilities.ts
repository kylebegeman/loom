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

/** Shown in place of every update action when the operating system owns the runtime (DIR-13). */
export const OS_MANAGED_RUNTIME_NOTE = "This computer's operating system manages its Loom runtime.";

/** True only for a Loom server whose operating system ships its runtime and owns its updates. */
export const runtimeManagedByOperatingSystem = (
  capabilities: ExecutionEnvironmentCapabilities | null | undefined,
): boolean => capabilities?.serverRuntimeOwner === "operating-system";
