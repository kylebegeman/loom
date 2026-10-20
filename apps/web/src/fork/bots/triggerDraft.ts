import {
  BOT_TRIGGER_EVENT_FIELDS,
  BOTS_TRIGGER_MIN_INTERVAL_MS,
  checkTriggerMapping,
  type BotDefinition,
  type BotsSaveTriggerInput,
  type BotTrigger,
  type BotTriggerEvent,
  type BotTriggerEventKind,
  type BotTriggerMapping,
  type BotTriggerSchedule,
} from "@t3tools/contracts/fork";
import type { ProjectId } from "@t3tools/contracts";

export const TRIGGER_KIND_LABELS: Record<BotTriggerEventKind, string> = {
  "pull-request-checks-failing": "Pull request checks fail",
  "pull-request-opened": "Pull request opens",
  "thread-settled": "Thread settles",
  "merge-conflict": "Upstream merge conflicts",
  webhook: "Webhook request",
  schedule: "Schedule",
};

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type MappingMode = "none" | "field" | "value";

export interface MappingDraft {
  readonly mode: MappingMode;
  readonly field: string;
  readonly value: string;
}

export interface TriggerDraft {
  readonly name: string;
  readonly kind: BotTriggerEventKind;
  /** Empty means any project; thread-settled requires one. */
  readonly projectId: string;
  readonly repository: string;
  readonly branchPattern: string;
  readonly scheduleType: BotTriggerSchedule["type"];
  readonly everyMinutes: string;
  readonly timeOfDay: string;
  readonly weekdays: ReadonlyArray<number>;
  readonly signed: boolean;
  readonly signatureHeader: string;
  readonly signatureEncoding: "hex" | "base64";
  readonly signaturePrefix: string;
  /** Empty keeps the stored secret. */
  readonly secret: string;
  readonly mapping: Readonly<Record<string, MappingDraft>>;
  readonly enabled: boolean;
  readonly cooldownMinutes: string;
  readonly dailyLimit: string;
  readonly followLatest: boolean;
}

const EMPTY_MAPPING: MappingDraft = { mode: "none", field: "", value: "" };

/** The event field a parameter most likely wants, by name. */
const guessField = (kind: BotTriggerEventKind, name: string) => {
  const fields = BOT_TRIGGER_EVENT_FIELDS[kind];
  const lower = name.toLowerCase();
  return (
    fields.find((field) => field.toLowerCase() === lower) ??
    (lower.includes("file") || lower.includes("path")
      ? fields.find((field) => field === "file")
      : undefined) ??
    (lower.includes("pr") || lower.includes("pull")
      ? fields.find((field) => field === "url")
      : undefined)
  );
};

/** Maps each parameter to the field of the same name where the event has one. */
export const guessMapping = (
  bot: Pick<BotDefinition, "parameters">,
  kind: BotTriggerEventKind,
): Record<string, MappingDraft> =>
  Object.fromEntries(
    bot.parameters.map((parameter) => {
      const field = guessField(kind, parameter.name);
      return [
        parameter.name,
        field === undefined ? EMPTY_MAPPING : { mode: "field" as const, field, value: "" },
      ];
    }),
  );

export const emptyTriggerDraft = (bot: BotDefinition): TriggerDraft => ({
  name: `${bot.name} on checks failing`,
  kind: "pull-request-checks-failing",
  projectId: bot.scopeProjectId ?? "",
  repository: "",
  branchPattern: "",
  scheduleType: "interval",
  everyMinutes: "60",
  timeOfDay: "09:00",
  weekdays: [1, 2, 3, 4, 5],
  signed: false,
  signatureHeader: "x-hub-signature-256",
  signatureEncoding: "hex",
  signaturePrefix: "sha256=",
  secret: "",
  mapping: guessMapping(bot, "pull-request-checks-failing"),
  enabled: true,
  cooldownMinutes: "10",
  dailyLimit: "20",
  followLatest: false,
});

export const triggerDraftFrom = (bot: BotDefinition, trigger: BotTrigger): TriggerDraft => {
  const base = emptyTriggerDraft(bot);
  const event = trigger.event;
  const filters =
    event.kind === "pull-request-checks-failing" || event.kind === "pull-request-opened"
      ? {
          projectId: event.projectId ?? "",
          repository: event.repository ?? "",
          branchPattern: event.branchPattern ?? "",
        }
      : event.kind === "thread-settled"
        ? { projectId: event.projectId }
        : {};
  const schedule =
    event.kind !== "schedule"
      ? {}
      : event.schedule.type === "interval"
        ? {
            scheduleType: "interval" as const,
            everyMinutes: String(event.schedule.everyMs / 60_000),
          }
        : {
            scheduleType: "fixed_time" as const,
            timeOfDay: event.schedule.timeOfDay,
            weekdays: event.schedule.weekdays ?? [],
          };
  const signature =
    event.kind === "webhook" && event.signature !== undefined
      ? {
          signed: true,
          signatureHeader: event.signature.header,
          signatureEncoding: event.signature.encoding,
          signaturePrefix: event.signature.prefix,
        }
      : {};
  return {
    ...base,
    ...filters,
    ...schedule,
    ...signature,
    name: trigger.name,
    kind: event.kind,
    mapping: Object.fromEntries(
      bot.parameters.map((parameter) => {
        const entry = trigger.mapping[parameter.name];
        if (entry === undefined) return [parameter.name, EMPTY_MAPPING];
        return [
          parameter.name,
          "field" in entry
            ? { mode: "field" as const, field: entry.field, value: "" }
            : { mode: "value" as const, field: "", value: String(entry.value) },
        ];
      }),
    ),
    enabled: trigger.enabled,
    cooldownMinutes: String(trigger.cooldownMinutes),
    dailyLimit: String(trigger.dailyLimit),
    followLatest: trigger.followLatest,
  };
};

const wholeNumber = (raw: string) => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null);

const eventFromDraft = (draft: TriggerDraft): BotTriggerEvent | string => {
  const projectId = draft.projectId === "" ? {} : { projectId: draft.projectId as ProjectId };
  switch (draft.kind) {
    case "pull-request-checks-failing":
    case "pull-request-opened":
      return {
        kind: draft.kind,
        ...projectId,
        ...(draft.repository.trim() === "" ? {} : { repository: draft.repository.trim() }),
        ...(draft.branchPattern.trim() === "" ? {} : { branchPattern: draft.branchPattern.trim() }),
      };
    case "thread-settled":
      return draft.projectId === ""
        ? "Choose the project whose threads start this bot."
        : { kind: "thread-settled", projectId: draft.projectId as ProjectId };
    case "merge-conflict":
      return { kind: "merge-conflict" };
    case "webhook":
      if (!draft.signed) return { kind: "webhook" };
      if (draft.signatureHeader.trim() === "") return "Name the header that carries the signature.";
      return {
        kind: "webhook",
        signature: {
          header: draft.signatureHeader.trim(),
          encoding: draft.signatureEncoding,
          prefix: draft.signaturePrefix,
        },
      };
    case "schedule": {
      if (draft.scheduleType === "interval") {
        const minutes = wholeNumber(draft.everyMinutes);
        if (minutes === null || minutes * 60_000 < BOTS_TRIGGER_MIN_INTERVAL_MS)
          return "Run at most once a minute.";
        return { kind: "schedule", schedule: { type: "interval", everyMs: minutes * 60_000 } };
      }
      if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(draft.timeOfDay)) return "Choose a time of day.";
      return {
        kind: "schedule",
        schedule: {
          type: "fixed_time",
          timeOfDay: draft.timeOfDay,
          ...(draft.weekdays.length === 0 ? {} : { weekdays: draft.weekdays.toSorted() }),
        },
      };
    }
  }
};

const mappingFromDraft = (bot: BotDefinition, draft: TriggerDraft): BotTriggerMapping | string => {
  const mapping: Record<string, BotTriggerMapping[string]> = {};
  for (const parameter of bot.parameters) {
    const entry = draft.mapping[parameter.name] ?? EMPTY_MAPPING;
    if (entry.mode === "field" && entry.field.trim() !== "")
      mapping[parameter.name] = { field: entry.field.trim() };
    if (entry.mode === "value") {
      if (parameter.type === "number") {
        const value = Number(entry.value);
        if (entry.value.trim() === "" || !Number.isFinite(value))
          return `${parameter.label} needs a number.`;
        mapping[parameter.name] = { value };
      } else if (parameter.type === "boolean")
        mapping[parameter.name] = { value: entry.value === "true" };
      else mapping[parameter.name] = { value: entry.value };
    }
  }
  return mapping;
};

/** The save request, or the first thing to fix; mapping rules match the server's. */
export const triggerInputFromDraft = (
  bot: BotDefinition,
  draft: TriggerDraft,
  existing: BotTrigger | null,
): { readonly input: BotsSaveTriggerInput } | { readonly error: string } => {
  if (draft.name.trim() === "") return { error: "Name the trigger." };
  const event = eventFromDraft(draft);
  if (typeof event === "string") return { error: event };
  const mapping = mappingFromDraft(bot, draft);
  if (typeof mapping === "string") return { error: mapping };
  const mappingError = checkTriggerMapping(bot, event, mapping);
  if (mappingError !== null) return { error: mappingError };
  const cooldownMinutes = wholeNumber(draft.cooldownMinutes);
  if (cooldownMinutes === null || cooldownMinutes > 1440)
    return { error: "Cooldown is 0 to 1440 minutes." };
  const dailyLimit = wholeNumber(draft.dailyLimit);
  if (dailyLimit === null || dailyLimit < 1 || dailyLimit > 500)
    return { error: "The daily limit is 1 to 500 runs." };
  return {
    input: {
      ...(existing === null ? {} : { id: existing.id, expectedUpdatedAt: existing.updatedAt }),
      botId: bot.id,
      name: draft.name.trim(),
      event,
      mapping,
      enabled: draft.enabled,
      cooldownMinutes,
      dailyLimit,
      followLatest: draft.followLatest,
      ...(event.kind === "webhook" && draft.signed && draft.secret !== ""
        ? { webhookSecret: draft.secret }
        : {}),
      ...(event.kind === "webhook" && !draft.signed && existing?.webhook?.hasSecret
        ? { webhookSecret: "" }
        : {}),
    },
  };
};

const scheduleSummary = (schedule: BotTriggerSchedule) => {
  if (schedule.type === "interval") {
    const minutes = schedule.everyMs / 60_000;
    return minutes % 60 === 0
      ? `Every ${minutes / 60 === 1 ? "hour" : `${minutes / 60} hours`}`
      : `Every ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const days =
    schedule.weekdays === undefined ||
    schedule.weekdays.length === 0 ||
    schedule.weekdays.length === 7
      ? "every day"
      : schedule.weekdays.map((day) => WEEKDAY_LABELS[day]).join(", ");
  return `At ${schedule.timeOfDay}, ${days}`;
};

/** One line describing when the trigger fires, such as "Pull request checks fail in acme/app". */
export const triggerSummary = (
  event: BotTriggerEvent,
  projectTitle: (id: string) => string,
): string => {
  switch (event.kind) {
    case "pull-request-checks-failing":
    case "pull-request-opened": {
      const where = [
        event.repository ?? (event.projectId === undefined ? null : projectTitle(event.projectId)),
        event.branchPattern === undefined ? null : `branch ${event.branchPattern}`,
      ].filter((part) => part !== null);
      return where.length === 0
        ? TRIGGER_KIND_LABELS[event.kind]
        : `${TRIGGER_KIND_LABELS[event.kind]} in ${where.join(", ")}`;
    }
    case "thread-settled":
      return `A thread in ${projectTitle(event.projectId)} settles`;
    case "schedule":
      return scheduleSummary(event.schedule);
    default:
      return TRIGGER_KIND_LABELS[event.kind];
  }
};
