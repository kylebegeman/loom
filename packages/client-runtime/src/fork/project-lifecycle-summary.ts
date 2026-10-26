import type {
  LibraryWorkingCopy,
  ProjectLifecycleLane,
  ProjectLifecycleStatus,
} from "@t3tools/contracts/fork";

type WorkingLocation = Pick<LibraryWorkingCopy, "rootPath" | "repositories">;

export const TEMPORARY_RESOURCES_EXPLANATION =
  "Keep files applies to working files. Temporary resources follow work cleanup.";

export function summarizeProjectTemporaryResources(
  location: WorkingLocation,
  lanes: readonly ProjectLifecycleLane[],
) {
  const paths = new Set([location.rootPath, ...location.repositories.map((repo) => repo.path)]);
  // A checkout can belong to several projects and conversations. Its lane is counted once.
  const matching = new Map(
    lanes.filter((lane) => paths.has(lane.checkoutPath)).map((lane) => [lane.id, lane]),
  );
  const conversations = new Set<string>();
  const leases = new Set<string>();
  let measuredBytes: number | null = null;
  let unknownUsageCount = 0;
  let running = false;
  let shared = false;
  let waitingCleanupCount = 0;
  let attentionCount = 0;
  let checkoutMissingCount = 0;
  for (const lane of matching.values()) {
    if (lane.usedBytes !== null && Number.isFinite(lane.usedBytes) && lane.usedBytes >= 0)
      measuredBytes = (measuredBytes ?? 0) + lane.usedBytes;
    else unknownUsageCount++;
    const holders = new Set(lane.threadIds);
    for (const id of holders) conversations.add(id);
    for (const lease of lane.leases) leases.add(`${lease.kind}:${lease.ref}`);
    running ||= lane.running;
    shared ||= holders.size > 1;
    if (!lane.running && holders.size === 0) waitingCleanupCount++;
    if (lane.state === "error") attentionCount++;
    if (lane.checkoutMissing !== null) checkoutMissingCount++;
  }
  return {
    laneCount: matching.size,
    measuredBytes,
    unknownUsageCount,
    conversationCount: conversations.size,
    attachedResourceCount: leases.size,
    running,
    shared,
    waitingCleanupCount,
    attentionCount,
    checkoutMissingCount,
  };
}

function formatMeasuredBytes(bytes: number) {
  if (bytes < 1_000) return `${Math.round(bytes)} B`;
  if (bytes < 1e6) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** Failed and disconnected reads never present retained measurements as current usage. */
export function projectTemporaryResourceLabels({
  location,
  status,
  connected,
  supported,
  failed,
}: {
  readonly location: WorkingLocation;
  readonly status: ProjectLifecycleStatus | null;
  readonly connected: boolean;
  readonly supported: boolean;
  readonly failed: boolean;
}): { readonly usage: string; readonly activity: string | null } {
  if (!connected)
    return { usage: "Computer offline. Reconnect to check temporary resources.", activity: null };
  if (!supported)
    return { usage: "Temporary resource status is unavailable on this computer.", activity: null };
  if (failed) return { usage: "Temporary resource status could not be read.", activity: null };
  if (status === null) return { usage: "Checking temporary resources…", activity: null };
  const summary = summarizeProjectTemporaryResources(location, status.lanes);
  const activity: string[] = [];
  if (!status.enabled) activity.push("Temporary resource cleanup is off on this computer");
  if (summary.running) activity.push("Work running");
  if (summary.conversationCount > 0)
    activity.push(
      `${summary.conversationCount} ${summary.conversationCount === 1 ? "conversation holding" : "conversations holding"} resources${summary.shared ? " (shared)" : ""}`,
    );
  if (summary.attachedResourceCount > 0)
    activity.push(
      `${summary.attachedResourceCount} attached ${summary.attachedResourceCount === 1 ? "resource" : "resources"}`,
    );
  if (summary.waitingCleanupCount > 0 && status.enabled) activity.push("Waiting for cleanup");
  if (summary.attentionCount > 0) activity.push("Resources need attention");
  if (summary.checkoutMissingCount > 0) activity.push("Checkout gone, cleanup pending");
  return {
    usage:
      summary.laneCount === 0
        ? "No temporary resources for these files"
        : summary.measuredBytes === null
          ? "Usage not measured"
          : summary.unknownUsageCount > 0
            ? `${formatMeasuredBytes(summary.measuredBytes)} measured; some usage unknown`
            : `${formatMeasuredBytes(summary.measuredBytes)} used`,
    activity: activity.length > 0 ? activity.join(" · ") : null,
  };
}
