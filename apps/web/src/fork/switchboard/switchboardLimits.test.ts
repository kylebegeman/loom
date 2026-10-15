import { ProviderDriverKind } from "@t3tools/contracts";
import type { SwitchboardLimit, SwitchboardModelAvailability } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";

import {
  hasSwitchboardBlocks,
  isSwitchboardAvailabilityUnknown,
  switchboardModelBlock,
} from "./switchboardLimits";

const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");
const NAMES: Record<string, string> = {
  "gpt-6-luna": "GPT-6 Luna",
  "gpt-5.6-luna": "GPT-5.6 Luna",
};
const nameOf = (slug: string) => NAMES[slug] ?? slug;

const onCredits: SwitchboardLimit = {
  driver: "codex",
  servedModels: ["gpt-6-luna", "gpt-5.6-luna"],
  until: null,
};

describe("switchboardModelBlock", () => {
  it("serves credit models and every model of a provider with allowance", () => {
    expect(switchboardModelBlock({ limits: [onCredits] }, CODEX, "gpt-6-luna", nameOf)).toBeNull();
    expect(
      switchboardModelBlock({ limits: [onCredits] }, CLAUDE, "claude-opus-5-5", nameOf),
    ).toBeNull();
    expect(switchboardModelBlock({ limits: [] }, CODEX, "gpt-6-sol", nameOf)).toBeNull();
  });

  it("names the credit models when another model is blocked", () => {
    expect(switchboardModelBlock({ limits: [onCredits] }, CODEX, "gpt-6-sol", nameOf)).toBe(
      "Codex is on credits until an account resets, so Switchboard serves only GPT-6 Luna and GPT-5.6 Luna.",
    );
  });

  it("matches credit model patterns with wildcards", () => {
    const pattern = { ...onCredits, servedModels: ["gpt-*-luna"] };
    expect(switchboardModelBlock({ limits: [pattern] }, CODEX, "gpt-6.1-luna", nameOf)).toBeNull();
    expect(
      switchboardModelBlock({ limits: [pattern] }, CODEX, "gpt-6-luna-pro", nameOf),
    ).not.toBeNull();
  });

  it("blocks every model of a provider with no allowance or credits", () => {
    const out: SwitchboardLimit = { driver: "claudeAgent", servedModels: [], until: null };
    expect(switchboardModelBlock({ limits: [out] }, CLAUDE, "claude-opus-5-5", nameOf)).toBe(
      "Every Claude account is out of allowance until an account resets.",
    );
  });

  it("decides by a model's own state before its provider's limit", () => {
    const model = (
      id: string,
      state: SwitchboardModelAvailability["state"],
    ): SwitchboardModelAvailability => ({
      driver: "codex",
      id,
      state,
      reason: "fixture",
      resetAt: null,
    });
    const models = [model("gpt-6-sol", "unavailable"), model("gpt-6-terra", "unknown")];
    expect(switchboardModelBlock({ limits: [], models }, CODEX, "gpt-6-sol", nameOf)).toBe(
      "Switchboard has no Codex account that can serve gpt-6-sol until an account resets.",
    );
    expect(switchboardModelBlock({ limits: [], models }, CODEX, "gpt-6-terra", nameOf)).toBeNull();
    expect(switchboardModelBlock({ limits: [], models }, CODEX, "gpt-6-vela", nameOf)).toBeNull();
    expect(
      switchboardModelBlock({ limits: [onCredits], models }, CODEX, "gpt-6-sol", nameOf),
    ).toContain("serves only GPT-6 Luna and GPT-5.6 Luna");
    expect(
      switchboardModelBlock({ limits: [onCredits], models }, CODEX, "gpt-6-terra", nameOf),
    ).toBeNull();
  });
});

describe("Switchboard availability state", () => {
  it("blocks nothing and reports unknown when the controller could not answer", () => {
    for (const availability of ["unavailable", "stale"] as const) {
      const status = { limits: [], availability };
      expect(isSwitchboardAvailabilityUnknown(status)).toBe(true);
      expect(hasSwitchboardBlocks(status)).toBe(false);
    }
    expect(isSwitchboardAvailabilityUnknown({ limits: [], availability: "available" })).toBe(false);
    expect(isSwitchboardAvailabilityUnknown({ limits: [] })).toBe(false);
  });
});
