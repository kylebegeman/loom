import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import type { BotDefinition } from "@t3tools/contracts/fork";
import {
  botDraft,
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
});
