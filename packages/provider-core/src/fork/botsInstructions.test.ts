import { describe, expect, it } from "@effect/vitest";
import { T3_CODE_ORCHESTRATION_SECTIONS } from "../server/orchestrationInstructions.ts";
import { LOOM_BOTS_INSTRUCTIONS } from "./botsInstructions.ts";

describe("LOOM_BOTS_INSTRUCTIONS", () => {
  it("is delivered once, whole", () => {
    expect(
      T3_CODE_ORCHESTRATION_SECTIONS.filter((section) => section === LOOM_BOTS_INSTRUCTIONS),
    ).toHaveLength(1);
    // Codex cuts the middle out of an instruction entry over 4,000 bytes.
    expect(new TextEncoder().encode(LOOM_BOTS_INSTRUCTIONS).length).toBeLessThan(4000);
  });
});
