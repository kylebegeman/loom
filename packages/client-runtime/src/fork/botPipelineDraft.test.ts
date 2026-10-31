import { describe, expect, it } from "@effect/vitest";
import type { BotPipelineInput } from "@t3tools/contracts/fork";
import { pipelineCopyDraft, pipelineInputFromDraft } from "./botPipelineDraft.ts";

const template: BotPipelineInput = {
  id: "engineering-review",
  name: "Engineering review",
  description: "A bounded review workflow.",
  parameters: [
    {
      name: "target",
      label: "Target",
      type: "choice",
      required: true,
      choices: ["current", "branch"],
      default: "current",
    },
  ],
  steps: [
    {
      id: "review",
      botId: "reviewer",
      version: 3,
      inputs: { target: "{{input.target}}" },
      onFail: { goTo: "review", maxRounds: 2 },
      onError: "stop",
    },
  ],
};

describe("pipelineCopyDraft", () => {
  it("creates an unsaved copy without replacing a saved id or changing typed inputs and bounds", () => {
    const draft = pipelineCopyDraft(template, new Set([template.id, "engineering-review-copy"]));
    const built = pipelineInputFromDraft(draft);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input).toMatchObject({
      id: "engineering-review-copy-2",
      name: "Engineering review copy",
      parameters: template.parameters,
      steps: [
        { id: "review", botId: "reviewer", version: 3, onFail: { goTo: "review", maxRounds: 2 } },
      ],
    });
    expect(built.input).not.toHaveProperty("version");
    expect(built.input).not.toHaveProperty("enabled");
    expect(template.id).toBe("engineering-review");
  });
});
