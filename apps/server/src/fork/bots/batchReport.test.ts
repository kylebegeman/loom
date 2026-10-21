import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  batchCountsLine,
  type BotBatch,
  type BotBatchItem,
  type BotRun,
} from "@t3tools/contracts/fork";
import { countItems } from "./BotBatchesStore.ts";
import { BATCH_REPORT_MAX_BYTES, renderBatchReport } from "./batchReport.ts";

const run = (id: string, fields: Partial<BotRun>): BotRun => ({
  id,
  botId: "reviewer",
  botVersion: 2,
  botName: "Reviewer",
  threadId: ThreadId.make(`bot-run-${id}`),
  projectId: ProjectId.make("project-a"),
  inputs: {},
  status: "completed",
  startedBy: "user",
  callerThreadId: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  startedAt: "2026-10-20T10:00:01.000Z",
  finishedAt: "2026-10-20T10:01:00.000Z",
  result: null,
  resultTruncated: false,
  error: null,
  ...fields,
});

const item = (index: number, label: string, fields: Partial<BotBatchItem> = {}): BotBatchItem => ({
  index,
  label,
  inputs: { file: label },
  state: "started",
  runId: `run-${index}`,
  previousRunIds: [],
  run: run(`run-${index}`, {}),
  ...fields,
});

const batchOf = (items: ReadonlyArray<BotBatchItem>): BotBatch => ({
  id: "batch-1",
  botId: "reviewer",
  botVersion: 2,
  botName: "Reviewer",
  projectId: ProjectId.make("project-a"),
  sourceType: "lines",
  sourceSummary: "Pasted lines, 4 items",
  itemParameter: "file",
  sharedInputs: {},
  status: "finished",
  note: null,
  startedBy: "user",
  callerThreadId: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  finishedAt: "2026-10-20T10:05:00.000Z",
  total: items.length,
  counts: countItems(items),
});

describe("renderBatchReport", () => {
  it("lists items that need a look before the ones that passed", () => {
    const items = [
      item(0, "a.ts", {
        run: run("run-0", {
          verdict: {
            verdict: "fail",
            summary: "Two bugs.",
            findings: [{ title: "Off by one", detail: "", path: "a.ts", line: 3 }],
            findingsTruncated: false,
            source: "decoded",
          },
        }),
        previousRunIds: ["run-old"],
      }),
      item(1, "b.ts", {
        run: run("run-1", {
          verdict: {
            verdict: "pass",
            summary: "Fine.",
            findings: [],
            findingsTruncated: false,
            source: "decoded",
          },
        }),
      }),
      item(2, "c.ts", {
        run: run("run-2", { status: "failed", error: "The run ended as failed." }),
      }),
      item(3, "d.ts", { state: "skipped", runId: null, run: null }),
    ];
    const { markdown, truncated } = renderBatchReport(batchOf(items), items);
    expect(truncated).toBe(false);
    expect(markdown).toBe(
      [
        "# Reviewer batch",
        "",
        "Version 2. Pasted lines, 4 items.",
        "",
        "1 pass, 1 fail, 1 failed, 1 skipped.",
        "",
        "## a.ts\n\nOutcome: fail\n\nTwo bugs.\n\n- Off by one (`a.ts:3`)\n\nRun thread: bot-run-run-0\nEarlier attempts: 1",
        "",
        "## c.ts\n\nOutcome: failed\n\nThe run ended as failed.\n\nRun thread: bot-run-run-2",
        "",
        "## d.ts\n\nOutcome: skipped",
        "",
        "## Passed\n\n- b.ts",
      ].join("\n"),
    );
  });

  it("cuts a report that would pass the size limit at a whole section", () => {
    const long = "x".repeat(2_000);
    const items = Array.from({ length: 60 }, (_, index) =>
      item(index, `file-${index}.ts`, {
        run: run(`run-${index}`, { status: "failed", error: long }),
      }),
    );
    const { markdown, truncated } = renderBatchReport(batchOf(items), items);
    expect(truncated).toBe(true);
    expect(new TextEncoder().encode(markdown).length).toBeLessThanOrEqual(BATCH_REPORT_MAX_BYTES);
    expect(markdown.endsWith("_Report cut short. Open the batch for the rest._")).toBe(true);
  });

  it("counts plain completions when no item gave a verdict", () => {
    const items = [item(0, "a.ts"), item(1, "b.ts", { state: "pending", runId: null, run: null })];
    expect(batchCountsLine(countItems(items))).toBe("1 completed, 1 waiting");
  });
});
