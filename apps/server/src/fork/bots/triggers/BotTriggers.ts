import { WORKFLOW_IDS, WORKFLOW_TRIGGER_HINTS } from "@t3tools/contracts/fork";
import { intakeTriggerProblem, intakeReport } from "../../workflows/intake.ts";
import { ScheduledTaskWebhookDeliveryId, type RuntimeMode } from "@t3tools/contracts";
import {
  botTriggerHookId,
  BOT_TRIGGER_RETIRED_MESSAGE,
  BOT_TRIGGER_HOOK_PREFIX,
  isBotTriggerHookId,
  BotsError,
  checkTriggerMapping,
  type BotInputs,
  type BotInputValue,
  type BotPipelineChange,
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
import { makeBotOperationState } from "../BotOperationState.ts";
import { BotPipelines } from "../pipelines/BotPipelines.ts";
import { isoAt } from "../BotBudgets.ts";
import { BotsService, outranks, type BotCaller } from "../BotsService.ts";
import { makeBotTriggersStore, type StoredTrigger } from "./BotTriggersStore.ts";
import type { TriggerDispatch } from "./dispatch.ts";
import { eventPasses, type TriggerEvent } from "./matchers.ts";
import { firstFireAt } from "./scheduleStep.ts";
import { makeWebhookFieldReader, webhookEventKey } from "./webhookFields.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Accepted deliveries per trigger per minute, the scheduled task limit. */
const WEBHOOK_RATE_LIMIT_PER_MINUTE = 60;
const BATCH_NEEDS_LATEST =
  "A batch runs the bot's latest version; pin this trigger to it or let it follow the latest.";
const BOTH_FOLLOWS = "A trigger follows either the latest or the stable version, not both.";
const PIPELINE_PER_FILE = "A pipeline runs once per event, not once per conflicting file.";
const REFUSAL_REASONS = {
  disabled: "trigger is disabled",
  retired: "trigger is retired",
  rejected_signature: "signature did not match",
  rate_limited: "too many deliveries",
} as const;

const fail = (reason: BotsError["reason"], message: string) => new BotsError({ reason, message });

const storageError = (cause: unknown) =>
  Effect.logWarning("Bot trigger storage failed", { cause }).pipe(
    Effect.andThen(Effect.fail(fail("storage", "Loom could not read or write bot triggers."))),
  );

const hex = (uuid: string) => uuid.replaceAll("-", "");

/** The narrower of two runtime mode ceilings; null is none. */
const narrower = (a: RuntimeMode | null, b: RuntimeMode | null) =>
  a === null ? b : b === null || outranks(b, a) ? a : b;

/** Webhook and merge-conflict triggers listen on a hook URL. */
type TriggerTarget = Pick<
  BotTrigger,
  "botId" | "pipelineId" | "followLatest" | "followStable" | "pinnedVersion"
>;

/** The bot version a firing of the trigger runs. */
const versionRun = (trigger: TriggerTarget) =>
  trigger.followLatest
    ? "latest"
    : trigger.followStable === true
      ? "stable"
      : trigger.pinnedVersion;

const usesHook = (event: BotTriggerEvent) =>
  event.kind === "webhook" || event.kind === "merge-conflict";

/** The bot's inputs from an event's fields; a field the event lacks is left out. */
const mapInputs = (
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

interface Outcome {
  readonly outcome: BotTriggerFiring["outcome"];
  readonly runId: string | null;
  readonly pipelineRunId?: string;
  readonly batchId?: string;
  readonly reason: string | null;
}

export const make = Effect.gen(function* () {
  const store = yield* makeBotTriggersStore;
  const operation = yield* makeBotOperationState;
  const bots = yield* BotsService;
  const batches = yield* BotBatches;
  const pipelines = yield* BotPipelines;
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
    if (trigger.event.kind === "merge-conflict") return { ...trigger, enabled: false };
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
    const lastDeliveryRefusal = cache.get(stored.trigger.id)?.trigger.lastDeliveryRefusal;
    const current =
      lastDeliveryRefusal === undefined
        ? stored
        : { ...stored, trigger: { ...stored.trigger, lastDeliveryRefusal } };
    cache.set(stored.trigger.id, current);
    if (stored.trigger.event.kind === "schedule") yield* PubSub.publish(scheduleChanged, undefined);
    const trigger = yield* view(current);
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

  /**
   * Refuses arming a trigger whose runs its caller could not start: a bot run never arms one, and
   * an agent cannot re-arm a person's trigger, which has no ceiling, for a bot broader than itself.
   * It checks what a firing runs: the trigger's version of its bot, or every step of its pipeline.
   */
  const checkArming = Effect.fnUntraced(function* (
    target: TriggerTarget,
    stored: StoredTrigger | null,
    caller: BotCaller,
  ) {
    yield* bots.checkCaller({ botId: target.botId, inputs: {} }, caller);
    if (
      caller.actor === "agent" &&
      stored?.trigger.projectId !== undefined &&
      stored.trigger.projectId !== caller.projectId
    )
      return yield* fail("permission", "An agent's trigger must keep its own execution project.");
    const ceiling =
      stored === null
        ? caller
        : { ...caller, runtimeMode: narrower(caller.runtimeMode, stored.creatorRuntimeMode) };
    if (target.pipelineId != null)
      return yield* pipelines.checkRunnable(target.pipelineId, ceiling);
    // A firing of a version that no longer exists is skipped, so the current bot stands in.
    const definition = yield* bots
      .definitionAt(target.botId, versionRun(target))
      .pipe(Effect.catch(() => bots.get(target.botId)));
    yield* bots.checkRunnable(definition, ceiling);
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
    const executionProjectId =
      input.projectId === undefined
        ? (existing?.trigger.projectId ??
          (caller.actor === "agent" ? (caller.projectId ?? undefined) : undefined))
        : (input.projectId ?? undefined);
    if (
      caller.actor === "agent" &&
      ((executionProjectId !== undefined && executionProjectId !== caller.projectId) ||
        (input.projectId === null &&
          (existing?.trigger.projectId !== undefined || caller.projectId !== null)))
    )
      return yield* fail("permission", "An agent's trigger must keep its own execution project.");
    const pipelineId = input.pipelineId ?? null;
    if (
      pipelineId !== null &&
      WORKFLOW_TRIGGER_HINTS[pipelineId] &&
      executionProjectId === undefined
    )
      return yield* fail("invalid", "Choose the exact execution project for this workflow.");
    const intakeProblem = intakeTriggerProblem(input);
    if (intakeProblem !== null) return yield* fail("invalid", intakeProblem);
    if (existing !== null && (existing.trigger.pipelineId ?? null) !== pipelineId)
      return yield* fail("invalid", "A trigger cannot move to another pipeline.");
    const bot = yield* bots.get(input.botId);
    yield* checkArming(
      {
        botId: input.botId,
        pipelineId,
        followLatest: input.followLatest,
        ...(input.followStable === true ? { followStable: true } : {}),
        pinnedVersion: existing?.trigger.pinnedVersion ?? bot.version,
      },
      existing,
      caller,
    );
    if (input.followLatest && input.followStable === true)
      return yield* fail("invalid", BOTH_FOLLOWS);
    const pipeline = pipelineId === null ? null : yield* pipelines.get(pipelineId);
    if (pipeline !== null && pipeline.steps[0]?.botId !== input.botId)
      return yield* fail(
        "invalid",
        "A pipeline trigger names the bot of the pipeline's first step.",
      );
    if (input.event.kind === "merge-conflict")
      return yield* fail("invalid", BOT_TRIGGER_RETIRED_MESSAGE);
    const mappingError = checkTriggerMapping(pipeline ?? bot, input.event, input.mapping);
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
      ...(input.completionDestinationId === undefined
        ? {}
        : { completionDestinationId: input.completionDestinationId }),
      ...(executionProjectId === undefined ? {} : { projectId: executionProjectId }),
      event: input.event,
      mapping: input.mapping,
      enabled: input.enabled,
      cooldownMinutes: input.cooldownMinutes,
      dailyLimit: input.dailyLimit,
      followLatest: input.followLatest,
      ...(input.followStable === true ? { followStable: true } : {}),
      ...(pipelineId === null ? {} : { pipelineId }),
      pinnedVersion: existing?.trigger.pinnedVersion ?? bot.version,
      createdBy: existing?.trigger.createdBy ?? caller.actor,
      createdAt: existing?.trigger.createdAt ?? now,
      updatedAt: now,
      lastFiredAt: existing?.trigger.lastFiredAt ?? null,
      ...(existing?.trigger.lastDeliveryRefusal === undefined
        ? {}
        : { lastDeliveryRefusal: existing.trigger.lastDeliveryRefusal }),
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
    caller: BotCaller,
  ) {
    const stored = yield* requireStored(triggerId);
    if (enabled && stored.trigger.event.kind === "merge-conflict")
      return yield* fail("invalid", BOT_TRIGGER_RETIRED_MESSAGE);
    if (enabled) yield* checkArming(stored.trigger, stored, caller);
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

  /** Pins any stored version of the bot, its current one when none is named. */
  const repin = Effect.fn("BotTriggers.repin")(function* (input: BotsRepinTriggerInput) {
    const stored = yield* requireStored(input.triggerId);
    const bot = yield* bots.get(stored.trigger.botId);
    const version = input.version ?? bot.version;
    if (version !== bot.version) yield* bots.version({ botId: bot.id, version });
    const followLatest = input.followLatest ?? stored.trigger.followLatest;
    const followStable = input.followStable ?? stored.trigger.followStable === true;
    if (followLatest && followStable) return yield* fail("invalid", BOTH_FOLLOWS);
    const { followStable: _followStable, ...rest } = stored.trigger;
    return yield* write({
      ...stored,
      trigger: {
        ...rest,
        pinnedVersion: version,
        followLatest,
        ...(followStable ? { followStable: true } : {}),
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

  const prepareDispatch = Effect.fn("BotTriggers.prepareDispatch")(function* (
    stored: StoredTrigger,
    event: TriggerEvent,
    test: boolean,
    nowMs: number,
    requestId: string,
  ): Effect.fn.Return<TriggerDispatch | Outcome, BotsError> {
    const allowed = yield* operation.checkAdmission(true).pipe(Effect.result);
    if (allowed._tag === "Failure") {
      if (allowed.failure.reason === "storage") return yield* allowed.failure;
      return { outcome: "skipped", runId: null, reason: allowed.failure.message };
    }
    const { trigger } = stored;
    const executionProjectId = trigger.projectId ?? event.projectId;
    const bot = yield* bots.get(trigger.botId).pipe(
      Effect.catchIf(
        (error) => error.reason === "not_found",
        () => Effect.succeed(null),
      ),
    );
    if (bot === null) return { outcome: "skipped", runId: null, reason: "The bot was deleted." };
    const pinned = yield* bots.definitionAt(trigger.botId, versionRun(trigger)).pipe(
      Effect.map((definition) => ({ definition, problem: null })),
      Effect.catchIf(
        (error) => error.reason !== "storage",
        (error) => Effect.succeed({ definition: bot, problem: error.message }),
      ),
    );
    const { definition } = pinned;
    const caller = {
      actor: trigger.createdBy,
      threadId: null,
      projectId: executionProjectId ?? null,
      runtimeMode: stored.creatorRuntimeMode,
      requestScope: `trigger:${trigger.id}`,
    };
    const checkout =
      event.threadId !== undefined &&
      definition.workspace.type === "project" &&
      definition.workspace.checkout === "caller";
    const input: BotsRunInput = {
      botId: definition.id,
      inputs: mapInputs(trigger.mapping, event.fields),
      clientRequestId: requestId,
      ...(trigger.completionDestinationId === undefined
        ? {}
        : { completionDestinationId: trigger.completionDestinationId }),
      ...(executionProjectId === undefined ? {} : { projectId: executionProjectId }),
      ...(checkout ? { checkoutThreadId: event.threadId } : {}),
    };
    const base = { definition, input, caller };
    const skip = (reason: string): TriggerDispatch => ({ ...base, job: { _tag: "skip", reason } });
    const refuse = (error: BotsError) =>
      error.reason === "storage" ? Effect.fail(error) : Effect.succeed(skip(error.message));

    if (!test) {
      const window = yield* store
        .runFirings(trigger.id, isoAt(nowMs - DAY_MS))
        .pipe(Effect.catch(storageError));
      if (
        window.lastRunAt !== null &&
        nowMs - Date.parse(window.lastRunAt) < trigger.cooldownMinutes * 60_000
      )
        return skip(
          `Fired within ${trigger.cooldownMinutes} minute${trigger.cooldownMinutes === 1 ? "" : "s"} of its last run.`,
        );
      if (window.count >= trigger.dailyLimit)
        return skip(
          `Already started ${trigger.dailyLimit} run${trigger.dailyLimit === 1 ? "" : "s"} in the last 24 hours.`,
        );
    }
    if (trigger.pipelineId != null) {
      if (event.items !== undefined) return skip(PIPELINE_PER_FILE);
      return yield* Effect.gen(function* () {
        const pipeline = yield* pipelines.get(trigger.pipelineId!);
        yield* pipelines.checkRunnable(pipeline.id, caller);
        const botVersions: Record<string, number> = {};
        for (const step of pipeline.steps)
          botVersions[step.id] = (yield* bots.definitionAt(
            step.botId,
            step.version ?? "latest",
          )).version;
        return {
          ...base,
          job: {
            _tag: "pipeline",
            version: pipeline.version,
            botVersions,
            input: {
              pipelineId: pipeline.id,
              inputs: input.inputs,
              clientRequestId: requestId,
              ...(trigger.completionDestinationId === undefined
                ? {}
                : { completionDestinationId: trigger.completionDestinationId }),
              ...(executionProjectId === undefined ? {} : { projectId: executionProjectId }),
              ...(event.threadId === undefined ? {} : { checkoutThreadId: event.threadId }),
            },
          },
        } satisfies TriggerDispatch;
      }).pipe(Effect.catch(refuse));
    }
    if (pinned.problem !== null) return skip(pinned.problem);
    const checked = yield* bots.checkRunnable(definition, caller).pipe(Effect.result);
    if (checked._tag === "Failure") return yield* refuse(checked.failure);

    if (event.items !== undefined) {
      if (event.items.length === 0) return skip("The report listed no conflicting files.");
      if (definition.version !== bot.version) return skip(BATCH_NEEDS_LATEST);
      return {
        ...base,
        job: {
          _tag: "batch",
          input: {
            botId: definition.id,
            clientRequestId: requestId,
            ...(trigger.completionDestinationId === undefined
              ? {}
              : { completionDestinationId: trigger.completionDestinationId }),
            source: {
              type: "inputs",
              items: event.items.map((fields) => mapInputs(trigger.mapping, fields)),
            },
            ...(executionProjectId === undefined ? {} : { projectId: executionProjectId }),
          },
        },
      };
    }
    return { ...base, job: { _tag: "run" } };
  });

  const dispatch = Effect.fn("BotTriggers.dispatch")(function* (
    firing: BotTriggerFiring,
    pending: TriggerDispatch,
  ): Effect.fn.Return<Outcome, BotsError> {
    const { definition, input, caller, job } = pending;
    const options = { triggerId: firing.triggerId };
    const skip = (reason: string) =>
      bots.recordUnstarted(definition, input, caller, reason, options).pipe(
        Effect.map((run): Outcome => ({ outcome: "skipped", runId: run.id, reason })),
        Effect.catchIf(
          (error) => error.reason !== "storage",
          () => Effect.succeed<Outcome>({ outcome: "skipped", runId: null, reason }),
        ),
      );
    const refuse = (error: BotsError) =>
      error.reason === "storage" ? Effect.fail(error) : skip(error.message);
    switch (job._tag) {
      case "skip":
        return yield* skip(job.reason);
      case "pipeline":
        return yield* pipelines
          .run(job.input, caller, {
            ...options,
            expectedVersion: job.version,
            expectedBotVersions: job.botVersions,
          })
          .pipe(
            Effect.map((run): Outcome => ({
              outcome: "run",
              runId: null,
              pipelineRunId: run.id,
              reason: "Started a pipeline run.",
            })),
            Effect.catch(refuse),
          );
      case "batch":
        return yield* batches
          .runBatch(job.input, caller, {
            ...options,
            expectedVersion: definition.version,
          })
          .pipe(
            Effect.map((batch): Outcome => ({
              outcome: "run",
              runId: null,
              batchId: batch.id,
              reason: `Started a batch of ${batch.total} file${batch.total === 1 ? "" : "s"}.`,
            })),
            Effect.catch(refuse),
          );
      case "run":
        return yield* bots.startRunWith(definition, input, caller, options).pipe(
          Effect.map((run): Outcome =>
            run.status === "failed" && run.startedAt === null
              ? { outcome: "skipped", runId: run.id, reason: run.error }
              : { outcome: "run", runId: run.id, reason: null },
          ),
          Effect.catch(refuse),
        );
    }
  });

  const completeFiring = Effect.fn("BotTriggers.completeFiring")(function* (
    firing: BotTriggerFiring,
  ) {
    yield* store
      .withTransaction(
        Effect.gen(function* () {
          yield* store.updateFiring(firing);
          yield* store.setLastFired(firing.triggerId, firing.firedAt);
        }),
      )
      .pipe(Effect.catch(storageError));
    yield* store.pruneFirings(firing.triggerId).pipe(Effect.ignore({ log: true }));
    const current = cache.get(firing.triggerId);
    if (current !== undefined) {
      const lastFiredAt =
        current.trigger.lastFiredAt !== null && current.trigger.lastFiredAt > firing.firedAt
          ? current.trigger.lastFiredAt
          : firing.firedAt;
      const updated = { ...current, trigger: { ...current.trigger, lastFiredAt } };
      cache.set(firing.triggerId, updated);
      yield* publish({ _tag: "trigger", trigger: yield* view(updated) });
    }
    yield* publish({ _tag: "firing", firing });
    return firing;
  });

  const resumeFiring = Effect.fn("BotTriggers.resumeFiring")(function* (pending: {
    readonly firing: BotTriggerFiring;
    readonly dispatch: TriggerDispatch;
  }) {
    const outcome = yield* dispatch(pending.firing, pending.dispatch);
    return yield* completeFiring({ ...pending.firing, ...outcome });
  });

  const fireStored = Effect.fn("BotTriggers.fireStored")(
    function* (stored: StoredTrigger, event: TriggerEvent, test: boolean) {
      const existing = yield* store
        .getFiring(stored.trigger.id, event.key)
        .pipe(Effect.catch(storageError));
      if (existing !== null)
        return existing.dispatch === null
          ? null
          : yield* resumeFiring({ ...existing, dispatch: existing.dispatch });
      const pending: BotTriggerFiring = {
        id: yield* randomUuidV4,
        triggerId: stored.trigger.id,
        eventKey: event.key,
        eventSummary: event.summary,
        firedAt: yield* nowIso,
        outcome: "pending",
        runId: null,
        reason: null,
      };
      const prepared = yield* prepareDispatch(
        stored,
        event,
        test,
        Date.parse(pending.firedAt),
        `bot-trigger:${pending.id}`,
      );
      if (!("job" in prepared)) {
        const firing = { ...pending, ...prepared };
        if (!(yield* store.insertFiring(firing).pipe(Effect.catch(storageError)))) return null;
        return yield* completeFiring(firing);
      }
      if (!(yield* store.insertFiring(pending, prepared).pipe(Effect.catch(storageError))))
        return null;
      yield* publish({ _tag: "firing", firing: pending });
      return yield* resumeFiring({ firing: pending, dispatch: prepared });
    },
    (effect) => fireLock.withPermits(1)(effect),
  );

  const recoverPending = Effect.fn("BotTriggers.recoverPending")(
    function* () {
      const pending = yield* store.pendingFirings().pipe(Effect.catch(storageError));
      for (const firing of pending) yield* resumeFiring(firing);
    },
    (effect) => fireLock.withPermits(1)(effect),
  );

  /** Cursor acknowledgement waits for durable outcomes from every matching trigger. */
  const handleEvent = Effect.fn("BotTriggers.handleEvent")(function* (event: TriggerEvent) {
    for (const stored of cache.values())
      if (
        stored.trigger.enabled &&
        stored.trigger.event.kind !== "merge-conflict" &&
        eventPasses(stored.trigger, event)
      )
        yield* fireStored(stored, event, false);
  });

  /** Fires a trigger with sample fields, past its filters, dedupe and limits. */
  const test = Effect.fn("BotTriggers.test")(function* (input: BotsTestTriggerInput) {
    const stored = yield* requireStored(input.triggerId);
    if (stored.trigger.event.kind === "merge-conflict")
      return yield* fail("invalid", BOT_TRIGGER_RETIRED_MESSAGE);
    const key = `test:${yield* randomUuidV4}`;
    const event: TriggerEvent = {
      kind: stored.trigger.event.kind,
      key,
      summary: "Test firing",
      fields: input.fields,
    };
    const firing = yield* fireStored(stored, event, true);
    if (firing === null) return yield* fail("storage", "Loom could not record the test firing.");
    return firing;
  });

  const recordRefusal = Effect.fn("BotTriggers.recordDeliveryRefusal")(function* (
    trigger: BotTrigger,
    reason: keyof typeof REFUSAL_REASONS,
  ) {
    const now = yield* DateTime.now;
    const recorded = yield* store
      .recordDeliveryRefusal({
        id: yield* randomUuidV4,
        triggerId: trigger.id,
        eventKey: `refused:${Math.floor(DateTime.toEpochMillis(now) / 60_000)}`,
        eventSummary: "Webhook delivery refused",
        firedAt: DateTime.formatIso(now),
        outcome: "skipped",
        runId: null,
        reason: REFUSAL_REASONS[reason],
      })
      .pipe(Effect.catch(storageError));
    const current = cache.get(trigger.id);
    if (current !== undefined) {
      const latest = current.trigger.lastDeliveryRefusal;
      const issue =
        latest !== undefined &&
        (latest.at > recorded.issue.at ||
          (latest.at === recorded.issue.at && latest.count > recorded.issue.count))
          ? latest
          : recorded.issue;
      const updated = {
        ...current,
        trigger: { ...current.trigger, lastDeliveryRefusal: issue },
      };
      cache.set(trigger.id, updated);
      yield* publish({ _tag: "trigger", trigger: yield* view(updated) });
    }
    yield* store.pruneFirings(trigger.id).pipe(Effect.ignore({ log: true }));
    yield* publish({ _tag: "firing", firing: recorded.firing });
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
    if (!trigger.enabled || trigger.event.kind === "merge-conflict") {
      yield* recordRefusal(
        trigger,
        trigger.event.kind === "merge-conflict" ? "retired" : "disabled",
      );
      return { _tag: "disabled" };
    }
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
    ) {
      yield* recordRefusal(trigger, "rejected_signature");
      return { _tag: "rejected_signature" };
    }

    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const recent = (deliveries.get(trigger.id) ?? []).filter((at) => nowMs - at < 60_000);
    if (recent.length >= WEBHOOK_RATE_LIMIT_PER_MINUTE) {
      deliveries.set(trigger.id, recent);
      yield* recordRefusal(trigger, "rate_limited");
      return { _tag: "rate_limited", outcome: "rate_limited" };
    }
    deliveries.set(trigger.id, [...recent, nowMs]);

    let event: TriggerEvent;
    {
      const deliveryKey = webhookEventKey(request);
      const intake =
        trigger.pipelineId === WORKFLOW_IDS.intake
          ? intakeReport(request.bodyText, trigger.mapping, deliveryKey)
          : null;
      if (intake !== null && "error" in intake) return yield* fail("invalid", intake.error);
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
        key: intake?.key ?? deliveryKey ?? `delivery:${yield* randomUuidV4}`,
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
    if (dueAt !== null)
      yield* fireStored(
        stored,
        {
          kind: "schedule",
          key: `schedule:${dueAt}`,
          summary: `Scheduled for ${dueAt}`,
          fields: { firedAt: dueAt },
        },
        false,
      );
    yield* store.setNextFire(triggerId, next).pipe(Effect.catch(storageError));
    const current = cache.get(triggerId);
    if (current === undefined) return;
    const updated = { ...current, trigger: { ...current.trigger, nextFireAt: next } };
    cache.set(triggerId, updated);
    yield* publish({ _tag: "trigger", trigger: yield* view(updated) });
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

  /** Removes pipeline triggers whose pipeline is gone, so none fires into a reused pipeline id. */
  const removePipelineTriggers = (gone: (pipelineId: string) => boolean) =>
    removeAll(
      [...cache.values()]
        .filter(({ trigger }) => trigger.pipelineId != null && gone(trigger.pipelineId))
        .map(({ trigger }) => trigger.id),
    ).pipe(
      Effect.catchCause((cause) => Effect.logWarning("Bot trigger cleanup failed", { cause })),
    );

  const onPipelinesChange = (change: BotPipelineChange) =>
    change._tag !== "pipeline-deleted"
      ? Effect.void
      : removePipelineTriggers((pipelineId) => pipelineId === change.pipelineId);

  yield* bots.changes.pipe(
    Stream.runForEach(onBotsChange),
    Effect.forkIn(serviceScope, { startImmediately: true }),
  );
  yield* pipelines.changes.pipe(
    Stream.runForEach(onPipelinesChange),
    Effect.forkIn(serviceScope, { startImmediately: true }),
  );
  // Triggers left by a pipeline deleted before its cleanup ran.
  yield* Effect.filter(
    new Set(
      [...cache.values()].flatMap(({ trigger }) =>
        trigger.pipelineId == null ? [] : [trigger.pipelineId],
      ),
    ),
    (pipelineId) => pipelines.exists(pipelineId).pipe(Effect.map((exists) => !exists)),
  ).pipe(
    Effect.flatMap((gone) => removePipelineTriggers((pipelineId) => gone.includes(pipelineId))),
    Effect.catchCause((cause) => Effect.logWarning("Bot trigger cleanup failed", { cause })),
  );

  yield* recoverPending().pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Bot trigger dispatch recovery failed", { cause }),
    ),
  );

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
    recoverPending,
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
