import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { BotDefinitionInput } from "@t3tools/contracts/fork";
import { Schema } from "effect";
import { draftFromBrief, replaceInputs, type DraftSource } from "./draft.ts";

const decodeDraft = Schema.decodeUnknownSync(BotDefinitionInput);

const source = (fields: Partial<DraftSource> = {}): DraftSource => ({
  brief: "Review PR #412 and check apps/web/src/App.tsx",
  attachments: 0,
  title: "Review PR #412",
  projectId: ProjectId.make("project-a"),
  scratch: false,
  worktreePath: null,
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "opus" },
  runtimeMode: "full-access",
  interactionMode: "plan",
  ...fields,
});

describe("draftFromBrief", () => {
  it("turns a pull request and a path into required parameters", () => {
    const { draft, notes } = draftFromBrief(source(), new Set());
    expect(draft.instructions).toBe("Review PR #{{pr}} and check {{file}}");
    expect(draft.parameters).toEqual([
      {
        name: "pr",
        label: "Pull request",
        description: "For example 412",
        type: "number",
        required: true,
      },
      {
        name: "file",
        label: "File",
        description: "For example apps/web/src/App.tsx",
        type: "string",
        required: true,
      },
    ]);
    expect(notes).toContain("2 values became parameters.");
  });

  it("uses one placeholder for a repeated path", () => {
    const { text, placeholders } = replaceInputs("Open src/a.ts, then fix src/a.ts and src/b.ts.");
    expect(text).toBe("Open {{file}}, then fix {{file}} and {{file2}}.");
    expect(placeholders.map((placeholder) => placeholder.name)).toEqual(["file", "file2"]);
  });

  it("leaves fenced code alone", () => {
    const brief = "Fix src/a.ts like this:\n```\nimport x from 'src/b.ts'; // #12\n```\nThen #13.";
    expect(replaceInputs(brief).text).toBe(
      "Fix {{file}} like this:\n```\nimport x from 'src/b.ts'; // #12\n```\nThen #{{pr}}.",
    );
  });

  it("keeps URLs whole except a pull request number", () => {
    const { text, placeholders } = replaceInputs(
      "See https://example.com/docs/guide.html and https://github.com/a/b/pull/77/files",
    );
    expect(text).toBe(
      "See https://example.com/docs/guide.html and https://github.com/a/b/pull/{{pr}}/files",
    );
    expect(placeholders).toEqual([expect.objectContaining({ name: "pr", value: "77" })]);
  });

  it("stops at six values and says so", () => {
    const brief = "Check a/1.ts a/2.ts a/3.ts a/4.ts a/5.ts a/6.ts a/7.ts";
    const { draft, notes } = draftFromBrief(source({ brief }), new Set());
    expect(draft.parameters).toHaveLength(6);
    expect(draft.instructions).toContain("a/7.ts");
    expect(notes).toContain(
      "Only the first 6 values became parameters; 1 more was left as written.",
    );
  });

  it("cuts a long brief and still decodes", () => {
    const { draft, notes } = draftFromBrief(source({ brief: "word ".repeat(5_000) }), new Set());
    expect(draft.instructions.length).toBeLessThanOrEqual(20_000);
    expect(notes).toContain("The brief was cut to 20,000 characters.");
    expect(() => decodeDraft(draft)).not.toThrow();
  });

  it("names the bot without the replaced values and avoids taken ids", () => {
    expect(draftFromBrief(source(), new Set()).draft).toMatchObject({
      name: "Review",
      id: "review",
    });
    const fix = draftFromBrief(
      source({ title: "Fix flaky test in src/a.test.ts", brief: "Fix src/a.test.ts" }),
      new Set(["fix-flaky-test"]),
    ).draft;
    expect(fix).toMatchObject({ name: "Fix flaky test", id: "fix-flaky-test-2" });
  });

  it("copies the thread's settings and worktree", () => {
    const { draft, notes } = draftFromBrief(source({ worktreePath: "/w/tree" }), new Set());
    expect(draft).toMatchObject({
      modelSelection: { instanceId: "claude", model: "opus" },
      runtimeMode: "full-access",
      interactionMode: "plan",
      workspace: { type: "project", projectId: "project-a", worktree: true },
      scopeProjectId: "project-a",
    });
    expect(notes).toContain("The thread used a worktree, so each run gets a new worktree too.");
    expect(draftFromBrief(source({ scratch: true, attachments: 2 }), new Set())).toMatchObject({
      draft: { workspace: { type: "scratch" }, scopeProjectId: null },
      notes: expect.arrayContaining([
        "The first message had attachments, which a bot cannot carry; they were left out.",
      ]),
    });
  });
});
