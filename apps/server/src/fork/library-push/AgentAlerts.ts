import type {
  EnvironmentId,
  OrchestrationV2DomainEvent,
  OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import {
  isBotRunThreadId,
  LIBRARY_PUSH_ACTIVITY_ROUTE,
  type LibraryPushThreadActivityKind,
  LibraryPushActivityReply,
  type LibraryPushActivityRequest,
} from "@t3tools/contracts/fork";
import { type AgentAwarenessPhase, projectThreadAwarenessV2 } from "@t3tools/shared/agentAwareness";
import { threadCompletionAlertMuted } from "@t3tools/shared/fork/thread-alerts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClientRequest } from "effect/http";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import {
  makeAgentAwarenessPublishWorker,
  shouldPublishAgentAwarenessEvent,
} from "../../relay/AgentAwarenessRelay.ts";
import { forkParked } from "../../serverActivation.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import { LibraryPushService } from "./LibraryPushService.ts";
import { UnheardAlertNotices } from "./UnheardAlertNotices.ts";

/**
 * Agent alerts (C04-10). Each computer decides which of its threads need the user and tells its
 * Library, and the Library decides whose iPhones hear about it and how often.
 */

/** A transition first seen this long after it happened, as on an unarchived thread, is old news. */
const FRESH_MS = 2 * 60_000;
/** The post is one small JSON body, so a Library that takes longer is down. */
const POST_TIMEOUT = "20 seconds";

/** `unheard` is an alert the Library accepted while no recipient had an iPhone registered. */
export type AgentAlertOutcome =
  | "sent"
  | "unheard"
  | "dropped"
  | "unsupported"
  | "refused"
  | "unreachable"
  | "unsupported-kind";
type AgentAlertPost = (
  request: Extract<LibraryPushActivityRequest, { threadId: ThreadId }>,
) => Effect.Effect<AgentAlertOutcome>;

/**
 * How long this computer stops posting after each outcome. Nothing is queued or retried, since a
 * late alert is worse than none.
 */
const PAUSE_MS: Readonly<Record<AgentAlertOutcome, number>> = {
  sent: 0,
  // An iPhone can register at any moment, and the thread says what was missed.
  unheard: 0,
  // Invalid, too large or over the hourly limit: only that one alert is lost.
  dropped: 0,
  // A Library from before alerts, or with them off, answers the same way until it is redeployed.
  unsupported: 30 * 60_000,
  "unsupported-kind": 0,
  // A refused sign-in or a computer missing from the directory needs someone to act first.
  refused: 30 * 60_000,
  unreachable: 60_000,
};

/** What this computer last saw of a thread. */
interface SeenThread {
  /** The last transition that needed the user, so later changes to the thread do not repeat it. */
  readonly key: string | null;
  /** A thread seen working makes its next transition news, however long the run took. */
  readonly working: boolean;
}

interface Attention {
  readonly kind: LibraryPushThreadActivityKind;
  readonly key: string;
  readonly atMs: number | null;
}

const NO_PROJECT = { title: "" };

const attentionOf = (
  phase: AgentAwarenessPhase,
  shell: OrchestrationV2ThreadShell,
): Attention | null => {
  switch (phase) {
    case "waiting_for_approval":
    case "waiting_for_input": {
      const request = shell.pendingRuntimeRequest;
      if (request === null) return null;
      const kind = phase === "waiting_for_approval" ? "approval" : "input";
      return {
        kind,
        key: `${kind}:${request.id}`,
        atMs: DateTime.toEpochMillis(request.createdAt),
      };
    }
    case "completed":
    case "failed": {
      if (shell.latestRunId === null) return null;
      const kind =
        phase === "completed"
          ? "completed"
          : shell.lastErrorClass === "usage_limit"
            ? "limited"
            : "failed";
      return {
        kind,
        key: `${kind}:${shell.latestRunId}`,
        atMs:
          shell.latestRunCompletedAt == null
            ? null
            : DateTime.toEpochMillis(shell.latestRunCompletedAt),
      };
    }
    case "starting":
    case "running":
    case "stale":
      return null;
  }
};

/**
 * One look at a thread. The phases and the settled rule are the relay's, so every surface agrees on
 * what needs the user. Bot runs alert only for approvals and input; snoozed or settled threads keep
 * completions quiet by the same rule as desktop alerts.
 */
export const agentAlertStep = (
  previous: SeenThread | undefined,
  shell: OrchestrationV2ThreadShell,
  input: { readonly environmentId: EnvironmentId; readonly nowMs: number },
): { readonly seen: SeenThread; readonly alert: LibraryPushThreadActivityKind | null } => {
  const awareness =
    shell.archivedAt !== null || shell.deletedAt !== null
      ? null
      : projectThreadAwarenessV2({
          environmentId: input.environmentId,
          project: NO_PROJECT,
          thread: shell,
        });
  const candidate = awareness === null ? null : attentionOf(awareness.phase, shell);
  const attention =
    isBotRunThreadId(shell.id) && candidate?.kind !== "approval" && candidate?.kind !== "input"
      ? null
      : candidate;
  if (attention === null) {
    const working = awareness?.phase === "starting" || awareness?.phase === "running";
    // The key stays, so settling and unsettling a thread never repeats its last alert.
    return { seen: { key: previous?.key ?? null, working }, alert: null };
  }
  const seen = { key: attention.key, working: false };
  if (attention.key === previous?.key) return { seen, alert: null };
  const fresh =
    previous?.working === true ||
    (attention.atMs !== null && input.nowMs - attention.atMs <= FRESH_MS);
  const muted =
    attention.kind === "completed" &&
    threadCompletionAlertMuted(shell, DateTime.makeUnsafe(input.nowMs));
  return { seen, alert: fresh && !muted ? attention.kind : null };
};

/** Follows thread changes and posts each new transition once. */
export const makeAgentAlerts = Effect.fn("AgentAlerts.make")(function* (input: {
  readonly environmentId: EnvironmentId;
  readonly post: AgentAlertPost;
  /** Tells the thread its alert reached no iPhone. */
  readonly unheard: (threadId: ThreadId) => Effect.Effect<void>;
}) {
  const threads = yield* ThreadManagementService;
  const seen = new Map<ThreadId, SeenThread>();
  // The worker looks at one thread at a time, so this state needs no lock.
  let pausedUntilMs = 0;

  const check = Effect.fn("AgentAlerts.check")(
    function* (threadId: ThreadId) {
      const shell = yield* threads.getThreadShell(threadId);
      if (shell === null || shell.deletedAt !== null) {
        seen.delete(threadId);
        return;
      }
      const nowMs = yield* Clock.currentTimeMillis;
      const step = agentAlertStep(seen.get(threadId), shell, {
        environmentId: input.environmentId,
        nowMs,
      });
      seen.set(threadId, step.seen);
      if (step.alert === null || nowMs < pausedUntilMs) return;
      const outcome = yield* input.post({ threadId, kind: step.alert });
      if (outcome === "unheard") yield* input.unheard(threadId);
      if (PAUSE_MS[outcome] > 0)
        pausedUntilMs = (yield* Clock.currentTimeMillis) + PAUSE_MS[outcome];
      yield* Effect.logDebug("Agent alert posted", { kind: step.alert, outcome });
    },
    // A missed alert is the only symptom, so nothing here reaches the log above debug.
    Effect.catchCause((cause) => Effect.logDebug("Agent alert check failed", { cause })),
  );
  const worker = yield* makeAgentAwarenessPublishWorker(check);

  /** Records what every thread already shows, so a restart repeats no alert. */
  const seed = Effect.gen(function* () {
    const snapshot = yield* threads.getShellSnapshot();
    const nowMs = yield* Clock.currentTimeMillis;
    for (const shell of snapshot.threads) {
      const step = agentAlertStep(undefined, shell, { environmentId: input.environmentId, nowMs });
      seen.set(shell.id, step.seen);
    }
  });

  const observe = (event: OrchestrationV2DomainEvent) =>
    shouldPublishAgentAwarenessEvent(event) ? worker.enqueue(event.threadId) : Effect.void;

  return { seed, observe, drain: worker.drain };
});

const decodeReply = Schema.decodeUnknownEffect(LibraryPushActivityReply);

type MissingReply = Exclude<AgentAlertOutcome, "sent" | "unheard">;

const outcomeOfStatus = (status: number): MissingReply => {
  switch (status) {
    // No route, or alerts off on this Library.
    case 404:
    case 405:
      return "unsupported";
    case 401:
    case 403:
    case 409:
      return "refused";
    case 400:
    case 413:
    case 429:
      return "dropped";
    default:
      return "unreachable";
  }
};

type RemoteLibrary = Pick<
  Extract<LibraryConnection.LibraryConnection, { readonly kind: "remote" }>,
  "endpoint" | "send"
>;

/**
 * Posts one activity over the publisher session, which names this computer to the Library. Answers
 * the Library's reply, or the outcome that stands in for a missing one; it never fails.
 */
export const postLibraryActivity = (
  library: RemoteLibrary,
  request: LibraryPushActivityRequest,
): Effect.Effect<LibraryPushActivityReply | MissingReply> =>
  library
    .send(
      HttpClientRequest.post(library.endpoint(LIBRARY_PUSH_ACTIVITY_ROUTE)).pipe(
        HttpClientRequest.bodyJsonUnsafe(request),
      ),
    )
    .pipe(
      Effect.flatMap((response) =>
        response.status === 400 && request.kind === "scheduled-failed"
          ? Effect.succeed("unsupported-kind" as const)
          : response.status >= 200 && response.status < 300
            ? // A proxy's sign-in page or an older Library's app shell can also answer 200.
              response.json.pipe(
                Effect.flatMap(decodeReply),
                Effect.orElseSucceed((): MissingReply => "unsupported"),
              )
            : Effect.succeed(outcomeOfStatus(response.status)),
      ),
      Effect.catchTags({
        LibraryError: (error) =>
          Effect.succeed<MissingReply>(error.reason === "blocked" ? "refused" : "unreachable"),
      }),
      Effect.timeout(POST_TIMEOUT),
      Effect.orElseSucceed((): MissingReply => "unreachable"),
    );

/** A Library from before the device count omits it, so its accepted alerts all read as sent. */
const acceptedOutcome = (reply: LibraryPushActivityReply): AgentAlertOutcome =>
  reply.devices === 0 ? "unheard" : "sent";

export const remoteAgentAlertPost =
  (
    library: RemoteLibrary,
  ): ((request: LibraryPushActivityRequest) => Effect.Effect<AgentAlertOutcome>) =>
  (request) =>
    postLibraryActivity(library, request).pipe(
      Effect.map((answer) => (typeof answer === "string" ? answer : acceptedOutcome(answer))),
    );

const authorityPost =
  (push: LibraryPushService["Service"], environmentId: EnvironmentId): AgentAlertPost =>
  (request) =>
    push.alert(environmentId, request).pipe(
      Effect.map(acceptedOutcome),
      Effect.catchTags({
        LibraryPushError: (error) =>
          Effect.succeed<AgentAlertOutcome>(
            error.reason === "rate-limited"
              ? "dropped"
              : error.reason === "off" || error.reason === "misconfigured"
                ? "unsupported"
                : "unreachable",
          ),
      }),
    );

/**
 * The Library posts its own threads in process; other computers post over their publisher session.
 * The connection is read once at start, as the directory reporter reads it, so a new sign-in takes
 * a restart. Without a usable Library there is no one to tell.
 */
export const AgentAlertsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const connection = yield* (yield* LibraryConnection.LibraryConnectionService).current.pipe(
      Effect.orElseSucceed((): LibraryConnection.LibraryConnection => ({ kind: "unavailable" })),
    );
    const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
    const push = yield* LibraryPushService;
    const post =
      connection.kind === "remote"
        ? remoteAgentAlertPost(connection)
        : // The Library knows its own switch, so it watches nothing while alerts are off.
          connection.kind === "authority" && push.alerts
          ? authorityPost(push, environmentId)
          : null;
    if (post === null) return;
    const threads = yield* ThreadManagementService;
    const notices = yield* UnheardAlertNotices;
    const alerts = yield* makeAgentAlerts({
      environmentId,
      post,
      unheard: (threadId) => notices.post(threadId, "agent"),
    });
    yield* forkParked(
      alerts.seed.pipe(
        // Without the seed a thread's first look goes by time alone, which still alerts nothing old.
        Effect.catchCause((cause) =>
          Effect.logDebug("Agent alerts started without a seed", { cause }),
        ),
        Effect.andThen(Stream.runForEach(threads.streamDomainEvents, alerts.observe)),
        Effect.catchCause((cause) => Effect.logWarning("Agent alerts stopped", { cause })),
      ),
    );
  }),
).pipe(Layer.provide(LibraryConnection.layer));
