import { describe, expect, it } from "vite-plus/test";
import { ProjectId } from "@t3tools/contracts";
import { defaultProjectProfile } from "@t3tools/contracts/fork";
import { buildProfilePatch, mixedValue } from "./profileDraft";

describe("scoped project profile drafts", () => {
  const first = {
    ...defaultProjectProfile(ProjectId.make("one")),
    agentNotes: "Private on one",
    commands: { test: { _tag: "action" as const, scriptId: "one-test" } },
    budgets: { dailyTokens: 1000, threadTokens: 100 },
    env: { schemaPath: "config/one.schema", varlock: "never" as const },
  };
  const second = {
    ...first,
    projectId: ProjectId.make("two"),
    budgets: { dailyTokens: 2000, threadTokens: 200 },
    env: { schemaPath: "config/two.schema", varlock: "auto" as const },
  };
  it("updates only edited fields, preserving each checkout's other settings", () => {
    for (const profile of [first, second]) {
      expect(buildProfilePatch(profile, { dailyTokens: 3000 })).toEqual({
        budgets: { dailyTokens: 3000, threadTokens: profile.budgets.threadTokens },
      });
      expect(buildProfilePatch(profile, { varlock: "never" })).toEqual({
        env: { schemaPath: profile.env.schemaPath, varlock: "never" },
      });
      expect(buildProfilePatch(profile, {})).toEqual({});
    }
  });
  it("can remove one mapping, clear a budget, and edit a literal without changing other intents", () => {
    expect(
      buildProfilePatch(first, {
        commands: { test: null, build: { _tag: "command", command: "vp build" } },
        threadTokens: null,
        agentNotes: "",
        bindings: [{ kind: "reviewer", id: "review" }],
      }),
    ).toEqual({
      agentNotes: "",
      budgets: { dailyTokens: 1000, threadTokens: null },
      commands: { build: { _tag: "command", command: "vp build" } },
      bindings: [{ kind: "reviewer", id: "review" }],
    });
  });
  it("distinguishes mixed values from empty or unset values", () => {
    expect(mixedValue([first.env.schemaPath, second.env.schemaPath])).toEqual({
      value: undefined,
      mixed: true,
    });
    expect(mixedValue(["", ""])).toEqual({ value: "", mixed: false });
    expect(mixedValue([undefined, undefined])).toEqual({ value: undefined, mixed: false });
  });
});
