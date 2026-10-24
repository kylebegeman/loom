import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { isTerminalBotRunStatus, type BotRun, type BotVerdictValue } from "@t3tools/contracts/fork";
import { BOT_RUN_STATES, BOT_VERDICT_STATES } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  ListFilterIcon,
  PlayIcon,
  SquareIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { cn } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { BotFindings, RawReply } from "./BotFindings";
import { BotRunStatusBadge, BotTile, VerdictChip, runDuration, runTime } from "./BotIdentity";
import { BotRunFeedback } from "./BotRunFeedback";
import { bots } from "./state";
import type { BotDefinition as StubBot } from "@t3tools/contracts/fork";

export const runInputSummary = (run: BotRun) =>
  Object.entries(run.inputs)
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join(", ");

/** The one line under a run's title: when, how long, where and who, in that order of interest. */
function runMeta(run: BotRun) {
  const active = !isTerminalBotRunStatus(run.status);
  const parts = [
    active
      ? run.status === "queued"
        ? `Queued ${runTime(run.createdAt)}`
        : `Started ${runTime(run.startedAt ?? run.createdAt)}`
      : runTime(run.finishedAt ?? run.startedAt ?? run.createdAt),
    active ? null : runDuration(run.startedAt, run.finishedAt),
    `v${run.botVersion}`,
    run.ranOn ? `on ${run.ranOn.label}` : null,
    run.requestedBy ? `for ${run.requestedBy.label}` : null,
    run.startedBy === "agent" ? "started by an agent" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function RunRow({
  environmentId,
  run,
  showBot,
  canCancel,
  canRate,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotRun;
  readonly showBot: boolean;
  readonly canCancel: boolean;
  readonly canRate: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useAtomCommand(bots.cancel, { reportFailure: false });
  const tone = BOT_RUN_STATES[run.status].tone;
  const active = !isTerminalBotRunStatus(run.status);
  const summary = runInputSummary(run);
  const verdict = run.verdict ?? null;
  const detail = verdict ? "findings" : run.result ? "reply" : null;

  const stop = async () => {
    setBusy(true);
    setError(null);
    const result = await cancel({ environmentId, input: { runId: run.id } });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not cancel the run.");
    }
    setBusy(false);
  };

  const feedback = !active && (canRate || run.rating != null || run.note);
  const expandable = detail !== null || feedback;

  return (
    <li className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        {showBot ? (
          <BotTile bot={{ id: run.botId }} size="sm" />
        ) : (
          <LibraryStateDot tone={tone} className="mx-2" />
        )}
        <div className="flex min-w-0 flex-1 basis-56 flex-col">
          <p className="truncate text-sm font-medium">
            {showBot ? run.botName : summary || "No inputs"}
          </p>
          <p className="truncate text-xs tabular-nums text-muted-foreground">{runMeta(run)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {verdict ? <VerdictChip verdict={verdict.verdict} /> : null}
          {verdict && run.status === "completed" ? null : <BotRunStatusBadge status={run.status} />}
          {run.replayId ? <LibraryStateBadge tone="neutral">Replay</LibraryStateBadge> : null}
        </div>
        <div className="flex items-center gap-0.5">
          {active ? (
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              disabled={!canCancel || busy}
              onClick={() => void stop()}
            >
              <SquareIcon />
              {busy ? "Cancelling…" : "Cancel"}
            </Button>
          ) : null}
          {run.status === "queued" ? null : (
            <Button
              shape="pill"
              size="icon-xs"
              variant="ghost"
              aria-label="Open thread"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  // A remote run's thread lives on the computer that ran it.
                  params={{
                    environmentId: run.ranOn?.environmentId ?? environmentId,
                    threadId: run.threadId,
                  }}
                />
              }
            >
              <ArrowUpRightIcon />
            </Button>
          )}
          {expandable ? (
            <Button
              shape="pill"
              size="icon-xs"
              variant="ghost"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide" : "Show"} ${detail ?? "feedback"}`}
              onClick={() => setExpanded((open) => !open)}
            >
              <ChevronDownIcon
                className={cn("transition-transform duration-200", expanded && "rotate-180")}
              />
            </Button>
          ) : null}
        </div>
      </div>
      {(showBot && summary) ||
      (verdict && !expanded) ||
      run.error ||
      error ||
      (expanded && (detail || feedback)) ? (
        <div className={cn("flex min-w-0 flex-col gap-2", showBot ? "ps-9" : "ps-7")}>
          {showBot && summary ? (
            <p className="truncate text-xs text-muted-foreground">{summary}</p>
          ) : null}
          {verdict && !expanded ? (
            <p className="line-clamp-1 text-sm text-foreground/90">{verdict.summary}</p>
          ) : null}
          {run.error ? (
            <p className="text-sm text-destructive-foreground wrap-anywhere">{run.error}</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {error}
            </p>
          ) : null}
          {expanded && verdict ? (
            <BotFindings run={run} verdict={verdict} />
          ) : expanded && run.result ? (
            <RawReply run={run} />
          ) : null}
          {expanded && feedback ? (
            <BotRunFeedback environmentId={environmentId} run={run} canRate={canRate} />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

const FILTERS = ["all", "pass", "fail", "needs_attention"] as const;

/**
 * Narrows the run list to one verdict; runs without a verdict only show under All. A menu, so it
 * sits in the tab strip's toolbar instead of stacking a second row of tabs under it.
 */
export function VerdictFilter({
  value,
  onChange,
}: {
  readonly value: BotVerdictValue | null;
  readonly onChange: (value: BotVerdictValue | null) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={<Button shape="pill" size="xs" variant={value ? "secondary" : "ghost"} />}
      >
        <ListFilterIcon />
        {value ? BOT_VERDICT_STATES[value].label : "All verdicts"}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        <MenuRadioGroup
          value={value ?? "all"}
          onValueChange={(next) => {
            const filter = FILTERS.find((entry) => entry === next);
            if (filter) onChange(filter === "all" ? null : filter);
          }}
        >
          {FILTERS.map((filter) => (
            <MenuRadioItem key={filter} value={filter}>
              {filter === "all" ? "All verdicts" : BOT_VERDICT_STATES[filter].label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

export function BotRuns({
  environmentId,
  runs,
  showBot,
  canCancel,
  canRate,
  emptyMessage,
  emptyAction,
}: {
  readonly environmentId: EnvironmentId;
  readonly runs: ReadonlyArray<BotRun>;
  readonly showBot: boolean;
  readonly canCancel: boolean;
  /** Good and Bad mark runs for replays and suggested edits. */
  readonly canRate: boolean;
  readonly emptyMessage: string;
  readonly emptyAction?: ReactNode;
}) {
  if (runs.length === 0) {
    return <BotsEmptyList icon={PlayIcon} message={emptyMessage} action={emptyAction} />;
  }
  return (
    <ul className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}>
      {runs.map((run) => (
        <RunRow
          key={run.id}
          environmentId={environmentId}
          run={run}
          showBot={showBot}
          canCancel={canCancel}
          canRate={canRate}
        />
      ))}
    </ul>
  );
}

/** A list with nothing in it yet: a dashed outline the rows will fill, and the way to start. */
export function BotsEmptyList({
  icon: Icon,
  message,
  action,
}: {
  readonly icon: typeof PlayIcon;
  readonly message: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3">
      <span
        aria-hidden
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16"
      >
        <Icon className="size-4" />
      </span>
      <p className="min-w-0 flex-1 basis-48 text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

const SKELETON_ROWS = ["first", "second", "third", "fourth"];

/** Rows shaped like runs while the list loads, so the page keeps its height when they arrive. */
export function BotRowsSkeleton({ label = "Loading runs" }: { readonly label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}
    >
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton shape="card" className="size-6" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
          <Skeleton shape="pill" className="h-5 w-20" />
        </div>
      ))}
    </div>
  );
}

// STUB(bots-redesign): replaced by the owning area's implementation.
/** The Runs view: every run on the index, or one bot's on its page, in the scope the search names. */
export function RunsView(_props: { readonly bot: StubBot | null }) {
  return null;
}

/** A short list of runs whose rows open the run sheet, such as a bot's most recent runs. */
export function RunRows(_props: { readonly runs: readonly BotRun[]; readonly showBot: boolean }) {
  return null;
}
