import type { UsageSummaryInput } from "@t3tools/contracts";
import type {
  BotBudgetState,
  BotRun,
  BotSyncResult,
  BotTargetReadiness,
  BotUsageRow,
  BotsUsageResult,
} from "@t3tools/contracts/fork";
import {
  type BotsUsageWindow,
  type LibraryWorkflowTone,
  rollingBotsUsageWindow,
} from "@t3tools/client-runtime/fork";
import { formatCount, formatTokens } from "@t3tools/shared/usageFormat";

/** How far `timeZone`'s wall clock is ahead of UTC at `ms`. */
const zoneOffsetMs = (ms: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - Math.floor(ms / 1000) * 1000;
};

/** Midnight starting `day` (YYYY-MM-DD, plus `addDays`) in `timeZone`, as epoch milliseconds. */
const midnightIn = (day: string, timeZone: string, addDays = 0) => {
  const [year = 1970, month = 1, dayOfMonth = 1] = day.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, dayOfMonth + addDays);
  // A second pass settles days whose midnight is on the other side of a DST change.
  const first = wall - zoneOffsetMs(wall, timeZone);
  return wall - zoneOffsetMs(first, timeZone);
};

/**
 * The Usage page's window as instants: its hours as they are, or its calendar days from the first
 * day's midnight to the midnight after the last, in the page's time zone.
 */
export const usagePageWindow = (window: UsageSummaryInput): BotsUsageWindow => {
  if (
    window.resolution === "hour" &&
    window.sinceTime !== undefined &&
    window.untilTime !== undefined
  )
    return { since: window.sinceTime, until: window.untilTime };
  return {
    since: new Date(midnightIn(window.sinceDay, window.timeZone)).toISOString(),
    until: new Date(midnightIn(window.untilDay, window.timeZone, 1)).toISOString(),
  };
};

/** The usage windows the Bots page offers, in days back from now, shortest first. */
export const BOT_USAGE_DAYS = [1, 7, 30, 90] as const;
export type BotUsageDays = (typeof BOT_USAGE_DAYS)[number];

/** Labels match the Usage page's own window choices, so the two pages read alike. */
const WINDOW_TEXT: Record<
  BotUsageDays,
  { readonly label: string; readonly short: string; readonly phrase: string }
> = {
  1: { label: "Past 24h", short: "24h", phrase: "in 24 hours" },
  7: { label: "7 days", short: "7d", phrase: "in 7 days" },
  30: { label: "30 days", short: "30d", phrase: "in 30 days" },
  90: { label: "90 days", short: "90d", phrase: "in 90 days" },
};

export const DEFAULT_BOT_USAGE_DAYS: BotUsageDays = 7;

/** The window as a menu offers it, such as "7 days". */
export const usageWindowLabel = (days: BotUsageDays) => WINDOW_TEXT[days].label;
/** The window where a label has a few characters to spare, such as "Runs · 7d". */
export const usageWindowShort = (days: BotUsageDays) => WINDOW_TEXT[days].short;
/** The window inside a sentence, such as "No runs in 7 days". */
export const usageWindowPhrase = (days: BotUsageDays) => WINDOW_TEXT[days].phrase;

/** One refetch at most this often while runs keep finishing. */
export const USAGE_REFETCH_INTERVAL_MS = 5_000;

/**
 * The window ending now, or `current` itself while the minute has not turned, so a refresh in the
 * same minute refetches the one query instead of starting another.
 */
export function advanceUsageWindow(
  current: BotsUsageWindow,
  days: number,
  nowMs: number,
): BotsUsageWindow {
  const next = rollingBotsUsageWindow(days, nowMs);
  return next.since === current.since && next.until === current.until ? current : next;
}

/**
 * Moves whenever a watched run finishes. The count alone can stand still when the watch drops an
 * old finished run as a new one finishes, so the latest finish rides along.
 */
export function finishedRunsSignature(runs: Iterable<Pick<BotRun, "finishedAt">>): string {
  let count = 0;
  let latest = "";
  for (const run of runs) {
    if (run.finishedAt === null) continue;
    count += 1;
    if (run.finishedAt > latest) latest = run.finishedAt;
  }
  return `${count}:${latest}`;
}

/** What one window's last fetch already counted, shared by every view showing that window. */
export interface UsageFetchLedger {
  readonly until: string;
  readonly signature: string;
  readonly fetchedAt: number;
}

export type UsageRefetchPlan =
  /** The window is new; its first fetch already counts every run finished so far. */
  | { readonly kind: "adopt" }
  | { readonly kind: "none" }
  | { readonly kind: "now" }
  | { readonly kind: "wait"; readonly ms: number };

/** Whether finished runs call for a refetch, at most once per interval. */
export function planUsageRefetch(
  ledger: UsageFetchLedger | undefined,
  until: string,
  signature: string,
  nowMs: number,
  intervalMs = USAGE_REFETCH_INTERVAL_MS,
): UsageRefetchPlan {
  if (ledger === undefined || ledger.until !== until) return { kind: "adopt" };
  if (ledger.signature === signature) return { kind: "none" };
  const wait = ledger.fetchedAt + intervalMs - nowMs;
  return wait <= 0 ? { kind: "now" } : { kind: "wait", ms: wait };
}

/** The soonest moment a limited bot may run again, so its "at limit" state can clear itself. */
export function nextBudgetRetryMs(
  budgets: Readonly<Record<string, BotBudgetState>>,
  nowMs: number,
): number | null {
  let soonest: number | null = null;
  for (const state of Object.values(budgets)) {
    if (state.retryAt === undefined) continue;
    const at = Date.parse(state.retryAt);
    if (!Number.isFinite(at) || at <= nowMs) continue;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest;
}

/** A bot that did not run in the window, so every bot reads the same once usage has arrived. */
export function emptyUsageRow(botId: BotUsageRow["botId"]): BotUsageRow {
  return {
    botId,
    botName: "",
    runs: 0,
    completed: 0,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    pass: 0,
    fail: 0,
    needsAttention: 0,
    successRate: null,
    medianDurationMs: null,
    maxDurationMs: null,
    tokens: { input: 0, cachedInput: 0, output: 0, total: 0 },
    usageComplete: true,
    byModel: [],
  };
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${formatCount(count)} ${count === 1 ? one : many}`;

/** "at least 3.2M tokens" while some run reported only part of its usage. */
export const tokensText = (total: number, complete: boolean) =>
  `${complete ? "" : "at least "}${formatTokens(total)} tokens`;

/** The index header's clause, such as "142 runs in 7 days · at least 3.2M tokens". */
export function usageClauseText(totals: BotsUsageResult["totals"], days: BotUsageDays): string {
  const phrase = usageWindowPhrase(days);
  if (totals.runs === 0) return `No runs ${phrase}`;
  return [
    `${plural(totals.runs, "run")} ${phrase}`,
    totals.tokens.total > 0 ? tokensText(totals.tokens.total, totals.usageComplete) : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** The pass rate for a bot that gives verdicts, the completed share for the rest. */
export function usageRate(
  row: Pick<BotUsageRow, "successRate" | "pass" | "fail" | "needsAttention">,
): { readonly label: "Pass rate" | "Completed"; readonly share: number } | null {
  if (row.successRate === null) return null;
  return {
    label: row.pass + row.fail + row.needsAttention > 0 ? "Pass rate" : "Completed",
    share: row.successRate,
  };
}

/** A row's outcomes, leaving out the ones that did not happen. */
export function outcomeText(
  row: Pick<BotUsageRow, "completed" | "failed" | "timedOut" | "cancelled">,
): string {
  const parts = [
    row.completed ? `${formatCount(row.completed)} completed` : null,
    row.failed ? `${formatCount(row.failed)} failed` : null,
    row.timedOut ? `${formatCount(row.timedOut)} timed out` : null,
    row.cancelled ? `${formatCount(row.cancelled)} cancelled` : null,
  ].filter((part) => part !== null);
  return parts.length ? parts.join(" · ") : "None finished";
}

export function verdictText(row: Pick<BotUsageRow, "pass" | "fail" | "needsAttention">) {
  const parts = [
    row.pass ? `${formatCount(row.pass)} pass` : null,
    row.fail ? `${formatCount(row.fail)} fail` : null,
    row.needsAttention ? `${formatCount(row.needsAttention)} need attention` : null,
  ].filter((part) => part !== null);
  return parts.length ? parts.join(" · ") : null;
}

/** The largest token total among rows, the scale every bar in a column shares. */
export const busiestTokens = (rows: Iterable<Pick<BotUsageRow, "tokens">>) => {
  let max = 0;
  for (const row of rows) if (row.tokens.total > max) max = row.tokens.total;
  return max;
};

/** Below this, a bar for a bot that did use tokens would vanish, reading as none at all. */
const MIN_VISIBLE_SHARE = 0.02;

/** A row's share of the scale, from 0 to 1. Any use at all stays visible. */
export function tokenShare(tokens: number, max: number): number {
  if (tokens <= 0 || max <= 0) return 0;
  return Math.min(1, Math.max(MIN_VISIBLE_SHARE, tokens / max));
}

/** Near a limit from this share of it, as on mobile. */
export const BUDGET_WARN_SHARE = 0.8;

export type BotBudgetLevel = "blocked" | "near" | "ok";

/**
 * Where a bot stands against its rolling 24-hour limits. Limits are checked independently and
 * either one blocks, so the tighter one speaks for the bot.
 */
export function budgetStatus(state: BotBudgetState): {
  readonly level: BotBudgetLevel;
  /** The tighter limit, or null for a budget with no limits set. */
  readonly limit: "runs" | "tokens" | null;
  readonly share: number;
} {
  const runs =
    state.runsPerDay === undefined || state.runsPerDay <= 0
      ? null
      : state.runsInWindow / state.runsPerDay;
  const tokens =
    state.tokensPerDay === undefined || state.tokensPerDay <= 0
      ? null
      : state.tokensInWindow / state.tokensPerDay;
  const tighter: { limit: "runs" | "tokens" | null; share: number } =
    runs !== null && (tokens === null || runs >= tokens)
      ? { limit: "runs", share: runs }
      : tokens !== null
        ? { limit: "tokens", share: tokens }
        : { limit: null, share: 0 };
  const { limit, share } = tighter;
  const level =
    state.retryAt !== undefined || share >= 1
      ? "blocked"
      : share >= BUDGET_WARN_SHARE
        ? "near"
        : "ok";
  return { level, limit, share };
}

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "38 of 50 runs in the last 24 hours", and when the next run may start once a limit is reached. */
export function budgetMeterText(state: BotBudgetState, formatTime = clockTime): string {
  const parts = [
    ...(state.runsPerDay === undefined
      ? []
      : [`${formatCount(state.runsInWindow)} of ${plural(state.runsPerDay, "run")}`]),
    ...(state.tokensPerDay === undefined
      ? []
      : [`${formatTokens(state.tokensInWindow)} of ${formatTokens(state.tokensPerDay)} tokens`]),
  ];
  const used = parts.length
    ? `${parts.join(" and ")} in the last 24 hours.`
    : "No limit is set for the last 24 hours.";
  if (state.retryAt === undefined) return used;
  return `${used} The next run is possible at ${formatTime(state.retryAt)}.`;
}

/** One limit's use, such as "38 of 50 runs" or "1.2M of 2M tokens". */
export function budgetUseText(state: BotBudgetState, limit: "runs" | "tokens"): string {
  return limit === "runs"
    ? `${formatCount(state.runsInWindow)} of ${plural(state.runsPerDay ?? 0, "run")}`
    : `${formatTokens(state.tokensInWindow)} of ${formatTokens(state.tokensPerDay ?? 0)} tokens`;
}

/** A meter's short caption: the tighter limit's use, or when the bot may run again. */
export function budgetCaption(state: BotBudgetState, formatTime = clockTime): string {
  const status = budgetStatus(state);
  if (status.level === "blocked")
    return state.retryAt === undefined ? "At limit" : `At limit until ${formatTime(state.retryAt)}`;
  const use = status.limit === null ? "No limit" : budgetUseText(state, status.limit);
  return status.level === "near" ? `${use}, near limit` : use;
}

/** How many budgeted bots are at or near their limits. */
export function budgetAlerts(budgets: Readonly<Record<string, BotBudgetState>>) {
  let blocked = 0;
  let near = 0;
  for (const state of Object.values(budgets)) {
    const { level } = budgetStatus(state);
    if (level === "blocked") blocked += 1;
    else if (level === "near") near += 1;
  }
  return { blocked, near };
}

/** The header's warning, or null when every bot has room. */
export function budgetAlertText({ blocked, near }: { blocked: number; near: number }) {
  if (blocked && near) return `${formatCount(blocked + near)} bots at or near their daily limit`;
  if (blocked)
    return blocked === 1
      ? "1 bot at its daily limit"
      : `${formatCount(blocked)} bots at their daily limit`;
  if (near)
    return near === 1
      ? "1 bot near its daily limit"
      : `${formatCount(near)} bots near their daily limit`;
  return null;
}

/** Reasons arrive as fragments or sentences; each reads as a sentence once joined. */
export const reasonsText = (reasons: readonly string[]) =>
  reasons
    .map((reason) => reason.trim())
    .filter((reason) => reason.length > 0)
    .map((reason) => (/[.!?]$/.test(reason) ? reason : `${reason}.`))
    .join(" ");

/**
 * One computer's readiness to run a bot, as a word and a tone. Older servers send no
 * availability, so readiness falls back to what they do send.
 */
export function targetAvailability(
  target: Pick<BotTargetReadiness, "ready" | "online" | "freeSlots" | "availability">,
): { readonly tone: LibraryWorkflowTone; readonly label: string } {
  const availability =
    target.availability ?? (target.ready ? "ready" : target.online ? "blocked" : "offline");
  switch (availability) {
    case "ready":
      return {
        tone: "success",
        label: `Ready · ${plural(target.freeSlots, "free slot")}`,
      };
    case "busy":
      return { tone: "warning", label: "Busy" };
    case "offline":
      return { tone: "neutral", label: "Offline" };
    case "blocked":
      return { tone: "warning", label: "Not ready" };
    case "unknown":
      return { tone: "neutral", label: "Not verified" };
  }
}

/** The why behind a computer's readiness, for a tooltip or hint. */
export function targetDetail(
  target: Pick<BotTargetReadiness, "reasons" | "reportedAt">,
  reported: (iso: string) => string,
): string | null {
  const parts = [
    reasonsText(target.reasons) || null,
    target.reportedAt ? `Reported ${reported(target.reportedAt)}.` : null,
  ].filter((part) => part !== null);
  return parts.length ? parts.join(" ") : null;
}

/** Runs that crossed computers, newest first: sent to another computer or sent here by one. */
export const remoteRuns = <R extends Pick<BotRun, "ranOn" | "requestedBy">>(
  runs: readonly R[],
  limit: number,
): R[] => runs.filter((run) => run.ranOn != null || run.requestedBy != null).slice(0, limit);

/** A sync's outcome in one sentence; refused bots are listed on their own. */
export const syncSummary = (result: Pick<BotSyncResult, "pulled">) =>
  result.pulled === 0
    ? "Every shared bot is up to date."
    : `Brought in ${plural(result.pulled, "shared bot")}.`;

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
};

/** A computer's operating system as people name it, such as "macOS" for `darwin`. */
export const platformName = (os: string) => PLATFORM_NAMES[os.toLowerCase()] ?? os;
