import { useState } from "react";
import {
  LIBRARY_OPERATION_LABELS,
  LIBRARY_OPERATION_STATES,
  libraryProjectRequestOutcome,
  selectLibraryProjectRequests,
  needsLibrarySignIn,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { PROJECT_WORKFLOWS_FEATURE, type LibraryOperation } from "@t3tools/contracts/fork";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  FolderOpenIcon,
  FolderPenIcon,
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
import { LibrarySignInLink } from "./LibrarySignInLink";
import { ComputerLabel } from "./ProjectIdentity";

const OPERATION_ICONS: Record<LibraryOperation["kind"], LucideIcon> = {
  import: FolderPlusIcon,
  create: FolderPlusIcon,
  update: FolderPenIcon,
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
  computerLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId?: string;
  readonly computerLabel?: string;
}) {
  const { environments } = useEnvironments();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const label = environment?.label ?? computerLabel ?? "Saved computer";
  const connected =
    environment?.entry.enabled === true && environment.connection.phase === "connected";
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
  const canResume = useLibraryPermission(projectLibrary.resumeOperation, environmentId);
  const canCancel = useLibraryPermission(projectLibrary.cancelOperation, environmentId);
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
  const { shown, total, unfinished } = selectLibraryProjectRequests(
    query.data ?? [],
    showAll ? null : SHOWN_OPERATIONS,
  );
  return (
    <section aria-label={`Request history on ${label}`} className="flex min-w-0 flex-col gap-1.5">
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
            aria-label={`Check request outcomes on ${label}`}
            disabled={!connected || query.isPending}
            onClick={query.refresh}
          >
            <RefreshCwIcon />
          </Button>
        ) : null}
      </div>
      {!supported ? (
        <p className="text-xs text-muted-foreground">
          {connected
            ? `Update Loom on ${label} to see its saved requests here.`
            : `${label} is offline. Reconnect to check saved requests.`}
        </p>
      ) : (
        <>
          <LibraryErrorNotice error={error ?? query.error} onRetry={query.refresh} />
          {!connected ? (
            <p role="status" className="text-xs text-muted-foreground">
              Computer offline. Saved receipts may be incomplete. Reconnect to check outcomes.
            </p>
          ) : null}
          {!total ? (
            <p className="text-xs text-muted-foreground">
              {query.isPending
                ? "Loading requests..."
                : "No saved requests returned. This does not confirm that no work ran."}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {shown.map((operation) => (
                <OperationRow
                  key={operation.id}
                  operation={operation}
                  canResume={connected && canResume && !busy}
                  canCancel={connected && canCancel && !busy}
                  canCheck={connected && !query.isPending}
                  onCheck={query.refresh}
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
          {total > shown.length || showAll ? (
            <div>
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll ? "Show fewer" : `Show all ${total}`}
              </Button>
            </div>
          ) : null}
          {unfinished > 0 ? (
            <p className="text-xs text-muted-foreground">
              Resume continues the saved request. Cancel remaining steps keeps completed outcomes;
              it does not undo file changes. A running step must finish before cancellation.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function OperationRow({
  operation,
  canResume,
  canCancel,
  canCheck,
  onCheck,
  onResume,
  onCancel,
}: {
  readonly operation: LibraryOperation;
  readonly canResume: boolean;
  readonly canCancel: boolean;
  readonly canCheck: boolean;
  readonly onCheck: () => void;
  readonly onResume: () => void;
  readonly onCancel: () => void;
}) {
  const Icon = OPERATION_ICONS[operation.kind];
  const state = LIBRARY_OPERATION_STATES[operation.state];
  const outcome = libraryProjectRequestOutcome(operation);
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
      <div className="flex min-w-0 flex-col gap-1 ps-10 text-xs">
        {outcome.completed.length ? (
          <p className="text-foreground">{outcome.completed.join(". ")}.</p>
        ) : null}
        {outcome.remaining.length ? (
          <p className="text-muted-foreground">Remaining: {outcome.remaining.join(". ")}.</p>
        ) : null}
        <p className="text-muted-foreground">{outcome.conversation}.</p>
        {outcome.path ? <p className="break-all text-muted-foreground">{outcome.path}</p> : null}
        {outcome.detail ? <p className="text-muted-foreground">{outcome.detail}</p> : null}
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">Request reference</summary>
          <p className="break-all select-text">{outcome.requestId}</p>
          <p>
            Requested{" "}
            <time dateTime={operation.createdAt}>
              {new Date(operation.createdAt).toLocaleString()}
            </time>
            . Resume keeps this reference.
          </p>
        </details>
      </div>
      {operation.error ? (
        <div className="flex flex-wrap items-center gap-2 ps-10">
          <p role="status" className="text-xs text-destructive-foreground">
            {operation.error}
          </p>
          {needsLibrarySignIn(operation.error, operation.accessRepair) ? (
            <LibrarySignInLink />
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5 ps-10">
        <Button shape="pill" size="xs" variant="ghost" disabled={!canCheck} onClick={onCheck}>
          Check outcome
        </Button>
        {outcome.canResume ? (
          <>
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              disabled={!canResume}
              onClick={onResume}
            >
              {outcome.resumeLabel}
            </Button>
            <Button shape="pill" size="xs" variant="ghost" disabled={!canCancel} onClick={onCancel}>
              Cancel remaining steps
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}
