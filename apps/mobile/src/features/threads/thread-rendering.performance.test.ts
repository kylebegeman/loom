import {
  MessageId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import {
  appendTerminalOutput,
  EMPTY_TERMINAL_OUTPUT,
  TERMINAL_OUTPUT_TAIL_CHARS,
  TERMINAL_PALETTES,
  terminalOutputPlainText,
  terminalOutputSpans,
} from "@t3tools/shared/terminalOutput";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  buildThreadFeed,
  createThreadFeedCache,
  deriveThreadFeedPresentation,
} from "../../lib/threadActivity";

const threadId = ThreadId.make("performance-thread");
const timestamp = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");

function itemBase(id: string, runId: RunId, ordinal: number) {
  return {
    id: TurnItemId.make(id),
    threadId,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: timestamp,
    completedAt: timestamp,
    updatedAt: timestamp,
  };
}

function projected(
  item: OrchestrationV2TurnItem,
  position: number,
): OrchestrationV2ProjectedTurnItem {
  return {
    position,
    visibility: "local",
    sourceThreadId: threadId,
    sourceItemId: item.id,
    item,
  };
}

describe("long mobile conversations", () => {
  it("does not reread 1,000 historical turns' message bodies on 20 streamed updates", () => {
    const reads = vi.fn();
    const rows = Array.from({ length: 1_000 }, (_, turn) => {
      const runId = RunId.make(`run-${turn}`);
      const prompt: OrchestrationV2TurnItem = {
        ...itemBase(`user-${turn}`, runId, turn * 3),
        type: "user_message",
        messageId: MessageId.make(`prompt-${turn}`),
        createdBy: "user",
        creationSource: "mobile",
        inputIntent: "turn_start",
        get text() {
          reads();
          return `Historical prompt ${turn}`;
        },
        attachments: [],
      };
      const command: OrchestrationV2TurnItem = {
        ...itemBase(`command-${turn}`, runId, turn * 3 + 1),
        type: "command_execution",
        input: "echo done",
        exitCode: 0,
      };
      const reply: OrchestrationV2TurnItem = {
        ...itemBase(`reply-${turn}`, runId, turn * 3 + 2),
        type: "assistant_message",
        messageId: MessageId.make(`answer-${turn}`),
        get text() {
          reads();
          return `Historical answer ${turn}`;
        },
        streaming: false,
      };
      return [prompt, command, reply].map((item, index) => projected(item, turn * 3 + index));
    }).flat();
    const cache = createThreadFeedCache();
    const expandedRunIds = new Set<RunId>();
    const present = (items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>) =>
      deriveThreadFeedPresentation(
        buildThreadFeed(items, { cache }),
        null,
        expandedRunIds,
        undefined,
        null,
        false,
        cache,
      );
    const initial = present(rows);
    reads.mockClear();
    const activeRunId = RunId.make("streaming");
    const prompt = projected(
      {
        ...itemBase("live-user", activeRunId, rows.length),
        type: "user_message",
        messageId: MessageId.make("live-prompt"),
        createdBy: "user",
        creationSource: "mobile",
        inputIntent: "turn_start",
        text: "Next turn",
        attachments: [],
      },
      rows.length,
    );
    let latest = initial;
    for (let update = 0; update < 20; update += 1) {
      const reply = projected(
        {
          ...itemBase("live-reply", activeRunId, rows.length + 1),
          type: "assistant_message",
          messageId: MessageId.make("live-answer"),
          text: "Streaming ".repeat(update + 1),
          streaming: true,
          status: "running",
          completedAt: null,
        },
        rows.length + 1,
      );
      latest = present([...rows, prompt, reply]);
    }
    expect(reads).not.toHaveBeenCalled();
    expect(latest.slice(0, initial.length)).toEqual(initial);
    expect(latest.every((row, index) => index >= initial.length || row === initial[index])).toBe(
      true,
    );
    expect(latest.at(-1)).toMatchObject({
      type: "message",
      message: { text: "Streaming ".repeat(20), streaming: true },
    });
  });
});

describe("heavy mobile command output", () => {
  it("keeps a 3.8 MB log within the existing 64 KiB output tail", () => {
    const input = "line of log output\n".repeat(200_000);
    const output = appendTerminalOutput(EMPTY_TERMINAL_OUTPUT, input);
    expect(input.length).toBe(3_800_000);
    expect(output.truncated).toBe(true);
    expect(output.text.length).toBeLessThanOrEqual(TERMINAL_OUTPUT_TAIL_CHARS);
    expect(output.text.endsWith("line of log output\n")).toBe(true);
    const spans = terminalOutputSpans(output.text, TERMINAL_PALETTES.dark);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.text).toBe(output.text);
  });

  it("bounds styled text spans while preserving every displayed character", () => {
    const input = "\u001b[0;31mred\u001b[0;32mgreen\u001b[0m\n".repeat(4_000);
    const output = appendTerminalOutput(EMPTY_TERMINAL_OUTPUT, input);
    const spans = terminalOutputSpans(output.text, TERMINAL_PALETTES.dark);
    expect(output.text.length).toBeLessThanOrEqual(TERMINAL_OUTPUT_TAIL_CHARS);
    expect(spans.length).toBeLessThanOrEqual(2_001);
    expect(spans.map((span) => span.text).join("")).toBe(terminalOutputPlainText(output.text));
  });
});
