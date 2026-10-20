import { describe, expect, it } from "vite-plus/test";
import type { BotPipelineInput } from "@t3tools/contracts/fork";
import {
  defaultStepInputs,
  emptyPipelineDraft,
  newStepDraft,
  pipelineDraft,
  pipelineInputFromDraft,
} from "./pipelineDraft";

const reviewFixVerify: BotPipelineInput = {
  id: "review-fix",
  name: "Review and fix",
  description: "",
  parameters: [{ name: "target", label: "Target", type: "string", required: true }],
  steps: [
    {
      id: "review",
      botId: "reviewer",
      version: "stable",
      inputs: { target: "{{input.target}}" },
      onFail: "continue",
    },
    {
      id: "fix",
      botId: "fixer",
      version: 3,
      inputs: { target: "{{input.target}}", finding: "{{item}}" },
      forEach: { from: "{{steps.review.findings}}" },
      onError: "continue",
    },
    {
      id: "verify",
      botId: "verifier",
      inputs: { target: "{{input.target}}" },
      onFail: { goTo: "review", maxRounds: 3 },
    },
  ],
};

describe("pipeline drafts", () => {
  it("round-trips a saved pipeline, leaving default gates and empty templates out", () => {
    const draft = pipelineDraft(reviewFixVerify);
    const withBlank = {
      ...draft,
      steps: draft.steps.map((step) =>
        step.id === "verify" ? { ...step, inputs: { ...step.inputs, claim: " " } } : step,
      ),
    };
    expect(pipelineInputFromDraft(withBlank)).toEqual({ ok: true, input: reviewFixVerify });
  });

  it("names the field to fix", () => {
    const draft = pipelineDraft(reviewFixVerify);
    const loopBack = (maxRounds: string) => ({
      ...draft,
      steps: draft.steps.map((step) => (step.id === "verify" ? { ...step, maxRounds } : step)),
    });
    expect(pipelineInputFromDraft(loopBack("9"))).toEqual({
      ok: false,
      message: "Rounds for verify are a whole number from 1 to 5.",
    });
    expect(pipelineInputFromDraft({ ...emptyPipelineDraft(), id: "x", name: "X" })).toEqual({
      ok: false,
      message: "Add a step.",
    });
  });

  it("gives a new step a free id and fills inputs the pipeline shares by name", () => {
    const draft = pipelineDraft(reviewFixVerify);
    const fixer = {
      id: "fixer",
      parameters: [
        { name: "target", label: "Target", type: "string" as const, required: true },
        { name: "finding", label: "Finding", type: "text" as const, required: true },
      ],
    };
    const step = newStepDraft(draft, fixer);
    expect(step.id).toBe("fixer");
    expect(newStepDraft({ ...draft, steps: [...draft.steps, step] }, fixer).id).toBe("fixer-2");
    expect(defaultStepInputs(draft, fixer)).toEqual({ target: "{{input.target}}", finding: "" });
  });
});
