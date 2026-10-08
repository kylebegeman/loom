import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import type { ProjectLifecycleSettings } from "@t3tools/contracts/fork";

/** Finder and `diskutil` sizes are decimal. */
export const GB = 1_000_000_000;

export const STEER_RATIO = 0.75;
export const CLEAR_RATIO = 0.9;
/** A lane must fall this low before its running agent can be steered again. */
export const STEER_RESET_RATIO = 0.6;
export const GROW_FACTOR = 1.5;
/** The machine notice ends once free space is this far above the reserve. */
export const RESERVE_RECOVERY_BYTES = 10 * GB;
/** Remount an idle lane when its image holds this much more than the volume uses. */
export const REMOUNT_SLACK_BYTES = 10 * GB;
export const REMOUNT_SLACK_RATIO = 0.25;

const APPLE_MARKERS = new Set(["Package.swift", "project.yml", "Project.swift", "Tuist", "ios"]);

/** Top-level entries of a checkout that mark an Xcode or SwiftPM project. */
export const isAppleCheckout = (entries: ReadonlyArray<string>) =>
  entries.some(
    (name) =>
      APPLE_MARKERS.has(name) || name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace"),
  );

export const laneCapBytes = (
  settings: ProjectLifecycleSettings,
  projectId: string,
  apple: boolean,
) =>
  (settings.projectCapsGb[projectId] ?? (apple ? settings.appleCapGb : settings.defaultCapGb)) * GB;

/** A folder name that is safe in a path and in the shell index. */
export const laneSlug = (name: string) =>
  name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "")
    .slice(0, 64) || "lane";

export const uniqueName = (base: string, taken: ReadonlySet<string>) => {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
};

/** The checkout's lane name: `main` for the project root, else the worktree folder. */
export const laneBaseName = (checkoutPath: string, workspaceRoot: string) =>
  checkoutPath === workspaceRoot ? "main" : laneSlug(checkoutPath.split("/").pop() ?? "");

/**
 * Project folder under the lanes root. Reuses the project's existing folder; a name already
 * used by another project gets the project id appended.
 */
export const projectFolder = (input: {
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly existing: ReadonlyArray<{ readonly projectId: string; readonly folder: string }>;
}) => {
  const own = input.existing.find((entry) => entry.projectId === input.projectId);
  if (own !== undefined) return own.folder;
  const base = laneSlug(input.workspaceRoot.split("/").pop() ?? "");
  return input.existing.some((entry) => entry.folder === base)
    ? `${base}-${laneSlug(input.projectId).slice(0, 8)}`
    : base;
};

export const threadSettled = (thread: OrchestrationV2ThreadShell) =>
  thread.settledOverride === "settled" ||
  (thread.settledAt !== null && thread.settledOverride !== "active");

/** Threads that keep a lane alive: not archived and not settled. */
export const holdsLane = (thread: OrchestrationV2ThreadShell) =>
  thread.archivedAt === null && !threadSettled(thread);

export const threadRunning = (thread: OrchestrationV2ThreadShell) => thread.activeRunId !== null;

export type LaneAction =
  | { readonly type: "steer" }
  | { readonly type: "clear-tmp" }
  | { readonly type: "remount" };

export interface LaneReading {
  readonly capBytes: number;
  readonly usedBytes: number | null;
  readonly imageBytes: number | null;
  readonly running: boolean;
  readonly mounted: boolean;
}

/** What the watchdog does for one lane this tick, and whether its agent stays steered. */
export const laneActions = (reading: LaneReading, steered: boolean) => {
  const actions: Array<LaneAction> = [];
  if (reading.usedBytes === null || !reading.mounted) return { actions, steered };
  const ratio = reading.usedBytes / reading.capBytes;
  let nextSteered = ratio < STEER_RESET_RATIO ? false : steered;
  if (reading.running) {
    if (ratio >= STEER_RATIO && !nextSteered) {
      actions.push({ type: "steer" });
      nextSteered = true;
    }
    return { actions, steered: nextSteered };
  }
  if (ratio >= CLEAR_RATIO) actions.push({ type: "clear-tmp" });
  else if (
    reading.imageBytes !== null &&
    reading.imageBytes - reading.usedBytes >
      Math.max(REMOUNT_SLACK_BYTES, reading.capBytes * REMOUNT_SLACK_RATIO)
  )
    actions.push({ type: "remount" });
  return { actions, steered: nextSteered };
};

/** True when an idle lane is still at the clear threshold after clearing `tmp`. */
export const shouldGrow = (usedBytes: number, capBytes: number) =>
  usedBytes / capBytes >= CLEAR_RATIO;

/**
 * The cap to grow to: half again, limited so the machine keeps its reserve. Null when there
 * is less than 1 GB of room.
 */
export const growTarget = (input: {
  readonly capBytes: number;
  readonly hostFreeBytes: number | null;
  readonly reserveBytes: number;
}) => {
  if (input.hostFreeBytes === null) return null;
  const room = input.hostFreeBytes - input.reserveBytes;
  const extra = Math.min(Math.ceil((input.capBytes * (GROW_FACTOR - 1)) / GB) * GB, room);
  return extra < GB ? null : input.capBytes + Math.floor(extra / GB) * GB;
};

/**
 * Machine-wide pressure. An episode starts when free space drops below the reserve and ends
 * once it recovers past the reserve plus a margin; agents are steered once per episode.
 */
export const machinePressure = (input: {
  readonly hostFreeBytes: number | null;
  readonly reserveBytes: number;
  readonly inEpisode: boolean;
}) => {
  if (input.hostFreeBytes === null)
    return { below: false, inEpisode: input.inEpisode, steer: false };
  const below = input.hostFreeBytes < input.reserveBytes;
  if (below) return { below, inEpisode: true, steer: !input.inEpisode };
  const recovered = input.hostFreeBytes >= input.reserveBytes + RESERVE_RECOVERY_BYTES;
  return { below, inEpisode: input.inEpisode && !recovered, steer: false };
};

export const formatGb = (bytes: number) => `${Math.round(bytes / GB)} GB`;

export const laneSteerText = (input: {
  readonly usedBytes: number;
  readonly capBytes: number;
  readonly tmpPath: string;
}) =>
  [
    `Loom: this thread's lane is at ${Math.round((input.usedBytes / input.capBytes) * 100)}% of its ${formatGb(input.capBytes)} cap (${formatGb(input.usedBytes)} used).`,
    `Before continuing, delete scratch you no longer need under ${input.tmpPath}, or call loom_project_lifecycle_free with scope "tmp", "build" or "all".`,
    "If you still need room after that, call loom_project_lifecycle_grow.",
  ].join(" ");

export const reserveSteerText = (input: {
  readonly hostFreeBytes: number;
  readonly reserveBytes: number;
}) =>
  [
    `Loom: this machine has ${formatGb(input.hostFreeBytes)} free, below its ${formatGb(input.reserveBytes)} reserve.`,
    "Finish your current step, then free what you no longer need with loom_project_lifecycle_free and delete large files you created outside your lane.",
  ].join(" ");
