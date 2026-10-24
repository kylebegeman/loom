import {
  BOT_RUN_STATES,
  BOT_VERDICT_STATES,
  applyRunChanges,
  type BotsChanges,
  type LibraryWorkflowTone,
} from "@t3tools/client-runtime/fork";
import {
  BOTS_LIST_RUNS_MAX_LIMIT,
  isTerminalBotRunStatus,
  type BotRun,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";

export type RunsScope = "all" | "attention" | "dismissed" | "batches";

/**
 * A scope the server cannot serve, such as an old link to Batches, opens every run instead. Needs
 * you always opens: runs waiting on an answer come from this client's threads, so a server
 * without the inbox still has those to show.
 */
export function resolveRunsScope(
  scope: RunsScope | undefined,
  host: { readonly inboxSupported: boolean; readonly batchesSupported: boolean },
): RunsScope {
  switch (scope) {
    case "attention":
      return scope;
    case "dismissed":
      return host.inboxSupported ? scope : "all";
    case "batches":
      return host.batchesSupported ? scope : "all";
    default:
      return "all";
  }
}

/**
 * The first page of runs. Without a verdict this is the exact input the shell uses for a bot's
 * vitals and the collection's ticks, key order included, so both read one cached request.
 */
export const runsListInput = (filters: {
  readonly botId?: string | undefined;
  readonly verdict?: BotVerdictValue | undefined;
}) => ({
  limit: BOTS_LIST_RUNS_MAX_LIMIT,
  ...(filters.botId === undefined ? {} : { botId: filters.botId }),
  ...(filters.verdict === undefined ? {} : { verdict: filters.verdict }),
});

/**
 * Older pages loaded under the first one. `base` names the first page they continue, so a refetched
 * or refiltered first page starts over rather than leaving a gap between it and the older pages.
 */
export interface RunPages {
  readonly base: string;
  /** Older pages already settled, newest first. */
  readonly loaded: readonly BotRun[];
  /** Where the page being shown now starts; null while only the first page is shown. */
  readonly cursor: string | null;
}

export const runPagesFor = (pages: RunPages, base: string): RunPages =>
  pages.base === base ? pages : { base, loaded: [], cursor: null };

const oldestCreatedAt = (runs: readonly BotRun[]) =>
  runs.reduce<string | undefined>(
    (oldest, run) => (oldest === undefined || run.createdAt < oldest ? run.createdAt : oldest),
    undefined,
  );

/** Asks for the page before `page`, the newest page shown so far, and keeps `page` once it is older. */
export function loadOlderRuns(pages: RunPages, page: readonly BotRun[]): RunPages {
  const cursor = oldestCreatedAt(page);
  if (cursor === undefined) return pages;
  return {
    base: pages.base,
    loaded: pages.cursor === null ? pages.loaded : [...pages.loaded, ...page],
    cursor,
  };
}

/** Every listed run so far, newest first, each once. */
export function pagedRuns(
  first: readonly BotRun[],
  pages: RunPages,
  current: readonly BotRun[] | null,
): readonly BotRun[] {
  const byId = new Map<string, BotRun>();
  for (const run of [...first, ...pages.loaded, ...(pages.cursor === null ? [] : (current ?? []))])
    if (!byId.has(run.id)) byId.set(run.id, run);
  return [...byId.values()];
}

/**
 * Listed runs with watched changes applied. New runs join; while older pages remain unloaded, a
 * watched run older than the oldest listed one stays out, so a rating on an old run does not pull
 * it into the middle of the log.
 */
export function runLogRuns(
  listed: readonly BotRun[],
  changes: BotsChanges,
  options: {
    readonly botId?: string | undefined;
    readonly verdict?: BotVerdictValue | undefined;
    readonly complete: boolean;
  },
): readonly BotRun[] {
  const merged = applyRunChanges(listed, changes, {
    botId: options.botId,
    verdict: options.verdict,
    includeNew: true,
  });
  const floor = options.complete ? undefined : oldestCreatedAt(listed);
  return floor === undefined ? merged : merged.filter((run) => run.createdAt >= floor);
}

export interface RunDay {
  readonly key: string;
  readonly label: string;
  readonly runs: readonly BotRun[];
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The local calendar day of an instant, as `YYYY-MM-DD`. */
export const localDayKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const DAY_LABEL = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const DAY_LABEL_WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function dayLabel(at: number, now: number) {
  const key = localDayKey(at);
  if (key === localDayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === localDayKey(yesterday.getTime())) return "Yesterday";
  return new Date(at).getFullYear() === new Date(now).getFullYear()
    ? DAY_LABEL.format(at)
    : DAY_LABEL_WITH_YEAR.format(at);
}

/**
 * The log's shape: runs still going first, then finished runs by the local day they started on,
 * newest day first. Runs keep the order they arrive in, which is newest first.
 */
export function groupRunsByDay(
  runs: readonly BotRun[],
  now: number,
): { readonly active: readonly BotRun[]; readonly days: readonly RunDay[] } {
  const active: BotRun[] = [];
  const days = new Map<string, { at: number; runs: BotRun[] }>();
  for (const run of runs) {
    if (!isTerminalBotRunStatus(run.status)) {
      active.push(run);
      continue;
    }
    const at = Date.parse(run.createdAt);
    if (!Number.isFinite(at)) continue;
    const key = localDayKey(at);
    const day = days.get(key);
    if (day) day.runs.push(run);
    else days.set(key, { at, runs: [run] });
  }
  return {
    active,
    days: [...days]
      .toSorted(([left], [right]) => right.localeCompare(left))
      .map(([key, day]) => ({ key, label: dayLabel(day.at, now), runs: day.runs })),
  };
}

/**
 * How a run's outcome shows. Exceptions and work in flight get a pill; a pass or a plain finish is
 * text beside a dot, so a column of passes stays quiet and a failure stands out.
 */
export interface RunOutcome {
  readonly label: string;
  readonly tone: LibraryWorkflowTone;
  readonly emphasis: "pill" | "plain" | "quiet";
}

export function runOutcome(run: BotRun): RunOutcome {
  if (run.status === "completed" && run.verdict) {
    const state = BOT_VERDICT_STATES[run.verdict.verdict];
    return { ...state, emphasis: run.verdict.verdict === "pass" ? "plain" : "pill" };
  }
  const state = BOT_RUN_STATES[run.status];
  switch (run.status) {
    case "completed":
      return { ...state, emphasis: "plain" };
    case "cancelled":
      return { ...state, emphasis: "quiet" };
    default:
      return { ...state, emphasis: "pill" };
  }
}

export type RunOriginKind =
  | "batch"
  | "pipeline"
  | "replay"
  | "trigger"
  | "retry"
  | "agent"
  | "person";

const ORIGIN_LABELS: Record<RunOriginKind, string> = {
  batch: "Batch",
  pipeline: "Pipeline",
  replay: "Replay",
  trigger: "Trigger",
  retry: "Retry",
  agent: "Agent",
  person: "You",
};

/** What started a run, most specific first: a batch run started by a person is a batch run. */
export function runOrigin(run: BotRun): { readonly kind: RunOriginKind; readonly label: string } {
  const kind: RunOriginKind =
    run.batchId != null
      ? "batch"
      : run.pipelineRunId != null
        ? "pipeline"
        : run.replayId != null
          ? "replay"
          : run.triggerId != null
            ? "trigger"
            : run.retryOf != null
              ? "retry"
              : run.startedBy === "agent"
                ? "agent"
                : "person";
  return { kind, label: ORIGIN_LABELS[kind] };
}

export const runInputSummary = (run: Pick<BotRun, "inputs">) =>
  Object.entries(run.inputs)
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join(", ");

export const firstLine = (text: string | null | undefined) => {
  const line = text
    ?.split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line ?? null;
};

/**
 * The one line that says what a run came to: its verdict, its error, or the start of its reply.
 * A decoded verdict's reply is the structured answer itself, so it never stands in for a summary.
 */
export const runHeadline = (run: BotRun) =>
  firstLine(run.verdict?.summary) ??
  firstLine(run.error) ??
  (run.verdict?.source === "decoded" ? null : firstLine(run.result));

const KNOWN_RUNS_MAX = 1000;
const knownRuns = new Map<string, BotRun>();

/**
 * Runs the lists have shown, so the run sheet opens one without a request, and on servers that
 * cannot look a run up at all. Watched changes stay fresher and take precedence.
 */
export function rememberRuns(runs: Iterable<BotRun>) {
  for (const run of runs) {
    knownRuns.delete(run.id);
    knownRuns.set(run.id, run);
  }
  for (const id of knownRuns.keys()) {
    if (knownRuns.size <= KNOWN_RUNS_MAX) break;
    knownRuns.delete(id);
  }
}

export const knownRun = (id: string) => knownRuns.get(id) ?? null;
