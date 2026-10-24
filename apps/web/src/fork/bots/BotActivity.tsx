import { useState } from "react";
import { isTerminalBotRunStatus, type BotRun } from "@t3tools/contracts/fork";
import type { LibraryWorkflowTone } from "@t3tools/client-runtime/fork";
import { cn } from "~/lib/utils";
import { LibraryStateDot } from "../project-library/LibraryControls";
import { TickStrip } from "../project-library/LibraryData";
import { formatSpan, runDuration, runTime } from "./BotIdentity";
import { runOutcome } from "./runLog";

/** A run's outcome as one tone: its verdict once it has one, else where the run stands. */
export const runTone = (run: BotRun): LibraryWorkflowTone => runOutcome(run).tone;

/** Oldest first, so the strip reads left to right like time. Lists arrive newest first. */
export const chronological = (runs: readonly BotRun[], limit: number) =>
  runs.slice(0, limit).toReversed();

const LEGEND: readonly { tone: LibraryWorkflowTone; label: string }[] = [
  { tone: "success", label: "Passed" },
  { tone: "danger", label: "Failed" },
  { tone: "warning", label: "Needs attention" },
  { tone: "active", label: "Running" },
  { tone: "neutral", label: "Other" },
];

const ACTIVITY_SLOTS = 50;
const EMPTY_SLOTS = Array.from({ length: ACTIVITY_SLOTS }, (_, index) => `empty-${index}`);

const runReadout = (run: BotRun, now: number) =>
  [
    runOutcome(run).label,
    runTime(run.finishedAt ?? run.startedAt ?? run.createdAt, now),
    isTerminalBotRunStatus(run.status) ? runDuration(run.startedAt, run.finishedAt, now) : null,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * The last runs across every bot as one strip of ticks, the shape status pages use for uptime.
 * Pointing at a tick reads that run out in the header, so the strip doubles as a timeline; with
 * `onSelectRun` each tick also opens its run.
 */
export function ActivityStrip({
  runs,
  now,
  onSelectRun,
}: {
  readonly runs: readonly BotRun[];
  readonly now: number;
  readonly onSelectRun?: (run: BotRun) => void;
}) {
  const [focused, setFocused] = useState<number | null>(null);
  const ticks = chronological(runs, ACTIVITY_SLOTS);
  const padding = ACTIVITY_SLOTS - ticks.length;
  const counts = new Map<LibraryWorkflowTone, number>();
  for (const run of ticks) counts.set(runTone(run), (counts.get(runTone(run)) ?? 0) + 1);
  const current = focused === null ? null : (ticks[focused - padding] ?? null);
  const summary = LEGEND.map(
    ({ tone, label }) => `${counts.get(tone) ?? 0} ${label.toLowerCase()}`,
  ).join(", ");
  return (
    <section
      aria-label="Recent activity"
      className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <p
          aria-live="polite"
          className="min-w-0 truncate text-xs tabular-nums text-muted-foreground"
        >
          {current ? (
            <>
              <span className="font-medium text-foreground">{current.botName}</span>
              {` · ${runReadout(current, now)}`}
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">Last {ticks.length} runs</span>, oldest
              first
            </>
          )}
        </p>
        <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
          {LEGEND.filter(({ tone }) => tone !== "neutral" || counts.get(tone)).map(
            ({ tone, label }) => (
              <li
                key={tone}
                className={cn("flex items-center gap-1.5", !counts.get(tone) && "opacity-60")}
              >
                <LibraryStateDot tone={tone} className="size-1.5" />
                {label}
                <span className="font-medium tabular-nums text-foreground">
                  {counts.get(tone) ?? 0}
                </span>
              </li>
            ),
          )}
        </ul>
      </div>
      <TickStrip
        size="fill"
        label={`Last ${ticks.length} runs: ${summary}`}
        ticks={[
          ...EMPTY_SLOTS.slice(0, padding).map((key) => ({ key, tone: null })),
          ...ticks.map((run) => ({
            key: run.id,
            tone: runTone(run),
            label: `${run.botName}, ${runReadout(run, now)}`,
          })),
        ]}
        focused={focused}
        onFocusTick={setFocused}
        {...(onSelectRun
          ? {
              onSelectTick: (index: number) => {
                const run = ticks[index - padding];
                if (run) onSelectRun(run);
              },
            }
          : {})}
      />
    </section>
  );
}

/** A bot's recent record in figures: how often it passes, how long it takes. */
export function botRecord(runs: readonly BotRun[]) {
  const finished = runs.filter((run) => isTerminalBotRunStatus(run.status));
  const passed = finished.filter((run) => runTone(run) === "success").length;
  const spans = finished
    .flatMap((run) => {
      if (!run.startedAt || !run.finishedAt) return [];
      const span = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
      return Number.isFinite(span) ? [span] : [];
    })
    .toSorted((left, right) => left - right);
  const median = spans.length ? spans[Math.floor(spans.length / 2)]! : null;
  return {
    finished: finished.length,
    passed,
    typical: median === null ? null : formatSpan(median),
  };
}
