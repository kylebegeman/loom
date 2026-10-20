import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition } from "@t3tools/contracts/fork";
import {
  batchSourceFromDraft,
  botDraft,
  checkoutChoices,
  defaultItemParameter,
  emptyBatchSourceDraft,
  emptyBotDraft,
  initialRunValues,
  newParameterDraft,
  runInputs,
  saveInputFromDraft,
  slugFromName,
} from "./draft";

const model = { instanceId: ProviderInstanceId.make("codex"), model: "test" };

const bot: BotDefinition = {
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews a file.",
  instructions: "Review {{file}} at depth {{depth}}.",
  parameters: [
    { name: "file", label: "File", type: "string", required: true },
    { name: "depth", label: "Depth", type: "number", required: false, default: "2" },
    { name: "strict", label: "Strict", type: "boolean", required: false },
    { name: "notes", label: "Notes", type: "text", required: false },
  ],
  modelSelection: model,
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "project", projectId: null, worktree: true, baseRef: "main" },
  timeoutMinutes: 10,
  maxConcurrentRuns: 3,
  scopeProjectId: ProjectId.make("project-a"),
  version: 4,
  createdBy: "user",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  archivedAt: null,
};

describe("bot drafts", () => {
  it("round-trips a saved bot through the form", () => {
    const result = saveInputFromDraft(botDraft(bot), bot.version);
    const {
      version: _version,
      createdBy: _createdBy,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      archivedAt: _archivedAt,
      ...definition
    } = bot;
    expect(result).toEqual({ ok: true, input: { ...definition, expectedVersion: 4 } });
  });

  it("names the field to fix instead of a schema path", () => {
    const draft = { ...emptyBotDraft(model), id: slugFromName("  Merge Resolver! "), name: "x" };
    expect(draft.id).toBe("merge-resolver");
    expect(saveInputFromDraft(draft, undefined)).toEqual({
      ok: false,
      message: "Write the bot's instructions.",
    });
    expect(
      saveInputFromDraft(
        {
          ...draft,
          instructions: "Resolve.",
          parameters: [{ ...newParameterDraft(), name: "file", type: "choice" }],
        },
        undefined,
      ),
    ).toEqual({ ok: false, message: "List at least one choice for file." });
    expect(saveInputFromDraft({ ...draft, modelSelection: null }, undefined)).toEqual({
      ok: false,
      message: "Choose a model.",
    });
  });

  it("types run form values and leaves blank optional inputs to their defaults", () => {
    const values = initialRunValues(bot);
    expect(values).toEqual({ file: "", depth: "2", strict: "false", notes: "" });
    expect(runInputs(bot, { ...values, file: "a.ts", strict: "true" })).toEqual({
      file: "a.ts",
      depth: 2,
      strict: true,
    });
  });

  it("keeps a checkout bot running in the checkout it is run for", () => {
    const checkoutBot: BotDefinition = {
      ...bot,
      workspace: { type: "project", projectId: null, worktree: false, checkout: "caller" },
    };
    const draft = botDraft(checkoutBot);
    expect(draft.workspace).toBe("checkout");
    const saved = saveInputFromDraft(draft, checkoutBot.version);
    expect(saved.ok && saved.input.workspace).toEqual(checkoutBot.workspace);
  });

  it("sends a verdict reply and leaves the text default unsaid", () => {
    const verdictBot: BotDefinition = { ...bot, output: "verdict" };
    const saved = saveInputFromDraft(botDraft(verdictBot), verdictBot.version);
    expect(saved.ok && saved.input.output).toBe("verdict");
    const text = saveInputFromDraft({ ...botDraft(verdictBot), output: "text" }, 4);
    expect(text.ok && "output" in text.input).toBe(false);
  });

  it("sends a budget only when a limit is set, accepting thousands separators", () => {
    const budgeted: BotDefinition = { ...bot, budget: { runsPerDay: 50 } };
    const draft = { ...botDraft(budgeted), tokensPerDay: "2,000,000" };
    const saved = saveInputFromDraft(draft, budgeted.version);
    expect(saved.ok && saved.input.budget).toEqual({ runsPerDay: 50, tokensPerDay: 2_000_000 });
    const cleared = saveInputFromDraft({ ...draft, runsPerDay: "", tokensPerDay: " " }, 4);
    expect(cleared.ok && "budget" in cleared.input).toBe(false);
    expect(saveInputFromDraft({ ...draft, tokensPerDay: "500" }, 4)).toEqual({
      ok: false,
      message:
        "Tokens per 24 hours is a whole number from 1,000 to 10 billion, or empty for no limit.",
    });
  });

  it("offers one checkout per live worktree of the project, newest first", () => {
    const shell = (id: string, worktreePath: string | null, updatedAt: string, extra = {}) => ({
      id: ThreadId.make(id),
      projectId: ProjectId.make("project-a"),
      title: id,
      branch: worktreePath === null ? null : `branch-${worktreePath}`,
      worktreePath,
      archivedAt: null,
      updatedAt,
      ...extra,
    });
    const choices = checkoutChoices(
      [
        shell("old", "/wt/a", "2026-10-20T09:00:00.000Z"),
        shell("new", "/wt/a", "2026-10-20T11:00:00.000Z"),
        shell("other", "/wt/b", "2026-10-20T10:00:00.000Z"),
        shell("root", null, "2026-10-20T12:00:00.000Z"),
        shell("archived", "/wt/c", "2026-10-20T12:00:00.000Z", { archivedAt: "2026-10-20" }),
        shell("bot-run-1", "/wt/d", "2026-10-20T12:00:00.000Z"),
        shell("elsewhere", "/wt/e", "2026-10-20T12:00:00.000Z", {
          projectId: ProjectId.make("project-b"),
        }),
      ],
      "project-a",
    );
    expect(choices.map((choice) => choice.threadId)).toEqual(["new", "other"]);
    expect(choices[0]?.label).toBe("branch-/wt/a (new)");
  });
});

describe("batch source drafts", () => {
  it("sends nothing until the source is filled in, and trims what it sends", () => {
    expect(batchSourceFromDraft(emptyBatchSourceDraft)).toBeNull();
    expect(
      batchSourceFromDraft({ ...emptyBatchSourceDraft, type: "glob", pattern: "  " }),
    ).toBeNull();
    expect(
      batchSourceFromDraft({
        ...emptyBatchSourceDraft,
        type: "glob",
        pattern: " src/**/*.ts ",
        checkoutThreadId: "thread-a",
      }),
    ).toEqual({
      type: "glob",
      pattern: "src/**/*.ts",
      checkoutThreadId: ThreadId.make("thread-a"),
    });
    expect(batchSourceFromDraft({ ...emptyBatchSourceDraft, type: "conflicts" })).toEqual({
      type: "conflicts",
    });
    expect(batchSourceFromDraft({ ...emptyBatchSourceDraft, type: "pullRequests" })).toEqual({
      type: "pullRequests",
    });
    expect(
      batchSourceFromDraft({
        ...emptyBatchSourceDraft,
        type: "search",
        searchMode: "contents",
        query: " TODO ",
      }),
    ).toEqual({ type: "search", mode: "contents", query: "TODO" });
  });

  it("fills the first required text input with each item", () => {
    expect(defaultItemParameter(bot)).toBe("file");
    expect(
      defaultItemParameter({
        ...bot,
        parameters: bot.parameters.filter((parameter) => parameter.name !== "file"),
      }),
    ).toBe("depth");
    expect(defaultItemParameter({ ...bot, parameters: [] })).toBe("");
  });
});
