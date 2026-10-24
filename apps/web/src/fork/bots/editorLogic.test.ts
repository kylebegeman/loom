import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import type { BotDefinitionInput, BotVersionSummary } from "@t3tools/contracts/fork";
import {
  botDraft,
  emptyBotDraft,
  newParameterDraft,
  newVaultSlotDraft,
  saveInputFromDraft,
  type BotDraft,
} from "@t3tools/client-runtime/fork";
import {
  botDefinitionDiff,
  changedFieldLabel,
  draftChanges,
  draftProblems,
  instructionPlaceholders,
  listText,
  shownProblems,
  versionChangeText,
  versionCompareOptions,
  versionTrend,
  withParameterType,
} from "./editorLogic";
import { makeBotDefinition } from "./testFixtures";

const context = { projectTitle: (id: string) => (id === "loom" ? "Loom" : id) };
const base: BotDefinitionInput = {
  ...makeBotDefinition(),
  vaultSlots: [{ name: "github", label: "GitHub token", action: "use" }],
  budget: { runsPerDay: 10 },
};

describe("botDefinitionDiff", () => {
  it("reports credential slot changes that the version history used to call identical", () => {
    const diff = botDefinitionDiff(
      base,
      {
        ...base,
        vaultSlots: [
          {
            name: "github",
            label: "GitHub token",
            action: "use",
            destination: "https://api.github.com",
          },
          { name: "npm", label: "npm", action: "reveal" },
        ],
      },
      context,
    );
    expect(diff.instructions).toBeNull();
    expect(diff.fields).toEqual([
      {
        key: "vaultSlots:github",
        label: "Credential github",
        before: "GitHub token, Use it, anywhere the action allows",
        after: "GitHub token, Use it, only toward https://api.github.com",
      },
      {
        key: "vaultSlots:npm",
        label: "Credential npm",
        before: "Not there",
        after: "Reveal its value, anywhere the action allows",
      },
    ]);
    expect(
      botDefinitionDiff(base, { ...base, vaultSlots: [] }, context).fields.map((f) => f.after),
    ).toEqual(["Removed"]);
  });

  it("finds a change in every definition field except the instructions, which diff by line", () => {
    const edits: ReadonlyArray<Partial<BotDefinitionInput>> = [
      { id: "other" },
      { name: "Other" },
      { description: "" },
      { parameters: [] },
      { modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "opus" } },
      { runtimeMode: "full-access" },
      { interactionMode: "plan" },
      { output: "verdict" },
      { workspace: { type: "project", projectId: ProjectId.make("loom"), worktree: true } },
      { scopeProjectId: ProjectId.make("loom") },
      { timeoutMinutes: 6 },
      { maxConcurrentRuns: 2 },
      { vaultSlots: [] },
      { budget: { runsPerDay: 10, tokensPerDay: 5_000 } },
    ];
    for (const edit of edits)
      expect(botDefinitionDiff(base, { ...base, ...edit }, context).fields).toHaveLength(1);
    const instructions = botDefinitionDiff(base, { ...base, instructions: "New." }, context);
    expect(instructions.fields).toEqual([]);
    expect(instructions.instructions).toEqual({ before: base.instructions, after: "New." });
  });

  it("speaks the editor's words rather than raw values", () => {
    const diff = botDefinitionDiff(
      base,
      {
        ...base,
        workspace: {
          type: "project",
          projectId: ProjectId.make("loom"),
          worktree: true,
          baseRef: "main",
        },
        scopeProjectId: ProjectId.make("elsewhere"),
        budget: {},
      },
      context,
    );
    expect(diff.fields).toEqual([
      {
        key: "workspace",
        label: "Runs in",
        before: "Fresh scratch folder",
        after: "New worktree of Loom from main",
      },
      { key: "scopeProjectId", label: "Available in", before: "Every project", after: "elsewhere" },
      { key: "budget:runsPerDay", label: "Runs per 24 hours", before: "10", after: "No limit" },
    ]);
  });

  it("reports a new input order once, beside the inputs themselves", () => {
    const two: BotDefinitionInput = {
      ...base,
      parameters: [
        { name: "pr", label: "pr", type: "string", required: true },
        { name: "depth", label: "depth", type: "number", required: false, default: "2" },
      ],
    };
    const diff = botDefinitionDiff(
      two,
      { ...two, parameters: two.parameters.toReversed() },
      context,
    );
    expect(diff.fields).toEqual([
      { key: "parameters:order", label: "Input order", before: "pr, depth", after: "depth, pr" },
    ]);
  });
});

describe("draftChanges", () => {
  it("ignores the row keys a fresh draft gets and names each changed part once", () => {
    const initial = botDraft(base);
    expect(draftChanges(initial, botDraft(base))).toEqual([]);
    const edited: BotDraft = {
      ...initial,
      instructions: "Changed.",
      runsPerDay: "",
      tokensPerDay: "2000",
      vaultSlots: [...initial.vaultSlots, newVaultSlotDraft()],
    };
    expect(draftChanges(initial, edited)).toEqual(["instructions", "credentials", "budget"]);
  });

  it("counts reordering inputs as a change", () => {
    const initial = botDraft({
      ...base,
      parameters: [
        { name: "a", label: "a", type: "string", required: true },
        { name: "b", label: "b", type: "string", required: true },
      ],
    });
    expect(
      draftChanges(initial, { ...initial, parameters: initial.parameters.toReversed() }),
    ).toEqual(["inputs"]);
  });
});

describe("draftProblems", () => {
  const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt" };

  it("holds back missing fields until a save is tried, but shows invalid ones at once", () => {
    const draft: BotDraft = { ...emptyBotDraft(model), timeoutMinutes: "500" };
    const problems = draftProblems(draft);
    expect(problems.map((problem) => [problem.field, problem.kind])).toEqual([
      ["bot-name", "missing"],
      ["bot-id", "missing"],
      ["bot-instructions", "missing"],
      ["bot-timeout", "invalid"],
    ]);
    expect(shownProblems(problems, false).map((problem) => problem.field)).toEqual(["bot-timeout"]);
    expect(shownProblems(problems, true)).toHaveLength(4);
  });

  it("checks each input against its own type and the other inputs", () => {
    const number = { ...newParameterDraft(), name: "depth", type: "number" as const };
    const choice = {
      ...newParameterDraft(),
      name: "depth",
      type: "choice" as const,
      choices: "fast\nslow",
      defaultValue: "medium",
    };
    const draft: BotDraft = {
      ...botDraft(base),
      parameters: [{ ...number, defaultValue: "two" }, choice],
    };
    expect(draftProblems(draft).map((problem) => [problem.field, problem.message])).toEqual([
      [`${number.key}-default`, "The default must be a number."],
      [`${choice.key}-name`, "Another input already has this name."],
      [`${choice.key}-default`, "The default must be one of the choices."],
    ]);
  });

  it("agrees with the save request on which drafts can be saved", () => {
    const valid = botDraft(base);
    const drafts: ReadonlyArray<BotDraft> = [
      valid,
      { ...valid, id: "Bad Id" },
      { ...valid, name: "   " },
      { ...valid, instructions: "x".repeat(20_001) },
      { ...valid, maxConcurrentRuns: "1.5" },
      { ...valid, runsPerDay: "10,001" },
      { ...valid, runsPerDay: "1,000" },
      { ...valid, tokensPerDay: "999" },
      { ...valid, modelSelection: null },
      { ...valid, vaultSlots: [{ ...newVaultSlotDraft(), name: "GitHub" }] },
      { ...valid, vaultSlots: [{ ...newVaultSlotDraft(), name: "github" }] },
      {
        ...valid,
        parameters: [{ ...newParameterDraft(), name: "kind", type: "choice", choices: " \n " }],
      },
    ];
    for (const draft of drafts)
      expect(draftProblems(draft).length === 0).toBe(saveInputFromDraft(draft, 1).ok);
  });

  it("refuses a run project other than the one project it is available in, as the server does", () => {
    const valid = botDraft(base);
    const fields = (draft: BotDraft) => draftProblems(draft).map((problem) => problem.field);
    const scoped = { ...valid, scopeProjectId: "loom" };
    expect(fields({ ...scoped, workspace: "project", projectId: "site" })).toEqual(["bot-project"]);
    expect(fields({ ...scoped, workspace: "checkout", projectId: "site" })).toEqual([
      "bot-project",
    ]);
    expect(fields({ ...scoped, workspace: "project", projectId: "loom" })).toEqual([]);
    expect(fields({ ...scoped, workspace: "project", projectId: "" })).toEqual([]);
    expect(fields({ ...scoped, workspace: "scratch", projectId: "site" })).toEqual([]);
    expect(fields({ ...valid, scopeProjectId: "", projectId: "site" })).toEqual([]);
  });
});

describe("withParameterType", () => {
  it("keeps a default the new type can hold and drops one it cannot", () => {
    const parameter = { ...newParameterDraft(), name: "depth", defaultValue: "2" };
    expect(withParameterType(parameter, "number").defaultValue).toBe("2");
    expect(withParameterType(parameter, "boolean").defaultValue).toBe("");
    expect(withParameterType({ ...parameter, choices: "1\n2" }, "choice").defaultValue).toBe("2");
  });
});

describe("instructionPlaceholders", () => {
  it("reads placeholders the way the server fills them", () => {
    expect(
      instructionPlaceholders("Review {{ pr }} and {{file}}, then {{pr}} again. {{}}", [
        "pr",
        "depth",
      ]),
    ).toEqual({ used: ["pr"], undeclared: ["file"], unused: ["depth"] });
  });
});

describe("labels", () => {
  it("names server fields in the editor's words", () => {
    expect(
      ["vaultSlots", "parameters", "modelSelection", "someNewField"].map(changedFieldLabel),
    ).toEqual(["Credentials", "Inputs", "Model", "Some new field"]);
    expect(listText(["Inputs", "Model", "Credentials"])).toBe("Inputs, Model and Credentials");
  });
});

describe("versions", () => {
  const summary = (version: number, patch: Partial<BotVersionSummary> = {}): BotVersionSummary => ({
    botId: "reviewer",
    version,
    savedBy: "user",
    savedAt: "2026-10-20T10:00:00.000Z",
    changed: [],
    restoredFrom: null,
    runs: 0,
    passRate: null,
    medianTotalTokens: null,
    ...patch,
  });

  it("offers the one before, stable and current first, without the version itself or later saves", () => {
    expect(versionCompareOptions(4, { stable: 2, current: 6, listed: [6, 5, 4, 3, 2] })).toEqual([
      { version: 6, label: "v6, current" },
      { version: 5, label: "v5" },
      { version: 3, label: "v3, the one before" },
      { version: 2, label: "v2, stable" },
    ]);
    expect(versionCompareOptions(3, { stable: 2, current: 3, listed: [3] })).toEqual([
      { version: 2, label: "v2, the one before and stable" },
    ]);
    expect(versionCompareOptions(1, { stable: null, current: 1, listed: [1] })).toEqual([]);
  });

  it("draws a trend oldest first from the versions that have the figure", () => {
    const versions = [
      summary(4, { passRate: 0.9 }),
      summary(3),
      summary(2, { passRate: 0.5 }),
      summary(1, { passRate: 0.25 }),
    ];
    expect(versionTrend(versions, (version) => version.passRate)).toEqual([
      { version: 1, value: 0.25 },
      { version: 2, value: 0.5 },
      { version: 4, value: 0.9 },
    ]);
    expect(versionTrend([summary(2, { passRate: 1 }), summary(1)], (v) => v.passRate)).toBeNull();
  });

  it("names what a version changed", () => {
    expect(versionChangeText(summary(3, { changed: ["instructions", "vaultSlots"] }))).toBe(
      "Changed Instructions and Credentials.",
    );
    expect(versionChangeText(summary(1))).toBe("First version.");
    expect(versionChangeText(summary(2))).toBe("Nothing changed from the one before.");
  });
});
