import { describe, expect, it } from "vite-plus/test";
import { Atom, AtomRegistry } from "effect/reactivity";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { BotRun, BotsInboxPage } from "@t3tools/contracts/fork";
import {
  applyInboxChanges,
  makeWaitingBotRunsAtom,
  waitingBotRunThreads,
  type WaitingBotRunThread,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  TRIAGE_REPEAT_MIN,
  combineTriagePages,
  dismissibleRuns,
  foldRepeats,
  groupTriage,
  needsPerson,
  olderCursor,
  orderTriage,
  outsideInboxWindow,
  triageBotCounts,
  triageBotState,
  triageEvidence,
  triageItems,
  triageReasonLabel,
  triageRunItem,
  triageTone,
  triageVerb,
} from "./inboxWaiting";
import { makeBotDefinition, makeBotRun } from "./testFixtures";

type WaitingShell = EnvironmentThreadShell & { readonly pendingRuntimeRequestAt?: string | null };
const shell = (fields: Partial<WaitingShell> = {}): WaitingShell =>
  ({
    environmentId: EnvironmentId.make("test"),
    id: ThreadId.make("bot-run-one"),
    title: "Reviewer",
    hasPendingApprovals: true,
    hasPendingUserInput: false,
    archivedAt: null,
    pendingRuntimeRequestAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:01:00.000Z",
    ...fields,
  }) as WaitingShell;

describe("waiting bot inbox", () => {
  it("retains request time separately from later thread activity and supports older shells", () => {
    const [waiting] = waitingBotRunThreads([shell()]);
    expect(waiting?.waitingSince).toBe("2026-10-20T10:00:00.000Z");
    expect(waiting?.updatedAt).toBe("2026-10-20T10:01:00.000Z");
    expect(
      waitingBotRunThreads([shell({ pendingRuntimeRequestAt: null })])[0]?.waitingSince,
    ).toBeNull();
  });

  it("publishes replacement requests and environment changes without rerendering for unrelated shell edits", () => {
    const original = shell();
    const source = Atom.make<ReadonlyArray<WaitingShell>>([original]);
    const waiting = makeWaitingBotRunsAtom(source);
    const registry = AtomRegistry.make();
    const unsubscribe = registry.subscribe(waiting, () => {});
    const first = registry.get(waiting);
    registry.set(source, [{ ...original, visibleItemCount: 4 }]);
    expect(registry.get(waiting)).toBe(first);
    registry.set(source, [{ ...original, pendingRuntimeRequestAt: "2026-10-20T10:02:00.000Z" }]);
    expect(registry.get(waiting)[0]?.waitingSince).toBe("2026-10-20T10:02:00.000Z");
    registry.set(source, [{ ...original, updatedAt: "2026-10-20T10:03:00.000Z" }]);
    expect(registry.get(waiting)[0]?.updatedAt).toBe("2026-10-20T10:03:00.000Z");
    registry.set(source, [{ ...original, environmentId: EnvironmentId.make("another") }]);
    expect(registry.get(waiting)[0]?.environmentId).toBe("another");
    registry.set(source, [{ ...original, hasPendingApprovals: false }]);
    expect(registry.get(waiting)).toEqual([]);
    unsubscribe();
    registry.dispose();
  });
});

const verdict = (
  value: "pass" | "fail" | "needs_attention",
  summary = "Summary line.",
  source: "decoded" | "invalid" = "decoded",
) => ({ verdict: value, summary, findings: [], findingsTruncated: false, source });

const waitingThread = (
  runId: string,
  fields: Partial<WaitingBotRunThread> = {},
): WaitingBotRunThread => ({
  environmentId: EnvironmentId.make("test"),
  id: ThreadId.make(`bot-run-${runId}`),
  title: "Reviewer",
  hasPendingApprovals: false,
  hasPendingUserInput: true,
  updatedAt: "2026-10-20T12:00:00.000Z",
  waitingSince: "2026-10-20T11:00:00.000Z",
  ...fields,
});

const page = (runs: BotRun[], fields: Partial<BotsInboxPage> = {}): BotsInboxPage => ({
  runs,
  total: runs.length,
  hasMore: false,
  ...fields,
});

const ids = (items: readonly { readonly key: string }[]) => items.map((item) => item.key);
const at = (minute: number) => `2026-10-20T10:${String(minute).padStart(2, "0")}:00.000Z`;

describe("combineTriagePages", () => {
  const first = page(
    [makeBotRun("a", { createdAt: at(9) }), makeBotRun("b", { createdAt: at(8) })],
    {
      total: 5,
      hasMore: true,
    },
  );

  it("keeps the first page's more flag until older pages are asked for", () => {
    const combined = combineTriagePages(first, [], { before: null, page: null });
    expect(combined.hasMore).toBe(true);
    expect(combined.total).toBe(5);
  });

  it("assumes more remain while an older page loads, then takes its flag", () => {
    expect(combineTriagePages(first, [], { before: at(8), page: null }).hasMore).toBe(true);
    const last = page(
      [makeBotRun("b", { createdAt: at(8) }), makeBotRun("c", { createdAt: at(7) })],
      {
        hasMore: false,
      },
    );
    const combined = combineTriagePages(first, [], { before: at(8), page: last });
    expect(combined.runs.map((run) => run.id)).toEqual(["a", "b", "c"]);
    expect(combined.hasMore).toBe(false);
  });

  it("joins pages loaded earlier in order", () => {
    const earlier = [makeBotRun("c", { createdAt: at(7) })];
    const combined = combineTriagePages(first, earlier, {
      before: at(7),
      page: page([makeBotRun("d", { createdAt: at(6) })], { hasMore: true }),
    });
    expect(combined.runs.map((run) => run.id)).toEqual(["a", "b", "c", "d"]);
    expect(combined.hasMore).toBe(true);
    expect(olderCursor(combined.runs)).toBe(at(6));
  });
});

describe("outsideInboxWindow", () => {
  const first = page(
    [
      makeBotRun("a", { status: "failed", createdAt: at(9) }),
      makeBotRun("b", { status: "failed", createdAt: at(8) }),
    ],
    { total: 5, hasMore: true },
  );
  const watchedTotal = (run: BotRun) =>
    applyInboxChanges(first, { runs: new Map([[run.id, run]]) }, { dismissed: false }).total;

  it("flags exactly the dismissals the watch cannot count", () => {
    const inside = makeBotRun("b", { status: "failed", createdAt: at(8), dismissedAt: at(20) });
    const older = makeBotRun("c", { status: "failed", createdAt: at(7), dismissedAt: at(20) });
    expect(watchedTotal(inside)).toBe(4);
    expect(outsideInboxWindow(first, [inside.createdAt])).toBe(false);
    expect(watchedTotal(older)).toBe(5);
    expect(outsideInboxWindow(first, [older.createdAt])).toBe(true);
  });

  it("trusts a complete page and doubts a run it cannot date", () => {
    expect(outsideInboxWindow({ ...first, hasMore: false }, [at(1)])).toBe(false);
    expect(outsideInboxWindow(first, [null])).toBe(true);
    expect(outsideInboxWindow(null, [null])).toBe(false);
  });
});

describe("triageItems", () => {
  const failed = makeBotRun("failed", { status: "failed" });
  const paused = makeBotRun("paused", { status: "running", botId: "writer", botName: "Writer" });

  it("joins a waiting thread to its run and skips one whose run is already listed", () => {
    const items = triageItems({
      runs: [failed],
      waiting: [waitingThread("paused"), waitingThread("failed")],
      findRun: (runId) => (runId === "paused" ? paused : undefined),
      bot: null,
    });
    expect(ids(items)).toEqual(["thread:test:bot-run-paused", "run:failed"]);
    const [waiting] = items;
    expect(waiting?.kind === "waiting" && waiting.run?.id).toBe("paused");
    expect(waiting?.botId).toBe("writer");
    expect(waiting?.botName).toBe("Writer");
    expect(waiting?.reason).toBe("question");
    expect(waiting?.at).toBe("2026-10-20T11:00:00.000Z");
  });

  it("falls back to the thread's title and last activity before the run loads", () => {
    const [item] = triageItems({
      runs: [],
      waiting: [
        waitingThread("unknown", { title: "  ", hasPendingApprovals: true, waitingSince: null }),
      ],
      findRun: () => undefined,
      bot: null,
    });
    expect(item?.botId).toBeNull();
    expect(item?.botName).toBe("Bot run");
    expect(item?.reason).toBe("approval");
    expect(item?.at).toBe("2026-10-20T12:00:00.000Z");
  });

  it("narrows to one bot by id, or by name while the run is unknown", () => {
    const items = triageItems({
      runs: [failed, makeBotRun("other", { status: "failed", botId: "writer" })],
      waiting: [
        waitingThread("paused"),
        waitingThread("unloaded", { title: "Reviewer" }),
        waitingThread("elsewhere", { title: "Writer" }),
      ],
      findRun: (runId) => (runId === "paused" ? paused : undefined),
      bot: { id: "reviewer", name: "Reviewer" },
    });
    expect(ids(items)).toEqual(["thread:test:bot-run-unloaded", "run:failed"]);
  });
});

describe("groupTriage", () => {
  it("orders groups by urgency, waits oldest first and finished runs newest first", () => {
    const items = triageItems({
      runs: [
        makeBotRun("stopped", { pipelineRunId: "p", pipelineStopped: true, finishedAt: at(50) }),
        makeBotRun("unsure", { verdict: verdict("needs_attention"), finishedAt: at(40) }),
        makeBotRun("late", { status: "timed_out", finishedAt: at(20) }),
        makeBotRun("broke", { status: "failed", finishedAt: at(30) }),
      ],
      waiting: [
        waitingThread("recent", { waitingSince: at(45) }),
        waitingThread("long", { waitingSince: at(15) }),
      ],
      findRun: () => undefined,
      bot: null,
    });
    const sections = groupTriage(items);
    expect(sections.map((section) => section.group)).toEqual([
      "waiting",
      "failed",
      "undecided",
      "pipeline",
    ]);
    expect(ids(sections[0]?.items ?? [])).toEqual([
      "thread:test:bot-run-long",
      "thread:test:bot-run-recent",
    ]);
    expect(ids(sections[1]?.items ?? [])).toEqual(["run:broke", "run:late"]);
    expect(ids(orderTriage(items))).toEqual([
      "thread:test:bot-run-long",
      "thread:test:bot-run-recent",
      "run:broke",
      "run:late",
      "run:unsure",
      "run:stopped",
    ]);
  });

  it("leaves out empty groups", () => {
    const items = [triageRunItem(makeBotRun("broke", { status: "failed" }))];
    expect(groupTriage(items).map((section) => section.group)).toEqual(["failed"]);
  });

  it("puts an agent's run whose result reached it last, as needing no one", () => {
    const agent = {
      status: "failed",
      startedBy: "agent",
      callerThreadId: ThreadId.make("chat"),
      notify: true,
    } as const;
    const items = [
      triageRunItem(makeBotRun("handled", { ...agent, deliveredAt: at(5) })),
      triageRunItem(makeBotRun("unreached", agent)),
      triageRunItem(makeBotRun("by-person", { ...agent, startedBy: "user", deliveredAt: at(5) })),
    ];
    const sections = groupTriage(items);
    expect(sections.map((section) => [section.group, ids(section.items)])).toEqual([
      ["failed", ["run:unreached", "run:by-person"]],
      ["handled", ["run:handled"]],
    ]);
    expect(ids(items.filter(needsPerson))).toEqual(["run:unreached", "run:by-person"]);
  });
});

describe("foldRepeats", () => {
  const failures = (botId: string, count: number) =>
    Array.from({ length: count }, (_, index) =>
      triageRunItem(
        makeBotRun(`${botId}-${index}`, { botId, status: "failed", finishedAt: at(10 + index) }),
      ),
    );

  it("folds a bot's third repeat under its newest", () => {
    const [section] = groupTriage([...failures("nightly", 3), ...failures("writer", 2)]);
    const entries = foldRepeats(section!);
    expect(entries.map((entry) => [entry.lead.key, entry.rest.length])).toEqual([
      ["run:nightly-2", 2],
      ["run:writer-1", 0],
      ["run:writer-0", 0],
    ]);
    expect(ids(entries[0]?.rest ?? [])).toEqual(["run:nightly-1", "run:nightly-0"]);
    expect(TRIAGE_REPEAT_MIN).toBe(3);
  });

  it("never folds waiting runs, each being its own question", () => {
    const [section] = groupTriage(
      triageItems({
        runs: [],
        waiting: ["a", "b", "c"].map((runId) => waitingThread(runId)),
        findRun: (runId) => makeBotRun(runId, { status: "running" }),
        bot: null,
      }),
    );
    expect(foldRepeats(section!).every((entry) => entry.rest.length === 0)).toBe(true);
  });
});

describe("triage summaries", () => {
  it("names how the provider failed a failed run, when it said", () => {
    const failed = (fields: Partial<BotRun> = {}) =>
      triageRunItem(makeBotRun("failed", { status: "failed", ...fields }));
    expect(triageReasonLabel(failed({ failureClass: "usage_limit" }))).toBe("Usage limit");
    expect(triageReasonLabel(failed({ failureClass: "transport_error" }))).toBe(
      "Connection dropped",
    );
    expect(triageReasonLabel(failed())).toBe("Failed");
    expect(triageReasonLabel(triageRunItem(makeBotRun("late", { status: "timed_out" })))).toBe(
      "Timed out",
    );
  });

  it("counts items per bot, busiest first", () => {
    const items = [
      triageRunItem(makeBotRun("1", { botId: "writer", botName: "Writer", status: "failed" })),
      triageRunItem(makeBotRun("2", { status: "failed" })),
      triageRunItem(makeBotRun("3", { status: "failed" })),
      triageRunItem(makeBotRun("4", { botId: "auditor", botName: "Auditor", status: "failed" })),
    ];
    expect(triageBotCounts(items)).toEqual([
      { botId: "reviewer", botName: "Reviewer", count: 2 },
      { botId: "auditor", botName: "Auditor", count: 1 },
      { botId: "writer", botName: "Writer", count: 1 },
    ]);
  });

  it("dismisses only finished runs, never a run still paused on someone", () => {
    const items = triageItems({
      runs: [makeBotRun("done", { status: "failed" })],
      waiting: [waitingThread("paused")],
      findRun: (runId) => makeBotRun(runId, { status: "running" }),
      bot: null,
    });
    expect(dismissibleRuns(items).map((run) => run.id)).toEqual(["done"]);
  });

  it("gives one verb for what to do next", () => {
    const failed = triageRunItem(makeBotRun("failed", { status: "failed" }));
    const active = { dismissed: false, botState: "active" } as const;
    expect(triageVerb(failed, active)).toBe("retry");
    expect(triageVerb(failed, { ...active, botState: "archived" })).toBe("review");
    expect(triageVerb(failed, { ...active, dismissed: true })).toBe("restore");
    const stopped = triageRunItem(
      makeBotRun("stopped", { status: "failed", pipelineRunId: "p", pipelineStopped: true }),
    );
    expect(triageVerb(stopped, active)).toBe("resume");
    const unsure = triageRunItem(makeBotRun("unsure", { verdict: verdict("needs_attention") }));
    expect(triageVerb(unsure, active)).toBe("review");
    const [waiting] = triageItems({
      runs: [],
      waiting: [waitingThread("paused")],
      findRun: () => undefined,
      bot: null,
    });
    expect(triageVerb(waiting!, { ...active, dismissed: true })).toBe("answer");
  });

  it("knows whether a run's bot can still run", () => {
    const definitions = [makeBotDefinition(), makeBotDefinition({ id: "old", archivedAt: at(1) })];
    expect(triageBotState("reviewer", definitions)).toBe("active");
    expect(triageBotState("old", definitions)).toBe("archived");
    expect(triageBotState("gone", definitions)).toBe("deleted");
    expect(triageBotState("gone", null)).toBe("active");
  });

  it("says why in one line: the error, else the summary, else the reason", () => {
    const evidence = (patch: Partial<BotRun>) =>
      triageEvidence(triageRunItem(makeBotRun("r", patch)));
    expect(evidence({ status: "failed", error: "\n  Provider exited\nstack trace" })).toBe(
      "Provider exited",
    );
    expect(
      evidence({ verdict: verdict("needs_attention", "Tests are flaky.\nMore detail.") }),
    ).toBe("Tests are flaky.");
    expect(evidence({ status: "timed_out" })).toBe("It ran past its time limit.");
    expect(evidence({ verdict: verdict("needs_attention", " ", "invalid") })).toBe(
      "The bot replied without a verdict.",
    );
  });

  it("marks a pipeline stopped by a failure as danger, by an undecided run as a warning", () => {
    const stopped = (patch: Partial<BotRun>) =>
      triageTone(
        triageRunItem(makeBotRun("p", { pipelineRunId: "p", pipelineStopped: true, ...patch })),
      );
    expect(stopped({ verdict: verdict("fail") })).toBe("danger");
    expect(stopped({ verdict: verdict("needs_attention") })).toBe("warning");
  });
});
