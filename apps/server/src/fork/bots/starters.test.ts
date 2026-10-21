import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import { BotDefinitionInput } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { checkParameters } from "./render.ts";
import { BOT_STARTERS } from "./starters.ts";

const decodeDefinition = Schema.decodeUnknownSync(BotDefinitionInput);

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

describe("BOT_STARTERS", () => {
  it.each(BOT_STARTERS.map((starter) => [starter.starterId, starter] as const))(
    "%s is a valid bot whose placeholders all name its inputs",
    (_id, starter) => {
      const definition = decodeDefinition({
        ...starter.definition,
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
        scopeProjectId: null,
      });
      expect(definition.id).toBe(starter.starterId);
      expect(checkParameters(definition)).toBeNull();
      const names = new Set(definition.parameters.map((parameter) => parameter.name));
      for (const [, name] of definition.instructions.matchAll(PLACEHOLDER))
        expect(names).toContain(name);
    },
  );

  it("keeps the reviewer read-only and the resolver in the caller's checkout", () => {
    const byId = new Map(BOT_STARTERS.map((starter) => [starter.starterId, starter.definition]));
    expect(byId.get("reviewer")).toMatchObject({
      runtimeMode: "approval-required",
      interactionMode: "plan",
    });
    expect(byId.get("merge-conflict-resolver")?.workspace).toMatchObject({
      worktree: false,
      checkout: "caller",
    });
  });
});
