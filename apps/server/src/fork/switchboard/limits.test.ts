import { describe, expect, it } from "@effect/vitest";

import { STATUS_MAX_AGE_MS, switchboardLimits } from "./limits.ts";

const UPDATED_AT = "2026-10-02T20:00:00.000Z";
const NOW = Date.parse(UPDATED_AT);
const HOUR = 3_600_000;

const account = (
  provider: "claude" | "codex",
  state: string,
  windows: { session?: number; weekly?: number } = {},
) => ({
  provider,
  state,
  usage: {
    session: windows.session === undefined ? null : { usedPercent: 100, resetsAt: windows.session },
    weekly: windows.weekly === undefined ? null : { usedPercent: 100, resetsAt: windows.weekly },
  },
});

const status = (accounts: ReadonlyArray<ReturnType<typeof account>>, updatedAt = UPDATED_AT) => ({
  updatedAt,
  codexCreditModels: ["gpt-6-luna", "gpt-5.6-luna"],
  accounts,
});

describe("switchboardLimits", () => {
  it("lists nothing while any account of a provider has allowance", () => {
    const result = switchboardLimits(
      status([
        account("codex", "credits", { weekly: NOW + HOUR }),
        account("codex", "ready"),
        account("claude", "unknown"),
      ]),
      NOW,
    );
    expect(result.limits).toEqual([]);
  });

  it("limits Codex to the credit models until the first weekly reset", () => {
    const result = switchboardLimits(
      status([
        account("codex", "credits", { weekly: NOW + 3 * HOUR }),
        account("codex", "credits", { weekly: NOW + 2 * HOUR }),
        account("codex", "signed-out"),
        account("claude", "ready"),
      ]),
      NOW,
    );
    expect(result.limits).toEqual([
      { driver: "codex", servedModels: ["gpt-6-luna", "gpt-5.6-luna"], until: NOW + 2 * HOUR },
    ]);
  });

  it("blocks a provider with no allowance and no credits, until the soonest window resets", () => {
    const result = switchboardLimits(
      status([
        account("claude", "exhausted", { session: NOW + HOUR, weekly: NOW + 5 * HOUR }),
        account("claude", "session-limited", { session: NOW + 2 * HOUR, weekly: NOW + 9 * HOUR }),
      ]),
      NOW,
    );
    expect(result.limits).toEqual([
      { driver: "claudeAgent", servedModels: [], until: NOW + 2 * HOUR },
    ]);
  });

  it("trusts nothing from a controller that has stopped updating", () => {
    const stale = status([account("codex", "credits")]);
    expect(switchboardLimits(stale, NOW + STATUS_MAX_AGE_MS + 1).limits).toEqual([]);
  });
});
