import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryPreservationEntry } from "@t3tools/contracts/fork";
import { LIBRARY_RESTORE_PATHS } from "@t3tools/client-runtime/fork";
import { ArchiveIcon, RefreshCwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { cn, randomUUID } from "~/lib/utils";
import { projectLibrary, useLibraryAuthority, useLibraryPermission } from "./state";
import {
  LIBRARY_SURFACE,
  LibraryDialog,
  LibraryErrorNotice,
  LibraryStateBadge,
} from "./LibraryControls";
import { ComputerLabel, PathLabel } from "./ProjectIdentity";
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
  const [activity, setActivity] = useState<string | null>(null);
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
    const status = await readStatus({
      environmentId: entry.copy.environmentId,
      input: { workingCopyId: entry.copy.id },
    });
    if (
      status._tag === "Failure" ||
      status.value.copy.state === "released" ||
      status.value.copy.registered === false
    ) {
      setError("These files changed or became unavailable. Refresh the Library before continuing.");
      query.refresh();
      setBusy(null);
      return;
    }
    const publishedHealth = await register({
      environmentId: authorityId,
      input: {
        requestId: randomUUID(),
        copy: { ...status.value.copy, health: result.value },
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
      if (!status.value.reviewToken) {
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
  const hostLabel = (id: EnvironmentId) =>
    authority.environments.find((entry) => entry.environmentId === id)?.label ??
    authority.computers.find((entry) => entry.environmentId === id)?.label ??
    "Saved computer";
  const entries = query.data ?? [];
  const restoreCounts = Object.entries(LIBRARY_RESTORE_PATHS).flatMap(([restore, path]) => {
    const count = entries.filter((entry) => entry.restore === restore).length;
    return count ? [{ restore, count, ...path }] : [];
  });
  return (
    <>
      <LibraryDialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
        title="Preservation and cleanup"
        description="Check what each copy holds before reclaiming its space. A pushed repository alone does not keep ignored files, stashes or hidden history."
        actions={
          <Button shape="pill" variant="ghost" disabled={!!busy} onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {restoreCounts.map((entry) => (
                <LibraryStateBadge key={entry.restore} tone={entry.tone}>
                  <span className="tabular-nums">{entry.count}</span> {entry.label.toLowerCase()}
                </LibraryStateBadge>
              ))}
            </div>
            <Button
              shape="pill"
              size="icon-xs"
              variant="ghost"
              aria-label="Refresh Library observations"
              disabled={query.isPending}
              onClick={query.refresh}
            >
              <RefreshCwIcon />
            </Button>
          </div>
          <LibraryErrorNotice error={error ?? query.error} onRetry={query.refresh} />
          {!entries.length ? (
            <p className="text-sm text-muted-foreground">
              {query.isPending ? "Loading saved copies..." : "No registered files to review."}
            </p>
          ) : null}
          {entries.map((entry) => {
            const online = connected(entry.copy.environmentId);
            const restore = LIBRARY_RESTORE_PATHS[entry.restore];
            return (
              <article
                key={entry.copy.id}
                aria-label={entry.copy.rootPath}
                className={cn("flex min-w-0 flex-col gap-3 p-4", LIBRARY_SURFACE)}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    {projectId ? null : (
                      <h3 className="truncate text-sm font-semibold">{entry.project.title}</h3>
                    )}
                    <PathLabel path={entry.copy.rootPath} className="-ms-1.5 max-w-full" />
                    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <ComputerLabel
                        environmentId={entry.copy.environmentId}
                        label={hostLabel(entry.copy.environmentId)}
                      />
                      <span aria-hidden>·</span>
                      <span>{online ? "Connected" : "Offline"}</span>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">
                        {entry.checkedAt
                          ? `Checked ${formatRelativeTimeLabel(entry.checkedAt)}`
                          : "Not checked yet"}
                      </span>
                    </p>
                  </div>
                  <LibraryStateBadge tone={restore.tone}>{restore.label}</LibraryStateBadge>
                </div>
                <p className="text-xs text-muted-foreground">{restore.detail}</p>
                {entry.blockers.length ? (
                  <ul
                    aria-label="Before removing"
                    className="flex flex-col gap-1 rounded-xl bg-warning/10 px-3 py-2.5 text-xs text-warning-foreground"
                  >
                    {entry.blockers.map((blocker) => (
                      <li key={blocker} className="flex items-start gap-2">
                        <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
                        {blocker}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {online ? null : (
                  <p className="text-xs text-muted-foreground">
                    Connect {hostLabel(entry.copy.environmentId)} to check or remove these files.
                  </p>
                )}
                <PreservationActions
                  entry={entry}
                  authorityId={authorityId}
                  busy={!!busy}
                  checking={busy === entry.copy.id}
                  connected={online}
                  showingActivity={activity === entry.copy.id}
                  onCheck={(preserve) => void check(entry, preserve)}
                  onReview={() => setReview(entry)}
                  onActivity={() =>
                    setActivity((current) => (current === entry.copy.id ? null : entry.copy.id))
                  }
                />
                {activity === entry.copy.id ? (
                  <div className="border-t border-border pt-3">
                    <ProjectOperationHistory
                      environmentId={entry.copy.environmentId}
                      projectId={entry.project.id}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
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

function PreservationActions({
  entry,
  authorityId,
  busy,
  checking,
  connected,
  showingActivity,
  onCheck,
  onReview,
  onActivity,
}: {
  readonly entry: LibraryPreservationEntry;
  readonly authorityId: EnvironmentId;
  readonly busy: boolean;
  readonly checking: boolean;
  readonly connected: boolean;
  readonly showingActivity: boolean;
  readonly onCheck: (preserve: boolean) => void;
  readonly onReview: () => void;
  readonly onActivity: () => void;
}) {
  const canCheck = useLibraryPermission(projectLibrary.refreshCopyHealth, entry.copy.environmentId);
  const canRead = useLibraryPermission(projectLibrary.readCopyStatus, entry.copy.environmentId);
  const canPublish = useLibraryPermission(projectLibrary.registerCopy, authorityId);
  const canSave = useLibraryPermission(projectLibrary.snapshotCopy, entry.copy.environmentId);
  const canRemove = useLibraryPermission(
    entry.copy.ownership === "borrowed"
      ? projectLibrary.unregisterCopy
      : projectLibrary.releaseCopy,
    entry.copy.environmentId,
  );
  const disabled = busy || !connected;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        shape="pill"
        size="xs"
        variant="outline"
        disabled={disabled || !canCheck || !canRead || !canPublish}
        onClick={() => onCheck(false)}
      >
        <RefreshCwIcon />
        {checking ? "Checking..." : "Check files and remotes"}
      </Button>
      <Button
        shape="pill"
        size="xs"
        variant="outline"
        disabled={disabled || !canCheck || !canRead || !canPublish || !canSave}
        onClick={() => onCheck(true)}
      >
        <ArchiveIcon />
        Save recovery archive
      </Button>
      <Button
        shape="pill"
        size="xs"
        variant="ghost"
        disabled={disabled || !canRemove}
        onClick={onReview}
      >
        <Trash2Icon />
        Review {entry.copy.ownership === "borrowed" ? "forgetting folder" : "file removal"}
      </Button>
      <div className="ms-auto">
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          aria-expanded={showingActivity}
          onClick={onActivity}
        >
          {showingActivity ? "Hide activity" : "Activity"}
        </Button>
      </div>
    </div>
  );
}
