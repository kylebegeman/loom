import * as Schema from "effect/Schema";

// Object unions already validate each alternative. MCP additionally requires an explicit root type.
export const objectInput = Schema.makeFilter(() => true, {
  toJsonSchema: () => ({ type: "object" }),
});
