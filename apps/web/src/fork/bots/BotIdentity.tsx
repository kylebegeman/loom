import type {
  BotDefinition,
  BotRunStatus,
  BotStarterState,
  BotStarterStatus,
  BotVerdictValue,
} from "@t3tools/contracts/fork";
import { BOT_RUN_STATES, BOT_VERDICT_STATES, botColor } from "@t3tools/client-runtime/fork";
import { BotIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LibraryStateBadge } from "../project-library/LibraryControls";
import { projectColorStyle } from "../project-library/ProjectIdentity";

const TILE_SIZES = {
  sm: "size-6 rounded-md",
  md: "size-8 rounded-lg",
  lg: "size-11 rounded-xl",
} as const;

const TILE_ICON_SIZES = { sm: "size-3.5", md: "size-4", lg: "size-5" } as const;

/**
 * A bot's mark: its stable color around the bot glyph. Scopes `--project-color` itself so a run
 * row in a mixed list wears its own bot's color. `status` rides on the corner, like a site's.
 */
export function BotTile({
  bot,
  size = "md",
  status,
}: {
  readonly bot: Pick<BotDefinition, "id">;
  readonly size?: keyof typeof TILE_SIZES;
  readonly status?: ReactNode;
}) {
  return (
    <span
      aria-hidden
      style={projectColorStyle(botColor(bot))}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16",
        TILE_SIZES[size],
      )}
    >
      <BotIcon className={TILE_ICON_SIZES[size]} />
      {status ? (
        <span className="absolute -end-0.5 -bottom-0.5 inline-flex rounded-full bg-background p-0.5">
          {status}
        </span>
      ) : null}
    </span>
  );
}

export function BotRunStatusBadge({ status }: { readonly status: BotRunStatus }) {
  const state = BOT_RUN_STATES[status];
  return <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>;
}

export function VerdictChip({ verdict }: { readonly verdict: BotVerdictValue }) {
  const state = BOT_VERDICT_STATES[verdict];
  return <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>;
}

const STARTER_LABELS: Record<Exclude<BotStarterState, "removed">, string> = {
  present: "Starter",
  edited: "Starter, edited",
  outdated: "Newer starter available",
};

export function starterLabel(status: BotStarterStatus | undefined) {
  return status === undefined || status.state === "removed" ? null : STARTER_LABELS[status.state];
}

export function StarterBadge({ status }: { readonly status: BotStarterStatus | undefined }) {
  const label = starterLabel(status);
  if (label === null || status === undefined) return null;
  return (
    <LibraryStateBadge tone={status.state === "outdated" ? "warning" : "neutral"}>
      {label}
    </LibraryStateBadge>
  );
}

const DAY_MS = 86_400_000;
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const SHORT_TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * When something happened or will happen, in the shortest form that still answers the question:
 * relative within a week, a date past that. Upcoming times (a trigger's next run) read forward.
 */
export function runTime(value: string | null, now = Date.now()) {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  const ahead = at - now;
  if (ahead > 60_000) {
    return ahead < DAY_MS
      ? `at ${SHORT_TIME.format(at)}`
      : `on ${SHORT_DATE.format(at)}, ${SHORT_TIME.format(at)}`;
  }
  return now - at < 7 * DAY_MS ? formatRelativeTimeLabel(value, now) : SHORT_DATE.format(at);
}

/** How long a run took, or has taken so far, in its two largest units. */
export function runDuration(startedAt: string | null, finishedAt: string | null, now = Date.now()) {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const end = finishedAt ? Date.parse(finishedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return formatSpan(end - start);
}

/** A span of time in its two largest units. */
export function formatSpan(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}
