import type { OrchestrationV2ProviderFailure } from "@t3tools/contracts";
import type { SwitchboardLimits, SwitchboardModelAvailability } from "@t3tools/contracts/fork";
import { describe, expect, it } from "@effect/vitest";

import { switchboardLimitFailure } from "./limitFailure.ts";

const RESET_AT = Date.parse("2026-11-13T23:09:00.000Z");
const REASON = "All Codex accounts are on credits and the credit policy excludes this model.";

const failure = (message: string): OrchestrationV2ProviderFailure => ({
  class: "provider_error",
  message,
  code: null,
  retryable: null,
});

const model = (
  overrides: Partial<SwitchboardModelAvailability> = {},
): SwitchboardModelAvailability => ({
  driver: "codex",
  id: "gpt-6.1-sol",
  state: "unavailable",
  reason: REASON,
  resetAt: RESET_AT,
  ...overrides,
});

const reading = (
  models: ReadonlyArray<SwitchboardModelAvailability>,
  availability: SwitchboardLimits["availability"] = "available",
): SwitchboardLimits => ({ limits: [], models, availability });

const REFUSAL =
  'unexpected status 400 Bad Request: {"error":"unknown provider for model gpt-6.1-sol"}';

describe("switchboardLimitFailure", () => {
  it("reports a refusal for a confirmed unavailable model as a usage limit", () => {
    expect(
      switchboardLimitFailure(failure(REFUSAL), "codex", reading([model()]), "America/New_York"),
    ).toEqual({
      class: "usage_limit",
      message: `Switchboard has no Codex account that can serve GPT-6.1-Sol. ${REASON} Next reset Fri, 6:09 PM EST.`,
      code: null,
      retryable: null,
      resetAt: "2026-11-13T23:09:00.000Z",
    });
  });

  it("explains a refusal without a reset but keeps its class", () => {
    expect(
      switchboardLimitFailure(
        failure("unknown provider for model claude-fable-5"),
        "claudeAgent",
        reading([
          model({
            driver: "claudeAgent",
            id: "claude-fable-5",
            reason: "Fable is excluded",
            resetAt: null,
          }),
        ]),
      ),
    ).toEqual({
      ...failure("unknown provider for model claude-fable-5"),
      message:
        "Switchboard has no Claude account that can serve Claude Fable 5. Fable is excluded.",
    });
  });

  it.each([
    ["a message that is not the refusal", failure("stream disconnected"), reading([model()])],
    [
      "a model the reading does not list",
      failure(REFUSAL),
      reading([model({ id: "gpt-6-astra" })]),
    ],
    ["a model that is available", failure(REFUSAL), reading([model({ state: "available" })])],
    ["a model whose state is unknown", failure(REFUSAL), reading([model({ state: "unknown" })])],
    [
      "a model listed for the other driver",
      failure(REFUSAL),
      reading([model({ driver: "claudeAgent" })]),
    ],
    ["a stale reading", failure(REFUSAL), { limits: [], availability: "stale" } as const],
    [
      "an unreachable controller",
      failure(REFUSAL),
      { limits: [], availability: "unavailable" } as const,
    ],
    ["routing turned off", failure(REFUSAL), { limits: [], availability: "disabled" } as const],
    ["an older server without models", failure(REFUSAL), { limits: [] }],
  ])("leaves the failure unchanged for %s", (_, original, limits) => {
    expect(switchboardLimitFailure(original, "codex", limits)).toBe(original);
  });
});
