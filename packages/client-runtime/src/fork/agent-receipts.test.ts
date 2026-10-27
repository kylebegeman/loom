import { describe, expect, it } from "vite-plus/test";

import { ThreadId } from "@t3tools/contracts";
import { botRunThreadId } from "@t3tools/contracts/fork";

import { agentReceiptFacts, isAgentWorkThread } from "./agent-receipts.ts";

describe("agentReceiptFacts", () => {
  it("names only what the receipt adds to the row", () => {
    expect(agentReceiptFacts({ filesChanged: 0, failedCommands: 0, memberCount: 0 })).toBeNull();
    expect(agentReceiptFacts({ filesChanged: 1, failedCommands: 2, memberCount: 0 })).toBe(
      "1 file changed · 2 failed checks",
    );
    expect(agentReceiptFacts({ filesChanged: 3, failedCommands: 0, memberCount: 1 })).toBe(
      "3 files changed · 1 agent",
    );
  });
});

describe("isAgentWorkThread", () => {
  const thread = (id: ThreadId, relationshipToParent: "subagent" | "fork" | null) => ({
    id,
    lineage: { rootThreadId: ThreadId.make("root"), parentThreadId: null, relationshipToParent },
  });

  it("covers subagents and bot runs but never a conversation someone continues", () => {
    expect(isAgentWorkThread(thread(ThreadId.make("child"), "subagent"))).toBe(true);
    expect(isAgentWorkThread(thread(botRunThreadId("run"), null))).toBe(true);
    // An agent-launched top-level thread can hold real work, so it is never bulk deleted.
    expect(isAgentWorkThread(thread(ThreadId.make("launched"), null))).toBe(false);
    expect(isAgentWorkThread(thread(ThreadId.make("forked"), "fork"))).toBe(false);
  });
});
