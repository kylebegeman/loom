import type { OrchestrationV2StoredEvent } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../../../serverActivation.ts";
import { isoAt } from "../BotBudgets.ts";
import { BotTriggers } from "./BotTriggers.ts";
import { PR_STATE_IDLE_MS } from "./BotTriggersStore.ts";
import { matchPullRequestLink, matchThreadSettled, pullRequestKey } from "./matchers.ts";

const RESUBSCRIBE_AFTER = Duration.seconds(5);
const WATCHED_EVENTS = ["thread.pull-request-link-updated", "thread.settled"] as const;
type WatchedEvent = (typeof WATCHED_EVENTS)[number];

type Threads = Pick<
  ThreadManagement.ThreadManagementService["Service"],
  "getThreadShell" | "streamStoredEventsFrom"
>;

/** Matches one stored event against every trigger; pull request state is shared by all of them. */
export const handleStoredEvent = Effect.fnUntraced(function* (
  triggers: Pick<BotTriggers["Service"], "handleEvent" | "store">,
  threads: Threads,
  stored: OrchestrationV2StoredEvent,
) {
  const { event } = stored;
  const occurredAt = DateTime.formatIso(event.occurredAt);
  if (event.type === "thread.settled") {
    const matched = matchThreadSettled(event.payload, stored.sequence, occurredAt);
    if (matched !== null) yield* triggers.handleEvent(matched);
    return;
  }
  if (event.type !== "thread.pull-request-link-updated") return;
  const link = event.payload;
  const key = pullRequestKey(link);
  const previous = yield* triggers.store.getPullRequest(key);
  const shell = yield* threads
    .getThreadShell(event.threadId)
    .pipe(Effect.orElseSucceed(() => null));
  const { next, events } = matchPullRequestLink(
    link,
    { threadId: event.threadId, projectId: shell?.projectId ?? null },
    previous,
    occurredAt,
  );
  for (const matched of events) yield* triggers.handleEvent(matched);
  if (next !== null) yield* triggers.store.setPullRequest(key, next, occurredAt);
});

/**
 * Follows one event type from its stored cursor, so events sent while the server was down still
 * fire. The first start reads history once to learn pull request state; a trigger never fires for
 * an event from before it was created.
 */
const follow = Effect.fn("BotTriggerReactor.follow")(
  function* (triggers: BotTriggers["Service"], threads: Threads, eventType: WatchedEvent) {
    const afterSequence = (yield* triggers.store.getCursor(eventType)) ?? 0;
    // The bounded stream can drop a slow reader; the cursor makes resubscribing lossless.
    yield* threads.streamStoredEventsFrom({ afterSequence, eventType }).pipe(
      Stream.runForEach((stored) =>
        handleStoredEvent(triggers, threads, stored).pipe(
          Effect.catchCause((cause) => Effect.logWarning("Bot trigger event failed", { cause })),
          Effect.andThen(triggers.store.setCursor(eventType, stored.sequence)),
        ),
      ),
    );
  },
  (effect, _triggers, _threads, eventType) =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Bot trigger stream failed; resubscribing", { eventType, cause }),
      ),
      Effect.andThen(Effect.sleep(RESUBSCRIBE_AFTER)),
      Effect.forever,
    ),
);

export const BotTriggerReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const triggers = yield* BotTriggers;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    yield* triggers.store
      .prunePullRequests(isoAt(now - PR_STATE_IDLE_MS))
      .pipe(Effect.ignore({ log: true }));
    for (const eventType of WATCHED_EVENTS) yield* forkParked(follow(triggers, threads, eventType));
  }),
);
