import {
  BOT_RUN_THREAD_PREFIX,
  isBotRunThreadId,
  isTerminalBotRunStatus,
  type BotDefinition,
  type BotRun,
  type BotsInboxPage,
} from "@t3tools/contracts/fork";
import type { LibraryWorkflowTone, WaitingBotRunThread } from "@t3tools/client-runtime/fork";

/**
 * The first page joined with older pages loaded since. `earlier` holds pages already behind the
 * one in flight; while that one loads, more is assumed to remain.
 */
export const combineTriagePages = (
  first: BotsInboxPage,
  earlier: readonly BotRun[],
  older: { readonly before: string | null; readonly page: BotsInboxPage | null },
): BotsInboxPage => {
  const seen = new Set<string>();
  const runs: BotRun[] = [];
  for (const run of [...first.runs, ...earlier, ...(older.page?.runs ?? [])]) {
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    runs.push(run);
  }
  return {
    runs,
    total: first.total,
    hasMore: older.before === null ? first.hasMore : (older.page?.hasMore ?? true),
  };
};

/** Why an item needs a person. It decides the item's group, its reason word and its one verb. */
export type TriageReason =
  | "approval"
  | "question"
  | "failed"
  | "timed_out"
  | "undecided"
  | "invalid"
  | "pipeline";

export type TriageGroup = "waiting" | "failed" | "undecided" | "pipeline";

/** Most urgent first: a run paused on a person blocks work that is otherwise going. */
export const TRIAGE_GROUPS: readonly TriageGroup[] = ["waiting", "failed", "undecided", "pipeline"];

type RunReason = Exclude<TriageReason, "approval" | "question">;

export const triageRunReason = (run: BotRun): RunReason =>
  run.pipelineRunId != null
    ? "pipeline"
    : run.status === "failed"
      ? "failed"
      : run.status === "timed_out"
        ? "timed_out"
        : run.verdict?.source === "invalid"
          ? "invalid"
          : "undecided";

const GROUP_OF: Record<TriageReason, TriageGroup> = {
  approval: "waiting",
  question: "waiting",
  failed: "failed",
  timed_out: "failed",
  undecided: "undecided",
  invalid: "undecided",
  pipeline: "pipeline",
};

interface TriageBase {
  readonly key: string;
  readonly group: TriageGroup;
  /** Null for a waiting thread whose run is not loaded yet. */
  readonly botId: string | null;
  readonly botName: string;
  /** When it started needing a person: the request, or the run's end. */
  readonly at: string;
}

export type TriageItem =
  | (TriageBase & {
      readonly kind: "waiting";
      readonly reason: "approval" | "question";
      readonly thread: WaitingBotRunThread;
      readonly run: BotRun | null;
    })
  | (TriageBase & { readonly kind: "run"; readonly reason: RunReason; readonly run: BotRun });

/** The run a bot run thread belongs to; its id is the thread id after the run prefix. */
export const runIdOfThread = (threadId: string): string | null =>
  isBotRunThreadId(threadId) ? threadId.slice(BOT_RUN_THREAD_PREFIX.length) : null;

/** The run behind any item; a waiting thread names its run even before the run is loaded. */
export const triageRunId = (item: TriageItem): string | null =>
  item.kind === "run" ? item.run.id : (item.run?.id ?? runIdOfThread(item.thread.id));

export const triageRunItem = (run: BotRun): TriageItem => {
  const reason = triageRunReason(run);
  return {
    kind: "run",
    key: `run:${run.id}`,
    reason,
    group: GROUP_OF[reason],
    run,
    botId: run.botId,
    botName: run.botName,
    at: run.finishedAt ?? run.createdAt,
  };
};

/**
 * Inbox runs and waiting threads as one queue. A waiting thread is joined to its run by id, so it
 * carries its bot and inputs; without the run it falls back to the thread's title, which is the
 * bot's name. `bot` narrows the queue to one bot.
 */
export function triageItems({
  runs,
  waiting,
  findRun,
  bot,
}: {
  readonly runs: readonly BotRun[];
  readonly waiting: readonly WaitingBotRunThread[];
  readonly findRun: (runId: string) => BotRun | undefined;
  readonly bot: Pick<BotDefinition, "id" | "name"> | null;
}): TriageItem[] {
  const listed = new Set(runs.map((run) => run.id));
  const items: TriageItem[] = [];
  for (const thread of waiting) {
    const runId = runIdOfThread(thread.id);
    if (runId !== null && listed.has(runId)) continue;
    const run = runId === null ? null : (findRun(runId) ?? null);
    const botId = run?.botId ?? null;
    if (bot && (run ? botId !== bot.id : thread.title !== bot.name)) continue;
    const reason = thread.hasPendingApprovals ? "approval" : "question";
    items.push({
      kind: "waiting",
      key: `thread:${thread.environmentId}:${thread.id}`,
      reason,
      group: "waiting",
      thread,
      run,
      botId,
      botName: run?.botName ?? (thread.title.trim() || "Bot run"),
      at: thread.waitingSince ?? thread.updatedAt,
    });
  }
  for (const run of runs) if (!bot || run.botId === bot.id) items.push(triageRunItem(run));
  return items;
}

const byAt = (left: TriageItem, right: TriageItem) =>
  left.at.localeCompare(right.at) || left.key.localeCompare(right.key);

export interface TriageSection {
  readonly group: TriageGroup;
  readonly items: readonly TriageItem[];
}

/**
 * The queue in groups, most urgent first. The longest wait leads its group, since someone has been
 * blocked longest; finished runs read newest first, like every other run list.
 */
export function groupTriage(items: readonly TriageItem[]): TriageSection[] {
  return TRIAGE_GROUPS.flatMap((group) => {
    const members = items.filter((item) => item.group === group);
    if (!members.length) return [];
    const sorted = members.toSorted(byAt);
    return [{ group, items: group === "waiting" ? sorted : sorted.toReversed() }];
  });
}

/** The queue in reading order across groups, for a band that shows only its head. */
export const orderTriage = (items: readonly TriageItem[]): TriageItem[] =>
  groupTriage(items).flatMap((section) => section.items);

export interface TriageEntry {
  readonly lead: TriageItem;
  /** The same bot's other items in the group, folded under the lead. */
  readonly rest: readonly TriageItem[];
}

/** From this many items of one bot in one group, the newest leads and the rest fold under it. */
export const TRIAGE_REPEAT_MIN = 3;

/**
 * A bot failing every night should read as one problem, not a wall of rows. Waiting items never
 * fold: each is its own question.
 */
export function foldRepeats(section: TriageSection): TriageEntry[] {
  if (section.group === "waiting") return section.items.map((lead) => ({ lead, rest: [] }));
  const byBot = new Map<string, TriageItem[]>();
  for (const item of section.items) {
    if (item.botId === null) continue;
    const members = byBot.get(item.botId) ?? [];
    members.push(item);
    byBot.set(item.botId, members);
  }
  const entries: TriageEntry[] = [];
  const folded = new Set<string>();
  for (const item of section.items) {
    if (folded.has(item.key)) continue;
    const members = item.botId === null ? [] : (byBot.get(item.botId) ?? []);
    if (members.length < TRIAGE_REPEAT_MIN) {
      entries.push({ lead: item, rest: [] });
      continue;
    }
    for (const member of members) folded.add(member.key);
    entries.push({ lead: item, rest: members.filter((member) => member.key !== item.key) });
  }
  return entries;
}

export interface TriageBotCount {
  readonly botId: string;
  readonly botName: string;
  readonly count: number;
}

/** Who the queue's items come from, busiest first, for the By bot filter. */
export function triageBotCounts(items: readonly TriageItem[]): TriageBotCount[] {
  const counts = new Map<string, TriageBotCount>();
  for (const item of items) {
    if (item.botId === null) continue;
    const current = counts.get(item.botId);
    counts.set(item.botId, {
      botId: item.botId,
      botName: current?.botName ?? item.botName,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts.values()].toSorted(
    (left, right) => right.count - left.count || left.botName.localeCompare(right.botName),
  );
}

/** The runs a person can dismiss: finished ones. A paused run is still going. */
export const dismissibleRunIds = (items: readonly TriageItem[]): string[] =>
  items.flatMap((item) =>
    item.kind === "run" && isTerminalBotRunStatus(item.run.status) ? [item.run.id] : [],
  );

/** Where the next page starts: the server lists runs created strictly before it. */
export const olderCursor = (runs: readonly BotRun[]): string | null =>
  runs.at(-1)?.createdAt ?? null;

export const firstLine = (text: string | null | undefined): string | null => {
  if (!text) return null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

export const triageInputSummary = (inputs: BotRun["inputs"]): string =>
  Object.entries(inputs)
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join(", ");

const REASON_LABELS: Record<TriageReason, string> = {
  approval: "Needs approval",
  question: "Has a question",
  failed: "Failed",
  timed_out: "Timed out",
  undecided: "Undecided",
  invalid: "Reply was not a verdict",
  pipeline: "Stopped its pipeline",
};

export const triageReasonLabel = (reason: TriageReason) => REASON_LABELS[reason];

const FALLBACK_EVIDENCE: Record<RunReason, string> = {
  failed: "No error was recorded.",
  timed_out: "It ran past its time limit.",
  undecided: "The bot could not reach a verdict.",
  invalid: "The bot replied without a verdict.",
  pipeline: "Its pipeline waits until it is resumed.",
};

/** The one line that says why, before anyone opens the run: the error, else the verdict's summary. */
export const triageEvidence = (item: TriageItem): string | null =>
  item.kind === "waiting"
    ? null
    : (firstLine(item.run.error) ??
      firstLine(item.run.verdict?.summary) ??
      FALLBACK_EVIDENCE[item.reason]);

export const triageTone = (item: TriageItem): LibraryWorkflowTone => {
  switch (item.reason) {
    case "failed":
      return "danger";
    case "pipeline":
      return item.kind === "run" &&
        (item.run.status === "failed" || item.run.verdict?.verdict === "fail")
        ? "danger"
        : "warning";
    default:
      return "warning";
  }
};

/** Whether the item's bot can still run. A list not loaded yet is taken as active. */
export type TriageBotState = "active" | "archived" | "deleted";

export const triageBotState = (
  botId: string | null,
  definitions: readonly Pick<BotDefinition, "id" | "archivedAt">[] | null,
): TriageBotState => {
  if (botId === null || definitions === null) return "active";
  const bot = definitions.find((entry) => entry.id === botId);
  return bot === undefined ? "deleted" : bot.archivedAt === null ? "active" : "archived";
};

export type TriageVerb = "answer" | "retry" | "review" | "resume" | "restore";

/**
 * The one thing to do next. A failed run whose bot can no longer run cannot be retried, so it is
 * reviewed instead; a dismissed run can only come back.
 */
export const triageVerb = (
  item: TriageItem,
  options: { readonly dismissed: boolean; readonly botState: TriageBotState },
): TriageVerb => {
  if (item.kind === "waiting") return "answer";
  if (options.dismissed) return "restore";
  switch (item.reason) {
    case "failed":
    case "timed_out":
      return options.botState === "active" ? "retry" : "review";
    case "pipeline":
      return "resume";
    default:
      return "review";
  }
};
