import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { ThreadRuntimeSummary } from "@t3tools/client-runtime/state/shell";

export interface ThreadRecoveryPresentation {
  readonly title: string;
  readonly detail: string;
  readonly action:
    | "reconnect"
    | "connection"
    | "resume"
    | "files"
    | "resume-run"
    | "retry-run"
    | null;
  readonly danger?: boolean;
}

export function resolveThreadRecoveryPresentation(input: {
  readonly connectionState: EnvironmentConnectionPhase;
  readonly queuedMessages: ReadonlyArray<{
    readonly messageId: string;
    readonly deliveryAttempted?: boolean;
  }>;
  readonly dispatchingMessageId: string | null;
  readonly delivery: {
    readonly messageId: string;
    readonly phase: "sending" | "confirming";
  } | null;
  readonly acknowledged: boolean;
  readonly runtimeStatus: ThreadRuntimeSummary["status"];
  readonly workspaceError: string | null;
  readonly queueHeld: boolean;
  readonly canOperate: boolean;
  /** How the latest run ended, when it can continue from there. */
  readonly stoppedRun?: "interrupted" | "failed" | null;
}): ThreadRecoveryPresentation | null {
  const connected = input.connectionState === "connected";
  const count = input.queuedMessages.length;
  const uncertain = input.queuedMessages.some((message) => message.deliveryAttempted);
  const connectionAction = input.connectionState === "unsupported" ? "connection" : "reconnect";
  if (!connected) {
    if (uncertain) {
      return {
        title: "Waiting for delivery confirmation",
        detail:
          "Your message may already have arrived. Loom will confirm delivery after reconnecting. You do not need to send it again.",
        action: connectionAction,
      };
    }
    if (count > 0) {
      return {
        title: `${count} message${count === 1 ? "" : "s"} queued on this phone`,
        detail:
          "Loom will send when this connection is ready. You can keep writing your next draft.",
        action: connectionAction,
      };
    }
    return {
      title:
        input.connectionState === "connecting" || input.connectionState === "reconnecting"
          ? "Reconnecting"
          : input.connectionState === "offline"
            ? "You are offline"
            : "Connection unavailable",
      detail:
        "You can keep editing your draft. Messages and work status will update when this connection is ready.",
      action: connectionAction,
    };
  }
  if (count > 0 && !input.canOperate) {
    return {
      title: "Queued messages are waiting for access",
      detail:
        "This connection cannot control this task. Your queued messages and draft are kept on this phone.",
      action: "connection",
    };
  }
  if (count > 0) {
    const dispatching = input.queuedMessages.find(
      (message) => message.messageId === input.dispatchingMessageId,
    );
    if (
      dispatching &&
      input.delivery?.messageId === dispatching.messageId &&
      input.delivery.phase === "sending"
    ) {
      return {
        title: "Sending message",
        detail: "Waiting for the server to accept your message.",
        action: null,
      };
    }
    if (uncertain) {
      return {
        title: "Checking message delivery",
        detail:
          "Loom is retrying the same saved request so it is accepted only once. You do not need to send it again.",
        action: null,
      };
    }
    return {
      title: dispatching
        ? "Preparing message"
        : `${count} message${count === 1 ? "" : "s"} queued on this phone`,
      detail: dispatching
        ? "Preparing attachments and sending your saved message."
        : "Loom will send your saved messages automatically.",
      action: null,
    };
  }
  if (input.acknowledged) {
    return {
      title: "Message accepted",
      detail: "Waiting for the conversation to update. You do not need to send it again.",
      action: null,
    };
  }
  if (input.runtimeStatus === "preparing") {
    return {
      title: "Preparing files",
      detail:
        "The server is preparing this workspace and restoring saved files if needed. The agent will start when the files are ready.",
      action: null,
    };
  }
  if (input.runtimeStatus === "starting") {
    return {
      title: "Starting agent",
      detail:
        "Your message was accepted. The computer prepares files and restores saved files if needed before the agent starts.",
      action: null,
    };
  }
  if (input.runtimeStatus === "failed" && input.workspaceError !== null) {
    return {
      title: "Could not prepare files",
      detail: `${input.workspaceError} The agent did not start. Check this computer's project files before sending another message.`,
      danger: true,
      action: "files",
    };
  }
  if (input.stoppedRun) {
    const failed = input.stoppedRun === "failed";
    return {
      title: failed ? "Run failed" : "Run stopped",
      detail: `${failed ? "Retry" : "Resume"} to continue where it left off.${input.queueHeld ? " Queued messages run after it." : ""}`,
      ...(failed ? { danger: true } : {}),
      action: input.canOperate ? (failed ? "retry-run" : "resume-run") : null,
    };
  }
  if (input.queueHeld) {
    return {
      title: "Queue paused",
      detail: "Resume the queue when you are ready for queued messages to run.",
      action: input.canOperate ? "resume" : null,
    };
  }
  return null;
}

export function resolveWorkspacePreparationError(input: {
  readonly runtimeStatus: ThreadRuntimeSummary["status"];
  readonly runId: string | null;
  readonly items: ReadonlyArray<{
    readonly item: {
      readonly type: string;
      readonly runId: string | null;
      readonly title: string | null;
      readonly failure?: { readonly message: string };
    };
  }>;
}): string | null {
  if (input.runtimeStatus !== "failed" || input.runId === null) return null;
  return (
    input.items.findLast(
      ({ item }) =>
        item.runId === input.runId &&
        item.type === "error" &&
        item.title === "Workspace preparation failed",
    )?.item.failure?.message ?? null
  );
}
