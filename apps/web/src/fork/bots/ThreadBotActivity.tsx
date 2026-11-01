import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { isTerminalBotRunStatus, type BotRun } from "@t3tools/contracts/fork";
import { botColor } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArrowUpRightIcon,
  BotIcon,
  ChevronDownIcon,
  PanelRightIcon,
  SquareIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import { useRightPanelStore } from "~/rightPanelStore";
import { useThreadShell } from "~/state/entities";
import { cn } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { forkPanelSurface } from "../panels/registry";
import {
  LibraryStateBadge,
  LibraryStateDot,
  LIBRARY_ROW,
} from "../project-library/LibraryControls";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { BotFindings, RunReply } from "./BotFindings";
import { runTime } from "./BotIdentity";
import { BOT_ACTIVITY_PANEL_ID } from "./panel";
import { runOutcome } from "./runLog";
import { elapsedLabel, runDurationLabel } from "./runMetrics";
import { bots, useWaitingBotRuns } from "./state";

export function BotActivitySummary({
  environmentId,
  runs,
}: {
  readonly environmentId: EnvironmentId;
  readonly runs: readonly BotRun[];
}) {
  const waitingThreads = useWaitingBotRuns(environmentId);
  const waitingIds = new Set(waitingThreads.map((thread) => thread.id));
  const needsPerson = (run: BotRun) => Boolean(run.attention || waitingIds.has(run.threadId));
  const waiting = runs.filter(
    (run) => needsPerson(run) && !isTerminalBotRunStatus(run.status),
  ).length;
  const running = runs.filter((run) => run.status === "running" && !needsPerson(run)).length;
  const queued = runs.filter((run) => run.status === "queued" && !needsPerson(run)).length;
  const labels = [
    ...(waiting ? [`${waiting} needs you`] : []),
    ...(running ? [`${running} running`] : []),
    ...(queued ? [`${queued} queued`] : []),
  ];
  return <p className="text-xs text-muted-foreground">{labels.join(", ") || "No bots running"}</p>;
}

export function BotActivityRun({
  environmentId,
  run,
  canCancel,
  now,
  showDetails = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotRun;
  readonly canCancel: boolean;
  readonly now: number;
  readonly showDetails?: boolean;
}) {
  const cancel = useAtomCommand(bots.cancel, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const thread = useThreadShell({ environmentId, threadId: run.threadId });
  const active = !isTerminalBotRunStatus(run.status);
  const attention = active
    ? (run.attention?.kind ??
      (thread?.hasPendingApprovals ? "approval" : thread?.hasPendingUserInput ? "question" : null))
    : null;
  const outcome = runOutcome(run, attention);
  const since = attention
    ? (run.attention?.since ?? thread?.pendingRuntimeRequestAt ?? run.startedAt ?? run.createdAt)
    : (run.startedAt ?? run.createdAt);
  const age = active
    ? run.status === "running" && !run.startedAt
      ? "Starting"
      : elapsedLabel(since, now)
    : runTime(run.finishedAt ?? since, now);
  const label =
    attention === "approval" ? "Approval" : attention === "question" ? "Question" : outcome.label;
  const stop = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await cancel({ environmentId, input: { runId: run.id } });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not stop the run.");
      setBusy(false);
    }
  };

  return (
    <li
      style={projectColorStyle(botColor({ id: run.botId }))}
      className={cn(LIBRARY_ROW, "min-w-0 py-1")}
    >
      <div className="flex h-6 min-w-0 items-center gap-2">
        <BotIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <Tooltip>
          <TooltipTrigger
            render={<span className="min-w-0 flex-1 truncate text-xs font-medium" tabIndex={0} />}
          >
            {run.botName}
          </TooltipTrigger>
          <TooltipPopup>{run.botName}</TooltipPopup>
        </Tooltip>
        {attention || outcome.tone === "warning" || outcome.tone === "danger" ? (
          <LibraryStateBadge tone={outcome.tone}>{label}</LibraryStateBadge>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground">
            <LibraryStateDot tone={outcome.tone} />
            {label}
          </span>
        )}
        <span className="hidden min-w-12 shrink-0 justify-end text-2xs whitespace-nowrap tabular-nums text-muted-foreground @min-[24rem]:inline-flex">
          {age}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {run.status !== "queued" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    shape="pill"
                    size={attention ? "xs" : "icon-xs"}
                    variant={attention ? "default" : "ghost"}
                    render={
                      <Link
                        to="/$environmentId/$threadId"
                        params={{ environmentId, threadId: run.threadId }}
                      />
                    }
                    aria-label={
                      attention
                        ? `${attention === "approval" ? "Review approval" : "Answer question"} for ${run.botName}`
                        : `Open ${run.botName} conversation`
                    }
                  />
                }
              >
                {attention ? attention === "approval" ? "Review" : "Answer" : <ArrowUpRightIcon />}
              </TooltipTrigger>
              <TooltipPopup>
                {attention
                  ? attention === "approval"
                    ? "Review approval"
                    : "Answer question"
                  : "Open conversation"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {active && canCancel ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    shape="pill"
                    size="icon-xs"
                    variant="ghost-destructive"
                    disabled={busy}
                    onClick={() => void stop()}
                    aria-label={`Stop ${run.botName} run`}
                  />
                }
              >
                <SquareIcon />
              </TooltipTrigger>
              <TooltipPopup>{busy ? "Stopping run…" : "Stop this run"}</TooltipPopup>
            </Tooltip>
          ) : null}
          {showDetails ? (
            <Button
              shape="pill"
              size="icon-xs"
              variant="ghost"
              aria-label={`Task and results for ${run.botName}`}
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpanded((value) => !value)}
            >
              <ChevronDownIcon className={cn(expanded && "rotate-180")} />
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="py-2 text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {showDetails && expanded ? (
        <div
          id={detailsId}
          role="region"
          aria-label={`${run.botName} task and results`}
          className="space-y-3 py-3 text-xs"
        >
          {run.modelSelection || run.ranOn ? (
            <p className="text-muted-foreground">
              {[run.modelSelection?.model, run.ranOn?.label].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {Object.keys(run.inputs).length ? (
            <dl className="space-y-2 rounded-lg bg-muted/40 p-3">
              {Object.entries(run.inputs).map(([name, value]) => (
                <div key={name} className="space-y-1">
                  <dt className="font-medium">{name}</dt>
                  <dd className="whitespace-pre-wrap text-muted-foreground wrap-anywhere">
                    {String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {run.verdict ? <BotFindings verdict={run.verdict} /> : null}
          {run.error ? (
            <p role="alert" className="text-destructive-foreground wrap-anywhere">
              {run.error}
            </p>
          ) : null}
          {run.result ? (
            <RunReply run={run} defaultOpen />
          ) : (
            <p className="text-muted-foreground">
              {active
                ? "The result will appear here when this run finishes."
                : "This run has no reply."}
            </p>
          )}
          {!active ? <p className="text-muted-foreground">{runDurationLabel(run)}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

export function OpenBotActivityButton({
  threadRef,
  onOpen,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onOpen?: () => void;
}) {
  return (
    <Button
      shape="pill"
      size="xs"
      variant="ghost"
      onClick={() => {
        useRightPanelStore
          .getState()
          .openSurface(threadRef, forkPanelSurface(BOT_ACTIVITY_PANEL_ID));
        onOpen?.();
      }}
    >
      <PanelRightIcon />
      Bots panel
    </Button>
  );
}
