import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { emptyBatchSourceDraft } from "@t3tools/client-runtime/fork";
import type { BotParameter, BotRun } from "@t3tools/contracts/fork";
import { batchSource, parameterInputs, runDuration, runMeta } from "./runLogic";

const parameters: ReadonlyArray<BotParameter> = [
  { name: "file", label: "File", type: "string", required: true },
  { name: "limit", label: "Limit", type: "number", required: false },
  { name: "enabled", label: "Enabled", type: "boolean", required: false },
  {
    name: "mode",
    label: "Mode",
    type: "choice",
    choices: ["quick", "full"],
    default: "quick",
    required: false,
  },
];

describe("native bot run inputs", () => {
  it("validates required and numeric values before submitting a run", () => {
    expect(() => parameterInputs(parameters, { file: "  " })).toThrow("File is required.");
    expect(() => parameterInputs(parameters, { file: "src/app.ts", limit: "Infinity" })).toThrow(
      "Limit must be a finite number.",
    );
    expect(() => parameterInputs(parameters, { file: "src/app.ts", limit: "oops" })).toThrow(
      "Limit must be a finite number.",
    );
    expect(() => parameterInputs(parameters, { file: "src/app.ts", mode: "other" })).toThrow(
      "Choose a value for Mode.",
    );
  });

  it("preserves text, converts typed inputs, and leaves optional defaults to the server", () => {
    expect(
      parameterInputs(parameters, {
        file: " src/app.ts ",
        limit: "-2.5",
        enabled: "true",
        mode: "",
      }),
    ).toEqual({ file: " src/app.ts ", limit: -2.5, enabled: true });
    expect(parameterInputs(parameters, { file: "src/app.ts", limit: "  " })).toEqual({
      file: "src/app.ts",
      enabled: false,
    });
  });

  it("only attaches a valid selected checkout to file-based batch sources", () => {
    const checkout = ThreadId.make("checkout-a");
    expect(
      batchSource({ ...emptyBatchSourceDraft, type: "glob", pattern: " src/**/*.ts " }, checkout),
    ).toEqual({ type: "glob", pattern: "src/**/*.ts", checkoutThreadId: checkout });
    expect(batchSource({ ...emptyBatchSourceDraft, type: "conflicts" }, null)).toEqual({
      type: "conflicts",
    });
    expect(batchSource({ ...emptyBatchSourceDraft, lines: "one\ntwo" }, checkout)).toEqual({
      type: "lines",
      text: "one\ntwo",
    });
    expect(
      batchSource(
        { ...emptyBatchSourceDraft, type: "pullRequests", query: " author:me " },
        checkout,
      ),
    ).toEqual({ type: "pullRequests", query: "author:me" });
    expect(
      batchSource({ ...emptyBatchSourceDraft, type: "search", query: "  " }, checkout),
    ).toBeNull();
  });
});

describe("native bot run presentation", () => {
  it("reads durations in their two largest units", () => {
    const start = "2026-10-22T10:00:00Z";
    expect(runDuration(null, null)).toBeNull();
    expect(runDuration(start, "2026-10-22T10:00:42Z")).toBe("42s");
    expect(runDuration(start, "2026-10-22T10:04:12Z")).toBe("4m 12s");
    expect(runDuration(start, "2026-10-22T10:05:00Z")).toBe("5m");
    expect(runDuration(start, "2026-10-22T12:07:30Z")).toBe("2h 7m");
  });

  it("leaves the duration off a run that is still going and names who it ran for", () => {
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();
    const base: BotRun = {
      id: "run",
      botId: "review",
      botName: "Review",
      botVersion: 3,
      threadId: ThreadId.make("bot-run"),
      projectId: null,
      inputs: {},
      status: "running",
      startedBy: "agent",
      callerThreadId: null,
      createdAt: iso(10 * 60_000),
      startedAt: iso(5 * 60_000),
      finishedAt: null,
      result: null,
      resultTruncated: false,
      error: null,
    };
    expect(runMeta(base)).toBe("Started 5m ago · v3 · started by an agent");
    expect(
      runMeta({
        ...base,
        status: "completed",
        startedBy: "user",
        finishedAt: iso(60_000),
        requestedBy: { environmentId: EnvironmentId.make("laptop"), label: "Laptop" },
      }),
    ).toBe("1m ago · 4m · v3 · for Laptop");
  });
});
