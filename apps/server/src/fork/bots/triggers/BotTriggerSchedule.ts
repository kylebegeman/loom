import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { forkParked } from "../../../serverActivation.ts";
import { BotTriggers } from "./BotTriggers.ts";
import { scheduleStep } from "./scheduleStep.ts";

/** The longest the loop sleeps, so a change it missed while busy waits at most this long. */
const MAX_SLEEP_MS = 60_000;

/** Fires every due schedule trigger once; returns the earliest time one is due next. */
const scheduleTick = Effect.fnUntraced(function* (
  triggers: Pick<BotTriggers["Service"], "scheduled" | "advanceSchedule">,
  now: DateTime.Zoned,
) {
  let earliest: number | null = null;
  for (const { trigger } of triggers.scheduled()) {
    if (trigger.event.kind !== "schedule") continue;
    const current = trigger.nextFireAt ?? null;
    const step = scheduleStep(trigger.event.schedule, current, now);
    if (step.fire !== null || step.next !== current)
      yield* triggers
        .advanceSchedule(trigger.id, step.fire, step.next)
        .pipe(
          Effect.catchCause((cause) => Effect.logWarning("Bot schedule trigger failed", { cause })),
        );
    if (step.next !== null) {
      const dueMs = Date.parse(step.next);
      if (earliest === null || dueMs < earliest) earliest = dueMs;
    }
  }
  return earliest;
});

export const BotTriggerScheduleLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const triggers = yield* BotTriggers;
    const localNow = DateTime.withCurrentZoneLocal(DateTime.nowInCurrentZone);
    const loop = Effect.gen(function* () {
      const now = yield* localNow;
      const earliest = yield* scheduleTick(triggers, now);
      const waitMs =
        earliest === null
          ? MAX_SLEEP_MS
          : Math.min(MAX_SLEEP_MS, Math.max(0, earliest - DateTime.toEpochMillis(now)));
      yield* Effect.raceFirst(
        Effect.sleep(Duration.millis(waitMs)),
        triggers.scheduleChanged.pipe(Stream.take(1), Stream.runDrain),
      );
    }).pipe(Effect.forever);
    yield* forkParked(loop);
  }),
);
