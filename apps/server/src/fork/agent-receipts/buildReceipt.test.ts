import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, NodeId, ProviderDriverKind, RunId, ThreadId } from "@t3tools/contracts";

import {
  assistantItem,
  commandItem,
  makeRun,
  makeSubagent,
  rootThreadId,
  toolItem,
  userItem,
} from "./AgentReceipts.testkit.ts";
import {
  buildSubagentReceipt,
  commandSummary,
  extractSubagentResult,
  subagentPrompt,
} from "./buildReceipt.ts";
import { summarizeClaudeAgentTranscript } from "./claudeTranscript.ts";

const childThreadId = ThreadId.make("thread:receipts-child");
const child = (turnItems: ReadonlyArray<ReturnType<typeof assistantItem>>, runs = [] as const) => ({
  runs: [...runs],
  messages: [],
  turnItems: [...turnItems],
  checkpoints: [],
});
const subagent = makeSubagent({
  id: NodeId.make("node:agent"),
  threadId: rootThreadId,
  childThreadId,
});

describe("sub-agent result extraction", () => {
  it("keeps a foreground Claude Agent's tool result", () => {
    expect(extractSubagentResult({ subagent, child: child([]), transcript: null })).toEqual({
      source: "claude_agent_result",
      text: "The flake is a shared port.",
    });
  });

  it("prefers a background Claude Agent's longer transcript over its summary", () => {
    const transcript = summarizeClaudeAgentTranscript(
      "/claude/projects/p/session/subagents/agent-a1.jsonl",
      [
        `{"type":"user","timestamp":"2026-10-20T09:01:00.000Z","message":{"content":"go"}}`,
        `{"type":"assistant","timestamp":"2026-10-20T09:01:30.000Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":5,"output_tokens":1},"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}`,
        `{"type":"assistant","timestamp":"2026-10-20T09:01:31.000Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":5,"cache_creation_input_tokens":10,"cache_read_input_tokens":100,"output_tokens":20},"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}`,
        "not json",
        `{"type":"assistant","timestamp":"2026-10-20T09:03:00.000Z","message":{"id":"m2","model":"claude-opus-5-5","usage":{"input_tokens":2,"output_tokens":30},"content":[{"type":"text","text":"Full findings: the flake is a shared port 4173 between two suites."}]}}`,
      ].join("\n"),
    );
    expect(transcript).toEqual({
      path: "/claude/projects/p/session/subagents/agent-a1.jsonl",
      finalText: "Full findings: the flake is a shared port 4173 between two suites.",
      model: "claude-opus-5-5",
      usage: {
        totalTokens: 67,
        inputTokens: 17,
        outputTokens: 50,
        cacheReadTokens: 100,
        toolCalls: 1,
        durationMs: 120_000,
      },
    });
    expect(
      extractSubagentResult({
        subagent: { ...subagent, result: "Agent finished." },
        child: child([]),
        transcript,
      }),
    ).toEqual({ source: "claude_transcript", text: transcript.finalText });
  });

  it("reads a workflow member's full StructuredOutput instead of its preview", () => {
    const output = { verdict: "pass", findings: ["none"] };
    expect(
      extractSubagentResult({
        subagent: { ...subagent, result: "verdict: pa…" },
        child: child([toolItem(childThreadId, 3, "StructuredOutput", output)]),
        transcript: null,
      }),
    ).toEqual({
      source: "workflow_structured_output",
      text: JSON.stringify(output, null, 2),
    });
  });

  it("keeps Codex's agent state message and reads an empty prompt from the child", () => {
    const codex = {
      ...subagent,
      driver: ProviderDriverKind.make("codex"),
      prompt: "",
      result: "Patched the parser.",
    };
    const records = child([userItem(childThreadId, 1, "Patch the parser")]);
    expect(extractSubagentResult({ subagent: codex, child: records, transcript: null })).toEqual({
      source: "codex_agent_state",
      text: "Patched the parser.",
    });
    expect(subagentPrompt(codex, records)).toBe("Patch the parser");
  });

  it("uses delegate_task's own final result for its run", () => {
    const delegated = { ...subagent, origin: "app_owned" as const, result: "preview" };
    const runId = RunId.make("run:delegated");
    const records = {
      ...child([
        assistantItem(childThreadId, 1, "Working on it", runId),
        assistantItem(childThreadId, 2, "Done: three files fixed.", runId),
        assistantItem(childThreadId, 3, "Unrelated later run"),
      ]),
      runs: [makeRun({ id: runId, threadId: childThreadId, delegatedTaskId: delegated.id })],
    };
    expect(
      extractSubagentResult({ subagent: delegated, child: records, transcript: null }),
    ).toEqual({ source: "delegate_task", text: "Done: three files fixed." });
  });

  it("falls back to the child's last assistant message for other drivers", () => {
    const other = { ...subagent, driver: ProviderDriverKind.make("opencode"), result: null };
    expect(
      extractSubagentResult({
        subagent: other,
        child: child([assistantItem(childThreadId, 4, "Summary from the child")]),
        transcript: null,
      }),
    ).toEqual({ source: "subagent_record", text: "Summary from the child" });
    expect(extractSubagentResult({ subagent: other, child: null, transcript: null })).toEqual({
      source: "none",
      text: "",
    });
  });
});

describe("command summary", () => {
  it("counts commands, lists failures with exit codes and ignores monitors", () => {
    expect(
      commandSummary([
        commandItem(childThreadId, 1, "vp test run", 1),
        commandItem(childThreadId, 2, "git status", 0),
        commandItem(childThreadId, 3, "tail -f log", 1, { monitor: true }),
      ]),
    ).toEqual({ count: 2, failed: [{ input: "vp test run", exitCode: 1 }] });
  });
});

it("keeps a remote delegate's final answer and environment pointer without a local child", () => {
  const remoteChild = {
    environmentId: EnvironmentId.make("studio"),
    threadId: ThreadId.make("remote-child"),
    label: "Studio",
    runId: RunId.make("remote-run"),
  };
  const receipt = buildSubagentReceipt({
    subagent: {
      ...subagent,
      origin: "app_owned",
      driver: ProviderDriverKind.make("remote"),
      childThreadId: null,
      remoteChild,
      status: "completed",
      result: "Verified on Studio",
    },
    lineage: { threadId: rootThreadId, rootThreadId, parentThreadId: null, parentSubjectId: null },
    child: null,
    transcript: null,
    parentCheckpoints: [],
    workflowMember: undefined,
    memberReceiptIds: [],
    promptSha256: "a".repeat(64),
  });
  expect(receipt.pointers).toMatchObject({ childThreadId: null, remoteChild });
  expect(receipt.result).toEqual({ source: "delegate_task", text: "Verified on Studio" });
});
