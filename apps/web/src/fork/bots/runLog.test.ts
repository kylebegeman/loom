import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { EMPTY_BOTS_CHANGES, type BotsChanges } from "@t3tools/client-runtime/fork";
import { BOTS_LIST_RUNS_MAX_LIMIT, type BotRun } from "@t3tools/contracts/fork";
import {
  canRetryRun,
  dayLabel,
  groupRunsByDay,
  knownRun,
  loadOlderRuns,
  pagedRuns,
  rememberRuns,
  resolveRunsScope,
  runHeadline,
  runLogRuns,
  runOrigin,
  runOutcome,
  runPagesFor,
  runsListInput,
  type RunPages,
} from "./runLog";
import { makeBotRun } from "./testFixtures";

const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();
const changesWith = (...runs: BotRun[]): BotsChanges => ({
  ...EMPTY_BOTS_CHANGES,
  runs: new Map(runs.map((run) => [run.id, run])),
});
const ids = (runs: readonly BotRun[]) => runs.map((run) => run.id);

describe("runs scope", () => {
  it("opens every run when the server cannot serve the asked-for scope", () => {
    const all = { inboxSupported: true, batchesSupported: true };
    const none = { inboxSupported: false, batchesSupported: false };
    expect(resolveRunsScope(undefined, all)).toBe("all");
    expect(resolveRunsScope("attention", all)).toBe("attention");
    expect(resolveRunsScope("dismissed", all)).toBe("dismissed");
    expect(resolveRunsScope("batches", all)).toBe("batches");
    expect(resolveRunsScope("attention", none)).toBe("all");
    expect(resolveRunsScope("dismissed", none)).toBe("all");
    expect(resolveRunsScope("batches", none)).toBe("all");
  });

  it("asks for the first page with the shell's exact input, so both share one request", () => {
    expect(JSON.stringify(runsListInput({}))).toBe(
      JSON.stringify({ limit: BOTS_LIST_RUNS_MAX_LIMIT }),
    );
    expect(JSON.stringify(runsListInput({ botId: "reviewer" }))).toBe(
      JSON.stringify({ limit: BOTS_LIST_RUNS_MAX_LIMIT, botId: "reviewer" }),
    );
    expect(runsListInput({ botId: "reviewer", verdict: "fail" })).toEqual({
      limit: BOTS_LIST_RUNS_MAX_LIMIT,
      botId: "reviewer",
      verdict: "fail",
    });
  });
});

describe("run pages", () => {
  const first = [
    makeBotRun("c", { createdAt: at(20, 12) }),
    makeBotRun("b", { createdAt: at(20, 11) }),
  ];
  const second = [
    makeBotRun("b", { createdAt: at(20, 11) }),
    makeBotRun("a", { createdAt: at(20, 9) }),
  ];
  const third = [makeBotRun("z", { createdAt: at(19, 8) })];
  const start: RunPages = { base: "first", loaded: [], cursor: null };

  it("continues from the oldest run shown and keeps each settled page", () => {
    const one = loadOlderRuns(start, first);
    expect(one).toEqual({ base: "first", loaded: [], cursor: at(20, 11) });
    expect(ids(pagedRuns(first, one, second))).toEqual(["c", "b", "a"]);

    const two = loadOlderRuns(one, second);
    expect(two.cursor).toBe(at(20, 9));
    expect(ids(two.loaded)).toEqual(["b", "a"]);
    expect(ids(pagedRuns(first, two, third))).toEqual(["c", "b", "a", "z"]);
    // While the next page loads, the pages already settled stay on screen.
    expect(ids(pagedRuns(first, two, null))).toEqual(["c", "b", "a"]);
  });

  it("starts over when the first page is refetched or refiltered", () => {
    const loaded = loadOlderRuns(loadOlderRuns(start, first), second);
    expect(runPagesFor(loaded, "first")).toBe(loaded);
    expect(runPagesFor(loaded, "refetched")).toEqual({
      base: "refetched",
      loaded: [],
      cursor: null,
    });
  });

  it("stays put on an empty page", () => {
    expect(loadOlderRuns(start, [])).toBe(start);
  });
});

describe("run log", () => {
  const listed = [
    makeBotRun("new", { createdAt: at(20, 12) }),
    makeBotRun("old", { createdAt: at(20, 10) }),
  ];

  it("adds new runs and updates listed ones, but leaves out older runs not loaded yet", () => {
    const changes = changesWith(
      makeBotRun("newer", { createdAt: at(20, 13) }),
      makeBotRun("old", { createdAt: at(20, 10), rating: "up" }),
      makeBotRun("ancient", { createdAt: at(18, 10), rating: "down" }),
    );
    const partial = runLogRuns(listed, changes, { complete: false });
    expect(ids(partial)).toEqual(["newer", "new", "old"]);
    expect(partial.find((run) => run.id === "old")?.rating).toBe("up");
    expect(ids(runLogRuns(listed, changes, { complete: true }))).toEqual([
      "newer",
      "new",
      "old",
      "ancient",
    ]);
  });

  it("keeps a bot's page to that bot and a verdict filter to that verdict", () => {
    const changes = changesWith(
      makeBotRun("other", { botId: "verifier", createdAt: at(20, 13) }),
      makeBotRun("failed", {
        createdAt: at(20, 14),
        verdict: {
          verdict: "fail",
          summary: "Broken.",
          findings: [],
          findingsTruncated: false,
          source: "decoded",
        },
      }),
    );
    expect(ids(runLogRuns(listed, changes, { botId: "reviewer", complete: true }))).toEqual([
      "failed",
      "new",
      "old",
    ]);
    expect(ids(runLogRuns(listed, changes, { verdict: "fail", complete: true }))).toEqual([
      "failed",
    ]);
  });
});

describe("run days", () => {
  const now = new Date(2026, 9, 23, 15, 0).getTime();

  it("puts running work first, then each local day newest first", () => {
    const runs = [
      makeBotRun("running", { status: "running", createdAt: at(23, 14) }),
      makeBotRun("today", { createdAt: at(23, 9) }),
      makeBotRun("late-yesterday", { createdAt: new Date(2026, 9, 22, 23, 59).toISOString() }),
      makeBotRun("early-today", { createdAt: new Date(2026, 9, 23, 0, 1).toISOString() }),
      makeBotRun("queued", { status: "queued", createdAt: at(23, 15) }),
      makeBotRun("last-week", { createdAt: at(16, 9) }),
      makeBotRun("broken-date", { createdAt: "not a date" }),
    ];
    const { active, days } = groupRunsByDay(runs, now);
    expect(ids(active)).toEqual(["running", "queued"]);
    expect(days.map((day) => [day.label, ids(day.runs)])).toEqual([
      ["Today", ["today", "early-today"]],
      ["Yesterday", ["late-yesterday"]],
      [dayLabel(new Date(2026, 9, 16, 9).getTime(), now), ["last-week"]],
    ]);
  });

  it("names older days by date, with the year once it differs", () => {
    const lastWeek = dayLabel(new Date(2026, 9, 16, 9).getTime(), now);
    expect(lastWeek).not.toMatch(/Today|Yesterday|2026/);
    expect(dayLabel(new Date(2025, 11, 31, 9).getTime(), now)).toMatch(/2025/);
  });
});

describe("run presentation", () => {
  it("reserves a pill for exceptions and work in flight", () => {
    const verdict = (value: "pass" | "fail") =>
      makeBotRun(value, {
        verdict: {
          verdict: value,
          summary: "",
          findings: [],
          findingsTruncated: false,
          source: "decoded",
        },
      });
    expect(runOutcome(verdict("pass")).emphasis).toBe("plain");
    expect(runOutcome(verdict("fail"))).toMatchObject({ emphasis: "pill", tone: "danger" });
    expect(runOutcome(makeBotRun("done")).emphasis).toBe("plain");
    expect(runOutcome(makeBotRun("stopped", { status: "cancelled" })).emphasis).toBe("quiet");
    expect(runOutcome(makeBotRun("going", { status: "running" })).emphasis).toBe("pill");
    expect(runOutcome(makeBotRun("broke", { status: "failed" })).emphasis).toBe("pill");
  });

  it("names the most specific origin", () => {
    expect(runOrigin(makeBotRun("a", { batchId: "batch", triggerId: "t" })).kind).toBe("batch");
    expect(runOrigin(makeBotRun("b", { triggerId: "t", retryOf: "x" })).kind).toBe("trigger");
    expect(runOrigin(makeBotRun("c", { startedBy: "agent" })).kind).toBe("agent");
    expect(runOrigin(makeBotRun("d"))).toEqual({ kind: "person", label: "You" });
  });

  it("offers Retry only where the server retries", () => {
    expect(canRetryRun(makeBotRun("failed", { status: "failed" }))).toBe(true);
    expect(canRetryRun(makeBotRun("passed"))).toBe(false);
    expect(canRetryRun(makeBotRun("cancelled", { status: "cancelled" }))).toBe(false);
    expect(canRetryRun(makeBotRun("retried", { status: "failed", retriedBy: "next" }))).toBe(false);
    expect(
      canRetryRun(makeBotRun("dismissed", { status: "failed", dismissedAt: at(20, 12) })),
    ).toBe(false);
    expect(
      canRetryRun(
        makeBotRun("stopped-pipeline", {
          status: "failed",
          pipelineRunId: "pipeline-run",
          pipelineStopped: true,
        }),
      ),
    ).toBe(false);
    expect(
      canRetryRun(
        makeBotRun("remote", {
          status: "failed",
          requestedBy: { environmentId: EnvironmentId.make("other"), label: "Laptop" },
        }),
      ),
    ).toBe(false);
  });

  it("heads a run with its verdict, else its error, else its reply", () => {
    expect(
      runHeadline(
        makeBotRun("v", {
          verdict: {
            verdict: "fail",
            summary: "\n Tests fail.\nMore",
            findings: [],
            findingsTruncated: false,
            source: "decoded",
          },
          error: "Ignored",
        }),
      ),
    ).toBe("Tests fail.");
    expect(runHeadline(makeBotRun("e", { error: "Crashed\nstack", result: null }))).toBe("Crashed");
    expect(runHeadline(makeBotRun("r", { result: "\n\nDone here.\n" }))).toBe("Done here.");
    expect(runHeadline(makeBotRun("n", { result: null }))).toBeNull();
    const decoded = {
      verdict: "pass",
      summary: "",
      findings: [],
      findingsTruncated: false,
    } as const;
    expect(
      runHeadline(
        makeBotRun("d", {
          verdict: { ...decoded, source: "decoded" },
          result: '{"verdict":"pass"}',
        }),
      ),
    ).toBeNull();
    expect(
      runHeadline(
        makeBotRun("i", { verdict: { ...decoded, source: "invalid" }, result: "Looks fine." }),
      ),
    ).toBe("Looks fine.");
  });

  it("remembers the newest copy of each run the lists showed", () => {
    rememberRuns([makeBotRun("seen", { rating: null })]);
    rememberRuns([makeBotRun("seen", { rating: "up" })]);
    expect(knownRun("seen")?.rating).toBe("up");
    expect(knownRun("never")).toBeNull();
  });
});
