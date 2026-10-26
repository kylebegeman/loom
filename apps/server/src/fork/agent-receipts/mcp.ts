import { OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import { type AgentReceipt, AgentReceiptError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { AgentReceipts, type EvictionReport } from "./AgentReceipts.ts";
import { resultLine } from "./buildReceipt.ts";

const REPORT_LIST_LIMIT = 40;
const failure = Schema.Union([AgentReceiptError, OrchestratorMcpFailure]);

export const AgentReceiptsToolkit = Toolkit.make(
  Tool.make("loom_agent_receipts", {
    description:
      "Read the receipts Loom wrote when this conversation's sub-agents and runs finished: what each was asked, its status, result, files changed, failed commands, tokens and model. Pass subjectId for one receipt's full result.",
    parameters: Schema.Struct({
      threadId: Schema.optional(
        Schema.String.annotate({ description: "Conversation to read. Defaults to the caller's." }),
      ),
      subjectId: Schema.optional(
        Schema.String.annotate({
          description: "A sub-agent id or run id from the list, for its full receipt.",
        }),
      ),
    }),
    success: Schema.Struct({ text: Schema.String }),
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "Read sub-agent receipts")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_agent_receipts_report", {
    description:
      "Report which sub-agent conversations hold nothing their receipt lacks, with byte counts. Read-only: it deletes nothing.",
    parameters: Tool.EmptyParams,
    success: Schema.Struct({ text: Schema.String }),
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "Report sub-agent receipt coverage")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_agent_receipts_backfill", {
    description:
      "Write receipts for finished sub-agents that have none or an outdated one. Safe to run again; transcripts are only read.",
    parameters: Tool.EmptyParams,
    success: Schema.Struct({ text: Schema.String }),
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Backfill sub-agent receipts")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);

const kib = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

const formatReceipt = (receipt: AgentReceipt) =>
  [
    `${receipt.kind} ${receipt.subjectId} [${receipt.status}]${receipt.title === null ? "" : ` ${receipt.title}`}`,
    `receipt ${receipt.id} · finished ${receipt.finishedAt} · ${receipt.driver}${receipt.model === null ? "" : ` ${receipt.model}`}`,
    `prompt (${receipt.prompt.length} chars, sha256 ${receipt.prompt.sha256.slice(0, 12)}): ${receipt.prompt.clipped}`,
    `files changed (${receipt.files.length}): ${receipt.files.map((file) => file.path).join(", ") || "none"}`,
    `commands: ${receipt.commands.count}, failed: ${
      receipt.commands.failed
        .map((command) => `${command.input} (exit ${command.exitCode ?? "?"})`)
        .join("; ") || "none"
    }`,
    `usage: ${JSON.stringify(receipt.usage)}`,
    ...(receipt.memberReceiptIds.length === 0
      ? []
      : [`members: ${receipt.memberReceiptIds.join(", ")}`]),
    `child conversation: ${receipt.pointers.childThreadId ?? "none"} · transcript: ${receipt.pointers.providerTranscriptPath ?? "none"}`,
    `result (${receipt.result.source}):`,
    receipt.result.text,
  ].join("\n");

const formatList = (receipts: ReadonlyArray<AgentReceipt>) =>
  receipts.length === 0
    ? "No receipts on this conversation yet."
    : receipts
        .map(
          (receipt) =>
            `- ${receipt.kind} ${receipt.subjectId} [${receipt.status}]${receipt.title === null ? "" : ` ${receipt.title}`}: ${receipt.files.length} files, ${receipt.commands.failed.length}/${receipt.commands.count} commands failed${receipt.memberReceiptIds.length === 0 ? "" : `, ${receipt.memberReceiptIds.length} members`}\n  ${resultLine(receipt.result.text)}`,
        )
        .join("\n");

const formatReport = (report: EvictionReport) =>
  [
    `${report.evictable} of ${report.children} sub-agent conversations hold nothing their receipt lacks.`,
    `Evictable: ${mib(report.evictableBytes)}. Kept: ${mib(report.keptBytes)}. Receipts: ${mib(report.receiptBytes)}.`,
    `Kept because: ${
      Object.entries(report.reasons)
        .map(([reason, count]) => `${reason} ${count}`)
        .join(", ") || "nothing"
    }`,
    `Largest evictable (up to ${REPORT_LIST_LIMIT}):`,
    ...report.candidates
      .filter((candidate) => candidate.evictable)
      .slice(0, REPORT_LIST_LIMIT)
      .map(
        (candidate) =>
          `- ${candidate.childThreadId} ${kib(candidate.childBytes)} (receipt ${kib(candidate.receiptBytes)}) under ${candidate.threadId}`,
      ),
  ].join("\n");

const targetThread = Effect.fn("AgentReceipts.targetThread")(function* (
  threadId: string | undefined,
) {
  if (threadId !== undefined) return ThreadId.make(threadId);
  const invocation = yield* McpInvocationContext;
  if (invocation.thread === undefined)
    return yield* new AgentReceiptError({
      reason: "not-found",
      message: "Pass threadId, or call this from an agent running in a Loom thread.",
    });
  return invocation.thread.threadId;
});

export const agentReceiptsHandlers = McpToolAccess.toLayer(
  AgentReceiptsToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const run = <A, E>(effect: Effect.Effect<A, E, AgentReceipts | McpInvocationContext>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_agent_receipts: McpToolAccess.reads((input) =>
        run(
          Effect.gen(function* () {
            const receipts = yield* AgentReceipts;
            const threadId = yield* targetThread(input.threadId);
            if (input.subjectId !== undefined)
              return { text: formatReceipt(yield* receipts.get(threadId, input.subjectId)) };
            return { text: formatList(yield* receipts.forThread(threadId)) };
          }),
        ),
      ),
      loom_agent_receipts_report: McpToolAccess.reads(() =>
        run(
          Effect.gen(function* () {
            const receipts = yield* AgentReceipts;
            return { text: formatReport(yield* receipts.evictionReport) };
          }),
        ),
      ),
      loom_agent_receipts_backfill: McpToolAccess.writes(() =>
        run(
          Effect.gen(function* () {
            const receipts = yield* AgentReceipts;
            const result = yield* receipts.backfill;
            return {
              text: `Checked ${result.scanned} finished sub-agents: ${result.written} receipts written, ${result.unchanged} unchanged, ${result.failed} skipped.`,
            };
          }),
        ),
      ),
    };
  }),
);
