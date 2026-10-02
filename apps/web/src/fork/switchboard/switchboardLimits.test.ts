import { ProviderDriverKind } from "@t3tools/contracts";
import type { SwitchboardLimit } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";

import { switchboardModelBlock } from "./switchboardLimits";

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
    expect(switchboardModelBlock([onCredits], CODEX, "gpt-6-luna", nameOf)).toBeNull();
    expect(switchboardModelBlock([onCredits], CLAUDE, "claude-opus-5-5", nameOf)).toBeNull();
    expect(switchboardModelBlock([], CODEX, "gpt-6-sol", nameOf)).toBeNull();
  });

  it("names the credit models when another model is blocked", () => {
    expect(switchboardModelBlock([onCredits], CODEX, "gpt-6-sol", nameOf)).toBe(
      "Codex is on credits until an account resets, so Switchboard serves only GPT-6 Luna and GPT-5.6 Luna.",
    );
  });

  it("matches credit model patterns with wildcards", () => {
    const pattern = { ...onCredits, servedModels: ["gpt-*-luna"] };
    expect(switchboardModelBlock([pattern], CODEX, "gpt-6.1-luna", nameOf)).toBeNull();
    expect(switchboardModelBlock([pattern], CODEX, "gpt-6-luna-pro", nameOf)).not.toBeNull();
  });

  it("blocks every model of a provider with no allowance or credits", () => {
    const out: SwitchboardLimit = { driver: "claudeAgent", servedModels: [], until: null };
    expect(switchboardModelBlock([out], CLAUDE, "claude-opus-5-5", nameOf)).toBe(
      "Every Claude account is out of allowance until an account resets.",
    );
  });
});
