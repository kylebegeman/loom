import {
  canReviewProjectStorageTarget,
  type ProjectStorageRolloutController,
  projectStorageRolloutChoices,
  projectStorageRolloutStateLabel,
  projectStorageRolloutLocalFilesLabel,
  PROJECT_STORAGE_ROLLOUT_CONFIRMATION_NOTICE,
  PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS as retentionLabels,
} from "@t3tools/client-runtime/fork";
import { CheckIcon, FolderIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Radio, RadioGroup } from "~/components/ui/radio-group";

type Controller = ProjectStorageRolloutController;
type Snapshot = ReturnType<Controller["getSnapshot"]>;
type Row = Snapshot["rows"][number];

export function ProjectStorageRollout({
  controller,
  snapshot,
}: {
  controller: Controller;
  snapshot: Snapshot;
}) {
  const selected = snapshot.rows.filter((row) => row.selected && row.status !== "saved");
  const saved = snapshot.rows.filter((row) => row.status === "saved");
  const queue = snapshot.rows.filter((row) => row.selected || row.status === "saved");
  const busy = snapshot.phase === "reviewing" || snapshot.phase === "saving";
  const needsReview = selected.some((row) => row.status !== "reviewed");
  const canConfirm =
    selected.length > 0 &&
    selected.every(
      (row) =>
        row.status === "reviewed" &&
        row.choice !== null &&
        projectStorageRolloutChoices(row).includes(row.choice),
    );
  const reviewable = selected.some((row) => canReviewProjectStorageTarget(row.target));

  return (
    <section aria-label="Selected folder review" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4">
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-medium">
            {busy
              ? snapshot.phase === "reviewing"
                ? "Reviewing selected folders"
                : "Saving folder choices"
              : saved.length > 0
                ? "Folder results"
                : "Choose folders to review"}
          </h2>
          <p role="status" className="text-xs text-muted-foreground">
            {selected.length} selected{saved.length > 0 ? `, ${saved.length} saved` : ""}.
            {busy
              ? snapshot.cancelRequested
                ? " Stopping after the current request finishes."
                : " Each folder is handled separately."
              : selected.length === 0
                ? " Select specific folders below. Reviewing does not change files or storage choices."
                : " Review current files, then choose a storage policy for each folder."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {busy ? (
            <Button
              size="sm"
              variant="outline"
              disabled={snapshot.cancelRequested}
              onClick={() => controller.cancel()}
            >
              {snapshot.cancelRequested ? "Stopping" : "Stop after current folder"}
            </Button>
          ) : (
            <>
              {selected.length > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => selected.forEach((row) => controller.setSelected(row.key, false))}
                >
                  Clear selection
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={!reviewable || selected.length === 0}
                onClick={() => void controller.review()}
              >
                {saved.length > 0
                  ? "Review unfinished folders"
                  : needsReview || selected.length === 0
                    ? "Review selected folders"
                    : "Refresh folder reviews"}
              </Button>
              <Button size="sm" disabled={!canConfirm} onClick={() => controller.confirm()}>
                Review choices and save
              </Button>
            </>
          )}
        </div>
      </div>
      {queue.some((row) => row.status !== "idle") ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            These reviews describe the primary project folders. Cleanup checks release safety again;
            a review does not prove a folder is ready to release.
          </p>
          <ul
            aria-label="Folder review queue"
            className="divide-y divide-border rounded-lg border border-border"
          >
            {queue.map((row) => (
              <StorageReviewRow key={row.key} row={row} busy={busy} controller={controller} />
            ))}
          </ul>
        </div>
      ) : null}
      <Dialog
        open={snapshot.phase === "confirming" && snapshot.confirmation !== null}
        onOpenChange={(open) => {
          if (!open) controller.cancelConfirmation();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Save reviewed storage choices?</DialogTitle>
            <DialogDescription>
              Only these folders will change. Each choice is saved separately.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <ul className="space-y-4" aria-label="Storage choices to confirm">
              {selected.map((row) => (
                <li key={row.key} className="space-y-1">
                  <p className="text-sm font-medium">
                    {row.target.projectName} on {row.target.environmentLabel}
                  </p>
                  <p className="wrap-anywhere text-xs text-muted-foreground">
                    {row.target.workspaceRoot}
                  </p>
                  <p className="text-sm">
                    {row.choice ? retentionLabels[row.choice] : "Choose a policy"}
                    {row.preview?.ownershipSource === null
                      ? ". Allow Loom to manage this folder."
                      : ""}
                  </p>
                  {row.preview?.state === "released" && row.choice === "keep" ? (
                    <p className="text-xs text-muted-foreground">
                      Keep will restore this working folder.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-sm font-medium">{PROJECT_STORAGE_ROLLOUT_CONFIRMATION_NOTICE}</p>
            <p className="text-xs text-muted-foreground">
              Keep permanent application data outside working folders and their disposable lanes.
              Stopping leaves completed choices saved; the current request may still finish.
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => controller.cancelConfirmation()}>
              Back to review
            </Button>
            <Button
              disabled={!canConfirm || snapshot.confirmation === null}
              onClick={() => {
                if (snapshot.confirmation) void controller.save(snapshot.confirmation);
              }}
            >
              Save {selected.length} {selected.length === 1 ? "folder choice" : "folder choices"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </section>
  );
}

function StorageReviewRow({
  row,
  busy,
  controller,
}: {
  row: Row;
  busy: boolean;
  controller: Controller;
}) {
  const preview = row.preview;
  const choices = projectStorageRolloutChoices(row);
  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-2.5">
          {row.status === "saved" ? (
            <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-icon-muted" />
          ) : (
            <FolderIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-icon-muted" />
          )}
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-medium">
              {row.target.projectName} on {row.target.environmentLabel}
            </h3>
            <p className="wrap-anywhere text-xs text-muted-foreground">
              {row.target.workspaceRoot}
            </p>
          </div>
        </div>
        <p role="status" className="text-xs text-muted-foreground">
          {row.status === "saved"
            ? "Saved"
            : row.status === "saving"
              ? "Saving..."
              : row.status === "reviewing"
                ? "Reviewing..."
                : row.status === "error"
                  ? "Review again"
                  : row.status === "reviewed"
                    ? "Reviewed"
                    : "Not reviewed"}
        </p>
      </div>
      {row.error ? (
        <p role="alert" className="text-sm text-destructive">
          {row.error}
        </p>
      ) : null}
      {row.status === "saved" && row.result ? (
        <p className="text-sm">
          Saved: {retentionLabels[row.result.retention]}.{" "}
          {projectStorageRolloutStateLabel(row.result)}.
        </p>
      ) : null}
      {preview && row.status !== "saved" ? (
        <>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Current ownership</p>
              <p>{projectStorageRolloutStateLabel(preview)}</p>
              {preview.ownershipSource !== null ? (
                <p className="text-xs text-muted-foreground">
                  {retentionLabels[preview.retention]}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Local files</p>
              <p>{projectStorageRolloutLocalFilesLabel(preview)}</p>
            </div>
          </div>
          {preview.blockers.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium">Current protections and blockers</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {preview.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {choices.length > 0 && row.status === "reviewed" ? (
            <RadioGroup
              aria-label={`Storage choice for ${row.target.projectName} on ${row.target.environmentLabel} at ${row.target.workspaceRoot}`}
              value={row.choice ?? ""}
              disabled={busy}
              onValueChange={(value) => {
                if (value === "keep" || value === "release-on-settle" || value === "inherit")
                  controller.choose(row.key, value);
              }}
            >
              {choices.map((choice) => (
                <label key={choice} className="flex items-start gap-2.5 text-sm">
                  <Radio value={choice} />
                  <span className="space-y-1">
                    <span className="block">{retentionLabels[choice]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {choice === "keep"
                        ? preview.state === "released"
                          ? "Restore this folder and keep its working files here."
                          : "Keep this folder until you change this choice."
                        : choice === "release-on-settle"
                          ? "Allow cleanup to release working files after all project work settles and safety checks pass."
                          : "Follow this computer's configured cleanup policy."}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          ) : preview.state !== "blocked" && row.status === "reviewed" ? (
            <p className="text-xs text-muted-foreground">
              Read-only review. This connection needs settings access to change this folder.
            </p>
          ) : null}
        </>
      ) : null}
      {!busy && row.status !== "saved" ? (
        <div className="flex flex-wrap gap-2">
          {row.status === "error" || row.status === "idle" ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canReviewProjectStorageTarget(row.target)}
              onClick={() => void controller.review([row.key])}
            >
              Review this folder again
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={() => controller.setSelected(row.key, false)}>
            Remove from selection
          </Button>
        </div>
      ) : null}
    </li>
  );
}
