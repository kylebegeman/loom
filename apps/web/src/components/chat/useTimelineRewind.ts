import type { EnvironmentThreadShell, ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { ComposerThreadTarget } from "../../composerDraftStore";
import type { ComposerHandleRef } from "../../composerHandleContext";
import type { SessionPhase } from "../../types";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  AuthOrchestrationOperateScope,
  CheckpointScopeId, // fork: project-lifecycle
  CommandId, // fork: project-lifecycle
  type EnvironmentId,
  type MessageId,
  type ScopedThreadRef,
  type ThreadId,
  type RunId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { readLocalApi } from "../../localApi";
import { findRevertCheckpoint } from "../../session-logic";
import { type ChatMessage } from "../../types";
import { newThreadId } from "~/lib/utils";
import { randomUUID } from "~/lib/utils"; // fork: project-lifecycle
import { buildThreadRouteParams } from "../../threadRoutes";
import { useComposerDraftStore } from "../../composerDraftStore";
import { threadEnvironment } from "../../state/threads";
import { waitForThreadShell } from "../../state/entities";
import { openRevertConfirm } from "./ChatOverlayHosts";
import type { PendingRevert } from "./ChatOverlayHosts"; // fork: project-lifecycle
import { assetEnvironment } from "../../state/assets";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { rewindToMessage } from "./chatViewSend";
import { makeThreadErrorSetter } from "../ChatView.logic";
import { waitForRevertedMessage } from "../ChatView.logic"; // fork: project-lifecycle
import { serverEnvironment } from "../../state/server"; // fork: project-lifecycle
import { toastManager } from "../ui/toast"; // fork: project-lifecycle
interface TimelineRewindInput {
  readonly environmentId: EnvironmentId;
  readonly routeThreadRef: ScopedThreadRef;
  readonly routeThreadKey: string;
  readonly currentRouteThreadKeyRef: { readonly current: string | null };
  readonly serverProjection: ThreadStructure | null;
  readonly activeThread: EnvironmentThreadShell | undefined;
  readonly timelineMessages: ReadonlyArray<ChatMessage>;
  readonly phase: SessionPhase;
  readonly isSendBusy: boolean;
  readonly isRevertingCheckpoint: boolean;
  readonly canOperateThread: boolean; // fork: project-lifecycle
  readonly supportsConversationRollback: boolean;
  readonly activeEnvironmentUnavailable: boolean;
  readonly activeEnvironmentUnavailableLabel: string | null;
  readonly promptRef: { current: string };
  readonly composerRef: ComposerHandleRef;
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly setThreadError: ReturnType<typeof makeThreadErrorSetter>;
}

/**
 * Going back in a thread's timeline: reverting to an earlier turn (restoring that message into
 * the composer) and forking a new thread from a run.
 */
export function useTimelineRewind(input: TimelineRewindInput) {
  const {
    environmentId,
    routeThreadRef,
    routeThreadKey,
    currentRouteThreadKeyRef,
    serverProjection,
    activeThread,
    timelineMessages,
    phase,
    isSendBusy,
    isRevertingCheckpoint,
    canOperateThread, // fork: project-lifecycle
    supportsConversationRollback,
    activeEnvironmentUnavailable,
    activeEnvironmentUnavailableLabel,
    promptRef,
    composerRef,
    composerDraftTarget,
    setThreadError,
  } = input;
  const navigate = useNavigate();
  const createAttachmentAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });

  const revertThreadCheckpoint = useOrchestrationCommand(threadEnvironment.revertCheckpoint, {
    reportFailure: false,
  });
  // fork: project-lifecycle
  const checkRestoreState = useAtomCommand(serverEnvironment.checkpointRestoreState, {
    reportFailure: false,
  });
  const undoCheckpointRestore = useAtomCommand(serverEnvironment.undoCheckpointRestore, {
    reportFailure: false,
  });
  const forkThreadFromRun = useAtomCommand(threadEnvironment.forkFromRun, {
    reportFailure: false,
  });

  // fork: project-lifecycle -- wait for the persisted rollback before offering its recovery token.
  const showRestoreUndo = async () => {
    if (!activeThread) return;
    const state = await checkRestoreState({ environmentId, input: { threadId: activeThread.id } });
    if (state._tag !== "Success" || state.value.undoToken === null) return;
    const undoToken = state.value.undoToken;
    const id = toastManager.add({
      type: "success",
      title: "Files restored",
      timeout: 0,
      description: "Undo restores your previous files. Conversation history stays rewound.",
      actionProps: {
        children: "Undo file restore",
        onClick: async () => {
          const result = await undoCheckpointRestore({
            environmentId,
            input: { threadId: activeThread.id, undoToken },
          });
          if (result._tag === "Success") {
            toastManager.close(id);
            toastManager.add({ type: "success", title: "File restore undone" });
          } else if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add({
              type: "error",
              title: "Could not undo the restore",
              description: error instanceof Error ? error.message : "Try again.",
            });
          }
        },
      },
    });
  };
  const openCheckedRevert = async (pending: Omit<PendingRevert, "canRestoreFiles" | "reason">) => {
    if (!activeThread) return;
    const result = await checkRestoreState({
      environmentId,
      input: {
        threadId: activeThread.id,
        ...(pending.scopeId === null ? {} : { scopeId: CheckpointScopeId.make(pending.scopeId) }),
      },
    });
    if (currentRouteThreadKeyRef.current !== routeThreadKey) return;
    openRevertConfirm(routeThreadKey, {
      ...pending,
      canRestoreFiles:
        pending.checkpointId !== null && result._tag === "Success" && result.value.canRestoreFiles,
      reason:
        pending.checkpointId === null
          ? "This checkpoint is not loaded. Reopen the message to restore its files."
          : result._tag === "Success"
            ? result.value.reason
            : "Could not check file restore safety. Reconnect and try again, or keep the current files.",
    });
  };

  const onRevertToTurnCount = async (
    turnCount: number,
    messageId: MessageId,
    restoreFiles?: boolean,
  ) => {
    const localApi = readLocalApi();
    if (
      !localApi ||
      !activeThread ||
      isRevertingCheckpoint ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const message = timelineMessages.find((message) => message.id === messageId);
    if (!message || message.role !== "user") return;

    if (!supportsConversationRollback) {
      setThreadError(
        activeThread.id,
        "This provider does not support reverting conversation history. Start a new thread instead.",
      );
      return;
    }
    if (activeEnvironmentUnavailable && activeEnvironmentUnavailableLabel) {
      setThreadError(
        activeThread.id,
        `Reconnect ${activeEnvironmentUnavailableLabel} before reverting checkpoints.`,
      );
      return;
    }
    if (phase === "running" || isSendBusy) {
      setThreadError(activeThread.id, "Interrupt the current turn before reverting checkpoints.");
      return;
    }
    if (restoreFiles === undefined) {
      // fork: project-lifecycle
      const checkpoint = findRevertCheckpoint(serverProjection?.checkpoints ?? [], turnCount);
      await openCheckedRevert({
        turnCount,
        messageId,
        checkpointId: checkpoint?.id ?? null,
        scopeId: checkpoint?.scopeId ?? null,
      });
      return;
    }

    useComposerDraftStore.setState((store) => ({
      rewindingThreadKeys: new Set(store.rewindingThreadKeys).add(routeThreadKey),
    }));
    setThreadError(activeThread.id, null);
    const rewind = await rewindToMessage({
      message,
      environmentId,
      routeThreadRef,
      threadId: activeThread.id,
      turnCount,
      restoreFiles,
      // Keep the live checkpoint identity when command context refetches a bounded window.
      checkpoint: findRevertCheckpoint(serverProjection?.checkpoints ?? [], turnCount),
      draftTarget: composerDraftTarget,
      composerHasPendingAttachments: composerRef.current?.hasPendingAttachments() === true,
      createAssetUrl: createAttachmentAssetUrl,
      revertThreadCheckpoint,
    });
    useComposerDraftStore.setState((store) => {
      const remaining = new Set(store.rewindingThreadKeys);
      remaining.delete(routeThreadKey);
      return { rewindingThreadKeys: remaining };
    });
    if (rewind.error !== null) {
      setThreadError(activeThread.id, rewind.error);
      return;
    }
    // fork: project-lifecycle
    if (restoreFiles) await showRestoreUndo();
    if (currentRouteThreadKeyRef.current === routeThreadKey) {
      const nextPrompt = rewind.prompt;
      promptRef.current = nextPrompt;
      composerRef.current?.resetCursorState({ prompt: nextPrompt, cursor: nextPrompt.length });
      requestAnimationFrame(() => {
        if (currentRouteThreadKeyRef.current === routeThreadKey) composerRef.current?.focusAtEnd();
      });
    }
  };
  const onRevertToTurnCountStable = useStableCallback(onRevertToTurnCount);
  // fork: project-lifecycle -- onConfirmRevert moved below, where it can roll back checkpoints too

  // fork: project-lifecycle
  const onRollbackCheckpoint = async (
    input: {
      readonly checkpointId: string;
      readonly scopeId: string;
    },
    restoreFiles?: boolean,
  ) => {
    // fork: project-lifecycle
    if (!activeThread || isRevertingCheckpoint || !canOperateThread) return;
    if (activeEnvironmentUnavailable && activeEnvironmentUnavailableLabel) {
      setThreadError(
        activeThread.id,
        `Reconnect ${activeEnvironmentUnavailableLabel} before reverting checkpoints.`,
      );
      return;
    }
    if (phase === "running" || isSendBusy) {
      setThreadError(activeThread.id, "Interrupt the current turn before reverting checkpoints.");
      return;
    }
    // fork: project-lifecycle
    const checkpoint = serverProjection?.checkpoints.find(
      (candidate) => candidate.id === input.checkpointId,
    );
    if (!checkpoint) {
      setThreadError(
        activeThread.id,
        "This checkpoint is no longer loaded. Reopen it and try again.",
      );
      return;
    }
    // fork: project-lifecycle
    if (restoreFiles === undefined) {
      await openCheckedRevert({
        ...input,
        messageId: null,
        turnCount: checkpoint.appRunOrdinal ?? 0,
      });
      return;
    }

    useComposerDraftStore.setState((store) => ({
      rewindingThreadKeys: new Set(store.rewindingThreadKeys).add(routeThreadKey),
    }));
    setThreadError(activeThread.id, null);
    // fork: project-lifecycle
    try {
      const commandId = CommandId.make(randomUUID());
      await waitForRevertedMessage(
        routeThreadRef,
        checkpoint.appRunOrdinal ?? 0,
        commandId,
        async () => {
          const result = await revertThreadCheckpoint({
            environmentId,
            input: {
              commandId,
              threadId: activeThread.id,
              checkpointId: input.checkpointId,
              scopeId: input.scopeId,
              restoreFiles,
            },
          });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        },
        undefined,
        { allowFilesOnly: true },
      );
      if (restoreFiles) await showRestoreUndo();
    } catch (error) {
      setThreadError(
        activeThread.id,
        error instanceof Error ? error.message : "Failed to revert thread state.",
      );
    }
    useComposerDraftStore.setState((store) => {
      const remaining = new Set(store.rewindingThreadKeys);
      remaining.delete(routeThreadKey);
      return { rewindingThreadKeys: remaining };
    });
  };

  // fork: project-lifecycle
  const onConfirmRevert = (pending: PendingRevert, restoreFiles: boolean) => {
    if (pending.messageId !== null)
      void onRevertToTurnCount(pending.turnCount, pending.messageId, restoreFiles);
    else if (pending.checkpointId !== null && pending.scopeId !== null)
      void onRollbackCheckpoint(
        { checkpointId: pending.checkpointId, scopeId: pending.scopeId },
        restoreFiles,
      );
  };
  const onConfirmRevertStable = useStableCallback(onConfirmRevert);

  // fork: project-lifecycle
  const onForkFromRun = async (
    input: { readonly sourceThreadId: ThreadId } & (
      | { readonly runId: RunId; readonly checkpointId?: never }
      | { readonly checkpointId: string; readonly runId?: never }
    ),
  ) => {
    if (!activeThread || activeEnvironmentUnavailable) return;
    const targetThreadId = newThreadId();
    const targetThreadRef = scopeThreadRef(environmentId, targetThreadId);
    const result = await forkThreadFromRun({
      environmentId,
      input: {
        sourceThreadId: input.sourceThreadId,
        targetThreadId,
        // fork: project-lifecycle
        ...(input.checkpointId === undefined
          ? { runId: input.runId }
          : { checkpointId: input.checkpointId }),
        title: `${activeThread.title} fork`,
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : "Failed to fork this response.",
        );
      }
      return;
    }
    const targetThreadReady = await waitForThreadShell(targetThreadRef);
    if (!targetThreadReady) {
      setThreadError(
        activeThread.id,
        "The fork was created, but its thread data did not reach this client. Reconnect and try opening it from the sidebar.",
      );
      return;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(targetThreadRef),
    });
  };
  const onForkFromRunStable = useStableCallback(onForkFromRun);
  const onRevertTimelineTurn = (targetTurnCount: number, messageId: MessageId) => {
    void onRevertToTurnCountStable(targetTurnCount, messageId);
  };
  const onRevertTimelineTurnStable = useStableCallback(onRevertTimelineTurn);
  return {
    onConfirmRevertStable,
    onForkFromRunStable,
    onRevertTimelineTurnStable,
  };
}
