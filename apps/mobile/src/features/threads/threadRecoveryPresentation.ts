import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { CONNECTION_STALL_DETAIL } from "@t3tools/client-runtime/fork";
import type { ThreadRuntimeSummary } from "@t3tools/client-runtime/state/shell";

export interface ThreadRecoveryPresentation {
  readonly title: string;
  readonly detail: string;
  readonly action: "reconnect" | "retry" | "identity" | "connection" | "resume" | "files" | null;
  readonly danger?: boolean;
}

/** What is known about the thread's computer beyond its phase. */
export interface ThreadRecoveryComputer {
  readonly label: string;
  /** It refused an expired Identity sign-in, and this phone can sign in again. */
  readonly signIn: boolean;
  /** "Can't reach Dorothy since 3:04 PM", once a reconnect has failed past the stall window. */
  readonly stallTitle: string | null;
  /** What the Library's directory last heard from it. */
  readonly directoryHealth: string | null;
}

const queuedText = (count: number) =>
  count === 1 ? "your queued message" : `your ${count} queued messages`;

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
  readonly computer?: ThreadRecoveryComputer;
}): ThreadRecoveryPresentation | null {
  const connected = input.connectionState === "connected";
  const count = input.queuedMessages.length;
  const uncertain = input.queuedMessages.some((message) => message.deliveryAttempted);
  const connectionAction = input.connectionState === "unsupported" ? "connection" : "reconnect";
  if (!connected) {
    const computer = input.computer;
    if (computer?.signIn) {
      return {
        title: `Sign in to ${computer.label} again`,
        detail: uncertain
          ? "Your sign-in expired. Your message may already have arrived, and Loom confirms delivery once you sign in. You do not need to send it again."
          : count > 0
            ? `Your sign-in expired. Loom sends ${queuedText(count)} once you sign in.`
            : "Your sign-in expired, so Loom can't connect. You can keep editing your draft.",
        action: "identity",
      };
    }
    if (computer?.stallTitle) {
      return {
        title: computer.stallTitle,
        detail: [
          CONNECTION_STALL_DETAIL,
          computer.directoryHealth,
          uncertain
            ? "Your message may already have arrived, and Loom confirms delivery after reconnecting. You do not need to send it again."
            : count > 0
              ? `Loom sends ${queuedText(count)} once it connects.`
              : "You can keep editing your draft.",
        ]
          .filter(Boolean)
          .join(" "),
        action: "retry",
      };
    }
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
