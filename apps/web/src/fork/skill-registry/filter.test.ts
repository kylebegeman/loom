import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { SkillRegistryEntry } from "@t3tools/contracts/fork";
import { filterSkills } from "./filter";

describe("skill inventory filtering", () => {
  it("combines account, scope and availability on the same native report", () => {
    const entry: SkillRegistryEntry = {
      key: "one",
      name: "review",
      description: "Review changes",
      locations: [],
      visibility: [
        {
          instanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
          scope: "user",
          enabled: true,
          userInvocationOnly: false,
          userInvocable: true,
          toggle: "codex",
        },
        {
          instanceId: ProviderInstanceId.make("claude"),
          driver: ProviderDriverKind.make("claude"),
          scope: "project",
          enabled: false,
          userInvocationOnly: false,
          userInvocable: true,
          toggle: "claude",
        },
      ],
      install: null,
      editable: true,
      containsScripts: false,
      currentHash: null,
      modified: false,
      problems: [],
    };
    expect(filterSkills([entry], "REVIEW", "codex", "all", "off")).toEqual([]);
    expect(filterSkills([entry], "", "codex", "project", "all")).toEqual([]);
    expect(filterSkills([entry], "review", "claude", "project", "off")).toEqual([entry]);
    const undiscovered = {
      ...entry,
      visibility: [],
      problems: [{ code: "invalid", severity: "error" as const, message: "Invalid YAML" }],
    };
    expect(filterSkills([undiscovered], "", "all", "all", "problem")).toEqual([undiscovered]);
    expect(filterSkills([undiscovered], "", "all", "all", "on")).toEqual([]);
  });
});
