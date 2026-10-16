import { useState } from "react";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import type { LibraryThreadSummary } from "@t3tools/contracts/fork";
import {
  libraryBriefSuggestionAvailability,
  libraryBriefSuggestionPrompt,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { newMessageId } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

/**
 * Asks a settled conversation's agent to look back and propose brief changes. The agent can only
 * propose; the suggestion waits on the project page for a person to accept or dismiss.
 */
export function SuggestBriefUpdates({
  summary,
  projectArchived,
  libraryKeepsProposals,
  hostLabel,
  hostConnected,
  hostProposes,
}: {
  readonly summary: LibraryThreadSummary;
  readonly projectArchived: boolean;
  readonly libraryKeepsProposals: boolean;
  readonly hostLabel: string;
  readonly hostConnected: boolean;
  readonly hostProposes: boolean;
}) {
  const shell = useThreadShell(
    hostConnected ? { environmentId: summary.environmentId, threadId: summary.threadId } : null,
  );
  const canSend = useEnvironmentScope(summary.environmentId, AuthOrchestrationOperateScope);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The live conversation is the freshest word on whether it is settled; the saved copy stands in.
  const availability = libraryBriefSuggestionAvailability({
    libraryKeepsProposals,
    settled: shell ? shell.settledOverride === "settled" : summary.settled === true,
    archived: projectArchived || (shell ? shell.archivedAt !== null : summary.archived),
    hostLabel,
    hostConnected,
    hostProposes,
    canSend,
  });
  if (availability.kind === "hidden") return null;
  const reason =
    availability.kind === "disabled"
      ? availability.reason
      : shell
        ? null
        : "Loading the live conversation...";
  const send = async () => {
    if (!shell) return;
    setSending(true);
    setError(null);
    const result = await startTurn({
      environmentId: summary.environmentId,
      input: {
        threadId: summary.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: libraryBriefSuggestionPrompt(summary.projectId),
          attachments: [],
        },
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        dispatchMode: "queue",
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not ask the agent.");
      return;
    }
    toastManager.add({
      type: "success",
      title: "Asked the agent",
      description: "Its suggestions will wait on the project page for you to review.",
    });
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        disabled={reason !== null || sending}
        aria-busy={sending}
        onClick={() => void send()}
      >
        {sending ? "Asking..." : "Suggest brief updates"}
      </Button>
      {reason || error ? (
        <p
          role={error ? "alert" : undefined}
          className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        >
          {error ?? reason}
        </p>
      ) : null}
    </div>
  );
}
