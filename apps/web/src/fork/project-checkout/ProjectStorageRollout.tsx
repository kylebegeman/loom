import {
  canReviewProjectStorageTarget,
  type ProjectStorageRolloutController,
  projectStorageRolloutChoices,
  projectStorageRolloutStateLabel,
  projectStorageRolloutLocalFilesLabel,
  PROJECT_STORAGE_ROLLOUT_CONFIRMATION_NOTICE,
  PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS as retentionLabels,
} from "@t3tools/client-runtime/fork";
import { CheckIcon, FolderIcon, XIcon } from "lucide-react";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

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
    <section aria-label="Selected folder review">
      <SettingsSection title={saved.length > 0 ? "Folder results" : "Review folders"}>
        <SettingsRow
          title={
            busy ? (
              snapshot.phase === "reviewing" ? (
                "Reviewing folders"
              ) : (
                "Saving choices"
              )
            ) : (
              <span role="status">
                {selected.length} selected{saved.length > 0 ? `, ${saved.length} saved` : ""}
              </span>
            )
          }
          description={
            busy
              ? snapshot.cancelRequested
                ? "Stopping after the current request finishes."
                : "Each folder is handled separately."
              : "Select folders below. Review leaves files and storage choices unchanged."
          }
          control={
            <div className="flex flex-wrap items-center gap-1.5">
              {busy ? (
                <Button
                  size="xs"
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
                      size="xs"
                      variant="ghost-muted"
                      onClick={() =>
                        selected.forEach((row) => controller.setSelected(row.key, false))
                      }
                    >
                      Clear
                    </Button>
                  ) : null}
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!reviewable || selected.length === 0}
                    onClick={() => void controller.review()}
                  >
                    {saved.length > 0
                      ? "Review unfinished"
                      : needsReview || selected.length === 0
                        ? "Review selected"
                        : "Refresh reviews"}
                  </Button>
                  <Button size="xs" disabled={!canConfirm} onClick={() => controller.confirm()}>
                    Confirm choices
                  </Button>
                </>
              )}
            </div>
          }
        />
        {queue.some((row) => row.status !== "idle") ? (
          <>
            <ul aria-label="Folder review queue" className="divide-y divide-border/50">
              {queue.map((row) => (
                <StorageReviewRow key={row.key} row={row} busy={busy} controller={controller} />
              ))}
            </ul>
            <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
              Cleanup checks release safety again. These reviews cover primary folders, not
              worktrees.
            </p>
          </>
        ) : null}
      </SettingsSection>
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
  const reviewed = row.status === "reviewed";
  const status =
    row.status === "saved"
      ? "Saved"
      : row.status === "saving"
        ? "Saving..."
        : row.status === "reviewing"
          ? "Reviewing..."
          : row.status === "error"
            ? "Review again"
            : reviewed
              ? preview
                ? projectStorageRolloutStateLabel(preview)
                : "Reviewed"
              : "Not reviewed";
  const choiceDescription =
    row.choice === "keep"
      ? preview?.state === "released"
        ? "Restore this folder and keep its working files here."
        : "Keep working files here until you change this choice."
      : row.choice === "release-on-settle"
        ? "Release working files after all work settles and safety checks pass."
        : row.choice === "inherit"
          ? "Follow this computer's configured cleanup policy."
          : null;
  return (
    <li>
      <SettingsRow
        title={
          <span className="flex items-center gap-2">
            {row.status === "saved" ? (
              <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-icon-muted" />
            ) : (
              <FolderIcon aria-hidden="true" className="size-3.5 shrink-0 text-icon-muted" />
            )}
            <span className="min-w-0 wrap-anywhere">{row.target.projectName}</span>
          </span>
        }
        description={
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  className="block truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              {row.target.workspaceRoot}
            </TooltipTrigger>
            <TooltipPopup>
              <span className="wrap-anywhere">{row.target.workspaceRoot}</span>
            </TooltipPopup>
          </Tooltip>
        }
        status={
          <span role="status">
            {row.target.environmentLabel} · {status}
          </span>
        }
        control={
          <>
            {choices.length > 0 && reviewed ? (
              <div className="w-52 max-w-full">
                <Select
                  value={row.choice}
                  disabled={busy}
                  items={choices.map((value) => ({ value, label: retentionLabels[value] }))}
                  onValueChange={(value) => {
                    if (value === "keep" || value === "release-on-settle" || value === "inherit")
                      controller.choose(row.key, value);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={`Storage choice for ${row.target.projectName} on ${row.target.environmentLabel} at ${row.target.workspaceRoot}`}
                  >
                    <SelectValue placeholder="Choose storage policy" />
                  </SelectTrigger>
                  <SelectPopup>
                    {choices.map((choice) => (
                      <SelectItem key={choice} value={choice}>
                        {retentionLabels[choice]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            ) : !busy && (row.status === "error" || row.status === "idle") ? (
              <Button
                size="xs"
                variant="outline"
                disabled={!canReviewProjectStorageTarget(row.target)}
                onClick={() => void controller.review([row.key])}
              >
                Review again
              </Button>
            ) : null}
            {!busy && row.status !== "saved" ? (
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Remove ${row.target.projectName} on ${row.target.environmentLabel} from selection`}
                onClick={() => controller.setSelected(row.key, false)}
              >
                <XIcon aria-hidden="true" className="size-3.5" />
              </Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-2 pb-2">
          {row.error ? (
            <p role="alert" className="text-xs text-destructive">
              {row.error}
            </p>
          ) : null}
          {row.status === "saved" && row.result ? (
            <p className="text-xs text-muted-foreground">
              {retentionLabels[row.result.retention]}. {projectStorageRolloutStateLabel(row.result)}
              .
            </p>
          ) : null}
          {preview && row.status !== "saved" ? (
            <>
              <p className="text-xs text-muted-foreground">
                {projectStorageRolloutLocalFilesLabel(preview)}
                {preview.blockers.length > 0
                  ? ` · ${preview.blockers.length} ${preview.blockers.length === 1 ? "protection" : "protections"}`
                  : ""}
              </p>
              {choiceDescription ? (
                <p className="text-xs text-muted-foreground">{choiceDescription}</p>
              ) : null}
              {choices.length === 0 && preview.state !== "blocked" && reviewed ? (
                <p className="text-xs text-muted-foreground">
                  Read-only review. Settings access is required to change this folder.
                </p>
              ) : null}
              <details className="text-xs text-muted-foreground">
                <summary className="w-fit cursor-pointer rounded-sm py-1 text-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  Review details
                </summary>
                <div className="space-y-2 pt-1">
                  <p className="wrap-anywhere">{row.target.workspaceRoot}</p>
                  <p>
                    {projectStorageRolloutStateLabel(preview)}
                    {preview.ownershipSource !== null
                      ? ` · ${retentionLabels[preview.retention]}`
                      : ". Saving allows Loom to manage this folder."}
                  </p>
                  {preview.blockers.length > 0 ? (
                    <ul
                      className="list-disc space-y-1 pl-4"
                      aria-label="Current protections and blockers"
                    >
                      {preview.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </details>
            </>
          ) : null}
        </div>
      </SettingsRow>
    </li>
  );
}
