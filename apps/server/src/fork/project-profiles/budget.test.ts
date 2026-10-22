import { describe, expect, it } from "@effect/vitest";
import { applyUsage, crossedLevels, processedTokens, serverLocalDay } from "./budget.ts";
import type { OrchestrationV2ProviderTurn } from "@t3tools/contracts";
describe("advisory budget accounting", () => {
  it("counts cumulative deltas and resets, crosses each threshold once", () => {
    expect([applyUsage(10, 20), applyUsage(20, 20), applyUsage(20, 5)]).toEqual([10, 0, 5]);
    expect(crossedLevels(0, 110, 100)).toEqual([80, 100]);
    expect(crossedLevels(80, 99, 100)).toEqual([]);
    expect(crossedLevels(99, 100, 100)).toEqual([100]);
    expect(crossedLevels(0, 110, null)).toEqual([]);
  });
  it("uses server local midnight through UTC midnight and DST", () => {
    const day = (iso: string) => serverLocalDay(iso, "America/New_York");
    expect(day("2026-10-22T23:59:00Z")).toBe(day("2026-10-23T00:01:00Z"));
    expect(day("2026-10-23T03:59:00Z")).toBe("2026-10-22");
    expect(day("2026-10-23T04:01:00Z")).toBe("2026-10-23");
    expect(day("2026-11-01T05:59:00Z")).toBe(day("2026-11-01T06:01:00Z"));
  });
  it("counts processed tokens once, including cached inputs, and ignores context-window sizes", () => {
    const turn = {
      tokenUsage: { usedTokens: 100_000 },
      turnTokenUsage: {
        usageStatus: "complete",
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 10,
      },
    } as OrchestrationV2ProviderTurn;
    expect(processedTokens(turn)).toBe(110);
    expect(
      processedTokens({ tokenUsage: { usedTokens: 100_000 } } as OrchestrationV2ProviderTurn),
    ).toBe(null);
  });
});
