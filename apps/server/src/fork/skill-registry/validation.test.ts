import { describe, expect, it } from "vite-plus/test";
import { validateSkill } from "./validation.ts";

describe("skill validation", () => {
  it("reads folded descriptions and Claude's YAML boolean conventions", () => {
    const validated = validateSkill(
      "---\nname: ship\ndescription: >-\n  Use only when explicitly requested.\ndisable-model-invocation: yes\nuser-invocable: off\n---\n\nReview before shipping.",
      "ship",
    );
    expect(validated).toMatchObject({
      name: "ship",
      description: "Use only when explicitly requested.",
      userInvocationOnly: true,
      userInvocable: false,
      issues: [],
    });
  });
  it("rejects duplicate YAML keys and malformed metadata instead of guessing", () => {
    for (const text of [
      "name: ship",
      "---\n- ship\n---\nbody",
      "---\nname: first\nname: second\n---\nbody",
    ])
      expect(validateSkill(text, "ship").issues.some((issue) => issue.severity === "error")).toBe(
        true,
      );
  });
  it("warns on portable naming differences without pretending to change provider discovery", () => {
    const validation = validateSkill(
      "---\nname: Other\ndescription: Explain\ncustom: value\n---\nbody",
      "folder",
    );
    expect(validation.issues.map((issue) => [issue.code, issue.severity])).toEqual([
      ["nameMismatch", "warning"],
      ["unknownKey", "warning"],
    ]);
  });
  it("rejects empty instructions, invalid invocation controls and oversized descriptions", () => {
    const validation = validateSkill(
      `---\nname: skill\ndescription: ${"x".repeat(1025)}\nuser-invocable: sometimes\n---\n`,
      "skill",
    );
    expect(validation.issues.map((issue) => issue.code)).toEqual([
      "description",
      "boolean",
      "body",
    ]);
  });
});
