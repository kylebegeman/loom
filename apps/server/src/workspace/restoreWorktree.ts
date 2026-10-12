import type { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Path from "effect/Path";

import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import { withWorkspaceLease } from "./workspaceLease.ts";

export class WorkspacePreparationError extends Schema.TaggedError<WorkspacePreparationError>()(
  "WorkspacePreparationError",
  { message: Schema.String },
) {}

/** Restores released checkouts, retaining a retry marker until setup succeeds. */
export const restoreWorktree = Effect.fn("Workspace.restoreWorktree")(function* (input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly worktreePath: string;
  readonly branch: string;
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
  return yield* withWorkspaceLease(
    cwd,
    Effect.gen(function* () {
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
          return yield* Effect.fail(
            new WorkspacePreparationError({
              message: "The project is unavailable. Restore its checkout before continuing.",
            }),
          );
        if (!exists) {
          yield* tracker.stageStatus(input.threadId, "checkout", "running");
          yield* fs.makeDirectory(path.dirname(cwd), { recursive: true });
          if (!(yield* fs.exists(marker)))
            yield* fs.writeFileString(
              marker,
              "Workspace setup must complete before starting the agent.\n",
              { flag: "wx" },
            );
          yield* git.pruneWorktrees({ cwd: project.value.workspaceRoot });
          yield* git.createWorktree({
            cwd: project.value.workspaceRoot,
            refName: input.branch,
            path: cwd,
          });
        }
        yield* tracker.stageStatus(input.threadId, "checkout", "done");
        yield* tracker.stageStatus(input.threadId, "setup-script", "running");
        const setup = yield* scripts.runForThread({
          threadId: input.threadId,
          projectId: input.projectId,
          worktreePath: cwd,
          trigger: "setup",
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
            return yield* Effect.fail(
              new WorkspacePreparationError({
                message: "Workspace setup did not provide a completion result.",
              }),
            );
          // Restoration always waits: a reclaimed checkout has no prepared dependencies.
          const completion = yield* setup.completion;
          if (completion.exitCode !== 0)
            return yield* Effect.fail(
              new WorkspacePreparationError({
                message:
                  completion.exitCode === null
                    ? "Workspace setup was stopped before completion. Retry to prepare the workspace."
                    : `Workspace setup exited with code ${completion.exitCode}. Fix the setup script and retry.`,
              }),
            );
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
    }),
  );
});
