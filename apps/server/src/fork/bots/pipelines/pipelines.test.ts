import { describe, expect, it } from "@effect/vitest";
import {
  BOTS_BATCH_MAX_ITEMS,
  type BotDefinition,
  type BotPipelineAttempt,
  type BotPipelineInput,
  type BotPipelineRun,
  type BotPipelineStep,
} from "@t3tools/contracts/fork";

import { testBot } from "../testing/fixtures.ts";
import { checkPipeline } from "./check.ts";
import { decide } from "./decide.ts";
import { renderPipelineReport } from "./report.ts";
import {
  fanOutItems,
  renderStepInputs,
  renderTemplate,
  type StepOutput,
  type TemplateContext,
} from "./templates.ts";

const verdictBot = (id: string, fields: Partial<BotDefinition> = {}) =>
  testBot({ id, name: id.charAt(0).toUpperCase() + id.slice(1), output: "verdict", ...fields });

const fixer = testBot({
  id: "fixer",
  name: "Fixer",
  parameters: [
    { name: "file", label: "File", type: "string", required: true },
    { name: "finding", label: "Finding", type: "text", required: true },
  ],
});

const bots = new Map([
  ["reviewer", verdictBot("reviewer")],
  ["verifier", verdictBot("verifier")],
  ["fixer", fixer],
]);

const output = (fields: Partial<StepOutput> = {}): StepOutput => ({
  status: "completed",
  verdict: null,
  summary: null,
  findings: [],
  result: null,
  error: null,
  ...fields,
});

const finding = (title: string, path?: string) => ({
  title,
  detail: "",
  ...(path === undefined ? {} : { path }),
});

const context = (fields: Partial<TemplateContext> = {}): TemplateContext => ({
  inputs: { file: "a.ts" },
  outputs: new Map(),
  item: null,
  round: 1,
  inputsUntrusted: false,
  ...fields,
});

const steps: ReadonlyArray<BotPipelineStep> = [
  { id: "review", botId: "reviewer", inputs: { file: "{{input.file}}" }, onFail: "continue" },
  {
    id: "fix",
    botId: "fixer",
    inputs: { file: "{{input.file}}", finding: "{{item}}" },
    forEach: { from: "{{steps.review.findings}}" },
  },
  {
    id: "verify",
    botId: "verifier",
    inputs: { file: "{{input.file}}" },
    onFail: { goTo: "review", maxRounds: 3 },
  },
];

const pipeline = (fields: Partial<BotPipelineInput> = {}): BotPipelineInput => ({
  id: "review-fix",
  name: "Review and fix",
  description: "",
  parameters: [{ name: "file", label: "File", type: "string", required: true }],
  steps,
  ...fields,
});

const check = (input: BotPipelineInput) =>
  checkPipeline(input, { bots, versionExists: (_botId, version) => version === 1 }).map(
    ({ stepId, field, message, severity }) => `${severity} ${stepId}.${field}: ${message}`,
  );

describe("pipeline templates", () => {
  it("fills inputs, earlier outputs and the item, marking what came from a run", () => {
    const outputs = new Map([
      ["review", output({ verdict: "fail", findings: [finding("Off by one", "a.ts")] })],
    ]);
    const plain = renderTemplate("Fix {{input.file}} in round {{round}}.", context());
    expect(plain).toEqual({ value: "Fix a.ts in round 1.", untrusted: false });
    const fromStep = renderTemplate(
      "{{steps.review.verdict}}: {{steps.review.findings}}",
      context({ outputs }),
    );
    expect(fromStep).toEqual({ value: "fail: - Off by one (a.ts)", untrusted: true });
    expect(
      renderTemplate("{{item.path}}", context({ item: finding("Off by one", "b.ts") })).value,
    ).toBe("b.ts");
    // Not a reference: left as the bot will see it.
    expect(renderTemplate("{{file}}", context()).value).toBe("{{file}}");
    // A triggered run's inputs came from an event.
    expect(renderTemplate("{{input.file}}", context({ inputsUntrusted: true })).untrusted).toBe(
      true,
    );
  });

  it("cuts an input to its parameter's limit and says so", () => {
    const long = "x".repeat(20_000);
    const rendered = renderStepInputs(
      { inputs: { file: "{{input.file}}" } },
      fixer.parameters,
      context({ inputs: { file: long } }),
    );
    expect(rendered.values.file!.length).toBeLessThan(long.length);
    expect(rendered.values.file).toMatch(/\[cut\]$/);
    expect(rendered.notes).toEqual([expect.stringMatching(/^File was cut to \d+ characters\.$/)]);
  });

  it("fans out over findings or the lines of a text input, at most a batch's worth", () => {
    const many = Array.from({ length: BOTS_BATCH_MAX_ITEMS + 2 }, (_, index) =>
      finding(`F${index}`),
    );
    const fromFindings = fanOutItems(
      "{{steps.review.findings}}",
      context({ outputs: new Map([["review", output({ findings: many })]]) }),
    );
    expect(fromFindings.items).toHaveLength(BOTS_BATCH_MAX_ITEMS);
    expect(fromFindings.notes).toEqual([
      `Only the first ${BOTS_BATCH_MAX_ITEMS} of ${many.length} items ran.`,
    ]);
    expect(
      fanOutItems("{{input.files}}", context({ inputs: { files: "a.ts\n\n b.ts " } })).items,
    ).toEqual(["a.ts", "b.ts"]);
  });
});

describe("checkPipeline", () => {
  it("accepts a review, fix, verify loop", () => {
    expect(check(pipeline())).toEqual([]);
  });

  it("reports references, inputs and loops that cannot work", () => {
    expect(
      check(
        pipeline({
          steps: [
            {
              id: "review",
              botId: "reviewer",
              inputs: { file: "{{steps.fix.summary}} {{input.nope}}", extra: "x" },
            },
            { id: "fix", botId: "fixer", inputs: { file: "{{item}}" } },
            {
              id: "verify",
              botId: "verifier",
              version: 9,
              inputs: { file: "{{input.file}}" },
              onFail: { goTo: "nowhere", maxRounds: 2 },
            },
          ],
        }),
      ),
    ).toEqual([
      "error review.inputs.file: Fix runs later, so only a step in the same loop can read it.",
      "error review.inputs.file: The pipeline has no input named nope.",
      "error review.inputs.extra: Reviewer has no input named extra.",
      "error fix.inputs.finding: Finding needs a value.",
      "error fix.inputs.file: Only a step that runs once per item can use {{item}}.",
      "error verify.version: Verifier has no version 9.",
      "error verify.onFail: There is no step nowhere.",
    ]);
  });

  it("lets a step read a later step of its own loop, and warns about split worktrees", () => {
    const worktreeVerifier = verdictBot("verifier", {
      workspace: { type: "project", projectId: null, worktree: true },
    });
    const problems = checkPipeline(
      pipeline({
        steps: steps.map((step) =>
          step.id === "review"
            ? { ...step, inputs: { file: "{{input.file}} {{steps.verify.summary}}" } }
            : step,
        ),
      }),
      { bots: new Map([...bots, ["verifier", worktreeVerifier]]), versionExists: () => true },
    );
    expect(problems.map((problem) => `${problem.severity} ${problem.stepId}`)).toEqual([
      "warning verify",
    ]);
  });
});

describe("decide", () => {
  it("goes on, loops back on a failed verdict, and stops after the last round", () => {
    expect(decide(steps, "review", 1, output({ verdict: "fail" }))).toEqual({
      kind: "next",
      stepId: "fix",
      round: 1,
    });
    expect(decide(steps, "verify", 1, output({ verdict: "fail" }))).toEqual({
      kind: "next",
      stepId: "review",
      round: 2,
    });
    expect(decide(steps, "verify", 3, output({ verdict: "fail" }))).toEqual({
      kind: "stopped",
      message: "Verify still failed after 3 rounds.",
    });
    expect(decide(steps, "verify", 2, output({ verdict: "pass" }))).toEqual({
      kind: "completed",
    });
  });

  it("fails on a run error unless the step continues on errors", () => {
    const failed = output({ status: "timed_out", error: "Took too long." });
    expect(decide(steps, "fix", 1, failed)).toEqual({
      kind: "failed",
      message: "Fix timed out. Took too long.",
    });
    const tolerant = steps.map((step) =>
      step.id === "fix" ? { ...step, onError: "continue" as const } : step,
    );
    expect(decide(tolerant, "fix", 1, failed)).toMatchObject({ kind: "next", stepId: "verify" });
  });

  it("stops on needs attention unless told to continue", () => {
    expect(decide(steps, "review", 1, output({ verdict: "needs_attention" }))).toEqual({
      kind: "stopped",
      message: "Review needs attention.",
    });
  });
});

describe("renderPipelineReport", () => {
  const run: BotPipelineRun = {
    id: "run-1",
    pipelineId: "review-fix",
    pipelineVersion: 2,
    pipelineName: "Review and fix",
    inputs: { file: "a.ts" },
    projectId: null,
    checkoutThreadId: null,
    status: "stopped",
    retryAt: null,
    cursorStepId: "verify",
    finalVerdict: "fail",
    stoppedRunId: "bot-run-2",
    error: "Verify gave a fail verdict.",
    startedBy: "user",
    callerThreadId: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    finishedAt: "2026-10-20T10:05:00.000Z",
  };
  const attempt = (
    seq: number,
    stepId: string,
    fields: Partial<BotPipelineAttempt> = {},
  ): BotPipelineAttempt => ({
    seq,
    stepId,
    round: 1,
    state: "done" as const,
    botVersion: 1,
    runId: `bot-run-${seq}`,
    batchId: null,
    outcome: null,
    notes: [],
    startedAt: "2026-10-20T10:00:00.000Z",
    finishedAt: "2026-10-20T10:01:30.000Z",
    ...fields,
  });

  it("gives the path, each attempt's outcome and the findings of a failure", () => {
    const report = renderPipelineReport(
      run,
      [
        { attempt: attempt(1, "fix", { state: "skipped", runId: null }), output: null },
        {
          attempt: attempt(2, "verify"),
          output: output({ verdict: "fail", summary: "Still broken.", findings: [finding("Bug")] }),
        },
      ],
      new Map([["verify", { botName: "Verifier", model: "test" }]]),
    );
    expect(report.truncated).toBe(false);
    expect(report.markdown).toContain("Stopped. Version 2.\n\nVerify gave a fail verdict.");
    expect(report.markdown).toContain("Path: Fix (skipped), Verify (fail)");
    expect(report.markdown).toContain(
      "## 2. Verify (fail)\n\nVerifier version 1, test, 1m 30s.\n\nStill broken.\n\n- Bug",
    );
  });
});
