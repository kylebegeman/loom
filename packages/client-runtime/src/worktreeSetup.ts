import type { WorktreeSetupSnapshot } from "@t3tools/contracts";

export function resolveVisibleWorktreeSetup(input: {
  live: WorktreeSetupSnapshot | null;
  recorded: WorktreeSetupSnapshot | null;
  turnStarted: boolean;
  followUpSent: boolean;
}): WorktreeSetupSnapshot | null {
  const snapshot =
    input.live && (!input.recorded || input.live.sequence >= input.recorded.sequence)
      ? input.live
      : input.recorded;
  if (!snapshot) return null;
  if (snapshot.phase === "running") return snapshot;
  if (input.followUpSent) return null;
  if (snapshot.phase !== "done") return snapshot;
  if (!input.turnStarted) return snapshot;
  return snapshot.stages.some((stage) => stage.status === "failed") ? snapshot : null;
}

export function worktreeSetupAgentStarted(snapshot: WorktreeSetupSnapshot): boolean {
  return snapshot.stages.some((stage) => stage.id === "agent" && stage.status === "done");
}

/**
 * Whether this setup holds the composer. Project files fill in behind an open conversation and the
 * computer holds its first turn until they land, so they never block Send.
 */
// fork: library-launch-files
export function worktreeSetupBlocksSend(snapshot: WorktreeSetupSnapshot): boolean {
  return (
    snapshot.kind !== "project-files" &&
    snapshot.phase === "running" &&
    !worktreeSetupAgentStarted(snapshot)
  );
}
