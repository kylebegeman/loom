import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { BotDefinitionInput } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { draftFromText } from "./import.ts";

const input = (text: string) => ({
  text,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "example" },
  projectId: ProjectId.make("project-a"),
});
const decode = Schema.decodeUnknownSync(BotDefinitionInput);

describe("draftFromText", () => {
  it("preserves existing inputs and avoids collisions when suggesting more", () => {
    const result = draftFromText(
      input("Review {{file}} and fix src/a.ts for {{target}}."),
      new Set(),
    );
    const entry = result.drafts[0]!;
    expect(entry.draft.instructions).toBe("Review {{file}} and fix {{file2}} for {{target}}.");
    expect(entry.draft.parameters.map((parameter) => parameter.name)).toEqual([
      "file",
      "target",
      "file2",
    ]);
    expect(entry.draft).toMatchObject({
      runtimeMode: "approval-required",
      workspace: { type: "project", projectId: "project-a", worktree: false },
    });
    expect(() => decode(entry.draft)).not.toThrow();
  });

  it("imports Markdown and structured exports without trusting saved authority", () => {
    const markdown = draftFromText(
      input(
        "---\ntitle: Improvement pass\nenabled: true\nruntimeMode: full-access\n---\nFix practical issues in {{target}}.",
      ),
      new Set(["improvement-pass"]),
    ).drafts[0]!;
    expect(markdown.sourceFormat).toBe("markdown");
    expect(markdown.intent).toBe("edits");
    expect(markdown.draft.id).toBe("improvement-pass-2");
    expect(markdown.draft.runtimeMode).toBe("approval-required");
    const fenced = draftFromText(
      input(
        '```loom-snippet\n{"id":"old-id","title":"Ideas","body":"Brainstorm ideas. Do not implement changes.","scopes":["global"],"enabled":true}\n```',
      ),
      new Set(),
    ).drafts[0]!;
    expect(fenced).toMatchObject({
      intent: "planning",
      sourceFormat: "snippet",
      draft: {
        id: "ideas",
        runtimeMode: "approval-required",
        interactionMode: "plan",
        scopeProjectId: "project-a",
      },
    });
    expect(fenced.draft).not.toHaveProperty("enabled");
    const ideas = draftFromText(
      input("Generate and prioritize ideas. I will choose which proposals go forward."),
      new Set(),
    ).drafts[0]!;
    expect(ideas).toMatchObject({ intent: "planning", draft: { interactionMode: "plan" } });
  });

  it("returns selectable drafts for a collection with unique ids and actionable failures", () => {
    const result = draftFromText(
      input(
        JSON.stringify([
          { title: "Review", body: "Inspect {{target}}." },
          { title: "Review", body: "Fix issues in {{target}}." },
          { title: "Empty", body: " " },
        ]),
      ),
      new Set(),
    );
    expect(result.drafts.map((entry) => entry.draft.id)).toEqual(["review", "review-2"]);
    expect(result.notes).toContain("Item 3 has no instructions and was left out.");
    expect(() => draftFromText(input("[broken json"), new Set())).toThrow("valid JSON");
    expect(() => draftFromText(input("  "), new Set())).toThrow("Paste");
  });

  it("keeps skill requirements and rejects excessive inputs without truncating instructions", () => {
    const instructions = "Use $example-skill. Fix {{target}}.\n```\nsrc/example.ts\n```";
    expect(draftFromText(input(instructions), new Set()).drafts[0]!.draft.instructions).toBe(
      instructions,
    );
    expect(() => draftFromText(input("x".repeat(20_001)), new Set())).toThrow("20,000");
    expect(() => draftFromText(input("PR #1 ".repeat(2_000)), new Set())).toThrow("20,000");
    expect(() =>
      draftFromText(
        input(Array.from({ length: 13 }, (_, i) => `{{input${i}}}`).join(" ")),
        new Set(),
      ),
    ).toThrow("12 inputs");
  });
});
