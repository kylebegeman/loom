import { useState } from "react";
import {
  LIBRARY_OPERATION_LABELS,
  LIBRARY_OPERATION_STATES,
  libraryOperationNeedsAction,
  sortLibraryOperations,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { PROJECT_WORKFLOWS_FEATURE, type LibraryOperation } from "@t3tools/contracts/fork";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderXIcon,
  HardDriveDownloadIcon,
  MessageSquarePlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { useEnvironments } from "~/state/environments";
import type { EnvironmentId } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { projectLibrary, useLibraryPermission } from "./state";
import { openLibraryAction } from "./actions";
import { LIBRARY_ROW, LibraryErrorNotice, LibraryStateBadge } from "./LibraryControls";
import { ComputerLabel } from "./ProjectIdentity";

const OPERATION_ICONS: Record<LibraryOperation["kind"], LucideIcon> = {
  create: FolderPlusIcon,
  prepare: HardDriveDownloadIcon,
  restore: ArchiveRestoreIcon,
  reopen: FolderOpenIcon,
  snapshot: ArchiveIcon,
  release: Trash2Icon,
  unregister: FolderXIcon,
  launch: MessageSquarePlusIcon,
};

/** Finished history beyond this folds behind Show all, so unfinished work stays in view. */
const SHOWN_OPERATIONS = 4;

/**
 * File work Loom ran on one computer, unfinished first. Work survives closing the window, so
 * anything that stopped partway can be resumed or cancelled here.
 */
export function ProjectOperationHistory({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId?: string;
}) {
  const { environments } = useEnvironments();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const label = environment?.label ?? "This computer";
  const supported = supportsLoomFeature(
    environment?.serverConfig?.environment.capabilities,
    PROJECT_WORKFLOWS_FEATURE,
  );
  const query = useEnvironmentQuery(
    supported
      ? projectLibrary.operations({ environmentId, input: projectId ? { projectId } : {} })
      : null,
  );
  const resume = useAtomCommand(projectLibrary.resumeOperation, { reportFailure: false });
  const cancel = useAtomCommand(projectLibrary.cancelOperation, { reportFailure: false });
  const allowed = useLibraryPermission(projectLibrary.resumeOperation, environmentId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const act = async (id: string, kind: "resume" | "cancel") => {
    setBusy(true);
    setError(null);
    const result = await (kind === "resume" ? resume : cancel)({
      environmentId,
      input: { operationId: id },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not update this operation.");
    }
    query.refresh();
    setBusy(false);
  };
  const operations = sortLibraryOperations(query.data ?? []);
  const shown = showAll ? operations : operations.slice(0, SHOWN_OPERATIONS);
  const unfinished = operations.some(
    (operation) => libraryOperationNeedsAction(operation) || operation.state === "running",
  );
  return (
    <section aria-label={`Activity on ${label}`} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <ComputerLabel
          environmentId={environmentId}
          label={label}
          className="text-sm font-medium text-foreground"
        />
        {supported ? (
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-label={`Refresh activity on ${label}`}
            disabled={query.isPending}
            onClick={query.refresh}
          >
            <RefreshCwIcon />
          </Button>
        ) : null}
      </div>
      {!supported ? (
        <p className="text-xs text-muted-foreground">
          Update Loom on {label} to see its file activity here.
        </p>
      ) : (
        <>
          <LibraryErrorNotice error={error ?? query.error} onRetry={query.refresh} />
          {!operations.length ? (
            <p className="text-xs text-muted-foreground">
              {query.isPending ? "Loading activity..." : `No file activity on ${label} yet.`}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {shown.map((operation) => (
                <OperationRow
                  key={operation.id}
                  operation={operation}
                  disabled={!allowed || busy}
                  onResume={() =>
                    operation.kind === "restore"
                      ? openLibraryAction("new-conversation", operation.projectId ?? undefined, {
                          environmentId,
                        })
                      : void act(operation.id, "resume")
                  }
                  onCancel={() => void act(operation.id, "cancel")}
                />
              ))}
            </ul>
          )}
          {operations.length > SHOWN_OPERATIONS ? (
            <div>
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll ? "Show fewer" : `Show all ${operations.length}`}
              </Button>
            </div>
          ) : null}
          {unfinished ? (
            <p className="text-xs text-muted-foreground">
              Work keeps going when the window closes. After a restart, Loom resumes safe steps on
              its own; file changes already running finish before they can be cancelled.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function OperationRow({
  operation,
  disabled,
  onResume,
  onCancel,
}: {
  readonly operation: LibraryOperation;
  readonly disabled: boolean;
  readonly onResume: () => void;
  readonly onCancel: () => void;
}) {
  const Icon = OPERATION_ICONS[operation.kind];
  const state = LIBRARY_OPERATION_STATES[operation.state];
  const actionable = libraryOperationNeedsAction(operation);
  // The phase repeats the state once work ends; it only adds something while work is underway.
  const phase =
    operation.state === "succeeded" || operation.state === "cancelled" ? null : operation.phase;
  return (
    <li className={cn(LIBRARY_ROW, "flex min-w-0 flex-col gap-1.5 py-2")}>
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-accent"
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{LIBRARY_OPERATION_LABELS[operation.kind]}</p>
          <p className="truncate text-xs tabular-nums text-muted-foreground">
            {[
              phase,
              formatRelativeTimeLabel(operation.updatedAt),
              operation.attempt > 1 ? `attempt ${operation.attempt}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
      </div>
      {operation.error ? (
        <p role="status" className="ps-10 text-xs text-destructive-foreground">
          {operation.error}
        </p>
      ) : null}
      {actionable ? (
        <div className="flex gap-1.5 ps-10">
          <Button shape="pill" size="xs" variant="outline" disabled={disabled} onClick={onResume}>
            {operation.kind === "restore" ? "Restore from Start" : "Resume"}
          </Button>
          <Button shape="pill" size="xs" variant="ghost" disabled={disabled} onClick={onCancel}>
            Cancel remaining steps
          </Button>
        </div>
      ) : null}
    </li>
  );
}
