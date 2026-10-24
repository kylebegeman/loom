import { describe, expect, it } from "vite-plus/test";
import { BOTS_PIPELINE_MAX_STEPS, type BotPipelineInput } from "@t3tools/contracts/fork";
import {
  defaultStepInputs,
  emptyPipelineDraft,
  newParameterDraft,
  newStepDraft,
  pipelineDraft,
  pipelineInputFromDraft,
  type PipelineDraft,
} from "@t3tools/client-runtime/fork";
import {
  builderProblems,
  canTakeStepId,
  changeStepBot,
  draftProblems,
  expectedVersionFor,
  gateSummary,
  inputUsage,
  insertStep,
  isDraftDirty,
  itemSources,
  loopTargets,
  mappingSummary,
  moveStep,
  removeStep,
  renameInputReferences,
  renameReferences,
  runSteps,
  saveRequest,
  stepReaders,
  stepSources,
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
  it("preserves a fan-out item label when editing a saved pipeline", () => {
    const pipeline: BotPipelineInput = {
      ...reviewFixVerify,
      steps: reviewFixVerify.steps.map((step) =>
        step.forEach === undefined
          ? step
          : {
              ...step,
              forEach: { ...step.forEach, itemLabel: "Finding {{item}}" },
            },
      ),
    };
    expect(pipelineInputFromDraft(pipelineDraft(pipeline))).toEqual({ ok: true, input: pipeline });
  });
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

const parameter = (name: string, type: "string" | "text" = "string") => ({
  name,
  label: name,
  type,
  required: true,
});
const reviewer = { id: "reviewer", parameters: [parameter("target")], output: "verdict" as const };
const fixer = {
  id: "fixer",
  parameters: [parameter("target"), parameter("finding", "text")],
  output: "text" as const,
};
const verifier = { id: "verifier", parameters: [parameter("target")], output: "verdict" as const };
const writer = {
  id: "writer",
  parameters: [parameter("target"), parameter("tone")],
  output: "text" as const,
};
const botOf = (botId: string) =>
  [reviewer, fixer, verifier, writer]
    .map((bot) => ({ ...bot, name: bot.id, archivedAt: null }))
    .find((bot) => bot.id === botId);

const ids = (draft: PipelineDraft) => draft.steps.map((step) => step.id);
const stepOf = (draft: PipelineDraft, id: string) => {
  const step = draft.steps.find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`No step ${id}`);
  return step;
};

describe("editing pipeline steps", () => {
  it("inserts a step between two others and opens it by its key", () => {
    const draft = pipelineDraft(reviewFixVerify);
    const inserted = insertStep(draft, 1, writer);
    expect(ids(inserted.draft)).toEqual(["review", "writer", "fix", "verify"]);
    expect(inserted.draft.steps[1]?.key).toBe(inserted.key);
    expect(inserted.draft.steps[1]?.inputs).toEqual({ target: "{{input.target}}", tone: "" });
  });

  it("refuses a step past the limit", () => {
    let draft = pipelineDraft(reviewFixVerify);
    while (draft.steps.length < BOTS_PIPELINE_MAX_STEPS)
      draft = insertStep(draft, draft.steps.length, writer).draft;
    const full = insertStep(draft, 0, writer);
    expect(full.draft).toBe(draft);
    expect(full.key).toBe("");
  });

  it("moves a step one place and leaves one at the edge where it is", () => {
    const draft = pipelineDraft(reviewFixVerify);
    const fix = stepOf(draft, "fix").key;
    expect(ids(moveStep(draft, fix, -1))).toEqual(["fix", "review", "verify"]);
    expect(ids(moveStep(draft, fix, 1))).toEqual(["review", "verify", "fix"]);
    expect(moveStep(draft, stepOf(draft, "review").key, -1)).toBe(draft);
    expect(moveStep(draft, stepOf(draft, "verify").key, 1)).toBe(draft);
  });

  it("asks for a new loop target when the step a loop went back to is removed", () => {
    const saved = pipelineDraft(reviewFixVerify);
    const draft = removeStep(saved, stepOf(saved, "review").key);
    expect(ids(draft)).toEqual(["fix", "verify"]);
    expect(stepOf(draft, "verify").goTo).toBe("");
  });

  it("follows a renamed step in every template, item source and loop", () => {
    const draft = renameReferences(pipelineDraft(reviewFixVerify), "review", "audit");
    expect(stepOf(draft, "fix").forEachFrom).toBe("{{steps.audit.findings}}");
    expect(stepOf(draft, "verify").goTo).toBe("audit");
    const spaced = renameReferences(
      {
        ...draft,
        steps: draft.steps.map((step) =>
          step.id === "verify"
            ? { ...step, inputs: { target: "Was {{ steps.audit.summary }} fixed?" } }
            : step,
        ),
      },
      "audit",
      "check",
    );
    expect(stepOf(spaced, "verify").inputs.target).toBe("Was {{ steps.check.summary }} fixed?");
    expect(renameReferences(draft, "aud", "x")).toEqual(draft);
  });

  it("keeps shared templates and drops verdict gates when a step changes to a text bot", () => {
    const draft = pipelineDraft(reviewFixVerify);
    const custom = {
      ...draft,
      steps: draft.steps.map((step) =>
        step.id === "verify" ? { ...step, inputs: { target: "Look at {{input.target}}" } } : step,
      ),
    };
    const changed = changeStepBot(custom, stepOf(custom, "verify").key, writer);
    const step = changed.steps[2];
    expect(step?.botId).toBe("writer");
    expect(step?.inputs).toEqual({ target: "Look at {{input.target}}", tone: "" });
    expect(step?.onFail).toBe("stop");
    expect(step?.goTo).toBe("");
    // A chosen id stays; a made-up one follows the bot and its readers follow it.
    expect(step?.id).toBe("verify");
    const started = insertStep(draft, 3, null);
    const picked = changeStepBot(started.draft, started.key, verifier);
    expect(picked.steps[3]?.id).toBe("verifier");
  });

  it("renames the readers of a made-up id when its bot changes", () => {
    const base = pipelineDraft(reviewFixVerify);
    const draft = renameReferences(
      {
        ...base,
        steps: base.steps.map((step) =>
          step.id === "review" ? { ...step, id: "reviewer" } : step,
        ),
      },
      "review",
      "reviewer",
    );
    const changed = changeStepBot(draft, stepOf(draft, "reviewer").key, verifier);
    expect(ids(changed)).toEqual(["verifier", "fix", "verify"]);
    expect(stepOf(changed, "fix").forEachFrom).toBe("{{steps.verifier.findings}}");
    expect(stepOf(changed, "verify").goTo).toBe("verifier");
  });
});

describe("renaming what steps read", () => {
  it("follows a renamed pipeline input without touching inputs that share its prefix", () => {
    const base = pipelineDraft(reviewFixVerify);
    const draft = {
      ...base,
      steps: base.steps.map((step) =>
        step.id === "fix"
          ? { ...step, inputs: { target: "{{ input.target }} and {{input.targets}}" } }
          : step,
      ),
    };
    const renamed = renameInputReferences(draft, "target", "branch");
    expect(stepOf(renamed, "review").inputs.target).toBe("{{input.branch}}");
    expect(stepOf(renamed, "fix").inputs.target).toBe("{{ input.branch }} and {{input.targets}}");
  });

  it("only lets references follow an id no other step holds", () => {
    const draft = pipelineDraft(reviewFixVerify);
    const fix = stepOf(draft, "fix").key;
    expect(canTakeStepId(draft, fix, "fixer")).toBe(true);
    expect(canTakeStepId(draft, fix, "review")).toBe(false);
    expect(canTakeStepId(draft, fix, "Fix")).toBe(false);
  });
});

describe("what a pipeline step can read", () => {
  it("offers earlier steps, and later ones only inside the loop the step sits in", () => {
    const draft = pipelineDraft(reviewFixVerify);
    const templates = (index: number) =>
      stepSources(draft, index, botOf).map((source) => source.template);
    expect(templates(0)).toContain("{{steps.fix.result}}");
    expect(templates(0)).not.toContain("{{steps.review.result}}");
    expect(templates(1)).toEqual(
      expect.arrayContaining([
        "{{input.target}}",
        "{{steps.review.findings}}",
        "{{steps.review.verdict}}",
        "{{item.title}}",
      ]),
    );
    expect(templates(1)).not.toContain("{{steps.fix.summary}}");
    const outsideLoop = insertStep(draft, 0, writer).draft;
    expect(stepSources(outsideLoop, 0, botOf).map((source) => source.template)).not.toContain(
      "{{steps.review.result}}",
    );
  });

  it("runs per item only over verdict findings or text inputs", () => {
    const draft = {
      ...pipelineDraft(reviewFixVerify),
      parameters: [
        ...pipelineDraft(reviewFixVerify).parameters,
        { ...newParameterDraft(), name: "files", label: "Files", type: "text" as const },
      ],
    };
    expect(itemSources(draft, 2, botOf).map((source) => source.template)).toEqual([
      "{{steps.review.findings}}",
      "{{input.files}}",
    ]);
  });

  it("only goes back to the step itself or an earlier one", () => {
    expect(loopTargets(pipelineDraft(reviewFixVerify), 1)).toEqual(["review", "fix"]);
  });

  it("sums up a step's inputs in one line and finds who reads each input", () => {
    const draft = pipelineDraft(reviewFixVerify);
    expect(mappingSummary(stepOf(draft, "fix"))).toEqual([
      { name: "target", from: "input.target" },
      { name: "finding", from: "item" },
    ]);
    expect(mappingSummary({ inputs: { target: "Check {{input.target}}" } })).toEqual([
      { name: "target", from: "text" },
    ]);
    expect(inputUsage(draft).get("target")).toEqual(["review", "fix", "verify"]);
  });
});

describe("describing a saved step", () => {
  it("names who reads a step and what of it they read", () => {
    const draft = pipelineDraft(reviewFixVerify);
    expect(stepReaders(draft, "review")).toEqual([{ stepId: "fix", fields: ["findings"] }]);
    expect(stepReaders(draft, "verify")).toEqual([]);
  });

  it("says what a fail does on a verdict step and only the gates that differ elsewhere", () => {
    const draft = pipelineDraft(reviewFixVerify);
    expect(gateSummary(stepOf(draft, "verify"), true)).toEqual([
      "Goes back to review if it fails, up to 3 rounds",
    ]);
    expect(gateSummary(stepOf(draft, "fix"), false)).toEqual(["Carries on if its run errors"]);
    expect(gateSummary(stepOf(draft, "review"), true)).toEqual(["Carries on if it fails"]);
  });
});

describe("pipeline builder problems", () => {
  it("refuses a new pipeline whose id another pipeline uses, but not that pipeline's own edit", () => {
    const draft = pipelineDraft(reviewFixVerify);
    const takenIds = new Set(["review-fix"]);
    expect(draftProblems(draft, { takenIds, isNew: true })).toEqual([
      {
        stepKey: null,
        field: "id",
        message: "Another pipeline already uses the id review-fix. Choose another id.",
        severity: "error",
      },
    ]);
    expect(draftProblems(draft, { takenIds, isNew: false })).toEqual([]);
  });

  it("pins each problem to its step and field", () => {
    const draft = pipelineDraft(reviewFixVerify);
    const broken = {
      ...draft,
      steps: draft.steps.map((step) =>
        step.id === "review"
          ? { ...step, onFail: "loop" as const, goTo: "verify" }
          : step.id === "fix"
            ? { ...step, id: "review" }
            : step,
      ),
    };
    const problems = draftProblems(broken, { takenIds: new Set(), isNew: false });
    expect(problems.map(({ stepKey, field }) => [stepKey, field])).toEqual([
      [draft.steps[0]?.key, "onFail"],
      [draft.steps[1]?.key, "id"],
    ]);
  });

  it("joins the server's check to the steps it names without repeating a local problem", () => {
    const draft = pipelineDraft(reviewFixVerify);
    const local = draftProblems(
      {
        ...draft,
        steps: draft.steps.map((step) => ({ ...step, botId: step.id === "fix" ? "" : step.botId })),
      },
      { takenIds: new Set(), isNew: false },
    );
    const merged = builderProblems(draft, local, [
      { stepId: "fix", field: "botId", message: "Choose a bot for this step.", severity: "error" },
      {
        stepId: "verify",
        field: "inputs.target",
        message: "verify reads steps.nope.",
        severity: "warning",
      },
      { stepId: null, field: "parameters", message: "Too many inputs.", severity: "error" },
    ]);
    expect(merged.map(({ stepKey, field }) => [stepKey, field])).toEqual([
      [draft.steps[1]?.key, "botId"],
      [draft.steps[2]?.key, "inputs.target"],
      [null, "parameters"],
    ]);
  });
});

describe("saving a pipeline", () => {
  it("expects no stored pipeline for a new one, so a shared slug is refused rather than overwritten", () => {
    expect(expectedVersionFor(null)).toBe(0);
    expect(expectedVersionFor({ version: 4 })).toBe(4);
    const request = saveRequest(pipelineDraft(reviewFixVerify), expectedVersionFor(null));
    expect(request).toEqual({ ok: true, input: { pipeline: reviewFixVerify, expectedVersion: 0 } });
  });

  it("ignores row keys when deciding whether a draft changed", () => {
    const first = pipelineDraft(reviewFixVerify);
    const again = pipelineDraft(reviewFixVerify);
    expect(isDraftDirty(first, again)).toBe(false);
    expect(isDraftDirty(first, { ...again, name: "Review, fix, verify" })).toBe(true);
  });
});

describe("pipeline runs", () => {
  const attempt = (seq: number, stepId: string, round: number) => ({
    seq,
    stepId,
    round,
    state: "done" as const,
    botVersion: 1,
    runId: null,
    batchId: null,
    outcome: { status: "completed" as const, verdict: null, summary: null },
    notes: [],
    startedAt: null,
    finishedAt: null,
  });
  const saved = { version: 2, steps: reviewFixVerify.steps };
  const attempts = [attempt(3, "review", 2), attempt(1, "review", 1), attempt(2, "fix", 1)];

  it("lays a run over the steps it was saved with, unreached ones included", () => {
    const { steps, exact } = runSteps({ pipelineVersion: 2 }, attempts, saved);
    expect(exact).toBe(true);
    expect(steps.map((step) => [step.stepId, step.attempts.map((each) => each.round)])).toEqual([
      ["review", [1, 2]],
      ["fix", [1]],
      ["verify", []],
    ]);
  });

  it("shows only the steps an older version reached", () => {
    const { steps, exact } = runSteps({ pipelineVersion: 1 }, attempts, saved);
    expect(exact).toBe(false);
    expect(steps.map((step) => step.stepId)).toEqual(["review", "fix"]);
    expect(steps[0]?.botId).toBeNull();
  });
});
