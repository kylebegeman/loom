import { ScheduledTaskWebhookDeliveryId } from "@t3tools/contracts";
import {
  botTriggerHookId,
  BOT_TRIGGER_HOOK_PREFIX,
  isBotTriggerHookId,
  BotsError,
  checkTriggerMapping,
  type BotInputs,
  type BotInputValue,
  type BotsChange,
  type BotsRepinTriggerInput,
  type BotsRunInput,
  type BotsSaveTriggerInput,
  type BotsTestTriggerInput,
  type BotsTriggerFiringsInput,
  type BotTrigger,
  type BotTriggerChange,
  type BotTriggerEvent,
  type BotTriggerFiring,
  type BotTriggerMapping,
} from "@t3tools/contracts/fork";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import {
  ScheduledTaskService,
  ScheduledTaskWebhookOrigin,
  WEBHOOK_ROUTE_PREFIX,
  type WebhookTriggerRequest,
  type WebhookTriggerResult,
} from "../../../scheduledTasks/ScheduledTaskService.ts";
import {
  constantTimeEquals,
  verifyWebhookSignature,
} from "../../../scheduledTasks/webhookVerification.ts";
import { BotBatches } from "../BotBatches.ts";
import { isoAt } from "../BotBudgets.ts";
import { BotsService, type BotCaller } from "../BotsService.ts";
import { makeBotTriggersStore, type StoredTrigger } from "./BotTriggersStore.ts";
import { eventPasses, type TriggerEvent } from "./matchers.ts";
import { firstFireAt } from "./scheduleStep.ts";
import { makeWebhookFieldReader, webhookEventKey } from "./webhookFields.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Accepted deliveries per trigger per minute, the scheduled task limit. */
const WEBHOOK_RATE_LIMIT_PER_MINUTE = 60;
/** A firing row's reason until its outcome is written, so a crash in between explains itself. */
const INTERRUPTED = "The server stopped before this firing finished.";
export const BOT_CHANGED = "Bot changed since this trigger was set.";

const fail = (reason: BotsError["reason"], message: string) => new BotsError({ reason, message });

const storageError = (cause: unknown) =>
  Effect.logWarning("Bot trigger storage failed", { cause }).pipe(
    Effect.andThen(Effect.fail(fail("storage", "Loom could not read or write bot triggers."))),
  );

const hex = (uuid: string) => uuid.replaceAll("-", "");

/** Webhook and merge-conflict triggers listen on a hook URL. */
const usesHook = (event: BotTriggerEvent) =>
  event.kind === "webhook" || event.kind === "merge-conflict";

const sha256 = (text: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).pipe(
    Effect.map((digest) => Buffer.from(digest).toString("hex")),
  );

/** The bot's inputs from an event's fields; a field the event lacks is left out. */
export const mapInputs = (
  mapping: BotTriggerMapping,
  fields: Readonly<Record<string, BotInputValue>>,
): BotInputs => {
  const inputs: Record<string, BotInputValue> = {};
  for (const [name, entry] of Object.entries(mapping)) {
    const value = "field" in entry ? fields[entry.field] : entry.value;
    if (value !== undefined) inputs[name] = value;
  }
  return inputs;
};

/** The merge conflict report `scripts/fork/loom.sh` posts: `{ tag, branch, files }`. */
const readConflictReport = (bodyText: string) => {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const { tag, branch, files } = parsed as Record<string, unknown>;
    if (typeof tag !== "string" || !Array.isArray(files)) return null;
    return {
      tag,
      branch: typeof branch === "string" ? branch : "",
      files: [
        ...new Set(files.filter((file): file is string => typeof file === "string")),
      ].toSorted(),
    };
  } catch {
    return null;
  }
};

interface Outcome {
  readonly outcome: BotTriggerFiring["outcome"];
  readonly runId: string | null;
  readonly reason: string | null;
}

export const make = Effect.gen(function* () {
  const store = yield* makeBotTriggersStore;
  const bots = yield* BotsService;
  const batches = yield* BotBatches;
  const readOrigin = yield* ScheduledTaskWebhookOrigin;
  const serviceScope = yield* Effect.scope;
  const changes = yield* PubSub.unbounded<BotTriggerChange>();
  /** One firing at a time, so cooldowns and daily limits see every earlier firing. */
  const fireLock = yield* Semaphore.make(1);
  const cache = new Map<string, StoredTrigger>();
  const deliveries = new Map<string, Array<number>>();
  /** Wakes the schedule loop when a schedule trigger changes. */
  const scheduleChanged = yield* PubSub.sliding<void>(1);

  for (const stored of yield* store.list().pipe(Effect.catch(storageError)))
    cache.set(stored.trigger.id, stored);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const localNow = DateTime.withCurrentZoneLocal(DateTime.nowInCurrentZone);
  const publish = (change: BotTriggerChange) => PubSub.publish(changes, change).pipe(Effect.asVoid);

  /** The trigger as clients see it; the hook address only when `withWebhook`. */
  const view = Effect.fnUntraced(function* (stored: StoredTrigger) {
    const { trigger, webhookToken } = stored;
    if (webhookToken === null) return trigger;
    const hookId = encodeURIComponent(botTriggerHookId(trigger.id));
    const base = (yield* readOrigin).relayHookBaseUrl;
    return {
      ...trigger,
      webhook: {
        path: `${WEBHOOK_ROUTE_PREFIX}/${hookId}/${webhookToken}`,
        url: base === null ? null : `${base}/${hookId}/${webhookToken}`,
        hasSecret: stored.webhookSecret !== null,
      },
    } satisfies BotTrigger;
  });

  const write = Effect.fnUntraced(function* (stored: StoredTrigger) {
    yield* store.upsert(stored).pipe(Effect.catch(storageError));
    cache.set(stored.trigger.id, stored);
    if (stored.trigger.event.kind === "schedule") yield* PubSub.publish(scheduleChanged, undefined);
    const trigger = yield* view(stored);
    yield* publish({ _tag: "trigger", trigger });
    return trigger;
  });

  const requireStored = (triggerId: string) => {
    const stored = cache.get(triggerId);
    return stored === undefined
      ? Effect.fail(fail("not_found", "The bot trigger was not found."))
      : Effect.succeed(stored);
  };

  const newToken = Effect.all([randomUuidV4, randomUuidV4]).pipe(
    Effect.map(([a, b]) => `${hex(a)}${hex(b)}`),
  );

  const nextFireFor = Effect.fnUntraced(function* (event: BotTriggerEvent, enabled: boolean) {
    if (event.kind !== "schedule" || !enabled) return null;
    return firstFireAt(event.schedule, yield* localNow);
  });

  const list = Effect.fn("BotTriggers.list")(function* (botId?: string) {
    const stored = [...cache.values()].filter(
      (entry) => botId === undefined || entry.trigger.botId === botId,
    );
    return yield* Effect.forEach(
      stored.toSorted((a, b) => a.trigger.createdAt.localeCompare(b.trigger.createdAt)),
      view,
    );
  });

  /** Creates or updates a trigger. The creator and their runtime mode are kept from creation. */
  const save = Effect.fn("BotTriggers.save")(function* (
    input: BotsSaveTriggerInput,
    caller: BotCaller,
  ) {
    const existing = input.id === undefined ? null : yield* requireStored(input.id);
    if (existing !== null && existing.trigger.botId !== input.botId)
      return yield* fail("invalid", "A trigger cannot move to another bot.");
    if (
      existing !== null &&
      input.expectedUpdatedAt !== undefined &&
      existing.trigger.updatedAt !== input.expectedUpdatedAt
    )
      return yield* fail("invalid", "This trigger changed since you opened it. Reload it first.");
    const bot = yield* bots.get(input.botId);
    yield* bots.checkRunnable(
      bot,
      existing === null ? caller : { ...caller, runtimeMode: existing.creatorRuntimeMode },
    );
    const mappingError = checkTriggerMapping(bot, input.event, input.mapping);
    if (mappingError !== null) return yield* fail("invalid", mappingError);

    const hook = usesHook(input.event);
    const webhookSecret = !hook
      ? null
      : input.webhookSecret === undefined
        ? (existing?.webhookSecret ?? null)
        : input.webhookSecret === ""
          ? null
          : input.webhookSecret;
    if (
      input.event.kind === "webhook" &&
      input.event.signature !== undefined &&
      webhookSecret === null
    )
      return yield* fail(
        "invalid",
        "Add the signing secret the sender uses, or remove the signature check.",
      );

    const now = yield* nowIso;
    const trigger: BotTrigger = {
      id: existing?.trigger.id ?? `trg_${hex(yield* randomUuidV4).slice(0, 20)}`,
      botId: input.botId,
      name: input.name,
      event: input.event,
      mapping: input.mapping,
      enabled: input.enabled,
      cooldownMinutes: input.cooldownMinutes,
      dailyLimit: input.dailyLimit,
      followLatest: input.followLatest,
      pinnedVersion: existing?.trigger.pinnedVersion ?? bot.version,
      createdBy: existing?.trigger.createdBy ?? caller.actor,
      createdAt: existing?.trigger.createdAt ?? now,
      updatedAt: now,
      lastFiredAt: existing?.trigger.lastFiredAt ?? null,
      ...(input.event.kind === "schedule"
        ? { nextFireAt: yield* nextFireFor(input.event, input.enabled) }
        : {}),
    };
    return yield* write({
      trigger,
      creatorRuntimeMode: existing === null ? caller.runtimeMode : existing.creatorRuntimeMode,
      webhookToken: hook ? (existing?.webhookToken ?? (yield* newToken)) : null,
      webhookSecret,
    });
  });

  const removeAll = Effect.fnUntraced(function* (ids: ReadonlyArray<string>) {
    yield* store.delete(ids).pipe(Effect.catch(storageError));
    for (const triggerId of ids) {
      cache.delete(triggerId);
      deliveries.delete(triggerId);
      yield* publish({ _tag: "trigger-deleted", triggerId });
    }
    yield* PubSub.publish(scheduleChanged, undefined);
  });

  const remove = Effect.fn("BotTriggers.delete")(function* (triggerId: string) {
    yield* requireStored(triggerId);
    yield* removeAll([triggerId]);
  });

  const setEnabled = Effect.fn("BotTriggers.setEnabled")(function* (
    triggerId: string,
    enabled: boolean,
  ) {
    const stored = yield* requireStored(triggerId);
    const { trigger } = stored;
    return yield* write({
      ...stored,
      trigger: {
        ...trigger,
        enabled,
        updatedAt: yield* nowIso,
        ...(trigger.event.kind === "schedule"
          ? { nextFireAt: yield* nextFireFor(trigger.event, enabled) }
          : {}),
      },
    });
  });

  /** Pins the bot's current version; earlier versions need L98's history. */
  const repin = Effect.fn("BotTriggers.repin")(function* (input: BotsRepinTriggerInput) {
    const stored = yield* requireStored(input.triggerId);
    const bot = yield* bots.get(stored.trigger.botId);
    if (input.version !== undefined && input.version !== bot.version)
      return yield* fail("invalid", `Only the current version, ${bot.version}, can be pinned.`);
    return yield* write({
      ...stored,
      trigger: {
        ...stored.trigger,
        pinnedVersion: bot.version,
        followLatest: input.followLatest ?? stored.trigger.followLatest,
        updatedAt: yield* nowIso,
      },
    });
  });

  const rotate = Effect.fn("BotTriggers.rotate")(function* (triggerId: string) {
    const stored = yield* requireStored(triggerId);
    if (!usesHook(stored.trigger.event))
      return yield* fail("invalid", "Only webhook and merge conflict triggers have an address.");
    return yield* write({
      ...stored,
      webhookToken: yield* newToken,
      trigger: { ...stored.trigger, updatedAt: yield* nowIso },
    });
  });

  const firings = Effect.fn("BotTriggers.firings")(function* (input: BotsTriggerFiringsInput) {
    yield* requireStored(input.triggerId);
    return yield* store
      .firings(input.triggerId, input.before, input.limit)
      .pipe(Effect.catch(storageError));
  });

  /** Starts the run, or records why not as a failed run that reaches the inbox. */
  const decide = Effect.fnUntraced(function* (
    stored: StoredTrigger,
    event: TriggerEvent,
    test: boolean,
    nowMs: number,
  ): Effect.fn.Return<Outcome, BotsError> {
    const { trigger } = stored;
    const bot = yield* bots.get(trigger.botId).pipe(Effect.option);
    if (bot._tag === "None")
      return { outcome: "skipped", runId: null, reason: "The bot was deleted." };
    const definition = bot.value;
    const caller: BotCaller = {
      actor: trigger.createdBy,
      threadId: null,
      projectId: event.projectId ?? null,
      runtimeMode: stored.creatorRuntimeMode,
    };
    const checkout =
      event.threadId !== undefined &&
      definition.workspace.type === "project" &&
      definition.workspace.checkout === "caller";
    const input: BotsRunInput = {
      botId: definition.id,
      inputs: mapInputs(trigger.mapping, event.fields),
      ...(event.projectId === undefined ? {} : { projectId: event.projectId }),
      ...(checkout ? { checkoutThreadId: event.threadId } : {}),
    };
    const skip = (reason: string) =>
      bots.recordUnstarted(definition, input, caller, reason, { triggerId: trigger.id }).pipe(
        Effect.map((run): Outcome => ({ outcome: "skipped", runId: run.id, reason })),
        Effect.orElseSucceed((): Outcome => ({ outcome: "skipped", runId: null, reason })),
      );

    if (!test) {
      const window = yield* store
        .runFirings(trigger.id, isoAt(nowMs - DAY_MS))
        .pipe(Effect.catch(storageError));
      if (
        window.lastRunAt !== null &&
        nowMs - Date.parse(window.lastRunAt) < trigger.cooldownMinutes * 60_000
      )
        return yield* skip(
          `Fired within ${trigger.cooldownMinutes} minute${trigger.cooldownMinutes === 1 ? "" : "s"} of its last run.`,
        );
      if (window.count >= trigger.dailyLimit)
        return yield* skip(
          `Already started ${trigger.dailyLimit} run${trigger.dailyLimit === 1 ? "" : "s"} in the last 24 hours.`,
        );
    }
    if (definition.version !== trigger.pinnedVersion && !trigger.followLatest)
      return yield* skip(BOT_CHANGED);
    const runnable = yield* bots.checkRunnable(definition, caller).pipe(Effect.flip, Effect.option);
    if (runnable._tag === "Some") return yield* skip(runnable.value.message);

    if (event.items !== undefined) {
      if (event.items.length === 0) return yield* skip("The report listed no conflicting files.");
      return yield* batches
        .runBatch(
          {
            botId: definition.id,
            source: {
              type: "inputs",
              items: event.items.map((fields) => mapInputs(trigger.mapping, fields)),
            },
            ...(event.projectId === undefined ? {} : { projectId: event.projectId }),
          },
          caller,
        )
        .pipe(
          Effect.map((batch): Outcome => ({
            outcome: "run",
            runId: null,
            reason: `Started a batch of ${batch.total} file${batch.total === 1 ? "" : "s"}.`,
          })),
          Effect.catch((error) => skip(error.message)),
        );
    }

    return yield* bots.startRunWith(definition, input, caller, { triggerId: trigger.id }).pipe(
      Effect.map((run): Outcome =>
        run.status === "failed" && run.startedAt === null
          ? { outcome: "skipped", runId: run.id, reason: run.error }
          : { outcome: "run", runId: run.id, reason: null },
      ),
      // Budget refusals and archived bots come back as errors; the firing still shows why.
      Effect.catch((error) =>
        error.reason === "not_found"
          ? Effect.succeed<Outcome>({ outcome: "skipped", runId: null, reason: error.message })
          : skip(error.message),
      ),
    );
  });

  /**
   * Fires `stored` for `event` once per event key. Returns null when this key already fired.
   * The firing row is written first, so a crash mid-firing never starts a second run.
   */
  const fireStored = (stored: StoredTrigger, event: TriggerEvent, test: boolean) =>
    Effect.gen(function* () {
      const { trigger } = stored;
      const firedAt = yield* nowIso;
      const pending: BotTriggerFiring = {
        id: yield* randomUuidV4,
        triggerId: trigger.id,
        eventKey: event.key,
        eventSummary: event.summary,
        firedAt,
        outcome: "skipped",
        runId: null,
        reason: INTERRUPTED,
      };
      const inserted = yield* store.insertFiring(pending).pipe(Effect.catch(storageError));
      if (!inserted) return null;
      const outcome = yield* decide(stored, event, test, Date.parse(firedAt));
      const firing: BotTriggerFiring = { ...pending, ...outcome };
      yield* store.updateFiring(firing).pipe(Effect.catch(storageError));
      yield* store.setLastFired(trigger.id, firedAt).pipe(Effect.catch(storageError));
      yield* store.pruneFirings(trigger.id).pipe(Effect.ignore({ log: true }));
      const current = cache.get(trigger.id);
      if (current !== undefined) {
        const updated = { ...current, trigger: { ...current.trigger, lastFiredAt: firedAt } };
        cache.set(trigger.id, updated);
        yield* publish({ _tag: "trigger", trigger: yield* view(updated) });
      }
      yield* publish({ _tag: "firing", firing });
      return firing;
    }).pipe(fireLock.withPermits(1));

  /** Fires every enabled trigger whose event and filters match. Used by the event reactor. */
  const handleEvent = Effect.fn("BotTriggers.handleEvent")(function* (event: TriggerEvent) {
    for (const stored of cache.values())
      if (stored.trigger.enabled && eventPasses(stored.trigger, event))
        yield* fireStored(stored, event, false).pipe(
          Effect.catchCause((cause) => Effect.logWarning("Bot trigger firing failed", { cause })),
        );
  });

  /** Fires a trigger with sample fields, past its filters, dedupe and limits. */
  const test = Effect.fn("BotTriggers.test")(function* (input: BotsTestTriggerInput) {
    const stored = yield* requireStored(input.triggerId);
    const key = `test:${yield* randomUuidV4}`;
    const event: TriggerEvent =
      stored.trigger.event.kind === "merge-conflict"
        ? {
            kind: "merge-conflict",
            key,
            summary: "Test firing",
            fields: input.fields,
            items: [input.fields],
          }
        : { kind: stored.trigger.event.kind, key, summary: "Test firing", fields: input.fields };
    const firing = yield* fireStored(stored, event, true);
    if (firing === null) return yield* fail("storage", "Loom could not record the test firing.");
    return firing;
  });

  const deliver = Effect.fn("BotTriggers.webhook")(function* (
    request: WebhookTriggerRequest,
  ): Effect.fn.Return<WebhookTriggerResult, BotsError> {
    const stored = cache.get(request.hookId.slice(BOT_TRIGGER_HOOK_PREFIX.length));
    if (
      stored === undefined ||
      stored.webhookToken === null ||
      !usesHook(stored.trigger.event) ||
      !constantTimeEquals(stored.webhookToken, request.token)
    )
      return { _tag: "not_found" };
    const { trigger } = stored;
    if (!trigger.enabled) return { _tag: "disabled" };
    if (
      trigger.event.kind === "webhook" &&
      trigger.event.signature !== undefined &&
      (stored.webhookSecret === null ||
        !verifyWebhookSignature({
          signature: trigger.event.signature,
          secret: stored.webhookSecret,
          headers: request.headers,
          body: request.body,
        }))
    )
      return { _tag: "rejected_signature" };

    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const recent = (deliveries.get(trigger.id) ?? []).filter((at) => nowMs - at < 60_000);
    if (recent.length >= WEBHOOK_RATE_LIMIT_PER_MINUTE) {
      deliveries.set(trigger.id, recent);
      return { _tag: "rate_limited", outcome: "rate_limited" };
    }
    deliveries.set(trigger.id, [...recent, nowMs]);

    let event: TriggerEvent;
    if (trigger.event.kind === "merge-conflict") {
      const report = readConflictReport(request.bodyText);
      const files = report?.files ?? [];
      const tag = report?.tag ?? "unknown";
      event = {
        kind: "merge-conflict",
        key: `${tag}:${yield* sha256(files.join("\n"))}`,
        summary: `${files.length} conflicting file${files.length === 1 ? "" : "s"} merging ${tag}`,
        fields: { tag, branch: report?.branch ?? "" },
        items: files.map((file) => ({ tag, branch: report?.branch ?? "", file })),
      };
    } else {
      const read = makeWebhookFieldReader(request);
      const fields: Record<string, BotInputValue> = {};
      for (const entry of Object.values(trigger.mapping))
        if ("field" in entry) {
          const value = read(entry.field);
          if (value !== undefined) fields[entry.field] = value;
        }
      const githubEvent = request.headers["x-github-event"];
      event = {
        kind: "webhook",
        key: webhookEventKey(request, yield* sha256(request.bodyText)),
        summary: githubEvent === undefined ? `${request.method} delivery` : `GitHub ${githubEvent}`,
        fields,
      };
    }
    const firing = yield* fireStored(stored, event, false);
    return {
      _tag: "accepted",
      deliveryId: ScheduledTaskWebhookDeliveryId.make(firing?.id ?? event.key),
      outcome: firing === null ? "duplicate" : "accepted",
    };
  });

  /**
   * A delivery to `/api/hooks/bot-trigger-<id>/<token>`, answered like a scheduled task's. It
   * cannot fail, so the route treats it like `triggerWebhook`; a storage failure answers 500.
   */
  const webhook = (request: WebhookTriggerRequest) => deliver(request).pipe(Effect.orDie);

  /** Enabled schedule triggers, for the schedule loop. */
  const scheduled = () =>
    [...cache.values()].filter(
      (stored) => stored.trigger.enabled && stored.trigger.event.kind === "schedule",
    );

  /** Records a schedule trigger's next time, and fires it for `dueAt` when given. */
  const advanceSchedule = Effect.fn("BotTriggers.advanceSchedule")(function* (
    triggerId: string,
    dueAt: string | null,
    next: string | null,
  ) {
    const stored = cache.get(triggerId);
    if (stored === undefined) return;
    yield* store.setNextFire(triggerId, next).pipe(Effect.catch(storageError));
    const updated = { ...stored, trigger: { ...stored.trigger, nextFireAt: next } };
    cache.set(triggerId, updated);
    if (dueAt !== null)
      yield* fireStored(
        updated,
        {
          kind: "schedule",
          key: `schedule:${dueAt}`,
          summary: `Scheduled for ${dueAt}`,
          fields: { firedAt: dueAt },
        },
        false,
      );
    else yield* publish({ _tag: "trigger", trigger: yield* view(updated) });
  });

  /** A deleted bot takes its triggers with it. */
  const onBotsChange = (change: BotsChange) =>
    change._tag !== "bot-deleted"
      ? Effect.void
      : removeAll(
          [...cache.values()]
            .filter((stored) => stored.trigger.botId === change.botId)
            .map((stored) => stored.trigger.id),
        ).pipe(
          Effect.catchCause((cause) => Effect.logWarning("Bot trigger cleanup failed", { cause })),
        );

  yield* bots.changes.pipe(Stream.runForEach(onBotsChange), Effect.forkIn(serviceScope));

  return {
    list,
    get: (triggerId: string) => requireStored(triggerId).pipe(Effect.flatMap(view)),
    save,
    delete: remove,
    setEnabled,
    repin,
    rotate,
    test,
    firings,
    handleEvent,
    webhook,
    scheduled,
    advanceSchedule,
    scheduleChanged: Stream.fromPubSub(scheduleChanged),
    store,
    changes: Stream.fromPubSub(changes),
  };
});

export class BotTriggers extends Context.Service<BotTriggers, Effect.Success<typeof make>>()(
  "t3/fork/bots/triggers/BotTriggers",
) {}

export const layer = Layer.effect(BotTriggers, make);

/**
 * The scheduled task service as the webhook route sees it, with `bot-trigger-` hooks answered by
 * the triggers. Without the fork layer it is the service unchanged.
 */
export const webhookTarget = Effect.gen(function* () {
  const scheduledTasks = yield* ScheduledTaskService;
  const triggers = yield* Effect.serviceOption(BotTriggers);
  if (Option.isNone(triggers)) return scheduledTasks;
  const target: ScheduledTaskService["Service"] = {
    ...scheduledTasks,
    triggerWebhook: (request) =>
      isBotTriggerHookId(request.hookId)
        ? triggers.value.webhook(request)
        : scheduledTasks.triggerWebhook(request),
  };
  return target;
});
