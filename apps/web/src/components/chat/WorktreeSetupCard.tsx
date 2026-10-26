import {
  worktreeSetupStageLabel,
  type WorktreeSetupSnapshot,
  type WorktreeSetupStage,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleIcon,
  LaptopIcon,
  MinusIcon,
  RotateCcwIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { ChevronDown, ChevronRight } from "lucide";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { MorphIcon } from "~/components/MorphIcon";
import { Spinner } from "~/components/ui/spinner";
import { MiddleTruncate } from "../ui/middle-truncate";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";
import { WorkLogRow } from "./WorkLog";

interface WorktreeSetupCardProps {
  snapshot: WorktreeSetupSnapshot;
  onCancel: (() => void) | null;
  onWorkLocally: (() => void) | null;
  onOpenTerminal: (() => void) | null;
  /** fork: library-launch-files: the computer filling a Library conversation's project files. */
  computerLabel?: string | null;
  onRetry?: (() => void) | null;
}

const isProjectFiles = (snapshot: WorktreeSetupSnapshot) => snapshot.kind === "project-files";

function stageElapsedMs(stage: WorktreeSetupStage, nowMs: number): number | null {
  if (!stage.startedAt) return null;
  const start = Date.parse(stage.startedAt);
  const end = stage.endedAt ? Date.parse(stage.endedAt) : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function useNowWhile(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active]);
  return nowMs;
}

function StageIcon({ status }: { status: WorktreeSetupStage["status"] }) {
  const className = "size-4 shrink-0 stroke-2";
  switch (status) {
    case "done":
      return <CheckIcon aria-hidden className={className} />;
    case "running":
      return <Spinner size="md" className="shrink-0" />;
    case "failed":
      return <XIcon aria-hidden className={className} />;
    case "warning":
      return <CircleAlertIcon aria-hidden className={className} />;
    case "skipped":
      return <MinusIcon aria-hidden className={className} />;
    case "pending":
      return <CircleIcon aria-hidden className={className} />;
  }
}

function stageRowClassName(status: WorktreeSetupStage["status"]): string {
  switch (status) {
    case "failed":
      return "text-destructive-foreground";
    case "warning":
      return "text-warning-foreground";
    case "pending":
      return "text-secondary-label opacity-40";
    case "running":
    case "skipped":
    case "done":
      return "text-secondary-label";
  }
}

function ShimmerOverlay({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="live-activity-focus pointer-events-none absolute inset-y-0 select-none"
    >
      <span className="live-activity-focus-counter block">
        <span className="live-activity-focus-aligned block text-foreground">{children}</span>
      </span>
    </span>
  );
}

function headerLabel(snapshot: WorktreeSetupSnapshot, computerLabel: string | null): string {
  if (isProjectFiles(snapshot)) {
    const computer = computerLabel ?? "this computer";
    switch (snapshot.phase) {
      case "running":
        return `Preparing files on ${computer}…`;
      case "done":
        return "Project files ready";
      case "failed":
        return `Couldn't prepare files on ${computer}`;
      case "cancelled":
        return "File preparation cancelled";
    }
  }
  switch (snapshot.phase) {
    case "running":
      return "Preparing workspace…";
    case "done":
      return snapshot.stages.some((stage) => stage.status === "failed")
        ? "Workspace ready, setup script failed"
        : "Workspace ready";
    case "failed":
      return "Workspace setup failed";
    case "cancelled":
      return "Workspace setup cancelled";
  }
}

function SetupHeaderRow({
  snapshot,
  totalElapsed,
  computerLabel,
}: {
  snapshot: WorktreeSetupSnapshot;
  totalElapsed: number | null;
  computerLabel: string | null;
}) {
  const running = snapshot.phase === "running";
  const failed = snapshot.phase === "failed";
  const finishedWithFailedStage =
    snapshot.phase === "done" && snapshot.stages.some((stage) => stage.status === "failed");
  const text = headerLabel(snapshot, computerLabel);
  const tone = failed
    ? "text-destructive-foreground"
    : finishedWithFailedStage
      ? "text-warning-foreground"
      : "text-muted-foreground";
  return (
    <div className="border-b border-border/60 pb-2 pt-1">
      <div
        className={cn(
          "flex h-6 min-w-0 items-baseline gap-2 px-1 text-sm leading-relaxed tabular-nums",
          tone,
        )}
      >
        <span
          ref={running ? observeVisibleAnimation : undefined}
          className="relative min-w-0 shrink overflow-hidden whitespace-nowrap"
        >
          <span className="block truncate">{text}</span>
          {running ? <ShimmerOverlay>{text}</ShimmerOverlay> : null}
        </span>
        {totalElapsed !== null ? (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {formatDuration(totalElapsed)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StageRow({
  stage,
  nowMs,
  scriptName,
  projectFiles,
}: {
  stage: WorktreeSetupStage;
  nowMs: number;
  scriptName: string | null;
  projectFiles: boolean;
}) {
  const elapsed = stageElapsedMs(stage, nowMs);
  const label =
    stage.id === "setup-script" && scriptName
      ? scriptName
      : projectFiles && stage.id === "fetch"
        ? "Download files"
        : worktreeSetupStageLabel(stage.id);
  const running = stage.status === "running";
  const trailing =
    stage.status === "pending"
      ? null
      : stage.status === "skipped"
        ? (stage.detail ?? "skipped")
        : (stage.id === "checkout" || (projectFiles && stage.id === "fetch")) &&
            running &&
            stage.percent !== null
          ? `${stage.percent}%`
          : stage.detail;
  return (
    <WorkLogRow
      data-worktree-setup-stage={stage.id}
      data-worktree-setup-status={stage.status}
      icon={
        <span className={cn("text-icon-muted", stage.status === "pending" && "opacity-40")}>
          <StageIcon status={stage.status} />
        </span>
      }
      label={
        <span
          ref={running ? observeVisibleAnimation : undefined}
          className={cn("relative block truncate", stageRowClassName(stage.status))}
        >
          {label}
          {running ? <ShimmerOverlay>{label}</ShimmerOverlay> : null}
        </span>
      }
      trailing={
        <>
          {trailing ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
              {trailing}
            </span>
          ) : null}
          {elapsed !== null && stage.status !== "skipped" && stage.status !== "pending" ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatDuration(elapsed)}
            </span>
          ) : null}
        </>
      }
    />
  );
}

const OUTPUT_TAIL_LINES = 4;
const OUTPUT_TAIL_SLOTS = Array.from({ length: OUTPUT_TAIL_LINES }, (_, slot) => slot);

function OutputTail({ lines, failed }: { lines: ReadonlyArray<string>; failed: boolean }) {
  const rows = OUTPUT_TAIL_SLOTS.map((slot) => ({
    slot,
    line: lines[lines.length - OUTPUT_TAIL_LINES + slot] ?? "",
  }));
  return (
    <pre
      className={cn(
        "mb-1 ml-8 overflow-hidden rounded-md border px-2.5 py-1.5 font-mono text-2xs leading-relaxed select-text",
        failed
          ? "border-destructive/20 bg-error-surface text-destructive-foreground"
          : "border-border bg-code text-muted-foreground",
      )}
    >
      {rows.map(({ slot, line }) => (
        <div key={slot} className="truncate whitespace-pre">
          {line.length === 0 ? "\u00a0" : line}
        </div>
      ))}
    </pre>
  );
}

function SetupDetails({ snapshot }: { snapshot: WorktreeSetupSnapshot }) {
  return (
    <dl className="mt-1 mb-1.5 ml-8 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {snapshot.branch ? (
        <>
          <dt className="text-foreground/80">Branch</dt>
          <dd className="min-w-0 font-mono">
            <MiddleTruncate value={snapshot.branch} className="flex" />
          </dd>
        </>
      ) : null}
      {snapshot.baseRef ? (
        <>
          <dt className="text-foreground/80">Base</dt>
          <dd className="min-w-0 font-mono">
            <MiddleTruncate value={snapshot.baseRef} className="flex" />
          </dd>
        </>
      ) : null}
      {snapshot.worktreePath ? (
        <>
          <dt className="text-foreground/80">Path</dt>
          <dd className="min-w-0 font-mono">
            <MiddleTruncate value={snapshot.worktreePath} className="flex" />
          </dd>
        </>
      ) : null}
      {snapshot.setupScript ? (
        <>
          <dt className="text-foreground/80">Setup</dt>
          <dd className="truncate font-mono">{snapshot.setupScript.command}</dd>
        </>
      ) : null}
    </dl>
  );
}

function CollapsedSummaryRow({
  snapshot,
  totalElapsed,
  computerLabel,
}: {
  snapshot: WorktreeSetupSnapshot;
  totalElapsed: number | null;
  computerLabel: string | null;
}) {
  const status: WorktreeSetupStage["status"] =
    snapshot.phase === "failed" || snapshot.phase === "cancelled"
      ? "failed"
      : snapshot.stages.some((stage) => stage.id === "setup-script" && stage.status === "failed")
        ? "failed"
        : "done";
  const label = headerLabel(snapshot, computerLabel);
  return (
    <WorkLogRow
      data-worktree-setup-stage="summary"
      data-worktree-setup-status={status}
      icon={
        <span className="text-icon-muted">
          <StageIcon status={status} />
        </span>
      }
      label={<span className={stageRowClassName(status)}>{label}</span>}
      trailing={
        totalElapsed !== null ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatDuration(totalElapsed)}
          </span>
        ) : null
      }
    />
  );
}

export function WorktreeSetupCard({
  snapshot,
  onCancel,
  onWorkLocally,
  onOpenTerminal,
  computerLabel = null,
  onRetry = null,
  embedded = false,
}: WorktreeSetupCardProps & {
  embedded?: boolean;
}) {
  const running = snapshot.phase === "running";
  const nowMs = useNowWhile(running);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const totalElapsed = (() => {
    const start = Date.parse(snapshot.startedAt);
    const end = snapshot.endedAt ? Date.parse(snapshot.endedAt) : nowMs;
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
  })();
  const setupStage = snapshot.stages.find((stage) => stage.id === "setup-script");
  const showTerminal = onOpenTerminal && setupStage && setupStage.status !== "pending";
  const collapsed = embedded && !running;
  const projectFiles = isProjectFiles(snapshot);
  // Project files own no working row while they download, so their card names itself.
  const showHeader = !embedded && (projectFiles || (!running && snapshot.phase !== "done"));
  const failed = snapshot.phase === "failed";
  const showTail =
    setupStage !== undefined &&
    (setupStage.status === "failed" ||
      (setupStage.status === "running" && setupStage.tail.length > 0));

  return (
    <section aria-label="Workspace setup" data-worktree-setup-phase={snapshot.phase}>
      {showHeader ? (
        <SetupHeaderRow
          snapshot={snapshot}
          totalElapsed={totalElapsed}
          computerLabel={computerLabel}
        />
      ) : null}
      {collapsed ? (
        <CollapsedSummaryRow
          snapshot={snapshot}
          totalElapsed={totalElapsed}
          computerLabel={computerLabel}
        />
      ) : (
        <div className={showHeader ? "pt-1.5" : undefined}>
          {snapshot.stages.map((stage) => (
            <div key={stage.id}>
              <StageRow
                stage={stage}
                nowMs={nowMs}
                scriptName={snapshot.setupScript?.name ?? null}
                projectFiles={projectFiles}
              />
              {stage.id === "setup-script" && showTail ? (
                <OutputTail lines={stage.tail} failed={stage.status === "failed"} />
              ) : null}
            </div>
          ))}
        </div>
      )}

      {failed && snapshot.error ? (
        <p className="mt-1 ml-8 text-xs text-muted-foreground">{snapshot.error}</p>
      ) : null}

      <div className="mt-0.5 ml-[calc(--spacing(6)+2px-(--spacing(2)-1px))] flex flex-wrap items-center gap-0.5">
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <MorphIcon aria-hidden icon={detailsOpen ? ChevronDown : ChevronRight} />
          Details
        </Button>
        {showTerminal ? (
          <Button type="button" size="xs" variant="ghost-muted" onClick={onOpenTerminal}>
            <TerminalIcon aria-hidden />
            Open terminal
          </Button>
        ) : null}
        {onWorkLocally ? (
          <Button type="button" size="xs" variant="ghost-muted" onClick={onWorkLocally}>
            <LaptopIcon aria-hidden />
            Work locally
          </Button>
        ) : null}
        {onRetry && projectFiles && failed ? (
          <Button type="button" size="xs" variant="ghost-muted" onClick={onRetry}>
            <RotateCcwIcon aria-hidden />
            Retry
          </Button>
        ) : null}
        {onCancel && (running || (projectFiles && failed)) ? (
          <Button type="button" size="xs" variant="ghost-muted" onClick={onCancel}>
            <XIcon aria-hidden />
            Cancel
          </Button>
        ) : null}
      </div>
      {detailsOpen ? <SetupDetails snapshot={snapshot} /> : null}
    </section>
  );
}
