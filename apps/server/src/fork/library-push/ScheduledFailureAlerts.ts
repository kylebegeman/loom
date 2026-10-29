import type { ScheduledTask } from "@t3tools/contracts";
import type { LibraryPushActivityRequest } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ScheduledTaskService } from "../../scheduledTasks/ScheduledTaskService.ts";
import { forkParked } from "../../serverActivation.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import { type AgentAlertOutcome, remoteAgentAlertPost } from "./AgentAlerts.ts";
import { LibraryPushService } from "./LibraryPushService.ts";

type TaskRun = Pick<ScheduledTask, "id" | "lastRunAt" | "lastRunStatus">;
type FailureRequest = Extract<LibraryPushActivityRequest, { kind: "scheduled-failed" }>;

export const makeScheduledFailureAlerts = Effect.fn("ScheduledFailureAlerts.make")(function (
  post: (request: FailureRequest) => Effect.Effect<AgentAlertOutcome>,
) {
  return Effect.sync(() => {
    let seen: ReadonlyMap<string, string> | null = null;
    let warned = false;
    const observe = Effect.fn("ScheduledFailureAlerts.observe")(function* (
      tasks: readonly TaskRun[],
    ) {
      const previous = seen;
      seen = new Map(
        tasks.map((task) => [task.id, `${task.lastRunAt ?? ""}:${task.lastRunStatus}`]),
      );
      if (previous === null) return;
      for (const task of tasks) {
        if (task.lastRunStatus !== "failed" || previous.get(task.id) === seen.get(task.id))
          continue;
        const outcome = yield* post({ kind: "scheduled-failed", taskId: task.id });
        if (outcome === "unsupported-kind" && !warned) {
          warned = true;
          yield* Effect.logInfo(
            "This Library needs an update before it can send scheduled-task failure notifications.",
          );
        }
      }
    });
    return { observe };
  });
});

export const ScheduledFailureAlertsLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const connection = yield* (yield* LibraryConnection.LibraryConnectionService).current.pipe(
      Effect.orElseSucceed((): LibraryConnection.LibraryConnection => ({ kind: "unavailable" })),
    );
    const push = yield* LibraryPushService;
    const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
    const post =
      connection.kind === "remote"
        ? remoteAgentAlertPost(connection)
        : connection.kind === "authority" && push.alerts
          ? (request: FailureRequest) =>
              push.alert(environmentId, request).pipe(
                Effect.map(() => "sent" as const),
                Effect.catchTags({
                  LibraryPushError: () => Effect.succeed("unreachable" as const),
                }),
              )
          : null;
    if (post === null) return;
    const alerts = yield* makeScheduledFailureAlerts(post);
    const tasks = yield* ScheduledTaskService;
    yield* forkParked(
      Stream.runForEach(tasks.subscribeList(), (snapshot) => alerts.observe(snapshot.tasks)).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Scheduled-task failure notifications stopped", { cause }),
        ),
      ),
    );
  }),
).pipe(Layer.provide(LibraryConnection.layer));
