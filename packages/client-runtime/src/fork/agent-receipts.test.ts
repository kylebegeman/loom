import { describe, expect, it } from "vite-plus/test";

import { agentReceiptFacts } from "./agent-receipts.ts";

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
