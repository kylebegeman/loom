import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryPreservationEntry } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { randomUUID } from "~/lib/utils";
import { projectLibrary, useLibraryAuthority } from "./state";
import { LibraryDialog, LibraryErrorNotice } from "./LibraryControls";
import { ReleaseCopyDialog } from "./ReleaseCopyDialog";
import { ProjectOperationHistory } from "./ProjectOperations";

export function ProjectPreservationCenter({
  authorityId,
  projectId,
  onClose,
  onChanged,
}: {
  readonly authorityId: EnvironmentId;
  readonly projectId?: string;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}) {
  const query = useEnvironmentQuery(
    projectLibrary.preservation({
      environmentId: authorityId,
      input: projectId ? { projectId } : {},
    }),
  );
  const authority = useLibraryAuthority();
  const [review, setReview] = useState<LibraryPreservationEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computer, setComputer] = useState<EnvironmentId | null>(null);
  const refresh = useAtomCommand(projectLibrary.refreshCopyHealth, { reportFailure: false });
  const readStatus = useAtomCommand(projectLibrary.readCopyStatus, { reportFailure: false });
  const snapshot = useAtomCommand(projectLibrary.snapshotCopy, { reportFailure: false });
  const register = useAtomCommand(projectLibrary.registerCopy, { reportFailure: false });
  const check = async (entry: LibraryPreservationEntry, preserve = false) => {
    setBusy(entry.copy.id);
    setError(null);
    const result = await refresh({
      environmentId: entry.copy.environmentId,
      input: { workingCopyId: entry.copy.id, refreshRemote: true },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : "Connect this computer and check its files.",
      );
      setBusy(null);
      return;
    }
    const publishedHealth = await register({
      environmentId: authorityId,
      input: {
        requestId: randomUUID(),
        copy: { ...entry.copy, health: result.value, updatedAt: result.value.checkedAt },
      },
    });
    if (publishedHealth._tag === "Failure") {
      setError(
        "Files checked on the computer. Reconnect the Library to save the observation, then retry.",
      );
      setBusy(null);
      return;
    }
    if (preserve) {
      const status = await readStatus({
        environmentId: entry.copy.environmentId,
        input: { workingCopyId: entry.copy.id },
      });
      if (status._tag === "Failure" || !status.value.reviewToken) {
        setError("Review this computer's current file blockers before saving a recovery archive.");
        setBusy(null);
        return;
      }
      const saved = await snapshot({
        environmentId: entry.copy.environmentId,
        input: {
          requestId: randomUUID(),
          workingCopyId: entry.copy.id,
          reviewToken: status.value.reviewToken,
        },
      });
      if (saved._tag === "Failure") {
        const cause = squashAtomCommandFailure(saved);
        setError(
          cause instanceof Error ? cause.message : "Could not preserve the recovery archive.",
        );
      } else {
        const published = await register({
          environmentId: authorityId,
          input: { requestId: randomUUID(), copy: saved.value },
        });
        if (published._tag === "Failure")
          setError(
            "Archive saved on the computer. Reconnect the Library to register its restore path.",
          );
      }
    }
    query.refresh();
    setBusy(null);
    onChanged();
  };
  const connected = (id: EnvironmentId) =>
    authority.environments.some(
      (environment) =>
        environment.environmentId === id && environment.connection.phase === "connected",
    );
  return (
    <>
      <LibraryDialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
        title="Preservation and cleanup"
        description="Review local work, saved recovery and the exact removal preview before reclaiming files. Repository publication alone does not preserve ignored files, stashes or hidden history."
        actions={
          <Button variant="ghost" disabled={!!busy} onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="space-y-6">
          <LibraryErrorNotice error={error ?? query.error} onRetry={query.refresh} />
          <Button size="sm" variant="outline" onClick={query.refresh}>
            Refresh Library observations
          </Button>
          {!query.data?.length ? (
            <p className="text-sm text-muted-foreground">
              {query.isPending ? "Loading preserved copies..." : "No registered files to review."}
            </p>
          ) : null}
          {query.data?.map((entry) => (
            <section key={entry.copy.id} className="space-y-2">
              <h3 className="text-sm font-semibold">{entry.project.title}</h3>
              <p className="break-all text-xs text-muted-foreground">{entry.copy.rootPath}</p>
              <p className="text-xs">
                Restore:{" "}
                {entry.restore === "verified-archive"
                  ? "Saved recovery archive"
                  : entry.restore === "repository"
                    ? "Repository clone; local-only files are not covered"
                    : "No verified restore path"}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.checkedAt
                  ? `Files last checked ${new Date(entry.checkedAt).toLocaleString()}`
                  : "Files have not been checked"}
                .{" "}
                {connected(entry.copy.environmentId)
                  ? "Computer connected"
                  : "Connect this computer to review"}
                .
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {entry.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!!busy || !connected(entry.copy.environmentId)}
                  onClick={() => void check(entry)}
                >
                  {busy === entry.copy.id ? "Checking..." : "Check files and remotes"}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!!busy || !connected(entry.copy.environmentId)}
                  onClick={() => void check(entry, true)}
                >
                  Save recovery archive
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!!busy || !connected(entry.copy.environmentId)}
                  onClick={() => setReview(entry)}
                >
                  Review{" "}
                  {entry.copy.ownership === "borrowed" ? "forgetting folder" : "file removal"}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setComputer(entry.copy.environmentId)}
                >
                  Operation history
                </Button>
              </div>
            </section>
          ))}
          {computer ? <ProjectOperationHistory environmentId={computer} /> : null}
        </div>
      </LibraryDialog>
      {review ? (
        <ReleaseCopyDialog
          copy={review.copy}
          onClose={() => setReview(null)}
          onReleased={() => {
            setReview(null);
            query.refresh();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}
