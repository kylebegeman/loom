import { resolveVersionMismatch } from "~/versionSkew";

/** Unknown or stale hosts must never look verified as current. */
export function describeFleetUpdateStatus(input: {
  readonly connected: boolean;
  readonly currentVersion: string | null;
  readonly targetVersion: string;
  readonly providerCount: number;
  readonly localVersion: string | null;
  readonly blockedReason?: string | undefined;
}): string {
  if (!input.connected) return "Offline · reconnect to check updates";
  if (input.currentVersion === null) return "Waiting for version";
  const behind = resolveVersionMismatch(input.currentVersion, input.targetVersion) !== null;
  const available = [
    ...(input.localVersion !== null
      ? [`App ${input.localVersion} available`]
      : behind
        ? [`Runtime ${input.targetVersion} available`]
        : []),
    ...(input.providerCount > 0
      ? [`${input.providerCount} provider ${input.providerCount === 1 ? "update" : "updates"}`]
      : []),
  ];
  return available.length === 0
    ? "Up to date"
    : [...available, ...(behind && input.blockedReason ? [input.blockedReason] : [])].join(" · ");
}
