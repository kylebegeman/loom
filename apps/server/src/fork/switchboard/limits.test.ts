import { describe, expect, it } from "@effect/vitest";

import { AVAILABILITY_MAX_AGE_MS, isCurrentEvaluation, switchboardLimits } from "./limits.ts";

const EVALUATED_AT = "2026-10-02T20:00:00.000Z";
const NOW = Date.parse(EVALUATED_AT);
const HOUR = 3_600_000;

const model = (
  provider: string,
  id: string,
  state: string,
  resetAt: number | null = null,
): {
  readonly id: string;
  readonly provider: string;
  readonly state: string;
  readonly reason: string;
  readonly resetAt: number | null;
} => ({ id, provider, state, reason: `${state} fixture`, resetAt });

const snapshot = (
  models: ReadonlyArray<ReturnType<typeof model>>,
  evaluatedAt = EVALUATED_AT,
  health?: { readonly stale?: boolean; readonly error?: string | null },
) => ({
  version: 1 as const,
  service: "switchboard" as const,
  evaluatedAt,
  ...(health === undefined ? {} : { health }),
  models,
});

describe("switchboardLimits", () => {
  it("blocks nothing while any listed model of a provider is available", () => {
    const result = switchboardLimits(
      snapshot([
        model("codex", "gpt-a", "unavailable", NOW + HOUR),
        model("codex", "gpt-b", "available"),
        model("claude", "claude-a", "available"),
      ]),
      NOW,
    );
    expect(result.availability).toBe("available");
    expect(result.limits).toEqual([]);
    expect(result.models).toContainEqual({
      driver: "codex",
      id: "gpt-a",
      state: "unavailable",
      reason: "unavailable fixture",
      resetAt: NOW + HOUR,
    });
  });

  it("limits a provider to its credit models until the soonest reset", () => {
    const result = switchboardLimits(
      snapshot([
        model("codex", "gpt-a", "unavailable", NOW + 3 * HOUR),
        model("codex", "gpt-b", "unavailable", NOW + 2 * HOUR),
        model("codex", "gpt-credits", "restricted"),
        model("claude", "claude-a", "available"),
      ]),
      NOW,
    );
    expect(result.limits).toEqual([
      { driver: "codex", servedModels: ["gpt-credits"], until: NOW + 2 * HOUR },
    ]);
  });

  it("keeps a provider selectable when any of its states is unknown", () => {
    const result = switchboardLimits(
      snapshot([
        model("claude", "claude-a", "unavailable", NOW + HOUR),
        model("claude", "claude-b", "unknown"),
      ]),
      NOW,
    );
    expect(result.limits).toEqual([]);
  });

  it("reads a state it does not know as unknown, never as blocked", () => {
    const result = switchboardLimits(
      snapshot([model("claude", "claude-a", "draining"), model("codex", "gpt-a", "available")]),
      NOW,
    );
    expect(result.limits).toEqual([]);
    expect(result.models?.[0]?.state).toBe("unknown");
  });

  it("ignores providers Loom does not route and resets already in the past", () => {
    const result = switchboardLimits(
      snapshot([
        model("gemini", "gemini-a", "unavailable"),
        model("constructor", "odd-a", "unavailable"),
        model("claude", "claude-a", "unavailable", NOW - HOUR),
      ]),
      NOW,
    );
    expect(result.models?.map((entry) => entry.driver)).toEqual(["claudeAgent"]);
    expect(result.limits).toEqual([{ driver: "claudeAgent", servedModels: [], until: null }]);
  });

  it("trusts nothing from an old evaluation", () => {
    const old = snapshot([model("codex", "gpt-a", "unavailable")]);
    expect(switchboardLimits(old, NOW + AVAILABILITY_MAX_AGE_MS + 1)).toEqual({
      limits: [],
      availability: "stale",
    });
  });

  it.each([
    [
      "a stale controller snapshot",
      snapshot([model("codex", "gpt-a", "unavailable")], EVALUATED_AT, { stale: true }),
    ],
    [
      "a failed controller pass",
      snapshot([model("codex", "gpt-a", "unavailable")], EVALUATED_AT, {
        stale: false,
        error: "controller-pass-failed",
      }),
    ],
    ["an empty catalog", snapshot([])],
    [
      "a catalog of providers Loom does not route",
      snapshot([model("gemini", "gemini-a", "available")]),
    ],
    [
      "a catalog where no state is known",
      snapshot([model("codex", "gpt-a", "unknown"), model("claude", "claude-a", "unknown")]),
    ],
  ] as const)("reports availability as unknown for %s", (_label, response) => {
    expect(switchboardLimits(response, NOW)).toEqual({ limits: [], availability: "stale" });
  });

  it("keeps per-model states when only a policy update failed", () => {
    const result = switchboardLimits(
      snapshot(
        [model("codex", "gpt-a", "unavailable"), model("codex", "gpt-b", "available")],
        EVALUATED_AT,
        {
          stale: false,
          error: "policy-update-failed",
        },
      ),
      NOW,
    );
    expect(result.availability).toBe("available");
    expect(result.models?.map((entry) => entry.state)).toEqual(["unavailable", "available"]);
  });

  it("does not let a future timestamp block models", () => {
    const future = snapshot([model("codex", "gpt-a", "unavailable")], "2026-10-02T21:00:00.000Z");
    expect(switchboardLimits(future, NOW)).toEqual({ limits: [], availability: "stale" });
  });
});

describe("isCurrentEvaluation", () => {
  it("accepts recent evaluations and small clock skew only", () => {
    expect(isCurrentEvaluation(EVALUATED_AT, NOW)).toBe(true);
    expect(isCurrentEvaluation(EVALUATED_AT, NOW - 30_000)).toBe(true);
    expect(isCurrentEvaluation(EVALUATED_AT, NOW - 2 * 60_000)).toBe(false);
    expect(isCurrentEvaluation(EVALUATED_AT, NOW + AVAILABILITY_MAX_AGE_MS + 1)).toBe(false);
    expect(isCurrentEvaluation("not a timestamp", NOW)).toBe(false);
  });
});
