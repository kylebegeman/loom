import { expect, it } from "@effect/vitest";
import * as SchemaAST from "effect/SchemaAST";
import { FORK_MCP_TOOLKITS } from "./index.ts";

// A declaration left in a tool's encoded output (DateTime.Utc, for one) is not JSON, and MCP
// rejects the whole call result. Encode such tools through Schema.toCodecJson.
const nonJsonDeclarations = (root: SchemaAST.AST): ReadonlyArray<string> => {
  const found = new Set<string>();
  const seen = new Set<SchemaAST.AST>();
  const walk = (ast: SchemaAST.AST): void => {
    if (seen.has(ast)) return;
    seen.add(ast);
    if (SchemaAST.isDeclaration(ast)) {
      found.add(String(ast.annotations?.expected ?? "declaration"));
      ast.typeParameters.forEach(walk);
    } else if (SchemaAST.isObjects(ast)) {
      ast.propertySignatures.forEach((property) => walk(property.type));
      ast.indexSignatures.forEach((index) => walk(index.type));
    } else if (SchemaAST.isArrays(ast)) {
      ast.elements.forEach(walk);
      ast.rest.forEach(walk);
    } else if (SchemaAST.isUnion(ast)) {
      ast.types.forEach(walk);
    } else if (SchemaAST.isSuspend(ast)) {
      walk(ast.thunk());
    }
  };
  walk(SchemaAST.toEncoded(root));
  return [...found];
};

it("encodes every fork tool's result as plain JSON", () => {
  const offenders = FORK_MCP_TOOLKITS.flatMap(({ toolkit }) =>
    Object.values(toolkit.tools).flatMap((tool) => {
      const found = nonJsonDeclarations(tool.successSchema.ast);
      return found.length === 0 ? [] : [`${tool.name}: ${found.join(", ")}`];
    }),
  );
  expect(offenders).toEqual([]);
});
