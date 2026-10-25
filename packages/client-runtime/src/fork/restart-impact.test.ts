import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationV2PendingBackgroundTask } from "@t3tools/contracts";
import { derivePendingBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

import { v2ThreadShell } from "../state/orchestrationV2TestFixtures.ts";
import {
  collectRestartImpact,
  describeRestartImpact,
  NO_RESTART_IMPACT,
  type RestartImpactThread,
  threadRestartImpact,
} from "./restart-impact.ts";

const thread = (overrides: Partial<RestartImpactThread> = {}): RestartImpactThread => ({
  ...v2ThreadShell,
  status: "completed",
  activityRunStatus: null,
  ...overrides,
});

const task = (
  kind: OrchestrationV2PendingBackgroundTask["kind"],
  taskId: string = kind,
): OrchestrationV2PendingBackgroundTask => ({ taskId, kind });

describe("threadRestartImpact", () => {
  it.each(["preparing", "queued", "starting", "running", "waiting"] as const)(
    "counts a %s run as working",
    (status) => {
      expect(threadRestartImpact(thread({ status }))).toBe("working");
    },
  );

  it("counts a live run behind a newer settled one", () => {
    expect(threadRestartImpact(thread({ activityRunStatus: "running" }))).toBe("working");
  });

  it("reads the latest run on servers without activity status", () => {
    const { activityRunStatus: _, ...older } = thread({ status: "running" });
    expect(threadRestartImpact(older)).toBe("working");
  });

  it("leaves settled and idle threads alone", () => {
    expect(threadRestartImpact(thread())).toBeNull();
    expect(threadRestartImpact(thread({ status: "idle" }))).toBeNull();
    expect(threadRestartImpact(thread({ status: "interrupted" }))).toBeNull();
  });

  it.each(["subagent", "monitor", "background_task"] as const)(
    "counts a settled turn waiting on a %s",
    (kind) => {
      expect(threadRestartImpact(thread({ pendingBackgroundTasks: [task(kind)] }))).toBe(
        "background",
      );
    },
  );

  it("does not count a background shell command", () => {
    expect(threadRestartImpact(thread({ pendingBackgroundTasks: [task("command")] }))).toBeNull();
  });

  it("does not count a pull request watch, which survives the restart", () => {
    const watches = derivePendingBackgroundWork({
      latestRun: { id: "run-1" as never, ordinal: 1, status: "completed" },
      providerThreads: [],
      turnItems: [],
      pullRequests: [
        {
          host: "github.com",
          repository: "acme/app",
          number: 1,
          url: "https://github.com/acme/app/pull/1",
          source: "agent",
          watch: {
            startedAt: "2026-10-05T00:00:00.000Z",
            headSha: null,
            failedChecks: [],
            passed: false,
            passedChecks: [],
            remarksThrough: "2026-10-05T00:00:00.000Z",
            remarkIds: [],
            conflicting: false,
            wakes: 0,
          },
        },
      ],
    });
    expect(watches.map(({ kind }) => kind)).toEqual(["monitor"]);
    expect(threadRestartImpact(thread({ pendingBackgroundTasks: watches }))).toBeNull();
    expect(
      threadRestartImpact(thread({ pendingBackgroundTasks: [...watches, task("subagent")] })),
    ).toBe("background");
  });
});

describe("collectRestartImpact", () => {
  it("splits interrupted threads by whether their server continues them", () => {
    expect(
      collectRestartImpact([
        {
          continuesThreads: false,
          threads: [
            thread({ status: "running" }),
            thread({ title: "Nightly report", pendingBackgroundTasks: [task("monitor")] }),
            thread(),
          ],
        },
        { continuesThreads: true, threads: [thread({ status: "queued" })] },
      ]),
    ).toEqual({ stopped: 2, continuing: 1, background: ["Nightly report"] });
  });

  it("reports no impact when nothing is working", () => {
    expect(collectRestartImpact([{ continuesThreads: false, threads: [thread()] }])).toBe(
      NO_RESTART_IMPACT,
    );
  });
});

describe("describeRestartImpact", () => {
  it("says nothing when no work is interrupted", () => {
    expect(describeRestartImpact(NO_RESTART_IMPACT)).toEqual([]);
  });

  it("says which interrupted threads can resume", () => {
    expect(describeRestartImpact({ stopped: 0, continuing: 1, background: [] })).toEqual([
      "1 thread with work in progress will be interrupted and can resume after the restart.",
    ]);
    expect(describeRestartImpact({ stopped: 2, continuing: 0, background: [] })).toEqual([
      "2 threads with work in progress will be interrupted.",
    ]);
    expect(describeRestartImpact({ stopped: 2, continuing: 1, background: [] })).toEqual([
      "3 threads with work in progress will be interrupted. 1 can resume after the restart.",
    ]);
  });

  it("names the threads waiting on background work", () => {
    expect(describeRestartImpact({ stopped: 2, continuing: 0, background: ["Fix login"] })).toEqual(
      [
        "2 threads with work in progress will be interrupted.",
        'Waiting on background work: "Fix login".',
      ],
    );
    expect(
      describeRestartImpact({
        stopped: 5,
        continuing: 0,
        background: ["A", "B", "C", "D", "E"],
      })[1],
    ).toBe('Waiting on background work: "A", "B", "C", and 2 more.');
  });
});
