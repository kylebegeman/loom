import { resolveVersionMismatch } from "~/versionSkew";

export const OS_MANAGED_RUNTIME_STATUS = "Runtime managed by its operating system";

/** Unknown or stale hosts must never look verified as current. */
export function describeFleetUpdateStatus(input: {
  readonly connected: boolean;
  readonly currentVersion: string | null;
  readonly targetVersion: string;
  readonly providerCount: number;
  readonly localVersion: string | null;
  readonly blockedReason?: string | undefined;
  /** The operating system ships this runtime, so no client version is "available" to it. */
  readonly osManaged?: boolean;
}): string {
  if (!input.connected) return "Offline · reconnect to check updates";
  if (input.currentVersion === null) return "Waiting for version";
  const behind = resolveVersionMismatch(input.currentVersion, input.targetVersion) !== null;
  const available = [
    ...(input.localVersion !== null
      ? [`App ${input.localVersion} available`]
      : behind
        ? [input.osManaged ? OS_MANAGED_RUNTIME_STATUS : `Runtime ${input.targetVersion} available`]
        : []),
    ...(input.providerCount > 0
      ? [`${input.providerCount} provider ${input.providerCount === 1 ? "update" : "updates"}`]
      : []),
  ];
  return available.length === 0
    ? "Up to date"
    : [
        ...available,
        ...(behind && input.blockedReason && !input.osManaged ? [input.blockedReason] : []),
      ].join(" · ");
}
