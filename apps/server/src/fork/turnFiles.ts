import type { CheckpointId, OrchestrationV2Checkpoint, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";

export interface TurnCheckpoint {
  readonly runId: RunId;
  readonly checkpointId: CheckpointId;
  readonly turn: number;
  /** Checkpoint paths are relative to the repository, not the workspace. */
  readonly files: ReadonlyArray<string>;
}

const asTurnCheckpoint = (checkpoint: OrchestrationV2Checkpoint): TurnCheckpoint | null =>
  checkpoint.status === "ready" &&
  checkpoint.runId !== null &&
  checkpoint.appRunOrdinal !== null &&
  checkpoint.files.length > 0
    ? {
        runId: checkpoint.runId,
        checkpointId: checkpoint.id,
        turn: checkpoint.appRunOrdinal,
        files: checkpoint.files.map((file) => file.path),
      }
    : null;

/** Strip a repository prefix while rejecting paths that cannot belong to the workspace. */
export const workspaceFiles = (prefix: string, files: ReadonlyArray<string>) =>
  files.flatMap((file) => {
    if (!file.startsWith(prefix)) return [];
    const relative = file.slice(prefix.length);
    return relative &&
      !relative.startsWith("/") &&
      !relative.includes("\\") &&
      !relative.includes("\0") &&
      !relative.split("/").includes("..")
      ? [relative]
      : [];
  });

/** Shared checkpoint discovery and stream for model and PCB follow-agent panels. */
export const makeTurnFiles = Effect.gen(function* () {
  const queries = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagementService;
  const runner = yield* ProcessRunner.ProcessRunner;
  const prefixes = new Map<string, string | null>();
  const repoPrefix = Effect.fn("TurnFiles.repoPrefix")(function* (root: string) {
    if (prefixes.has(root)) return prefixes.get(root)!;
    const result = yield* runner.run({
      command: "git",
      args: ["rev-parse", "--show-prefix"],
      cwd: root,
      timeout: "10 seconds",
      maxOutputBytes: 4096,
      outputMode: "truncate",
    });
    const prefix =
      result.code === 0 && !result.stdoutTruncated && !result.stdoutInvalidUtf8
        ? result.stdout.trim()
        : null;
    prefixes.set(root, prefix);
    return prefix;
  });
  const turnCheckpoints = Effect.fn("TurnFiles.turnCheckpoints")(function* (
    threadId: ThreadId,
    runId: RunId | null,
    limit: number,
  ) {
    const records = yield* queries.getThreadRecords(threadId, ["checkpoints"]);
    const checkpoints = records.checkpoints
      .flatMap((checkpoint) => {
        const turn = asTurnCheckpoint(checkpoint);
        return turn && (runId === null || turn.runId === runId) ? [turn] : [];
      })
      .toSorted((a, b) => b.turn - a.turn);
    return checkpoints.slice(0, runId === null ? limit : 1);
  });
  const turnCheckpointEvents = (threadId: ThreadId) =>
    threads.streamDomainEvents.pipe(
      Stream.map((event) => {
        const checkpoint =
          event.type === "checkpoint.captured" && event.payload.threadId === threadId
            ? asTurnCheckpoint(event.payload)
            : null;
        return checkpoint;
      }),
      Stream.filter((checkpoint): checkpoint is TurnCheckpoint => checkpoint !== null),
    );
  return { repoPrefix, turnCheckpoints, workspaceFiles, turnCheckpointEvents };
});
