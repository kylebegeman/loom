import { useState } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { libraryBriefSuggestionNotice } from "@t3tools/client-runtime/fork";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentQuery } from "~/state/query";
import { projectLibrary, useLibraryPermission } from "./state";

/**
 * The brief suggestion a project's setting made when this conversation settled. Asked first, it
 * waits here for a person to start it. Render it only when the conversation's computer is
 * connected and advertises `library-brief-suggestions`; that computer keeps and runs it.
 */
export function BriefSuggestionOffer({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const query = useEnvironmentQuery(
    projectLibrary.briefSuggestion({ environmentId, input: { threadId } }),
  );
  const start = useAtomCommand(projectLibrary.startBriefSuggestion, { reportFailure: false });
  const decline = useAtomCommand(projectLibrary.declineBriefSuggestion, { reportFailure: false });
  const canStart = useLibraryPermission(projectLibrary.startBriefSuggestion, environmentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notice = libraryBriefSuggestionNotice(query.data ?? null);
  if (!notice) return null;

  const run = async (
    attempt: () => Promise<AtomCommandResult<unknown, unknown>>,
    fallback: string,
  ) => {
    setBusy(true);
    setError(null);
    const result = await attempt();
    setBusy(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : fallback);
    }
    query.refresh();
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm dark:bg-accent/50">
      <p role="status" className="text-muted-foreground">
        {error ?? notice.text}
      </p>
      {notice.kind === "offer" && canStart ? (
        <div className="flex gap-2">
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(
                () => decline({ environmentId, input: { threadId } }),
                "Could not dismiss this offer.",
              )
            }
          >
            Not now
          </Button>
          <Button
            size="xs"
            disabled={busy}
            aria-busy={busy}
            onClick={() =>
              void run(
                () => start({ environmentId, input: { threadId } }),
                "Could not start the suggestion.",
              )
            }
          >
            {busy ? "Starting..." : "Suggest updates"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
