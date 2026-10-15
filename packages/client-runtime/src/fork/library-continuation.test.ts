import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { libraryContinuationContext } from "./library-continuation.ts";
const summary = {
  title: "API decisions",
  threadId: ThreadId.make("original"),
  environmentId: EnvironmentId.make("source"),
  sequence: 42,
};
describe("linked continuation context", () => {
  it("carries readable visible discussion and source provenance while excluding tool payloads", () => {
    const result = libraryContinuationContext({
      summary,
      projection: {
        messages: [],
        visibleTurnItems: [
          { item: { type: "user_message", text: "Keep independent repositories." } },
          { item: { type: "tool_call", text: "private tool payload" } },
          { item: { type: "assistant_message", text: "Next, integrate the iOS client." } },
        ],
      },
    });
    expect(result).toContain("Keep independent repositories.");
    expect(result).toContain("Next, integrate the iOS client.");
    expect(result).toContain("saved sequence: 42");
    expect(result).toContain("Verify its current files");
    expect(result).not.toContain("private tool payload");
  });
  it("bounds huge conversation text and provides an explicit path for missing discussion", () => {
    const result = libraryContinuationContext({
      summary,
      projection: {
        visibleTurnItems: [],
        messages: Array.from({ length: 100 }, () => ({
          role: "assistant",
          text: "x".repeat(100000),
        })),
      },
    });
    expect(result.length).toBeLessThan(17000);
    expect(
      libraryContinuationContext({ summary, projection: { visibleTurnItems: [], messages: [] } }),
    ).toContain("Review the linked source history");
  });
});
