import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ScheduledTaskId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2PendingRuntimeRequestSummary,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import {
  LIBRARY_PUSH_ACTIVITY_ROUTE,
  LibraryError,
  type LibraryPushActivityKind,
  type LibraryPushActivityRequest,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { type HttpClientRequest, HttpClientResponse } from "effect/http";

import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import {
  type AgentAlertOutcome,
  agentAlertStep,
  makeAgentAlerts,
  remoteAgentAlertPost,
} from "./AgentAlerts.ts";

const ENVIRONMENT_ID = EnvironmentId.make("computer-1");
const THREAD_ID = ThreadId.make("thread-1");
const RUN_ID = RunId.make("run-1");
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const MINUTE = 60_000;
const at = (millis: number) => DateTime.makeUnsafe(millis);

function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  const id = overrides.id ?? THREAD_ID;
  return {
    id,
    projectId: ProjectId.make("project-1"),
    title: "Private thread title",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "private-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "idle",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: at(NOW - 60 * MINUTE),
    updatedAt: at(NOW),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

const running = (overrides: Partial<OrchestrationV2ThreadShell> = {}) =>
  shell({ status: "running", activityRunStatus: "running", latestRunId: RUN_ID, ...overrides });

const ended = (
  status: "completed" | "failed",
  endedAgoMs: number,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
) =>
  shell({
    status,
    latestRunId: RUN_ID,
    latestRunCompletedAt: at(NOW - endedAgoMs),
    ...overrides,
  });

const waitingOn = (
  kind: OrchestrationV2PendingRuntimeRequestSummary["kind"],
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
) =>
  running({
    pendingRuntimeRequest: { id: RuntimeRequestId.make(id), kind, createdAt: at(NOW) },
    ...overrides,
  });

/** Each look at the same thread, in order, and the alert it raised. */
const alertsFor = (looks: ReadonlyArray<OrchestrationV2ThreadShell>) => {
  let seen: Parameters<typeof agentAlertStep>[0];
  return looks.map((look) => {
    const step = agentAlertStep(seen, look, { environmentId: ENVIRONMENT_ID, nowMs: NOW });
    seen = step.seen;
    return step.alert;
  });
};

describe("agentAlertStep", () => {
  it("alerts a run it saw working when the run ends, however long it ran", () => {
    expect(alertsFor([running(), ended("completed", 30 * MINUTE)])).toEqual([null, "completed"]);
  });

  it("alerts a transition it did not see coming only while the transition is fresh", () => {
    expect(alertsFor([ended("completed", MINUTE)])).toEqual(["completed"]);
    // An unarchived or newly transferred thread brings its old result with it.
    expect(alertsFor([ended("completed", 10 * MINUTE)])).toEqual([null]);
  });

  it("names approvals, questions, failures and usage limits, and repeats none of them", () => {
    expect(
      alertsFor([
        waitingOn("command", "request-1"),
        waitingOn("command", "request-1"),
        waitingOn("user_input", "request-2"),
      ]),
    ).toEqual(["approval", null, "input"]);
    expect(alertsFor([running(), ended("failed", 0), ended("failed", 0)])).toEqual([
      null,
      "failed",
      null,
    ]);
    expect(alertsFor([running(), ended("failed", 0, { lastErrorClass: "usage_limit" })])).toEqual([
      null,
      "limited",
    ]);
  });

  it("keeps a snoozed thread's result quiet, and lets a failure or a question wake it", () => {
    const snoozed = { snoozedUntil: at(NOW + 60 * MINUTE), snoozedAt: at(NOW - 60 * MINUTE) };
    expect(
      alertsFor([running(snoozed), ended("completed", 0, snoozed), ended("completed", 0)]),
    ).toEqual([null, null, null]);
    expect(alertsFor([running(snoozed), ended("failed", 0, snoozed)])).toEqual([null, "failed"]);
    expect(alertsFor([running(snoozed), waitingOn("user_input", "request-3", snoozed)])).toEqual([
      null,
      "input",
    ]);
  });

  it("does not repeat a result after the thread is settled and unsettled", () => {
    expect(
      alertsFor([
        running(),
        ended("completed", 0),
        ended("completed", 0, { settledOverride: "settled" }),
        ended("completed", 0),
      ]),
    ).toEqual([null, "completed", null, null]);
  });

  it("alerts bot approvals and questions while keeping their outcomes quiet", () => {
    const bot = { id: ThreadId.make("bot-run-1") };
    expect(
      alertsFor([
        running(bot),
        waitingOn("command", "request-1", bot),
        waitingOn("user_input", "request-2", bot),
        ended("completed", 0, bot),
        ended("failed", 0, bot),
      ]),
    ).toEqual([null, "approval", "input", null, null]);
  });

  it("leaves settled, archived and subagent threads alone", () => {
    const quiet: ReadonlyArray<Partial<OrchestrationV2ThreadShell>> = [
      { settledOverride: "settled" },
      { archivedAt: at(NOW) },
      {
        lineage: {
          rootThreadId: ThreadId.make("parent"),
          parentThreadId: ThreadId.make("parent"),
          relationshipToParent: "subagent",
        },
      },
    ];
    for (const overrides of quiet) {
      expect(alertsFor([running(overrides), ended("completed", 0, overrides)])).toEqual([
        null,
        null,
      ]);
    }
  });
});

/** A domain event the relay also reacts to. */
const changed = (threadId: ThreadId) =>
  ({ type: "run.updated", threadId, payload: {} }) as unknown as OrchestrationV2DomainEvent;

const harness = Effect.fn("test.harness")(function* (
  initial: ReadonlyArray<OrchestrationV2ThreadShell>,
  outcomes: Array<AgentAlertOutcome> = [],
) {
  yield* TestClock.setTime(NOW);
  const shells = new Map(initial.map((thread) => [thread.id, thread]));
  const posts: Array<Extract<LibraryPushActivityRequest, { threadId: ThreadId }>> = [];
  const unheard: Array<ThreadId> = [];
  const alerts = yield* makeAgentAlerts({
    environmentId: ENVIRONMENT_ID,
    post: (request) =>
      Effect.sync(() => {
        posts.push(request);
        return outcomes.shift() ?? "sent";
      }),
    unheard: (threadId) => Effect.sync(() => void unheard.push(threadId)),
  }).pipe(
    Effect.provide(
      Layer.mock(ThreadManagementService)({
        getThreadShell: (threadId) => Effect.sync(() => shells.get(threadId) ?? null),
        getShellSnapshot: () =>
          Effect.sync(
            () =>
              ({
                schemaVersion: 1,
                snapshotSequence: 0,
                threads: [...shells.values()],
                archivedThreads: [],
              }) as never,
          ),
      }),
    ),
  );
  yield* alerts.seed;
  const change = Effect.fn("test.change")(function* (next: OrchestrationV2ThreadShell) {
    shells.set(next.id, next);
    yield* alerts.observe(changed(next.id));
    yield* alerts.drain;
  });
  /** A thread seen working, then finishing now. */
  const finish = Effect.fn("test.finish")(function* (threadId: ThreadId) {
    yield* change(running({ id: threadId }));
    yield* change(ended("completed", 0, { id: threadId }));
  });
  return { posts, unheard, change, finish };
});

const posted = (threadId: ThreadId, kind: LibraryPushActivityKind) => ({ threadId, kind });

describe("makeAgentAlerts", () => {
  it.effect("posts each new transition once, and nothing the seed already saw", () =>
    Effect.gen(function* () {
      const waiting = waitingOn("command", "request-1");
      const second = ThreadId.make("thread-2");
      const { posts, change, finish } = yield* harness([waiting, running({ id: second })]);

      yield* change(waiting);
      expect(posts).toEqual([]);

      yield* finish(second);
      yield* change(ended("completed", 0, { id: second }));
      expect(posts).toEqual([posted(second, "completed")]);
    }).pipe(Effect.scoped),
  );

  it.effect.each<readonly [AgentAlertOutcome, number]>([
    ["unsupported", 30 * MINUTE],
    ["refused", 30 * MINUTE],
    ["unreachable", MINUTE],
  ])("stops posting after a Library answers %s, and tries again later", ([outcome, pauseMs]) =>
    Effect.gen(function* () {
      const { posts, finish } = yield* harness([], [outcome]);
      yield* finish(ThreadId.make("first"));
      yield* TestClock.adjust(pauseMs - 1_000);
      yield* finish(ThreadId.make("during"));
      expect(posts.map((post) => post.threadId)).toEqual(["first"]);

      yield* TestClock.adjust(1_000);
      yield* finish(ThreadId.make("after"));
      expect(posts.map((post) => post.threadId)).toEqual(["first", "after"]);
    }).pipe(Effect.scoped),
  );

  it.effect("tells the thread when its alert reached no iPhone, and keeps posting", () =>
    Effect.gen(function* () {
      const { posts, unheard, finish } = yield* harness([], ["unheard", "sent"]);
      yield* finish(ThreadId.make("first"));
      yield* finish(ThreadId.make("second"));
      expect(posts.map((post) => post.threadId)).toEqual(["first", "second"]);
      expect(unheard).toEqual(["first"]);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps posting after one alert is dropped", () =>
    Effect.gen(function* () {
      const { posts, finish } = yield* harness([], ["dropped"]);
      yield* finish(ThreadId.make("first"));
      yield* finish(ThreadId.make("second"));
      expect(posts.map((post) => post.threadId)).toEqual(["first", "second"]);
    }).pipe(Effect.scoped),
  );
});

const ACTIVITY: LibraryPushActivityRequest = { threadId: THREAD_ID, kind: "completed" };

const libraryAnswering = (
  answer: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, LibraryError>,
) => ({
  endpoint: (path: string) => new URL(path, "https://library.example.test").toString(),
  send: answer,
});

const respond = (response: Response) =>
  libraryAnswering((request) => Effect.succeed(HttpClientResponse.fromWeb(request, response)));

describe("remoteAgentAlertPost", () => {
  it.effect("posts the thread and kind to the Library's activity route", () =>
    Effect.gen(function* () {
      const requests: Array<HttpClientRequest.HttpClientRequest> = [];
      const outcome = yield* remoteAgentAlertPost(
        libraryAnswering((request) => {
          requests.push(request);
          return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ sent: 1 })));
        }),
      )(ACTIVITY);
      expect(outcome).toBe("sent");
      const [request] = requests;
      expect(request?.method).toBe("POST");
      expect(request?.url).toBe(`https://library.example.test${LIBRARY_PUSH_ACTIVITY_ROUTE}`);
      expect(request?.body._tag).toBe("Uint8Array");
      if (request?.body._tag === "Uint8Array")
        expect(JSON.parse(new TextDecoder().decode(request.body.body))).toEqual(ACTIVITY);
    }),
  );

  it.effect.each<readonly [string, AgentAlertOutcome, () => Response]>([
    ["no registered iPhone", "unheard", () => Response.json({ sent: 0, devices: 0 })],
    ["an iPhone over its limit", "sent", () => Response.json({ sent: 0, devices: 1 })],
    ["an older Library's reply", "sent", () => Response.json({ sent: 0 })],
    ["an app page", "unsupported", () => new Response("<html></html>", { status: 200 })],
    ["another JSON shape", "unsupported", () => Response.json({ ok: true })],
    ["404", "unsupported", () => new Response(null, { status: 404 })],
    ["405", "unsupported", () => new Response(null, { status: 405 })],
    ["401", "refused", () => new Response(null, { status: 401 })],
    ["403", "refused", () => new Response(null, { status: 403 })],
    ["409", "refused", () => Response.json({ reason: "not-in-directory" }, { status: 409 })],
    ["400", "dropped", () => Response.json({ reason: "invalid" }, { status: 400 })],
    ["413", "dropped", () => Response.json({ reason: "too-large" }, { status: 413 })],
    ["429", "dropped", () => Response.json({ reason: "rate-limited" }, { status: 429 })],
    ["503", "unreachable", () => Response.json({ reason: "unavailable" }, { status: 503 })],
  ])("reads %s as %s", ([, outcome, response]) =>
    Effect.gen(function* () {
      expect(yield* remoteAgentAlertPost(respond(response()))(ACTIVITY)).toBe(outcome);
    }),
  );

  it.effect("reads a missing sign-in as refused and a failed request as unreachable", () =>
    Effect.gen(function* () {
      expect(
        yield* remoteAgentAlertPost(respond(new Response(null, { status: 400 })))({
          kind: "scheduled-failed",
          taskId: ScheduledTaskId.make("task-1"),
        }),
      ).toBe("unsupported-kind");
      const failing = (reason: "blocked" | "io") =>
        remoteAgentAlertPost(libraryAnswering(() => Effect.fail(new LibraryError({ reason }))))(
          ACTIVITY,
        );
      expect(yield* failing("blocked")).toBe("refused");
      expect(yield* failing("io")).toBe("unreachable");
    }),
  );
});
