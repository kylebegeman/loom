import type { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Path from "effect/Path";

import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import { restoreManagedProjectCheckout } from "./ManagedProjectCheckout.ts";
import { withWorkspaceLease } from "./workspaceLease.ts";

export class WorkspacePreparationError extends Schema.TaggedError<WorkspacePreparationError>()(
  "WorkspacePreparationError",
  { message: Schema.String },
) {}

const RecoveryMarker = Schema.Struct({
  version: Schema.Literal(1),
  checkpointCommit: Schema.String,
});
const RecoveryMarkerCodec = Schema.fromJsonString(RecoveryMarker);
const decodeRecoveryMarker = Schema.decodeEffect(RecoveryMarkerCodec);
const encodeRecoveryMarker = Schema.encodeEffect(RecoveryMarkerCodec);

/** Restores released checkouts, retaining a retry marker until setup succeeds. */
export const restoreWorktree = Effect.fn("Workspace.restoreWorktree")(function* (input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly worktreePath: string;
  readonly branch: string;
  /** Set when the caller already holds this worktree lease. */
  readonly workspaceLeaseHeld?: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitWorkflow.GitWorkflowService;
  const projects = yield* ProjectService.ProjectService;
  const scripts = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const tracker = yield* WorktreeSetupTracker.WorktreeSetupTracker;
  const cwd = path.resolve(input.worktreePath);
  // A sibling survives failed creation, setup, and host restarts. It stays out
  // of the repository so Git cannot publish it or confuse it with user work.
  const marker = `${cwd}.t3-setup-pending`;
  const restore = Effect.gen(function* () {
    const exists = yield* fs.exists(cwd);
    if (exists && !(yield* fs.exists(marker))) return;
    yield* tracker.begin({
      threadId: input.threadId,
      branch: input.branch,
      baseRef: null,
      stages: ["checkout", "setup-script"],
      fiber: null,
    });
    yield* Effect.gen(function* () {
      const project = yield* projects.getById(input.projectId);
      if (Option.isNone(project))
        return yield* new WorkspacePreparationError({
          message: "The project is unavailable. Restore its checkout before continuing.",
        });
      yield* restoreManagedProjectCheckout(
        project.value.workspaceRoot,
        path.resolve(project.value.workspaceRoot) === cwd,
      );
      let recovery = (yield* fs.exists(marker))
        ? yield* fs
            .readFileString(marker)
            .pipe(Effect.flatMap((text) => decodeRecoveryMarker(text).pipe(Effect.option)))
        : Option.none<typeof RecoveryMarker.Type>();
      if (!exists) {
        yield* tracker.stageStatus(input.threadId, "checkout", "running");
        yield* fs.makeDirectory(path.dirname(cwd), { recursive: true });
        if (!(yield* fs.exists(marker)))
          yield* fs.writeFileString(
            marker,
            "Workspace setup must complete before starting the agent.\n",
            { flag: "wx" },
          );
        const root = project.value.workspaceRoot;
        const branchExists = yield* git.hasCommit({
          cwd: root,
          refName: `refs/heads/${input.branch}`,
        });
        let refName = input.branch;
        if (!branchExists) {
          const store = yield* ProjectionStore.ProjectionStoreV2;
          const saved = yield* store.getCheckpointContext(input.threadId);
          const scopes = new Set(
            saved.checkpointScopes
              .filter((scope) => scope.kind === "root_run" && path.resolve(scope.cwd) === cwd)
              .map((scope) => scope.id),
          );
          const checkpoint = saved.checkpoints
            .filter((checkpoint) => checkpoint.status === "ready" && scopes.has(checkpoint.scopeId))
            .toSorted((left, right) => (right.appRunOrdinal ?? 0) - (left.appRunOrdinal ?? 0))[0];
          if (
            checkpoint === undefined ||
            !(yield* git.hasCommit({ cwd: root, refName: `${checkpoint.ref}^` }))
          )
            return yield* new WorkspacePreparationError({
              message:
                "This conversation's branch is missing and no saved checkout is available. Restore its branch before retrying.",
            });
          const driver = yield* GitVcsDriver.GitVcsDriver;
          const snapshot = yield* driver.resolveCommit({ cwd: root, revision: checkpoint.ref });
          // Checkpoints capture working files; their parent records the real HEAD.
          const head = yield* driver.resolveCommit({
            cwd: root,
            revision: `${snapshot.commitSha}^`,
          });
          refName = head.commitSha;
          const recoveryMarker = { version: 1 as const, checkpointCommit: snapshot.commitSha };
          recovery = Option.some(recoveryMarker);
          // A retry must restore files before setup even if checkout creation already succeeded.
          yield* fs.writeFileString(marker, yield* encodeRecoveryMarker(recoveryMarker));
        }
        yield* git.pruneWorktrees({ cwd: root });
        yield* git.createWorktree({
          cwd: root,
          refName,
          ...(!branchExists ? { newRefName: input.branch } : {}),
          path: cwd,
        });
      }
      if (Option.isSome(recovery)) {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        yield* driver.execute({
          operation: "Workspace.restoreWorktree.restoreCheckpoint",
          cwd,
          args: [
            "restore",
            "--source",
            recovery.value.checkpointCommit,
            "--worktree",
            "--staged",
            "--",
            ".",
          ],
        });
        // Once files are restored, setup retries must keep any new work in the checkout.
        yield* fs.writeFileString(
          marker,
          "Workspace setup must complete before starting the agent.\n",
        );
      }
      yield* tracker.stageStatus(input.threadId, "checkout", "done");
      yield* tracker.stageStatus(input.threadId, "setup-script", "running");
      const setup = yield* scripts.runForThread({
        threadId: input.threadId,
        projectId: input.projectId,
        worktreePath: cwd,
        trigger: "setup",
        workspaceLeaseHeld: true,
        observeCompletion: {
          onOutputLine: (line) => tracker.appendTail(input.threadId, "setup-script", line),
        },
      });
      if (setup.status === "started") {
        yield* tracker.update(input.threadId, (snapshot) => ({
          ...snapshot,
          setupScript: {
            name: setup.scriptName,
            command: setup.scriptCommand,
            terminalId: setup.terminalId,
          },
        }));
        if (setup.completion === undefined)
          return yield* new WorkspacePreparationError({
            message: "Workspace setup did not provide a completion result.",
          });
        // Restoration always waits: a reclaimed checkout has no prepared dependencies.
        const completion = yield* setup.completion;
        if (completion.exitCode !== 0)
          return yield* new WorkspacePreparationError({
            message:
              completion.exitCode === null
                ? "Workspace setup was stopped before completion. Retry to prepare the workspace."
                : `Workspace setup exited with code ${completion.exitCode}. Fix the setup script and retry.`,
          });
        yield* tracker.stageStatus(input.threadId, "setup-script", "done");
      } else yield* tracker.stageStatus(input.threadId, "setup-script", "skipped");
      yield* fs.remove(marker);
      yield* tracker.finish(input.threadId, "done");
    }).pipe(
      Effect.onError((cause) =>
        tracker
          .finish(
            input.threadId,
            Cause.hasInterruptsOnly(cause) ? "cancelled" : "failed",
            Cause.pretty(cause),
          )
          .pipe(Effect.asVoid),
      ),
    );
  });
  return yield* input.workspaceLeaseHeld ? restore : withWorkspaceLease(cwd, restore);
});
