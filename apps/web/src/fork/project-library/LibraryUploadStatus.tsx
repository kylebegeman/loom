import { useState } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryPermission } from "./state";

/** Saved time and pending uploads are distinct; an offline host never looks freshly synchronized. */
export function LibraryUploadStatus({
  environmentId,
  threadId,
  onSynced,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onSynced: () => void;
}) {
  const query = useEnvironmentQuery(
    projectLibrary.replicationStatus({ environmentId, input: { threadIds: [threadId] } }),
  );
  const flush = useAtomCommand(projectLibrary.flushHistory, { reportFailure: false });
  const allowed = useLibraryPermission(projectLibrary.flushHistory, environmentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = query.data;
  const thread = status?.threads.find((entry) => entry.threadId === threadId);
  const pending = thread?.pending ?? false;
  const send = async () => {
    setBusy(true);
    setError(null);
    const result = await flush({ environmentId, input: { threadIds: [threadId] } });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : "Could not save pending history. Try again.",
      );
    } else {
      query.refresh();
      onSynced();
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <p role="status">
        {query.error
          ? "Upload status unavailable. Saved history may be behind."
          : !status
            ? "Checking saved history..."
            : !status.enabled
              ? "Automatic history uploads are off on this computer."
              : pending
                ? "New history is waiting to save to the Library."
                : "This computer has no pending history uploads."}
      </p>
      {status?.enabled && (pending || status.lastFailure) ? (
        <Button size="xs" variant="outline" disabled={busy || !allowed} onClick={() => void send()}>
          {busy ? "Saving..." : "Save pending history"}
        </Button>
      ) : null}
      <Button
        size="xs"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          query.refresh();
          onSynced();
        }}
      >
        Refresh saved history
      </Button>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
