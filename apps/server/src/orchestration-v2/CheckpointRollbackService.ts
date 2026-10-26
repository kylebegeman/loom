// fork: project-lifecycle
import {
  CheckpointRef,
  CheckpointRestoreActionError,
  type CheckpointRestoreState,
  type CommandId,
  type OrchestrationV2CheckpointScope,
} from "@t3tools/contracts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import {
  CheckpointId,
  CheckpointScopeId,
  latestProviderTurnForAttempt,
  type OrchestrationV2DomainEvent,
  ProviderThreadId,
  ThreadId,
  VcsProcessExitError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import type * as ServerConfig from "../config.ts";
import type * as ServerSettings from "../serverSettings.ts";
import { makeIsManagedWorktreePath } from "../worktreesDirectory.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import {
  isCheckpointRestoreIsolated,
  SHARED_WORKSPACE_RESTORE_MESSAGE,
} from "./CheckpointRestoreSafety.ts";
import { CheckpointRestoreError, CheckpointServiceV2 } from "./CheckpointService.ts";
import { EventSinkV2 } from "./EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { ProjectionStoreV2 } from "./ProjectionStore.ts";
import { GIT_INDEX_LOCKED_DETAIL } from "../vcs/VcsProcess.ts";
import * as ProjectStore from "./ProjectStore.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { ProviderSessionManagerV2 } from "./ProviderSessionManager.ts";
import { RuntimePolicyV2 } from "./RuntimePolicy.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";

// fork: project-lifecycle
const isCheckpointRestoreActionError = Schema.is(CheckpointRestoreActionError);

export const ROLLBACK_FAILED_MESSAGE =
  "The provider could not roll back this conversation. Try again; if it keeps failing, check the provider and server logs.";

export class CheckpointRollbackExecutionError extends Schema.TaggedError<CheckpointRollbackExecutionError>()(
  "CheckpointRollbackExecutionError",
  {
    reason: Schema.Literals([
      "rollback-target-invalid",
      "active-provider-changed",
      "provider-turn-unavailable",
      "unexpected-failure",
      "shared-workspace",
    ]),
    threadId: ThreadId,
    providerThreadId: ProviderThreadId,
    checkpointId: CheckpointId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "rollback-target-invalid":
        return `Rollback target ${this.checkpointId} for provider thread ${this.providerThreadId} on thread ${this.threadId} is incomplete or invalid.`;
      case "active-provider-changed":
        return `Active provider changed before rollback target ${this.checkpointId} could execute on thread ${this.threadId}.`;
      case "provider-turn-unavailable":
        return `Provider turn for rollback target ${this.checkpointId} is unavailable on provider thread ${this.providerThreadId}.`;
      case "shared-workspace":
        return SHARED_WORKSPACE_RESTORE_MESSAGE;
      case "unexpected-failure":
        return ROLLBACK_FAILED_MESSAGE;
    }
  }
}

const isCheckpointRollbackExecutionError = Schema.is(CheckpointRollbackExecutionError);
const isVcsProcessExitError = Schema.is(VcsProcessExitError);
const isCheckpointRestoreError = Schema.is(CheckpointRestoreError);

/**
 * The message clients see when a rollback fails. Only a held Git index lock
 * gets its own explanation; other reasons carry internal ids or raw Git
 * output, so they fall back to the generic message.
 */
export function rollbackFailureClientMessage(error: CheckpointRollbackExecutionError): string {
  const restoreCause = isCheckpointRestoreError(error.cause) ? error.cause.cause : undefined;
  return isVcsProcessExitError(restoreCause) && restoreCause.detail === GIT_INDEX_LOCKED_DETAIL
    ? GIT_INDEX_LOCKED_DETAIL
    : ROLLBACK_FAILED_MESSAGE;
}

export interface CheckpointRollbackServiceV2Shape {
  // fork: project-lifecycle
  readonly restoreState: (input: {
    readonly threadId: ThreadId;
    readonly scopeId?: CheckpointScopeId | undefined;
  }) => Effect.Effect<CheckpointRestoreState, CheckpointRestoreActionError>;
  readonly undoRestore: (input: {
    readonly threadId: ThreadId;
    readonly undoToken: string;
  }) => Effect.Effect<void, CheckpointRestoreActionError>;
  readonly execute: (input: {
    readonly threadId: ThreadId;
    readonly providerThreadId: ProviderThreadId;
    readonly checkpointId: CheckpointId;
    readonly scopeId: CheckpointScopeId;
    readonly restoreFiles?: boolean;
    // fork: project-lifecycle
    readonly requestId?: CommandId;
  }) => Effect.Effect<void, CheckpointRollbackExecutionError>;
}

export class CheckpointRollbackServiceV2 extends Context.Service<
  CheckpointRollbackServiceV2,
  CheckpointRollbackServiceV2Shape
>()("t3/orchestration-v2/CheckpointRollbackService/CheckpointRollbackServiceV2") {}

export const layer: Layer.Layer<
  CheckpointRollbackServiceV2,
  never,
  | CheckpointServiceV2
  // fork: project-lifecycle
  | CheckpointStore.CheckpointStore
  | GitWorkflowService.GitWorkflowService
  | EventSinkV2
  | IdAllocator.IdAllocatorV2
  | ProjectionStoreV2
  | ProviderSessionManagerV2
  | RuntimePolicyV2
  | FileSystem.FileSystem
  | Path.Path
  | ProjectStore.ProjectStoreV2
  | ServerConfig.ServerConfig
  | ServerSettings.ServerSettingsService
  | ThreadCommandExecutor.ThreadCommandExecutor
> = Layer.effect(
  CheckpointRollbackServiceV2,
  Effect.gen(function* () {
    const checkpoints = yield* CheckpointServiceV2;
    // fork: project-lifecycle
    const checkpointStore = yield* CheckpointStore.CheckpointStore;
    const undoStates = new Map<
      ThreadId,
      {
        token: string;
        scope: OrchestrationV2CheckpointScope;
        beforeRef: CheckpointRef;
        restoredRef: CheckpointRef;
      }
    >();
    const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
    const eventSink = yield* EventSinkV2;
    const ids = yield* IdAllocator.IdAllocatorV2;
    const projections = yield* ProjectionStoreV2;
    const sessions = yield* ProviderSessionManagerV2;
    const runtimePolicy = yield* RuntimePolicyV2;
    const fileSystem = yield* FileSystem.FileSystem;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const path = yield* Path.Path;
    const threadCommands = yield* ThreadCommandExecutor.ThreadCommandExecutor;
    const isManagedWorktreePath = yield* makeIsManagedWorktreePath;

    // fork: project-lifecycle
    const execute = Effect.fn("orchestrationV2.checkpointRollback.execute")(function* (
      input: Parameters<CheckpointRollbackServiceV2Shape["execute"]>[0],
    ) {
      const context = yield* projections.getCheckpointRollbackContext(input.threadId, input);
      const { providerThread, checkpoint, scope, targetAttempt, runsToRollback, staleCheckpoints } =
        context;
      if (
        providerThread === undefined ||
        providerThread.providerSessionId === null ||
        checkpoint === undefined ||
        scope === undefined ||
        checkpoint.scopeId !== scope.id ||
        checkpoint.status !== "ready"
      ) {
        return yield* new CheckpointRollbackExecutionError({
          reason: "rollback-target-invalid",
          threadId: input.threadId,
          providerThreadId: input.providerThreadId,
          checkpointId: input.checkpointId,
        });
      }
      if (
        providerThread.id !== context.thread.activeProviderThreadId ||
        providerThread.providerInstanceId !== context.thread.modelSelection.instanceId
      ) {
        return yield* new CheckpointRollbackExecutionError({
          reason: "active-provider-changed",
          threadId: input.threadId,
          providerThreadId: input.providerThreadId,
          checkpointId: input.checkpointId,
        });
      }

      const targetOrdinal = checkpoint.appRunOrdinal ?? 0;
      const rollbackTarget: ProviderAdapter.ProviderAdapterV2RollbackTarget =
        targetOrdinal === 0
          ? {
              type: "thread_start",
              checkpointId: checkpoint.id,
              appRunOrdinal: 0,
            }
          : yield* Effect.gen(function* () {
              const targetTurn =
                latestProviderTurnForAttempt(context.providerTurns, targetAttempt?.id) ??
                context.providerTurns.find((turn) => turn.id === targetAttempt?.providerTurnId);
              if (targetTurn === undefined || targetTurn.providerThreadId !== providerThread.id) {
                return yield* new CheckpointRollbackExecutionError({
                  reason: "provider-turn-unavailable",
                  threadId: input.threadId,
                  providerThreadId: input.providerThreadId,
                  checkpointId: input.checkpointId,
                });
              }
              return {
                type: "provider_turn" as const,
                checkpointId: checkpoint.id,
                appRunOrdinal: targetOrdinal,
                providerTurn: targetTurn,
              };
            });

      const { worktreePath, branch } = context.thread;
      // Recreated only where the server would have made it, as turn start does.
      if (
        worktreePath != null &&
        branch != null &&
        !(yield* fileSystem.exists(worktreePath)) &&
        (yield* isManagedWorktreePath(worktreePath))
      ) {
        const project = yield* projects.get(context.thread.projectId);
        if (Option.isSome(project)) {
          // fork: mini-native-retention -- a recreated checkout has no prepared dependencies;
          // the marker makes the next turn start run setup (see restoreWorktree).
          const marker = `${path.resolve(worktreePath)}.t3-setup-pending`;
          yield* fileSystem.makeDirectory(path.dirname(marker), { recursive: true });
          if (!(yield* fileSystem.exists(marker)))
            yield* fileSystem.writeFileString(
              marker,
              "Workspace setup must complete before starting the agent.\n",
              { flag: "wx" },
            );
          yield* gitWorkflow.pruneWorktrees({ cwd: project.value.workspaceRoot });
          yield* gitWorkflow.createWorktree({
            cwd: project.value.workspaceRoot,
            refName: branch,
            path: worktreePath,
          });
        }
      }

      if (
        input.restoreFiles !== false &&
        !(yield* isCheckpointRestoreIsolated(context.thread, scope, {
          fileSystem,
          projections,
          projects,
          path,
        }))
      ) {
        return yield* new CheckpointRollbackExecutionError({
          reason: "shared-workspace",
          threadId: input.threadId,
          providerThreadId: input.providerThreadId,
          checkpointId: input.checkpointId,
        });
      }

      const modelSelection = context.thread.modelSelection;
      const resolvedRuntimePolicy = yield* runtimePolicy.resolve({
        thread: context.thread,
        modelSelection,
      });
      const existingSession = context.providerSession;
      const session = yield* sessions.open({
        threadId: input.threadId,
        providerSessionId: providerThread.providerSessionId,
        modelSelection,
        runtimePolicy: resolvedRuntimePolicy,
        ...(existingSession === undefined ? {} : { resumeFromSession: existingSession }),
        ...(providerThread.nativeThreadRef?.nativeId == null
          ? {}
          : { initialNativeThreadId: providerThread.nativeThreadRef.nativeId }),
        ...(providerThread.nativeMetadata?.itemIdentityVersion === undefined
          ? {}
          : {
              initialProviderItemIdentityVersion: providerThread.nativeMetadata.itemIdentityVersion,
            }),
      });

      // Rolled-back turns remain in audit history but no longer exist in the provider conversation.
      const rolledBackAttemptIds = new Set(context.rolledBackAttemptIds);
      const providerThreadTurns = context.providerTurns.filter(
        (turn) =>
          turn.providerThreadId === providerThread.id &&
          (turn.runAttemptId === null || !rolledBackAttemptIds.has(turn.runAttemptId)),
      );

      // fork: project-lifecycle -- capture local edits before either provider or files move.
      const undoToken = input.restoreFiles === false ? null : yield* randomUuidV4;
      const beforeRef =
        undoToken === null
          ? null
          : CheckpointRef.make(`${checkpoint.ref}-before-restore-${undoToken}`);
      if (beforeRef !== null)
        yield* checkpointStore.captureCheckpoint({ cwd: scope.cwd, checkpointRef: beforeRef });
      const snapshot =
        runsToRollback.length === 0
          ? { providerThread }
          : yield* session.rollbackThread({
              providerThread,
              target: rollbackTarget,
              providerThreadTurns,
            });
      // fork: project-lifecycle -- stale checkpoint refs remain available for recovery and forks.
      if (input.restoreFiles !== false) {
        yield* checkpoints.restore({ scope, checkpoint });
        undoStates.set(input.threadId, {
          token: undoToken!,
          scope,
          beforeRef: beforeRef!,
          restoredRef: checkpoint.ref,
        });
      }

      // Lock against full-row thread writes that could restore the old native session after rollback.
      yield* threadCommands.withLock(
        input.threadId,
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          const makeEvent = <Event extends OrchestrationV2DomainEvent>(event: Omit<Event, "id">) =>
            Effect.map(
              ids.allocate.event({ threadId: event.threadId }),
              (id) =>
                ({
                  ...event,
                  id,
                }) as Event,
            );
          const events: Array<OrchestrationV2DomainEvent> = [];
          events.push(
            yield* makeEvent({
              type: "provider-thread.updated",
              threadId: input.threadId,
              driver: providerThread.driver,
              providerInstanceId: providerThread.providerInstanceId,
              occurredAt: now,
              payload: {
                ...snapshot.providerThread,
                lastRunOrdinal: targetOrdinal === 0 ? null : targetOrdinal,
                updatedAt: now,
              },
            }),
          );
          for (const staleCheckpoint of staleCheckpoints) {
            events.push(
              yield* makeEvent({
                type: "checkpoint.captured",
                threadId: input.threadId,
                ...(staleCheckpoint.runId === null ? {} : { runId: staleCheckpoint.runId }),
                nodeId: staleCheckpoint.nodeId,
                providerInstanceId: providerThread.providerInstanceId,
                occurredAt: now,
                payload: { ...staleCheckpoint, status: "stale" },
              }),
            );
          }
          for (const run of runsToRollback) {
            const rootNode = context.rootNodes.find((candidate) => candidate.id === run.rootNodeId);
            events.push(
              yield* makeEvent({
                type: "run.updated",
                threadId: input.threadId,
                runId: run.id,
                ...(rootNode === undefined ? {} : { nodeId: rootNode.id }),
                providerInstanceId: run.providerInstanceId,
                occurredAt: now,
                payload: { ...run, status: "rolled_back", completedAt: now },
              }),
            );
            if (rootNode !== undefined) {
              events.push(
                yield* makeEvent({
                  type: "node.updated",
                  threadId: input.threadId,
                  runId: run.id,
                  nodeId: rootNode.id,
                  providerInstanceId: run.providerInstanceId,
                  occurredAt: now,
                  payload: { ...rootNode, status: "rolled_back", completedAt: now },
                }),
              );
            }
          }
          // fork: project-lifecycle -- also acknowledge restores at the latest checkpoint.
          if (input.requestId !== undefined) {
            const current = yield* projections.getThread(input.threadId);
            events.push(
              yield* makeEvent({
                type: "thread.metadata-updated",
                threadId: input.threadId,
                providerInstanceId: providerThread.providerInstanceId,
                occurredAt: now,
                payload: {
                  ...current,
                  rollbackCompletedRequestId: input.requestId,
                  updatedAt: now,
                },
              }),
            );
          }
          yield* eventSink.write({ events });
        }),
      );
    });

    // fork: project-lifecycle
    const restoreState = Effect.fn("CheckpointRollback.restoreState")(
      function* (input: Parameters<CheckpointRollbackServiceV2Shape["restoreState"]>[0]) {
        const thread = yield* projections.getThread(input.threadId);
        const context = yield* projections.getCheckpointContext(input.threadId);
        const scope =
          input.scopeId === undefined
            ? context.checkpointScopes.at(-1)
            : context.checkpointScopes.find((scope) => scope.id === input.scopeId);
        const isolated =
          scope !== undefined &&
          (yield* isCheckpointRestoreIsolated(thread, scope, {
            fileSystem,
            projections,
            projects,
            path,
          }));
        return {
          threadId: input.threadId,
          canRestoreFiles: isolated,
          reason: isolated
            ? null
            : scope === undefined
              ? "No file checkpoint is available for this conversation."
              : SHARED_WORKSPACE_RESTORE_MESSAGE,
          undoToken: undoStates.get(input.threadId)?.token ?? null,
        };
      },
      Effect.mapError(
        (cause) =>
          new CheckpointRestoreActionError({
            message: "Could not check whether these files can be restored. Try again.",
            cause,
          }),
      ),
    );

    const undoRestore = Effect.fn("CheckpointRollback.undoRestore")(
      function* (input: { readonly threadId: ThreadId; readonly undoToken: string }) {
        const saved = undoStates.get(input.threadId);
        if (!saved || saved.token !== input.undoToken)
          return yield* new CheckpointRestoreActionError({
            message: "This restore can no longer be undone in this session.",
          });
        yield* withWorkspaceLease(
          path.resolve(saved.scope.cwd),
          threadCommands.withLock(
            input.threadId,
            Effect.gen(function* () {
              if (undoStates.get(input.threadId) !== saved)
                return yield* new CheckpointRestoreActionError({
                  message: "Another restore replaced this undo.",
                });
              const thread = yield* projections.getThread(input.threadId);
              const shell = yield* projections.getThreadShell(input.threadId);
              if (shell === null || shell.activeRunId !== null)
                return yield* new CheckpointRestoreActionError({
                  message: "Stop the current turn before undoing a file restore.",
                });
              if (
                !(yield* isCheckpointRestoreIsolated(thread, saved.scope, {
                  fileSystem,
                  projections,
                  projects,
                  path,
                }))
              )
                return yield* new CheckpointRestoreActionError({
                  message: SHARED_WORKSPACE_RESTORE_MESSAGE,
                });
              const probeRef = CheckpointRef.make(`${saved.beforeRef}-check`);
              yield* checkpointStore.captureCheckpoint({
                cwd: saved.scope.cwd,
                checkpointRef: probeRef,
              });
              yield* Effect.gen(function* () {
                const changed = yield* checkpointStore.diffCheckpoints({
                  cwd: saved.scope.cwd,
                  fromCheckpointRef: saved.restoredRef,
                  toCheckpointRef: probeRef,
                  ignoreWhitespace: false,
                  format: "numstat",
                  maxOutputBytes: 1024 * 1024,
                });
                if (changed.trim())
                  return yield* new CheckpointRestoreActionError({
                    message:
                      "Files changed after the restore. Undo would overwrite them, so it was stopped.",
                  });
                if (
                  !(yield* checkpointStore.restoreCheckpoint({
                    cwd: saved.scope.cwd,
                    checkpointRef: saved.beforeRef,
                    fallbackToHead: false,
                  }))
                )
                  return yield* new CheckpointRestoreActionError({
                    message: "The saved files for this undo are unavailable.",
                  });
                undoStates.delete(input.threadId);
              }).pipe(
                Effect.ensuring(
                  checkpointStore
                    .deleteCheckpointRefs({ cwd: saved.scope.cwd, checkpointRefs: [probeRef] })
                    .pipe(Effect.ignore),
                ),
              );
            }),
          ),
        );
      },
      Effect.mapError((cause) =>
        isCheckpointRestoreActionError(cause)
          ? cause
          : new CheckpointRestoreActionError({
              message: "Could not undo the file restore. Your recovery checkpoint is preserved.",
              cause,
            }),
      ),
    );

    return CheckpointRollbackServiceV2.of({
      // fork: project-lifecycle
      restoreState,
      undoRestore,
      // The inner execute owns the rollback span; this wrapper selects the workspace lease.
      execute: Effect.fnUntraced(
        function* (input) {
          // Storage cleanup removes worktrees under the same lease.
          const thread = yield* projections.getThread(input.threadId);
          yield* thread.worktreePath === null
            ? execute(input)
            : withWorkspaceLease(path.resolve(thread.worktreePath), execute(input));
        },
        (effect, input) =>
          effect.pipe(
            Effect.mapError((cause) =>
              isCheckpointRollbackExecutionError(cause)
                ? cause
                : new CheckpointRollbackExecutionError({
                    reason: "unexpected-failure",
                    threadId: input.threadId,
                    providerThreadId: input.providerThreadId,
                    checkpointId: input.checkpointId,
                    cause,
                  }),
            ),
          ),
      ),
    });
  }),
);
