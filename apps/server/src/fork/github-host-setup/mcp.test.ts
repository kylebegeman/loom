import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { McpSchema, Tool } from "effect/ai";
import { GitHubHostSetupToolkit } from "./mcp.ts";

const decodeToolInput = Schema.decodeUnknownEffect(McpSchema.ToolJson);
const decodeParameters = Schema.decodeUnknownEffect(
  GitHubHostSetupToolkit.tools.loom_github_host_setup.parametersSchema,
);

it.effect("registers GitHub setup with an MCP-compatible object input schema", () =>
  Effect.gen(function* () {
    const tool = GitHubHostSetupToolkit.tools.loom_github_host_setup;
    const input = yield* decodeToolInput(Tool.getJsonSchema(tool));
    expect(input.type).toBe("object");
  }),
);

it.effect("requires request IDs for mutations while allowing status without one", () =>
  Effect.gen(function* () {
    const decode = decodeParameters;
    expect(yield* decode({ action: "status" })).toEqual({ action: "status" });
    for (const action of ["start", "cancel"]) {
      expect((yield* decode({ action }).pipe(Effect.flip))._tag).toBe("SchemaError");
      expect((yield* decode({ action, requestId: "" }).pipe(Effect.flip))._tag).toBe("SchemaError");
      expect(yield* decode({ action, requestId: "test-request" })).toEqual({
        action,
        requestId: "test-request",
      });
    }
  }),
);
