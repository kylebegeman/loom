import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { ThreadRuntimeSummary } from "@t3tools/client-runtime/state/shell";
import type { MessageId, RunId, ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useComputerConnectionHealth } from "../../fork/connection-health/useComputerConnectionHealth";
import { useThreadVisibleTurnItems } from "../../state/use-thread-detail";
import { threadOutboxDeliveryAtom } from "../../state/thread-outbox-delivery";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";
import {
  resolveThreadRecoveryPresentation,
  resolveWorkspacePreparationError,
} from "./threadRecoveryPresentation";

export interface ContinuableRunAction {
  readonly failed: boolean;
  readonly onContinue: () => Promise<void>;
}

export function ThreadRecoveryNotice(props: {
  readonly threadRef: ScopedThreadRef;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly queuedMessages: ReadonlyArray<QueuedThreadMessage>;
  readonly dispatchingMessageId: MessageId | null;
  readonly acknowledged: boolean;
  readonly runtimeStatus: ThreadRuntimeSummary["status"];
  readonly runId: RunId | null;
  readonly canOperate: boolean;
  readonly onReconnect: () => void;
  readonly onOpenConnection: () => void;
  readonly onReviewFiles?: () => void;
  readonly onResumeQueue: (() => Promise<void>) | null;
  /** Present while the latest run stopped or failed in a way it can continue from. */
  readonly continuableRun?: ContinuableRunAction | null;
}) {
  const delivery = useAtomValue(threadOutboxDeliveryAtom);
  const items = useThreadVisibleTurnItems(props.threadRef);
  const computer = useComputerConnectionHealth(props.threadRef.environmentId);
  const presentation = resolveThreadRecoveryPresentation({
    connectionState: props.connectionState,
    queuedMessages: props.queuedMessages,
    dispatchingMessageId: props.dispatchingMessageId,
    delivery,
    acknowledged: props.acknowledged,
    runtimeStatus: props.runtimeStatus,
    workspaceError: resolveWorkspacePreparationError({
      runtimeStatus: props.runtimeStatus,
      runId: props.runId,
      items,
    }),
    queueHeld: props.onResumeQueue !== null,
    canOperate: props.canOperate,
    computer: { ...computer, signIn: computer.signIn !== null },
    stoppedRun: props.continuableRun
      ? props.continuableRun.failed
        ? "failed"
        : "interrupted"
      : null,
  });
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  if (presentation === null) return null;
  const continuesRun = presentation.action === "resume-run" || presentation.action === "retry-run";
  const resume = async () => {
    const start = continuesRun ? (props.continuableRun?.onContinue ?? null) : props.onResumeQueue;
    if (resuming || start === null) return;
    setResuming(true);
    setResumeError(null);
    try {
      await start();
    } catch (error) {
      setResumeError(
        error instanceof Error
          ? error.message
          : continuesRun
            ? "Could not continue the run. Try again."
            : "Could not resume the queue. Try again.",
      );
    }
    setResuming(false);
  };
  return (
    <View className="mx-3 mb-2 gap-1.5 rounded-2xl border border-border-subtle bg-card p-3">
      <AppText
        textRole="footnote"
        className={
          presentation.danger
            ? "font-t3-medium text-danger-foreground"
            : "font-t3-medium text-foreground"
        }
        accessibilityLiveRegion="polite"
      >
        {presentation.title}
      </AppText>
      <AppText textRole="caption" className="text-foreground-muted">
        {presentation.detail}
      </AppText>
      {resumeError !== null ? (
        <AppText textRole="caption" accessibilityRole="alert" className="text-danger-foreground">
          {resumeError}
        </AppText>
      ) : null}
      {presentation.action !== null && (presentation.action !== "files" || props.onReviewFiles) ? (
        <View className="pt-1">
          <Button
            label={
              presentation.action === "resume"
                ? "Resume queue"
                : presentation.action === "retry-run"
                  ? "Retry"
                  : presentation.action === "resume-run"
                    ? "Resume"
                    : presentation.action === "connection"
                      ? "Connection settings"
                      : presentation.action === "files"
                        ? "Review files"
                        : presentation.action === "identity"
                          ? "Sign in again"
                          : presentation.action === "retry"
                            ? "Retry now"
                            : "Reconnect"
            }
            tone="text"
            loading={(presentation.action === "resume" || continuesRun) && resuming}
            onPress={
              presentation.action === "resume" || continuesRun
                ? () => void resume()
                : presentation.action === "connection"
                  ? props.onOpenConnection
                  : presentation.action === "files"
                    ? () => props.onReviewFiles?.()
                    : presentation.action === "identity"
                      ? () => computer.signIn?.()
                      : props.onReconnect
            }
          />
        </View>
      ) : null}
    </View>
  );
}
