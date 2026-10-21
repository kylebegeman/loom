import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  batchCountsLine,
  type BotBatch,
  type BotBatchItem,
  type BotBatchRetryInclude,
} from "@t3tools/contracts/fork";
import { applyBatchItemChanges, type BotBatchChanges } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import ChatMarkdown from "~/components/ChatMarkdown";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { bots } from "./state";

const time = (value: string) => new Date(value).toLocaleString();

const STATUS_LABELS: Record<BotBatch["status"], string> = {
  running: "Running",
  finished: "Finished",
  cancelled: "Cancelled",
};

/** An item's outcome as one word and one fill; a verdict outranks a plain completion. */
const outcome = (item: BotBatchItem): { readonly label: string; readonly fill: string } => {
  if (item.state === "pending") return { label: "waiting", fill: "bg-muted" };
  if (item.state === "skipped") return { label: "skipped", fill: "bg-muted-foreground/30" };
  const run = item.run;
  if (run === null) return { label: "no longer stored", fill: "bg-muted-foreground/30" };
  switch (run.status) {
    case "queued":
      return { label: "waiting", fill: "bg-muted" };
    case "running":
      return { label: "running", fill: "bg-info" };
    case "failed":
      return { label: "failed", fill: "bg-destructive" };
    case "timed_out":
      return { label: "timed out", fill: "bg-destructive" };
    case "cancelled":
      return { label: "cancelled", fill: "bg-muted-foreground/30" };
    case "completed":
      switch (run.verdict?.verdict) {
        case "fail":
          return { label: "fail", fill: "bg-destructive" };
        case "needs_attention":
          return { label: "needs attention", fill: "bg-warning" };
        case "pass":
          return { label: "pass", fill: "bg-success" };
        default:
          return { label: "completed", fill: "bg-success" };
      }
  }
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
  if (batches.length === 0) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  return (
    <ul className="grid gap-2">
      {batches.map((batch) => (
        <li key={batch.id}>
          <Button
            size="sm-multiline"
            variant={batch.id === selectedId ? "secondary" : "ghost"}
            aria-pressed={batch.id === selectedId}
            className="w-full justify-start"
            onClick={() => onSelect(batch)}
          >
            <span className="grid min-w-0 gap-0.5 text-left">
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={batch.status === "running" ? "secondary" : "outline"}>
                  {STATUS_LABELS[batch.status]}
                </Badge>
                {showBot ? <span className="font-medium">{batch.botName}</span> : null}
                <span className="truncate">{batch.sourceSummary}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {time(batch.createdAt)} · {batchCountsLine(batch.counts)}
              </span>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

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
    <details
      className="rounded-lg border border-border p-3 text-sm"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">Report</summary>
      {open ? (
        <div className="mt-3 space-y-3">
          {report.error ? (
            <p role="alert" className="text-destructive-foreground">
              {report.error}
            </p>
          ) : report.data ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => copy.copyToClipboard(report.data?.markdown ?? "", undefined)}
                >
                  {copy.isCopied ? "Report copied" : "Copy report"}
                </Button>
                <Button size="xs" variant="ghost" onClick={report.refresh}>
                  Refresh
                </Button>
              </div>
              {copyError ? (
                <p role="alert" className="text-destructive-foreground">
                  {copyError}
                </p>
              ) : null}
              <ChatMarkdown text={report.data.markdown} cwd={undefined} />
            </>
          ) : (
            <p role="status" className="text-muted-foreground">
              Loading the report…
            </p>
          )}
        </div>
      ) : null}
    </details>
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

  if (query.error)
    return (
      <p role="alert" className="text-sm text-destructive-foreground">
        {query.error}
      </p>
    );
  if (!query.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading the batch…
      </p>
    );
  const { batch, items } = applyBatchItemChanges(query.data, changes);
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
    <section aria-label="Batch" className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{batch.sourceSummary}</h3>
            <Badge variant={running ? "secondary" : "outline"}>{STATUS_LABELS[batch.status]}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {batch.botName}, version {batch.botVersion} · {time(batch.createdAt)}
            {batch.startedBy === "agent" ? " · started by an agent" : ""}
          </p>
          <p className="text-sm">{batchCountsLine(batch.counts)}</p>
          {batch.note ? <p className="text-sm text-muted-foreground">{batch.note}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {running ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canCancel || busy}
              onClick={() => void stop()}
            >
              Cancel batch
            </Button>
          ) : null}
          {!running && failed > 0 ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canRun || busy}
              onClick={() => void rerun("failed")}
            >
              Retry failed
            </Button>
          ) : null}
          {!running && attention > 0 ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canRun || busy}
              onClick={() => void rerun("failed_and_attention")}
            >
              Retry failed and needs attention
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {!running && newer && failed + attention > 0 ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useLatest}
            onChange={(event) => setUseLatest(event.target.checked)}
          />
          Retry with version {latestVersion} instead of {batch.botVersion}
        </label>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      <ul aria-label="Items" className="flex flex-wrap gap-1">
        {items.map((item) => {
          const { label, fill } = outcome(item);
          const title = `${item.label}: ${label}`;
          const square = `block size-4 rounded-sm ${fill}`;
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
                        className={square}
                      />
                    ) : (
                      <span tabIndex={0} role="img" aria-label={title} className={square} />
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
      <BatchReport environmentId={environmentId} batch={batch} />
    </section>
  );
}
