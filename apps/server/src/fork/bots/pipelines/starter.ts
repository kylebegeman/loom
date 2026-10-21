import type { BotDefinitionInput, BotPipelineInput } from "@t3tools/contracts/fork";

/** Recorded in the bot starters' table, so the starter is offered once. */
export const PIPELINE_STARTER_ID = "pipeline:review-fix-verify";
export const PIPELINE_STARTER_REVISION = 1;

const FIXER_INSTRUCTIONS = `Fix this finding about {{target}}:

{{finding}}

1. Read the code the finding points at and confirm the problem is real. If it is not, change nothing and say why.
2. Make the smallest change that fixes it. Do not fix other findings, refactor, or touch unrelated files.
3. Run the narrowest check that covers the change: its own test, or a typecheck or lint of its package.

Do not commit. Reply with what you changed, the check you ran and its result.`;

/** A plain bot, not a starter: starter ids are a fixed set older clients decode. */
export const FIXER_DEFINITION: Omit<BotDefinitionInput, "modelSelection"> = {
  id: "fixer",
  name: "Fixer",
  description: "Fixes one review finding in the project checkout.",
  instructions: FIXER_INSTRUCTIONS,
  parameters: [
    {
      name: "target",
      label: "What the finding is about",
      description: "A path, branch, commit range or pull request number.",
      type: "string",
      required: true,
    },
    { name: "finding", label: "Finding", type: "text", required: true },
  ],
  runtimeMode: "auto-accept-edits",
  interactionMode: "default",
  workspace: { type: "project", projectId: null, worktree: false },
  timeoutMinutes: 20,
  // Fixes share one checkout, so they run one at a time.
  maxConcurrentRuns: 1,
  scopeProjectId: null,
};

/**
 * Review, fix each finding, then verify; a failed verification goes back to review, at most three
 * rounds. A review with no findings skips the fixes.
 */
export const REVIEW_FIX_VERIFY: BotPipelineInput = {
  id: "review-fix-verify",
  name: "Review, fix, verify",
  description: "Reviews a change, fixes each finding, and checks the fixes held.",
  parameters: [
    {
      name: "target",
      label: "What to review",
      description: "A path, branch, commit range or pull request number.",
      type: "string",
      required: true,
    },
    {
      name: "lens",
      label: "Lens",
      type: "choice",
      required: true,
      default: "correctness",
      choices: ["correctness", "surfaces", "fidelity"],
    },
  ],
  steps: [
    {
      id: "review",
      botId: "reviewer",
      inputs: { target: "{{input.target}}", lens: "{{input.lens}}" },
      onFail: "continue",
    },
    {
      id: "fix",
      botId: "fixer",
      inputs: { target: "{{input.target}}", finding: "{{item}}" },
      forEach: { from: "{{steps.review.findings}}" },
    },
    {
      id: "verify",
      botId: "verifier",
      inputs: {
        target: "{{input.target}}",
        claim:
          "A {{input.lens}} review of {{input.target}} now finds nothing to fix. These were the findings of the last review:\n\n{{steps.review.findings}}",
      },
      onFail: { goTo: "review", maxRounds: 3 },
    },
  ],
};
