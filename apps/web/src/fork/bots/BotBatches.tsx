import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  batchCountsLine,
  type BotBatch,
  type BotBatchCounts,
  type BotBatchItem,
  type BotBatchRetryInclude,
} from "@t3tools/contracts/fork";
import {
  applyBatchItemChanges,
  BOT_BATCH_STATES,
  BOT_RUN_STATES,
  BOT_VERDICT_STATES,
  botColor,
  type BotBatchChanges,
  type LibraryWorkflowTone,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ChevronDownIcon,
  CopyIcon,
  FileTextIcon,
  InfoIcon,
  LayersIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Skeleton } from "~/components/ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryErrorNotice,
  LibraryNotice,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { BotTile, runTime } from "./BotIdentity";
import { BotsEmptyList } from "./BotRuns";
import { bots } from "./state";

/** A state tone, plus the quieter fill of work that has not started yet. */
export type ProgressTone = LibraryWorkflowTone | "waiting";

const PROGRESS_FILL: Record<ProgressTone, string> = {
  waiting: "bg-muted-foreground/15",
  neutral: "bg-muted-foreground/40",
  active: "bg-(--project-color)",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

export type ProgressSegment = {
  readonly key: string;
  readonly tone: ProgressTone;
  readonly count: number;
};

/**
 * Where a batch or pipeline stands, as one calm bar of state-toned segments sized by their counts.
 * The caller prints the counts beside it, so the bar never has to carry a legend.
 */
export function ProgressBar({
  segments,
  label,
  className,
}: {
  readonly segments: ReadonlyArray<ProgressSegment>;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <div role="img" aria-label={label} className={cn("flex h-1.5 min-w-0 gap-0.5", className)}>
      {segments
        .filter((segment) => segment.count > 0)
        .map((segment) => (
          <span
            key={segment.key}
            className={cn("min-w-0.5 basis-0 rounded-full", PROGRESS_FILL[segment.tone])}
            style={{ flexGrow: segment.count }}
          />
        ))}
    </div>
  );
}

const countSegments = (counts: BotBatchCounts): ReadonlyArray<ProgressSegment> => [
  { key: "passed", tone: "success", count: counts.completed - counts.fail - counts.needsAttention },
  { key: "attention", tone: "warning", count: counts.needsAttention },
  { key: "failed", tone: "danger", count: counts.fail + counts.failed + counts.timedOut },
  { key: "stopped", tone: "neutral", count: counts.cancelled + counts.skipped },
  { key: "running", tone: "active", count: counts.running },
  { key: "waiting", tone: "waiting", count: counts.pending + counts.queued },
];

const settledCount = (batch: BotBatch) =>
  batch.total - batch.counts.pending - batch.counts.queued - batch.counts.running;

/** An item's outcome as one label and one tone; a verdict outranks a plain completion. */
const outcome = (item: BotBatchItem): { readonly label: string; readonly tone: ProgressTone } => {
  if (item.state === "pending") return { label: "Waiting", tone: "waiting" };
  if (item.state === "skipped") return { label: "Skipped", tone: "neutral" };
  const run = item.run;
  if (run === null) return { label: "No longer stored", tone: "neutral" };
  if (run.status === "queued") return { label: "Waiting", tone: "waiting" };
  const verdict = run.status === "completed" ? run.verdict?.verdict : undefined;
  return verdict ? BOT_VERDICT_STATES[verdict] : BOT_RUN_STATES[run.status];
};

export function BatchList({
  batches,
  selectedId,
  showBot,
  onSelect,
  emptyMessage,
}: {
  readonly batches: ReadonlyArray<BotBatch>;
  readonly selectedId: string | undefined;
  readonly showBot: boolean;
  readonly onSelect: (batch: BotBatch) => void;
  readonly emptyMessage: string;
}) {
  if (batches.length === 0) return <BotsEmptyList icon={LayersIcon} message={emptyMessage} />;
  return (
    <ul className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}>
      {batches.map((batch) => {
        const state = BOT_BATCH_STATES[batch.status];
        const selected = batch.id === selectedId;
        return (
          <li key={batch.id} style={projectColorStyle(botColor({ id: batch.botId }))}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(batch)}
              className={cn(
                "flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-start outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                selected ? "bg-accent/70" : "hover:bg-accent/40",
              )}
            >
              {showBot ? (
                <BotTile bot={{ id: batch.botId }} status={<LibraryStateDot tone={state.tone} />} />
              ) : (
                <LibraryStateDot tone={state.tone} className="mx-1" />
              )}
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate text-sm font-medium">
                  {showBot ? batch.botName : batch.sourceSummary}
                </span>
                <span className="block truncate text-xs tabular-nums text-muted-foreground">
                  {[
                    showBot ? batch.sourceSummary : null,
                    runTime(batch.createdAt),
                    batchCountsLine(batch.counts),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="hidden w-24 flex-col gap-1 sm:flex">
                  <ProgressBar
                    segments={countSegments(batch.counts)}
                    label={batchCountsLine(batch.counts)}
                  />
                  <span className="text-end text-2xs tabular-nums text-muted-foreground">
                    {settledCount(batch)} of {batch.total}
                  </span>
                </span>
                <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const REPORT_SKELETON_LINES = ["w-1/3", "w-5/6", "w-2/3", "w-3/4"];

function BatchReport({
  environmentId,
  batch,
}: {
  readonly environmentId: EnvironmentId;
  readonly batch: BotBatch;
}) {
  const [open, setOpen] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const report = useEnvironmentQuery(
    open ? bots.batchReport({ environmentId, input: { batchId: batch.id } }) : null,
  );
  // The report is built from the items, so it follows the batch as they finish.
  const countsLine = batchCountsLine(batch.counts);
  const refreshReport = report.refresh;
  const seenCounts = useRef(countsLine);
  useEffect(() => {
    if (seenCounts.current === countsLine) return;
    seenCounts.current = countsLine;
    if (open) refreshReport();
  }, [countsLine, open, refreshReport]);
  const copy = useCopyToClipboard<void>({
    target: "batch report",
    onError: (cause) => setCopyError(cause.message),
  });
  return (
    <div className="border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-start outline-none transition-colors duration-150 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Report</span>
          <span className="block text-xs text-muted-foreground">
            Every item's outcome, as Markdown you can copy
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 px-4 pb-4 text-sm sm:px-5">
          {report.error ? (
            <LibraryErrorNotice error={report.error} onRetry={report.refresh} />
          ) : report.data ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  onClick={() => copy.copyToClipboard(report.data?.markdown ?? "", undefined)}
                >
                  <CopyIcon />
                  {copy.isCopied ? "Report copied" : "Copy report"}
                </Button>
                <Button shape="pill" size="xs" variant="ghost" onClick={report.refresh}>
                  <RefreshCwIcon />
                  Refresh
                </Button>
              </div>
              <LibraryErrorNotice error={copyError} />
              <ChatMarkdown text={report.data.markdown} cwd={undefined} />
            </>
          ) : (
            <div role="status" aria-label="Loading the report" className="flex flex-col gap-2">
              {REPORT_SKELETON_LINES.map((width) => (
                <div key={width} className={width}>
                  <Skeleton className="h-3" />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The batch view's shape while it loads, so the list below does not jump when it arrives. */
function BatchViewSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the batch"
      className={cn(LIBRARY_OUTLINE, "flex flex-col gap-4 p-4 sm:p-5")}
    >
      <div className="flex items-center gap-4">
        <Skeleton shape="card" className="size-9" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
        <Skeleton shape="pill" className="h-6 w-24" />
      </div>
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-2.5 w-1/4" />
    </div>
  );
}

export function BatchView({
  environmentId,
  batchId,
  changes,
  latestVersionOf,
  canRun,
  canCancel,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly batchId: string;
  readonly changes: BotBatchChanges;
  /** A bot's saved version, or null when it is gone. */
  readonly latestVersionOf: (botId: string) => number | null;
  readonly canRun: boolean;
  readonly canCancel: boolean;
  readonly onClose: () => void;
}) {
  const query = useEnvironmentQuery(bots.getBatch({ environmentId, input: { batchId } }));
  const cancel = useAtomCommand(bots.cancelBatch, { reportFailure: false });
  const retry = useAtomCommand(bots.retryBatch, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useLatest, setUseLatest] = useState(false);

  if (query.error) return <LibraryErrorNotice error={query.error} onRetry={query.refresh} />;
  if (!query.data) return <BatchViewSkeleton />;
  const { batch, items } = applyBatchItemChanges(query.data, changes);
  const state = BOT_BATCH_STATES[batch.status];
  const running = batch.status === "running";
  const failed = batch.counts.failed + batch.counts.timedOut + batch.counts.fail;
  const attention = batch.counts.needsAttention;
  const latestVersion = latestVersionOf(batch.botId);
  const newer = latestVersion !== null && latestVersion !== batch.botVersion;

  const act = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await work());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  const stop = () =>
    act(async () => {
      const result = await cancel({ environmentId, input: { batchId: batch.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return null;
    });
  const rerun = (include: BotBatchRetryInclude) =>
    act(async () => {
      const result = await retry({
        environmentId,
        input: { batchId: batch.id, include, ...(useLatest && newer ? { useLatest: true } : {}) },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      query.refresh();
      const { retried, exhausted } = result.value;
      return exhausted.length === 0
        ? `Retrying ${retried} item${retried === 1 ? "" : "s"}.`
        : `Retrying ${retried}. Left out after too many attempts: ${exhausted.join(", ")}.`;
    });

  return (
    <section
      aria-label="Batch"
      style={projectColorStyle(botColor({ id: batch.botId }))}
      className={cn(LIBRARY_OUTLINE, "overflow-hidden")}
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <BotTile bot={{ id: batch.botId }} />
          <div className="min-w-0 flex-1 basis-60 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 text-base font-semibold tracking-tight wrap-anywhere">
                {batch.sourceSummary}
              </h3>
              <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">
              {[
                `${batch.botName}, v${batch.botVersion}`,
                runTime(batch.createdAt),
                batch.startedBy === "agent" ? "started by an agent" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {running ? (
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                disabled={!canCancel || busy}
                onClick={() => void stop()}
              >
                <SquareIcon />
                Cancel batch
              </Button>
            ) : null}
            {!running && failed > 0 ? (
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                disabled={!canRun || busy}
                onClick={() => void rerun("failed")}
              >
                <RotateCcwIcon />
                Retry failed
              </Button>
            ) : null}
            {!running && attention > 0 ? (
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                disabled={!canRun || busy}
                onClick={() => void rerun("failed_and_attention")}
              >
                <RotateCcwIcon />
                Retry failed and needs attention
              </Button>
            ) : null}
            <Button
              shape="pill"
              size="icon-xs"
              variant="ghost"
              aria-label="Close batch"
              onClick={onClose}
            >
              <XIcon />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <ul aria-label="Items" className="flex flex-wrap gap-0.5">
            {items.map((item) => {
              const { label, tone } = outcome(item);
              const title = `${item.label}: ${label}`;
              const segment = cn(
                "block h-5 w-3 rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                PROGRESS_FILL[tone],
              );
              return (
                <li key={item.index}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        item.run !== null && item.run.status !== "queued" ? (
                          <Link
                            to="/$environmentId/$threadId"
                            params={{ environmentId, threadId: item.run.threadId }}
                            aria-label={title}
                            className={segment}
                          />
                        ) : (
                          <span tabIndex={0} role="img" aria-label={title} className={segment} />
                        )
                      }
                    />
                    <TooltipPopup>
                      <span className="wrap-anywhere">{title}</span>
                    </TooltipPopup>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
          <p className="text-xs tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">
              {settledCount(batch)} of {batch.total} done
            </span>
            {" · "}
            {batchCountsLine(batch.counts)}
          </p>
        </div>
        {batch.note ? <LibraryNotice icon={InfoIcon}>{batch.note}</LibraryNotice> : null}
        {!running && newer && failed + attention > 0 ? (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox checked={useLatest} onCheckedChange={(checked) => setUseLatest(checked)} />
            Retry with version {latestVersion} instead of {batch.botVersion}
          </label>
        ) : null}
        {message ? (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        ) : null}
        <LibraryErrorNotice error={error} />
      </div>
      <BatchReport environmentId={environmentId} batch={batch} />
    </section>
  );
}
