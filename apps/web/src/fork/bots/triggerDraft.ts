import {
  BOT_TRIGGER_EVENT_FIELDS,
  BOTS_TRIGGER_MIN_INTERVAL_MS,
  checkTriggerMapping,
  isBotTriggerField,
  type BotDefinition,
  type BotParameter,
  type BotTrigger,
  type BotTriggerEvent,
  type BotTriggerEventKind,
  type BotTriggerFiring,
  type BotTriggerMapping,
} from "@t3tools/contracts/fork";
import {
  emptyTriggerDraft,
  guessMapping,
  triggerSummary,
  WEEKDAY_LABELS,
  type MappingDraft,
  type TriggerDraft,
  type TriggerTarget,
} from "@t3tools/client-runtime/fork";

/** The kinds in the order the editor offers them: the common ones first. */
export const TRIGGER_KINDS: readonly BotTriggerEventKind[] = [
  "schedule",
  "webhook",
  "pull-request-checks-failing",
  "pull-request-opened",
  "thread-settled",
  "merge-conflict",
];

export const PIPELINE_PER_FILE = "A pipeline runs once per event, not once per conflicting file.";
const MAX_INTERVAL_MINUTES = 31 * 24 * 60;
const MAX_NAME = 120;

const wholeNumber = (raw: string) => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null);

export type IntervalUnit = "minutes" | "hours" | "days";
const INTERVAL_UNIT_MINUTES: Record<IntervalUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
};

/** A stored interval in the largest unit that divides it, so 1440 minutes reads as 1 day. */
export function intervalParts(everyMinutes: string): {
  readonly amount: string;
  readonly unit: IntervalUnit;
} {
  const minutes = wholeNumber(everyMinutes);
  if (minutes === null || minutes === 0) return { amount: everyMinutes, unit: "minutes" };
  if (minutes % 1440 === 0) return { amount: String(minutes / 1440), unit: "days" };
  if (minutes % 60 === 0) return { amount: String(minutes / 60), unit: "hours" };
  return { amount: String(minutes), unit: "minutes" };
}

/**
 * The minutes an amount of a unit comes to, such as 1.5 hours as "90". Text that is not a whole
 * number of minutes passes through, so the draft keeps failing validation instead of guessing.
 */
export function everyMinutesFrom(amount: string, unit: IntervalUnit): string {
  const trimmed = amount.trim();
  const value = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(value)) return trimmed;
  const minutes = value * INTERVAL_UNIT_MINUTES[unit];
  return Number.isInteger(minutes) && minutes > 0 ? String(minutes) : trimmed;
}

/** "15 minutes", "hour", "6 hours", "day": the words after "every". */
function intervalPhrase(minutes: number): string {
  const { amount, unit } = intervalParts(String(minutes));
  const count = Number(amount);
  const noun = unit === "days" ? "day" : unit === "hours" ? "hour" : "minute";
  return count === 1 ? noun : `${count} ${noun}s`;
}

/** Chips beside the "Every" field, so each reads on from it: every 15 minutes, every 1 hour. */
export const INTERVAL_PRESETS: readonly { readonly label: string; readonly minutes: number }[] = [
  { label: "15 minutes", minutes: 15 },
  { label: "1 hour", minutes: 60 },
  { label: "6 hours", minutes: 360 },
  { label: "1 day", minutes: 1440 },
];

export const DAY_PRESETS: readonly { readonly label: string; readonly days: readonly number[] }[] =
  [
    { label: "Every day", days: [] },
    { label: "Weekdays", days: [1, 2, 3, 4, 5] },
    { label: "Weekends", days: [0, 6] },
  ];

const sameDays = (left: readonly number[], right: readonly number[]) => {
  const a = [...new Set(left)].toSorted((x, y) => x - y);
  const b = [...new Set(right)].toSorted((x, y) => x - y);
  return a.length === b.length && a.every((day, index) => day === b[index]);
};

/** No days chosen means every day, as the server reads it. */
function daysPhrase(weekdays: readonly number[]): string {
  const unique = [...new Set(weekdays)];
  if (unique.length === 0 || unique.length === 7) return "every day";
  if (sameDays(unique, [1, 2, 3, 4, 5])) return "weekdays";
  if (sameDays(unique, [0, 6])) return "weekends";
  return unique
    .toSorted((x, y) => x - y)
    .map((day) => WEEKDAY_LABELS[day])
    .join(", ");
}

/** The preset a day selection matches, so its chip can read as chosen. */
export function dayPresetOf(weekdays: readonly number[]): string | null {
  const all = weekdays.length === 7 ? [] : weekdays;
  return DAY_PRESETS.find((preset) => sameDays(preset.days, all))?.label ?? null;
}

const TIME_OF_DAY = /^([01]?\d|2[0-3]):([0-5]\d)$/;

type ScheduleFields = Pick<
  TriggerDraft,
  "scheduleType" | "everyMinutes" | "timeOfDay" | "weekdays"
>;

/** When a draft's schedule runs, in words, or null while it is incomplete. */
export function schedulePhrase(draft: ScheduleFields): string | null {
  if (draft.scheduleType === "interval") {
    const minutes = wholeNumber(draft.everyMinutes);
    return minutes === null || minutes < 1 ? null : `every ${intervalPhrase(minutes)}`;
  }
  if (!TIME_OF_DAY.test(draft.timeOfDay)) return null;
  return `${daysPhrase(draft.weekdays)} at ${draft.timeOfDay}`;
}

/**
 * The next days a time-of-day schedule runs, from `now`. The time itself is the server's, which
 * may sit in another time zone, so callers show the dates with the chosen time as typed.
 */
export function upcomingDays(
  draft: Pick<TriggerDraft, "timeOfDay" | "weekdays">,
  now: Date,
  count: number,
): Date[] {
  const match = TIME_OF_DAY.exec(draft.timeOfDay);
  if (match === null) return [];
  const days = draft.weekdays.length === 0 ? null : new Set(draft.weekdays);
  const result: Date[] = [];
  for (let offset = 0; offset <= 14 && result.length < count; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(Number(match[1]), Number(match[2]), 0, 0);
    if (candidate.getTime() <= now.getTime()) continue;
    if (days !== null && !days.has(candidate.getDay())) continue;
    result.push(candidate);
  }
  return result;
}

/**
 * When a trigger fires, in a line. Schedules read in the units they were set in, so a daily
 * interval says "Every day" rather than "Every 24 hours".
 */
export function triggerWhen(event: BotTriggerEvent, projectTitle: (id: string) => string): string {
  if (event.kind !== "schedule") return triggerSummary(event, projectTitle);
  const { schedule } = event;
  const phrase =
    schedule.type === "interval"
      ? schedulePhrase({
          scheduleType: "interval",
          everyMinutes: String(schedule.everyMs / 60_000),
          timeOfDay: "",
          weekdays: [],
        })
      : schedulePhrase({
          scheduleType: "fixed_time",
          everyMinutes: "",
          timeOfDay: schedule.timeOfDay,
          weekdays: schedule.weekdays ?? [],
        });
  if (phrase === null) return triggerSummary(event, projectTitle);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** The name a new trigger gets from what it runs and what starts it. */
export function defaultTriggerName(
  targetName: string,
  draft: Pick<TriggerDraft, "kind"> & ScheduleFields,
): string {
  const phrase =
    draft.kind === "schedule"
      ? (schedulePhrase(draft) ?? "on a schedule")
      : {
          "pull-request-checks-failing": "when checks fail",
          "pull-request-opened": "when a pull request opens",
          "thread-settled": "when a thread settles",
          "merge-conflict": "on merge conflicts",
          webhook: "from a webhook",
        }[draft.kind];
  return `${targetName} ${phrase}`.slice(0, MAX_NAME);
}

/**
 * Applies a change to a draft. A name nobody typed keeps following what starts the trigger and
 * what it runs, so a trigger switched to a schedule is never saved as "on checks failing".
 */
export function reviseTriggerDraft(
  draft: TriggerDraft,
  patch: Partial<TriggerDraft>,
  targetName: (pipelineId: string) => string,
): TriggerDraft {
  const next = { ...draft, ...patch };
  if (patch.name !== undefined) return next;
  const following = draft.name === defaultTriggerName(targetName(draft.pipelineId), draft);
  return following
    ? { ...next, name: defaultTriggerName(targetName(next.pipelineId), next) }
    : next;
}

/** A new trigger's draft, named for its kind and mapped to what it runs. */
export function newTriggerDraft(
  bot: BotDefinition,
  target: TriggerTarget,
  pipelineId: string,
): TriggerDraft {
  const base = emptyTriggerDraft(bot);
  const draft = { ...base, pipelineId, mapping: guessMapping(target, base.kind) };
  return { ...draft, name: defaultTriggerName(target.name, draft) };
}

/**
 * Keeps the fixed values and still-valid fields of a mapping when the event changes, and guesses
 * the rest, so switching kinds never leaves a field the new event does not offer.
 */
export function remapForKind(
  target: Pick<BotDefinition, "parameters">,
  mapping: Readonly<Record<string, MappingDraft>>,
  kind: BotTriggerEventKind,
): Record<string, MappingDraft> {
  const guessed = guessMapping(target, kind);
  return Object.fromEntries(
    target.parameters.map((parameter) => {
      const entry = mapping[parameter.name];
      if (entry === undefined) return [parameter.name, guessed[parameter.name]!];
      if (entry.mode !== "field") return [parameter.name, entry];
      return [
        parameter.name,
        isBotTriggerField(kind, entry.field.trim()) ? entry : guessed[parameter.name]!,
      ];
    }),
  );
}

export type TriggerStep = "kind" | "when" | "runs" | "review";
export const TRIGGER_STEPS: readonly TriggerStep[] = ["kind", "when", "runs", "review"];

export interface TriggerStepContext {
  readonly target: TriggerTarget;
  /** Whether a webhook secret is already stored, so signing can keep it. */
  readonly hasSecret: boolean;
}

const mappingProblem = (target: TriggerTarget, draft: TriggerDraft): string | null => {
  const mapping: Record<string, BotTriggerMapping[string]> = {};
  for (const parameter of target.parameters) {
    const entry = draft.mapping[parameter.name];
    if (entry === undefined || entry.mode === "none") continue;
    if (entry.mode === "field") {
      if (entry.field.trim() !== "") mapping[parameter.name] = { field: entry.field.trim() };
      continue;
    }
    if (parameter.type === "number") {
      const value = Number(entry.value);
      if (entry.value.trim() === "" || !Number.isFinite(value))
        return `${parameter.label} needs a number.`;
      mapping[parameter.name] = { value };
    } else
      mapping[parameter.name] = {
        value: parameter.type === "boolean" ? entry.value === "true" : entry.value,
      };
  }
  return checkTriggerMapping(target, { kind: draft.kind }, mapping);
};

const whenProblem = (draft: TriggerDraft, context: TriggerStepContext): string | null => {
  switch (draft.kind) {
    case "thread-settled":
      if (draft.projectId === "") return "Choose the project whose threads start it.";
      break;
    case "schedule":
      if (draft.scheduleType === "interval") {
        const minutes = wholeNumber(draft.everyMinutes);
        if (minutes === null || minutes === 0)
          return "Enter how often it runs, such as 15 minutes or 2 hours.";
        if (minutes * 60_000 < BOTS_TRIGGER_MIN_INTERVAL_MS) return "Run at most once a minute.";
        if (minutes > MAX_INTERVAL_MINUTES) return "Run at least once every 31 days.";
      } else if (!TIME_OF_DAY.test(draft.timeOfDay)) return "Choose a time of day.";
      break;
    case "webhook":
      if (!draft.signed) break;
      if (draft.signatureHeader.trim() === "") return "Name the header that carries the signature.";
      if (draft.secret === "" && !context.hasSecret)
        return "Add the secret the sender signs with, or turn off the signature check.";
      break;
    default:
      break;
  }
  const cooldown = wholeNumber(draft.cooldownMinutes);
  if (cooldown === null || cooldown > 1440) return "Wait 0 to 1440 minutes between runs.";
  const daily = wholeNumber(draft.dailyLimit);
  if (daily === null || daily < 1 || daily > 500) return "Allow 1 to 500 runs a day.";
  return null;
};

/** What still blocks one step of the editor, in the words the step's own fields use. */
export function triggerStepProblem(
  step: TriggerStep,
  draft: TriggerDraft,
  context: TriggerStepContext,
): string | null {
  switch (step) {
    case "kind":
      return draft.pipelineId !== "" && draft.kind === "merge-conflict" ? PIPELINE_PER_FILE : null;
    case "when":
      return whenProblem(draft, context);
    case "runs":
      if (draft.pipelineId !== "" && draft.kind === "merge-conflict") return PIPELINE_PER_FILE;
      return mappingProblem(context.target, draft);
    case "review":
      if (draft.name.trim() === "") return "Name the trigger.";
      return draft.name.trim().length > MAX_NAME
        ? `Keep the name to ${MAX_NAME} characters.`
        : null;
  }
}

/** The first step that still has a problem, or null when the draft can be saved. */
export function firstProblemStep(
  draft: TriggerDraft,
  context: TriggerStepContext,
): TriggerStep | null {
  return TRIGGER_STEPS.find((step) => triggerStepProblem(step, draft, context) !== null) ?? null;
}

export interface TestField {
  readonly key: string;
  readonly name: string;
  readonly value: string;
  readonly type: BotParameter["type"];
}

let testFieldKeys = 0;
export const newTestField = (name = "", type: BotParameter["type"] = "string"): TestField => ({
  key: `test-field-${++testFieldKeys}`,
  name,
  value: "",
  type,
});

/**
 * One row per field the event offers, or per field a webhook's inputs read, typed as the input
 * it fills, since the server passes a field's value to the run unchanged.
 */
export function initialTestFields(
  trigger: Pick<BotTrigger, "event" | "mapping">,
  target: Pick<BotDefinition, "parameters">,
): TestField[] {
  const typeOf = (field: string) =>
    target.parameters.find((parameter) => {
      const entry = trigger.mapping[parameter.name];
      return entry !== undefined && "field" in entry && entry.field === field;
    })?.type ?? "string";
  const names =
    trigger.event.kind === "webhook"
      ? Object.values(trigger.mapping).flatMap((entry) => ("field" in entry ? [entry.field] : []))
      : BOT_TRIGGER_EVENT_FIELDS[trigger.event.kind];
  return [...new Set(names)].map((name) => newTestField(name, typeOf(name)));
}

/** The test request's fields, or the first one to fix. */
export function testFieldsInput(
  fields: readonly Pick<TestField, "name" | "value" | "type">[],
): { readonly fields: Record<string, string | number | boolean> } | { readonly error: string } {
  const result = new Map<string, string | number | boolean>();
  for (const field of fields) {
    const name = field.name.trim();
    if (name === "") return { error: "Name every field, or remove the empty one." };
    if (result.has(name)) return { error: `The field ${name} appears twice.` };
    if (field.type === "number") {
      const value = Number(field.value);
      if (field.value.trim() === "" || !Number.isFinite(value))
        return { error: `${name} needs a number.` };
      result.set(name, value);
    } else if (field.type === "boolean") result.set(name, field.value === "true");
    else result.set(name, field.value);
  }
  return { fields: Object.fromEntries(result) };
}

export interface FiringActivity {
  /** The newest firing that started work. */
  readonly lastRun: BotTriggerFiring | null;
  /** The newest firing that was skipped. */
  readonly lastSkip: BotTriggerFiring | null;
  /** Skips newer than the last run, which say a trigger has stopped starting work. */
  readonly skippedSinceRun: number;
  readonly ran: number;
  readonly skipped: number;
}

/**
 * What a trigger's firings say about it. A trigger's own `lastFiredAt` counts skips too, so a
 * trigger held back by its cooldown would otherwise read as having just run.
 */
export function firingActivity(firings: readonly BotTriggerFiring[]): FiringActivity {
  const newestFirst = firings.toSorted((left, right) => right.firedAt.localeCompare(left.firedAt));
  const lastRun = newestFirst.find((firing) => firing.outcome === "run") ?? null;
  const lastSkip = newestFirst.find((firing) => firing.outcome === "skipped") ?? null;
  const runIndex = lastRun === null ? newestFirst.length : newestFirst.indexOf(lastRun);
  const ran = newestFirst.filter((firing) => firing.outcome === "run").length;
  return {
    lastRun,
    lastSkip,
    skippedSinceRun: runIndex,
    ran,
    skipped: newestFirst.length - ran,
  };
}

/** What a trigger's row says of its latest firing, from what the list and the watch carry. */
export type TriggerRowActivity =
  | { readonly kind: "never" }
  /** Fired, with an outcome only its firings know: `lastFiredAt` counts skips too. */
  | { readonly kind: "fired"; readonly at: string }
  | { readonly kind: "ran"; readonly at: string }
  | { readonly kind: "skipped"; readonly at: string };

/**
 * A row's activity without fetching each trigger's firings, which would cost one request per row.
 * A watched firing at least as new as `lastFiredAt` is the latest one, so its outcome is known.
 */
export function triggerRowActivity(
  trigger: Pick<BotTrigger, "lastFiredAt">,
  watched: readonly BotTriggerFiring[],
): TriggerRowActivity {
  const newest = watched.reduce<BotTriggerFiring | null>(
    (latest, firing) => (latest === null || firing.firedAt > latest.firedAt ? firing : latest),
    null,
  );
  const last = trigger.lastFiredAt;
  if (newest !== null && (last === null || newest.firedAt >= last))
    return { kind: newest.outcome === "run" ? "ran" : "skipped", at: newest.firedAt };
  return last === null ? { kind: "never" } : { kind: "fired", at: last };
}

/** The newest firing time a page holds, to tell when the trigger fired since it was fetched. */
export const newestFiredAt = (firings: readonly BotTriggerFiring[]) =>
  firings.reduce<string | null>(
    (newest, firing) => (newest === null || firing.firedAt > newest ? firing.firedAt : newest),
    null,
  );

export type TriggerStateFilter = "all" | "on" | "paused";

export interface TriggerFilters {
  readonly search: string;
  readonly kinds: ReadonlySet<BotTriggerEventKind>;
  readonly state: TriggerStateFilter;
}

/** Triggers that match a search over their words, the chosen kinds and on or paused. */
export function filterTriggers(
  triggers: readonly BotTrigger[],
  filters: TriggerFilters,
  words: (trigger: BotTrigger) => string,
): BotTrigger[] {
  const terms = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return triggers.filter((trigger) => {
    if (filters.kinds.size > 0 && !filters.kinds.has(trigger.event.kind)) return false;
    if (filters.state === "on" && !trigger.enabled) return false;
    if (filters.state === "paused" && trigger.enabled) return false;
    if (terms.length === 0) return true;
    const haystack = `${trigger.name} ${words(trigger)}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * The index's two groups. Schedules come soonest first, paused ones last since they have no next
 * run. Triggers that wait for something come most recently active first.
 */
export function triggerAgenda(triggers: readonly BotTrigger[]): {
  readonly nextUp: BotTrigger[];
  readonly onDemand: BotTrigger[];
} {
  const byName = (left: BotTrigger, right: BotTrigger) => left.name.localeCompare(right.name);
  const nextUp = triggers
    .filter((trigger) => trigger.event.kind === "schedule")
    .toSorted((left, right) => {
      const leftNext = left.enabled ? (left.nextFireAt ?? null) : null;
      const rightNext = right.enabled ? (right.nextFireAt ?? null) : null;
      if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
      if (leftNext !== rightNext) {
        if (leftNext === null) return 1;
        if (rightNext === null) return -1;
        return leftNext.localeCompare(rightNext);
      }
      return byName(left, right);
    });
  const onDemand = triggers
    .filter((trigger) => trigger.event.kind !== "schedule")
    .toSorted((left, right) => {
      if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
      if (left.lastFiredAt !== right.lastFiredAt) {
        if (left.lastFiredAt === null) return 1;
        if (right.lastFiredAt === null) return -1;
        return right.lastFiredAt.localeCompare(left.lastFiredAt);
      }
      return byName(left, right);
    });
  return { nextUp, onDemand };
}

/** Which version a bot trigger runs, and whether a newer one has been saved since it was set. */
export function triggerVersion(
  trigger: Pick<BotTrigger, "followLatest" | "followStable" | "pinnedVersion" | "pipelineId">,
  bot: Pick<BotDefinition, "version"> | undefined,
): { readonly label: string; readonly short: string; readonly outdated: boolean } | null {
  if (trigger.pipelineId != null) return null;
  if (trigger.followLatest) return { label: "Latest version", short: "latest", outdated: false };
  if (trigger.followStable === true)
    return { label: "Stable version", short: "stable", outdated: false };
  return {
    label: `Version ${trigger.pinnedVersion}`,
    short: `v${trigger.pinnedVersion}`,
    outdated: bot !== undefined && bot.version !== trigger.pinnedVersion,
  };
}

/** Each input a trigger fills and where from, such as "Pull request ← url" or "Depth = 2". */
export function mappingLines(
  target: Pick<BotDefinition, "parameters">,
  mapping: BotTriggerMapping,
): string[] {
  return target.parameters.flatMap((parameter) => {
    const entry = mapping[parameter.name];
    if (entry === undefined) return [];
    return "field" in entry
      ? [`${parameter.label} ← ${entry.field}`]
      : [`${parameter.label} = ${String(entry.value)}`];
  });
}

/** A trigger's limits in a line. */
export function limitsPhrase(trigger: Pick<BotTrigger, "dailyLimit" | "cooldownMinutes">) {
  const daily = `At most ${trigger.dailyLimit} run${trigger.dailyLimit === 1 ? "" : "s"} a day`;
  return trigger.cooldownMinutes > 0
    ? `${daily}, ${trigger.cooldownMinutes} minute${trigger.cooldownMinutes === 1 ? "" : "s"} apart`
    : daily;
}

/** A span ahead in its two largest units: "3m", "2h 14m", "3d 4h". */
export function spanAhead(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

/**
 * Hides a webhook address's token, the last part of its path, which is all a sender needs to
 * fire it. The rest stays readable so the address can still be recognized.
 */
export function maskWebhookAddress(address: string): string {
  const cut = address.lastIndexOf("/");
  return cut < 0 || cut === address.length - 1 ? address : `${address.slice(0, cut + 1)}••••••••`;
}

/** A random signing secret, as hex, for a sender to sign webhook requests with. */
export function generateWebhookSecret(bytes = 32): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
